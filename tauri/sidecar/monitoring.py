"""Typed, schema-checked MONITORING repository and guarded transaction handler.

This module is intentionally independent of FastAPI/Rust routing. Call
``handle(connection, request)`` with one acquired python-oracledb connection and
an action mapping (``load``, ``apply``, ``verify`` or ``history``). Every result
is JSON-safe and reports an explicit state. The handler owns transaction
commit/rollback for ``apply``; callers own connection acquisition/release.

Rows use the Monitoring Query typed value contract: NUMBER, DATE, TIMESTAMP and
CLOB values are wrapper objects, SQL NULL is ``None``, and character values are
preserved exactly:

* NUMBER: ``{"type":"number","value":"12.50"}`` (decimal text, no float)
* DATE: ``{"type":"date","value":"2026-10-13T10:15:30"}``
* TIMESTAMP: ``{"type":"timestamp","precision":6,"value":"2026-10-13T10:15:30.123456"}``
* CLOB: ``{"type":"clob","value":"full text"}``

Action requests are JSON-like mappings:

* ``load`` accepts an optional ``menuId`` and ``pageSize``; without ``menuId``
  it returns the complete configuration graph and ID inventories.
* ``apply`` requires ``identity``, ``fingerprint``, ``requestId``, ``changeId``,
  ``actor`` and ``operations``. Each operation is an explicit ``INSERT`` with
  ``baseline: None`` or ``UPDATE`` with complete typed ``baseline`` and
  ``desired`` rows.
* ``verify`` takes ``identity``, ``fingerprint`` and expected ``operations``.
  Audit-backed reconciliation also supplies the original ``requestId``,
  ``changeId`` and ``actor``. ``outcomeUnknown: true`` without a change ID is
  rejected as requiring reconciliation.
* ``history`` requires ``menuId``; ``offset`` and ``pageSize`` page summaries,
  while ``changeId`` or ``auditIds`` load transaction detail lazily.

Results use JSON-safe dictionaries with ``ok``, ``action`` and ``state``;
Oracle audit IDs are emitted as exact decimal strings so JavaScript cannot
round large NUMBER values. History summaries report ``groupComplete`` and
``expectedOperationCount``; menu-scoped summaries can be incomplete when a
transaction touches other menus. Failures include an ``error`` object with a
code, message and optional details. See docs/monitoring/PRD.md MQ-14 through
MQ-17 for the product contract.
"""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Mapping


SCHEMA = "MONITORING"
MANAGED_TABLES = (
    "DSH_MENU",
    "DSH_SUMMARY_GROUP",
    "DSH_SUMMARY_FIELD",
    "DSH_DETAIL_TABLE",
    "DSH_DETAIL_COLUMN",
)
READ_ONLY_TABLES = ("DSH_DATASOURCE", "DSH_SUMMARY_QUERY")
AUDIT_TABLE = "DSH_CONFIG_AUDIT"
ALL_TABLES = MANAGED_TABLES + READ_ONLY_TABLES + (AUDIT_TABLE,)
PAGE_SIZE_DEFAULT = 200
PAGE_SIZE_MAX = 500


def _column(kind: str, *, nullable: bool = False, length: int | None = None,
            precision: int | None = None, scale: int | None = None,
            default: str | None = None) -> dict[str, Any]:
    return {"kind": kind, "nullable": nullable, "length": length,
            "precision": precision, "scale": scale, "default": default}


# The read/write projection is deliberately an explicit schema contract. CLOBs
# remain data values; identifiers below are constants and never client input.
TABLE_COLUMNS: dict[str, dict[str, dict[str, Any]]] = {
    "DSH_MENU": {
        "MENU_ID": _column("VARCHAR2", length=50),
        "CHANNEL_NAME": _column("VARCHAR2", length=100),
        "MENU_LABEL": _column("VARCHAR2", length=100),
        "DISPLAY_ORDER": _column("NUMBER", precision=3, scale=0, default="1"),
        "IS_ACTIVE": _column("CHAR", length=1, default="'Y'"),
        "CREATED_BY": _column("VARCHAR2", nullable=True, length=50),
        "CREATED_AT": _column("TIMESTAMP", precision=6, scale=6, default="SYSTIMESTAMP"),
        "UPDATED_BY": _column("VARCHAR2", nullable=True, length=50),
        "UPDATED_AT": _column("TIMESTAMP", nullable=True, precision=6, scale=6),
    },
    "DSH_SUMMARY_GROUP": {
        "GROUP_ID": _column("VARCHAR2", length=50),
        "MENU_ID": _column("VARCHAR2", length=50),
        "DATASOURCE_ID": _column("VARCHAR2", length=30),
        "GROUP_TITLE": _column("VARCHAR2", nullable=True, length=100),
        "SQL_TEXT": _column("CLOB"),
        "TIMEOUT_MS": _column("NUMBER", precision=6, scale=0, default="5000"),
        "DISPLAY_ORDER": _column("NUMBER", precision=3, scale=0, default="1"),
    },
    "DSH_SUMMARY_FIELD": {
        "FIELD_ID": _column("VARCHAR2", length=50),
        "GROUP_ID": _column("VARCHAR2", length=50),
        "FIELD_TITLE": _column("VARCHAR2", length=100),
        "SOURCE_FIELD": _column("VARCHAR2", length=50),
        "VALUE_FORMAT": _column("VARCHAR2", length=20, default="'text'"),
        "TONE": _column("VARCHAR2", nullable=True, length=10),
        "DISPLAY_ORDER": _column("NUMBER", precision=3, scale=0, default="1"),
    },
    "DSH_DETAIL_TABLE": {
        "TABLE_ID": _column("VARCHAR2", length=50),
        "MENU_ID": _column("VARCHAR2", length=50),
        "DATASOURCE_ID": _column("VARCHAR2", length=30),
        "TABLE_TITLE": _column("VARCHAR2", length=150),
        "TONE": _column("VARCHAR2", nullable=True, length=10),
        "PAGE_SIZE": _column("NUMBER", precision=3, scale=0, default="10"),
        "SQL_TEXT": _column("CLOB"),
        "TIMEOUT_MS": _column("NUMBER", precision=6, scale=0, default="5000"),
        "DISPLAY_ORDER": _column("NUMBER", precision=3, scale=0, default="1"),
        "SHOW_CHART": _column("CHAR", length=1, default="'Y'"),
        "CHART_TYPE": _column("VARCHAR2", nullable=True, length=10),
        "CHART_TITLE": _column("VARCHAR2", nullable=True, length=150),
        "CHART_SQL": _column("CLOB", nullable=True),
        "CHART_LABEL_FIELD": _column("VARCHAR2", nullable=True, length=50),
        "CHART_VALUE_FIELD": _column("VARCHAR2", nullable=True, length=50),
        "CHART_VALUE_FORMAT": _column("VARCHAR2", nullable=True, length=20, default="'number'"),
    },
    "DSH_DETAIL_COLUMN": {
        "COLUMN_ID": _column("VARCHAR2", length=50),
        "TABLE_ID": _column("VARCHAR2", length=50),
        "COLUMN_TITLE": _column("VARCHAR2", length=100),
        "SOURCE_FIELD": _column("VARCHAR2", length=50),
        "VALUE_FORMAT": _column("VARCHAR2", length=20, default="'text'"),
        "ALIGN": _column("VARCHAR2", nullable=True, length=6),
        "DISPLAY_ORDER": _column("NUMBER", precision=3, scale=0, default="1"),
    },
    "DSH_DATASOURCE": {
        "DATASOURCE_ID": _column("VARCHAR2", length=30),
        "DISPLAY_NAME": _column("VARCHAR2", length=100),
        "JDBC_URL": _column("VARCHAR2", length=500),
        "CREDENTIAL_REF": _column("VARCHAR2", length=50),
        "POOL_MAX": _column("NUMBER", precision=3, scale=0, default="5"),
        "CONNECT_TIMEOUT_MS": _column("NUMBER", precision=6, scale=0, default="5000"),
        "DESCRIPTION": _column("VARCHAR2", nullable=True, length=300),
        "IS_ACTIVE": _column("CHAR", length=1, default="'Y'"),
        "CREATED_BY": _column("VARCHAR2", nullable=True, length=50),
        "CREATED_AT": _column("TIMESTAMP", precision=6, scale=6, default="SYSTIMESTAMP"),
    },
    "DSH_SUMMARY_QUERY": {
        "MENU_ID": _column("VARCHAR2", length=50),
        "DATASOURCE_ID": _column("VARCHAR2", length=30),
        "SQL_TEXT": _column("CLOB"),
        "TIMEOUT_MS": _column("NUMBER", precision=6, scale=0, default="5000"),
    },
    "DSH_CONFIG_AUDIT": {
        "AUDIT_ID": _column("NUMBER", default="GENERATED ALWAYS AS IDENTITY"),
        "TABLE_NAME": _column("VARCHAR2", length=30),
        "RECORD_ID": _column("VARCHAR2", length=50),
        "ACTION": _column("VARCHAR2", length=10),
        "OLD_VALUE": _column("CLOB", nullable=True),
        "NEW_VALUE": _column("CLOB", nullable=True),
        "CHANGED_BY": _column("VARCHAR2", nullable=True, length=50),
        "CHANGED_AT": _column("TIMESTAMP", precision=6, scale=6, default="SYSTIMESTAMP"),
    },
}

PRIMARY_KEYS = {
    "DSH_MENU": "MENU_ID",
    "DSH_SUMMARY_GROUP": "GROUP_ID",
    "DSH_SUMMARY_FIELD": "FIELD_ID",
    "DSH_DETAIL_TABLE": "TABLE_ID",
    "DSH_DETAIL_COLUMN": "COLUMN_ID",
    "DSH_DATASOURCE": "DATASOURCE_ID",
    "DSH_SUMMARY_QUERY": "MENU_ID",
    "DSH_CONFIG_AUDIT": "AUDIT_ID",
}

_EXPECTED_CONSTRAINTS: dict[str, dict[str, dict[str, Any]]] = {
    "DSH_MENU": {
        "PK_DSH_MENU": {"type": "P", "columns": ["MENU_ID"]},
        "CK_DSH_MENU_ACTV": {"type": "C", "check": "IS_ACTIVE IN ('Y','N')"},
    },
    "DSH_SUMMARY_GROUP": {
        "PK_DSH_SUM_GROUP2": {"type": "P", "columns": ["GROUP_ID"]},
        "FK_DSH_SUM_GROUP_MENU2": {"type": "R", "columns": ["MENU_ID"], "ref": ["DSH_MENU", "MENU_ID"], "delete": "CASCADE"},
        "FK_DSH_SUM_GROUP_DS": {"type": "R", "columns": ["DATASOURCE_ID"], "ref": ["DSH_DATASOURCE", "DATASOURCE_ID"], "delete": "NO ACTION"},
    },
    "DSH_SUMMARY_FIELD": {
        "PK_DSH_SUM_FIELD": {"type": "P", "columns": ["FIELD_ID"]},
        "CK_DSH_SUM_FIELD_TONE": {"type": "C", "check": "TONE IN ('OK','FAIL','PEND','INFO')"},
    },
    "DSH_DETAIL_TABLE": {
        "PK_DSH_DET_TABLE": {"type": "P", "columns": ["TABLE_ID"]},
        "CK_DSH_DET_TABLE_TONE": {"type": "C", "check": "TONE IN ('OK','FAIL','PEND','INFO')"},
        "CK_DSH_DET_TABLE_SIZE": {"type": "C", "check": "PAGE_SIZE BETWEEN 1 AND 100"},
        "CK_DSH_DET_TABLE_SHOW": {"type": "C", "check": "SHOW_CHART IN ('Y','N')"},
        "CK_DSH_DET_TABLE_CTYP": {"type": "C", "check": "CHART_TYPE IN ('BAR','LINE')"},
        "CK_DSH_DET_TABLE_CHART": {
            "type": "C",
            "check": "CHART_TYPE IS NULL OR (CHART_SQL IS NOT NULL AND CHART_LABEL_FIELD IS NOT NULL AND CHART_VALUE_FIELD IS NOT NULL)",
        },
        "FK_DSH_DET_TABLE_MENU": {"type": "R", "columns": ["MENU_ID"], "ref": ["DSH_MENU", "MENU_ID"], "delete": "CASCADE"},
        "FK_DSH_DET_TABLE_DS": {"type": "R", "columns": ["DATASOURCE_ID"], "ref": ["DSH_DATASOURCE", "DATASOURCE_ID"], "delete": "NO ACTION"},
    },
    "DSH_DETAIL_COLUMN": {
        "PK_DSH_DET_COLUMN": {"type": "P", "columns": ["COLUMN_ID"]},
        "CK_DSH_DET_COL_ALIGN": {"type": "C", "check": "ALIGN IN ('LEFT','RIGHT')"},
        "FK_DSH_DET_COL_TABLE": {"type": "R", "columns": ["TABLE_ID"], "ref": ["DSH_DETAIL_TABLE", "TABLE_ID"], "delete": "CASCADE"},
    },
    "DSH_DATASOURCE": {
        "PK_DSH_DATASOURCE": {"type": "P", "columns": ["DATASOURCE_ID"]},
        "CK_DSH_DATASOURCE_ACTV": {"type": "C", "check": "IS_ACTIVE IN ('Y','N')"},
        "CK_DSH_DATASOURCE_POOL": {"type": "C", "check": "POOL_MAX BETWEEN 1 AND 20"},
    },
    "DSH_SUMMARY_QUERY": {
        "PK_DSH_SUM_QUERY": {"type": "P", "columns": ["MENU_ID"]},
        "FK_DSH_SUM_QUERY_MENU": {"type": "R", "columns": ["MENU_ID"], "ref": ["DSH_MENU", "MENU_ID"], "delete": "CASCADE"},
        "FK_DSH_SUM_QUERY_DS": {"type": "R", "columns": ["DATASOURCE_ID"], "ref": ["DSH_DATASOURCE", "DATASOURCE_ID"], "delete": "NO ACTION"},
    },
    "DSH_CONFIG_AUDIT": {
        "PK_DSH_CONFIG_AUDIT": {"type": "P", "columns": ["AUDIT_ID"]},
    },
}

_CHECK_NORMALIZE = re.compile(r"\s+|\"", re.UNICODE)
_EDITABLE_COLUMNS = {
    "DSH_MENU": {"CHANNEL_NAME", "MENU_LABEL", "DISPLAY_ORDER", "IS_ACTIVE"},
    "DSH_SUMMARY_GROUP": {"DATASOURCE_ID", "GROUP_TITLE", "SQL_TEXT", "TIMEOUT_MS", "DISPLAY_ORDER"},
    "DSH_SUMMARY_FIELD": {"FIELD_TITLE", "SOURCE_FIELD", "VALUE_FORMAT", "TONE", "DISPLAY_ORDER"},
    "DSH_DETAIL_TABLE": {
        "DATASOURCE_ID", "TABLE_TITLE", "TONE", "PAGE_SIZE", "SQL_TEXT", "TIMEOUT_MS",
        "DISPLAY_ORDER", "SHOW_CHART", "CHART_TYPE", "CHART_TITLE", "CHART_SQL",
        "CHART_LABEL_FIELD", "CHART_VALUE_FIELD", "CHART_VALUE_FORMAT",
    },
    "DSH_DETAIL_COLUMN": {"COLUMN_TITLE", "SOURCE_FIELD", "VALUE_FORMAT", "ALIGN", "DISPLAY_ORDER"},
}
_PARENT_COLUMNS = {
    "DSH_SUMMARY_GROUP": {"MENU_ID", "DATASOURCE_ID"},
    "DSH_SUMMARY_FIELD": {"GROUP_ID"},
    "DSH_DETAIL_TABLE": {"MENU_ID", "DATASOURCE_ID"},
    "DSH_DETAIL_COLUMN": {"TABLE_ID"},
}
_INSERT_ORDER = {"DSH_MENU": 0, "DSH_SUMMARY_GROUP": 1, "DSH_DETAIL_TABLE": 1,
                 "DSH_SUMMARY_FIELD": 2, "DSH_DETAIL_COLUMN": 2}


class _MonitoringError(Exception):
    def __init__(self, code: str, message: str, *, state: str = "Failed",
                 details: Any = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.state = state
        self.details = details


@contextmanager
def _cursor(connection: Any):
    cursor = connection.cursor()
    try:
        yield cursor
    finally:
        try:
            cursor.close()
        except Exception:
            pass


def _fetch_all(cursor: Any) -> list[tuple[Any, ...]]:
    rows = []
    while True:
        batch = cursor.fetchmany(PAGE_SIZE_DEFAULT)
        if not batch:
            break
        rows.extend(batch)
    return rows


def _db_identity(connection: Any) -> dict[str, Any]:
    with _cursor(connection) as cursor:
        cursor.execute(
            "SELECT SYS_CONTEXT('USERENV','DB_NAME'), SYS_CONTEXT('USERENV','SERVICE_NAME'), "
            "SYS_CONTEXT('USERENV','CURRENT_SCHEMA'), SYS_CONTEXT('USERENV','SESSION_USER'), "
            "SYS_CONTEXT('USERENV','CURRENT_USER') FROM DUAL"
        )
        row = cursor.fetchone()
    if not row:
        raise _MonitoringError("IDENTITY_UNAVAILABLE", "Oracle did not return database identity.", state="Incompatible")
    return {
        "databaseName": row[0],
        "serviceName": row[1],
        "currentSchema": row[2],
        "sessionUser": row[3],
        "currentUser": row[4],
    }


def _public_identity(identity: Mapping[str, Any], charset: str | None = None) -> dict[str, Any]:
    result = {
        "database": identity.get("databaseName"),
        "service": identity.get("serviceName"),
        "schema": identity.get("currentSchema"),
        "username": identity.get("sessionUser"),
        "currentUser": identity.get("currentUser"),
    }
    if identity.get("connectionProfileId") is not None:
        result["connectionProfileId"] = identity["connectionProfileId"]
    if charset is not None:
        result["characterSet"] = charset
    return result


def _identity_with_profile(connection: Any, request: Mapping[str, Any]) -> dict[str, Any]:
    requested_schema = request.get("schema")
    if requested_schema is not None and str(requested_schema).upper() != SCHEMA:
        raise _MonitoringError("WRONG_SCHEMA", "Monitoring Query only supports the MONITORING schema.", state="Incompatible")
    identity = _db_identity(connection)
    if str(identity["currentSchema"] or "").upper() != SCHEMA:
        raise _MonitoringError("WRONG_SCHEMA", "The current Oracle schema must be MONITORING.", state="Incompatible",
                               details={"currentSchema": identity["currentSchema"]})
    profile_id = request.get("connectionProfileId")
    if profile_id is None and isinstance(request.get("identity"), Mapping):
        profile_id = request["identity"].get("connectionProfileId")
    if profile_id is not None:
        identity["connectionProfileId"] = str(profile_id)
    expected = request.get("identity")
    if isinstance(expected, Mapping):
        aliases = {
            "databaseName": ("databaseName", "database", "dbName"),
            "serviceName": ("serviceName", "service"),
            "currentSchema": ("currentSchema", "schema"),
            "sessionUser": ("sessionUser", "username"),
            "connectionProfileId": ("connectionProfileId", "profileId"),
        }
        mismatches = {}
        for canonical, names in aliases.items():
            value = next((expected[name] for name in names if name in expected), None)
            if value is not None and str(value).upper() != str(identity.get(canonical) or "").upper():
                mismatches[canonical] = {"expected": value, "actual": identity.get(canonical)}
        if mismatches:
            raise _MonitoringError("IDENTITY_MISMATCH", "The connected Oracle identity differs from the reviewed target.",
                                   state="Incompatible", details={"mismatches": mismatches})
    return identity


def _require_expected_identity(request: Mapping[str, Any]) -> None:
    expected = request.get("identity")
    if not isinstance(expected, Mapping):
        raise _MonitoringError("IDENTITY_REQUIRED", "This operation requires the target identity returned by Load.",
                               state="Incompatible")
    required_aliases = {
        "database": ("database", "databaseName", "dbName"),
        "service": ("service", "serviceName"),
        "schema": ("schema", "currentSchema"),
        "username": ("username", "sessionUser"),
    }
    missing = [canonical for canonical, aliases in required_aliases.items()
               if not any(alias in expected and expected[alias] is not None for alias in aliases)]
    if missing:
        raise _MonitoringError("IDENTITY_REQUIRED", "Target identity must include database, service, schema and username.",
                               state="Incompatible", details={"missing": missing})


def _int_or_none(value: Any) -> int | None:
    return int(value) if value is not None else None


def _inspect_metadata(connection: Any, *, include_summary_query: bool = True) -> tuple[dict[str, Any], str]:
    table_names = MANAGED_TABLES + ("DSH_DATASOURCE", AUDIT_TABLE)
    requested = table_names + (("DSH_SUMMARY_QUERY",) if include_summary_query else ())
    names_sql = ",".join(f"'{name}'" for name in requested)
    with _cursor(connection) as cursor:
        cursor.execute(
            "SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, DATA_LENGTH, DATA_PRECISION, DATA_SCALE, "
            "NULLABLE, CHAR_LENGTH, CHAR_USED FROM ALL_TAB_COLUMNS "
            f"WHERE OWNER = '{SCHEMA}' AND TABLE_NAME IN ({names_sql}) "
            "ORDER BY TABLE_NAME, COLUMN_ID"
        )
        column_rows = cursor.fetchall()
        # DATA_DEFAULT is LONG on Oracle releases that expose it through
        # ALL_TAB_COLUMNS; selecting it separately avoids LONG sort/join rules.
        cursor.execute(
            "SELECT TABLE_NAME, COLUMN_NAME, DATA_DEFAULT FROM ALL_TAB_COLUMNS "
            f"WHERE OWNER = '{SCHEMA}' AND TABLE_NAME IN ({names_sql})"
        )
        default_rows = cursor.fetchall()
        cursor.execute(
            "SELECT TABLE_NAME,COLUMN_NAME,GENERATION_TYPE FROM ALL_TAB_IDENTITY_COLS "
            f"WHERE OWNER='{SCHEMA}' AND TABLE_NAME IN ({names_sql})"
        )
        identity_rows = cursor.fetchall()
        cursor.execute(
            "SELECT C.TABLE_NAME, C.CONSTRAINT_NAME, C.CONSTRAINT_TYPE, C.STATUS, C.DELETE_RULE, "
            "C.SEARCH_CONDITION_VC, CC.COLUMN_NAME, CC.POSITION, RC.TABLE_NAME, RCC.COLUMN_NAME "
            "FROM ALL_CONSTRAINTS C "
            "LEFT JOIN ALL_CONS_COLUMNS CC ON CC.OWNER=C.OWNER AND CC.CONSTRAINT_NAME=C.CONSTRAINT_NAME "
            "LEFT JOIN ALL_CONSTRAINTS RC ON RC.OWNER=C.R_OWNER AND RC.CONSTRAINT_NAME=C.R_CONSTRAINT_NAME "
            "LEFT JOIN ALL_CONS_COLUMNS RCC ON RCC.OWNER=RC.OWNER AND RCC.CONSTRAINT_NAME=RC.CONSTRAINT_NAME "
            "AND RCC.POSITION=CC.POSITION "
            f"WHERE C.OWNER='{SCHEMA}' AND C.TABLE_NAME IN ({names_sql}) "
            "ORDER BY C.TABLE_NAME,C.CONSTRAINT_NAME,CC.POSITION"
        )
        constraint_rows = cursor.fetchall()
        cursor.execute(
            "SELECT TABLE_NAME, TRIGGER_NAME, STATUS FROM ALL_TRIGGERS "
            f"WHERE TABLE_OWNER='{SCHEMA}' AND TABLE_NAME IN ({','.join(repr(n) for n in MANAGED_TABLES + (AUDIT_TABLE,))}) "
            "ORDER BY TABLE_NAME, TRIGGER_NAME"
        )
        trigger_rows = cursor.fetchall()

    actual: dict[str, list[dict[str, Any]]] = {name: [] for name in requested}
    defaults = {(table, column): str(value).strip() if value is not None else None
                for table, column, value in default_rows}
    identity_defaults = {
        (table, column): "GENERATED ALWAYS AS IDENTITY" if str(generation).upper() == "ALWAYS"
        else "GENERATED BY DEFAULT AS IDENTITY"
        for table, column, generation in identity_rows
    }
    for row in column_rows:
        table, name, data_type, data_length, precision, scale, nullable, char_length, char_used = row
        actual.setdefault(table, []).append({
            "name": name,
            "dataType": str(data_type).upper(),
            "dataLength": _int_or_none(data_length),
            "precision": _int_or_none(precision),
            "scale": _int_or_none(scale),
            "nullable": nullable == "Y",
            "charLength": _int_or_none(char_length),
            "charUsed": char_used,
            "default": identity_defaults.get((table, name), defaults.get((table, name))),
        })

    constraints: dict[str, dict[str, dict[str, Any]]] = {name: {} for name in requested}
    for row in constraint_rows:
        table, name, ctype, status, delete_rule, condition, col, position, ref_table, ref_col = row
        if ctype == "C" and re.fullmatch(r'\s*"?[A-Z0-9_$#]+"?\s+IS\s+NOT\s+NULL\s*', str(condition or ""), re.IGNORECASE):
            # Oracle represents inline NOT NULL declarations as generated C
            # constraints as well as exposing NULLABLE='N'. The column contract
            # above already validates that rule; keep synthetic SYS_C names out
            # of the additional-constraint compatibility check.
            continue
        item = constraints.setdefault(table, {}).setdefault(name, {
            "type": ctype,
            "status": status,
            "deleteRule": delete_rule,
            "columns": [],
            "references": [],
            "check": condition,
        })
        if col is not None:
            item["columns"].append((int(position or 0), col))
        if ref_table is not None:
            item["references"].append((int(position or 0), ref_table, ref_col))
    for table_constraints in constraints.values():
        for item in table_constraints.values():
            item["columns"] = [column for _, column in sorted(item["columns"])]
            item["references"] = [[table, column] for _, table, column in sorted(item["references"])]
            item["check"] = str(item["check"] or "")

    mismatches = []
    for table in requested:
        expected_columns = TABLE_COLUMNS[table]
        actual_columns = actual.get(table, [])
        if table == "DSH_SUMMARY_QUERY" and not actual_columns:
            continue
        actual_by_name = {column["name"]: column for column in actual_columns}
        if not actual_columns:
            mismatches.append({"table": table, "issue": "missing table or no visible columns"})
            continue
        extra = sorted(set(actual_by_name) - set(expected_columns))
        missing = sorted(set(expected_columns) - set(actual_by_name))
        if extra or missing:
            mismatches.append({"table": table, "issue": "column set differs", "missing": missing, "extra": extra})
        for column_name, spec in expected_columns.items():
            column = actual_by_name.get(column_name)
            if column is None:
                continue
            expected_type = spec["kind"]
            actual_type = column["dataType"]
            if expected_type == "TIMESTAMP":
                type_ok = bool(re.fullmatch(r"TIMESTAMP(?:\(\d+\))?", actual_type))
            elif expected_type == "NUMBER":
                type_ok = actual_type == "NUMBER"
            else:
                type_ok = actual_type == expected_type
            differences = {}
            if not type_ok:
                differences["dataType"] = {"expected": expected_type, "actual": actual_type}
            if column["nullable"] != spec["nullable"]:
                differences["nullable"] = {"expected": spec["nullable"], "actual": column["nullable"]}
            if spec["length"] is not None and column["charLength"] != spec["length"]:
                differences["charLength"] = {"expected": spec["length"], "actual": column["charLength"]}
            if expected_type != "TIMESTAMP" and spec["precision"] is not None and column["precision"] != spec["precision"]:
                differences["precision"] = {"expected": spec["precision"], "actual": column["precision"]}
            if spec["scale"] is not None and column["scale"] != spec["scale"]:
                differences["scale"] = {"expected": spec["scale"], "actual": column["scale"]}
            if _normalize_default(column["default"]) != _normalize_default(spec["default"]):
                differences["default"] = {"expected": spec["default"], "actual": column["default"]}
            if expected_type in ("VARCHAR2", "CHAR") and column["charUsed"] not in ("B", "C"):
                differences["lengthSemantics"] = {"expected": "BYTE or CHAR", "actual": column["charUsed"]}
            if differences:
                mismatches.append({"table": table, "column": column_name, "differences": differences})

    for table in requested:
        if table == "DSH_SUMMARY_QUERY" and not actual.get(table):
            # Compatibility table is optional; it is read-only and may not have
            # been installed in every compatible MONITORING schema.
            continue
        expected_constraints = _EXPECTED_CONSTRAINTS[table]
        actual_constraints = constraints.get(table, {})
        missing = sorted(set(expected_constraints) - set(actual_constraints))
        extra = sorted(set(actual_constraints) - set(expected_constraints))
        if missing or extra:
            mismatches.append({"table": table, "issue": "constraint set differs", "missing": missing, "extra": extra})
        for name, spec in expected_constraints.items():
            found = actual_constraints.get(name)
            if found is None:
                continue
            differences = {}
            if found["type"] != spec["type"]:
                differences["type"] = {"expected": spec["type"], "actual": found["type"]}
            if found["status"] != "ENABLED":
                differences["status"] = {"expected": "ENABLED", "actual": found["status"]}
            if "columns" in spec and found["columns"] != spec["columns"]:
                differences["columns"] = {"expected": spec["columns"], "actual": found["columns"]}
            if "ref" in spec and found["references"] != [spec["ref"]]:
                differences["references"] = {"expected": [spec["ref"]], "actual": found["references"]}
            if "delete" in spec and str(found["deleteRule"] or "NO ACTION").upper() != spec["delete"]:
                differences["deleteRule"] = {"expected": spec["delete"], "actual": found["deleteRule"]}
            if "check" in spec:
                actual_check = _CHECK_NORMALIZE.sub("", found["check"]).upper()
                expected_check = _CHECK_NORMALIZE.sub("", spec["check"]).upper()
                if actual_check != expected_check:
                    differences["check"] = {"expected": spec["check"], "actual": found["check"]}
            if differences:
                mismatches.append({"table": table, "constraint": name, "differences": differences})

    if trigger_rows:
        mismatches.append({
            "issue": "triggers exist on managed or audit tables",
            "triggers": [{"table": row[0], "name": row[1], "status": row[2]} for row in trigger_rows],
        })
    if mismatches:
        raise _MonitoringError("SCHEMA_INCOMPATIBLE", "MONITORING metadata differs from the supported schema contract.",
                               state="Incompatible", details={"mismatches": mismatches})

    charset = _database_character_set(connection)
    normalized_tables = []
    for table in requested:
        if not actual.get(table):
            continue
        columns = []
        for column in actual[table]:
            timestamp_match = re.fullmatch(r"TIMESTAMP(?:\((\d+)\))?", column["dataType"])
            columns.append({
                "name": column["name"],
                "type": column["dataType"],
                "nullable": column["nullable"],
                "length": column["charLength"] if column["charUsed"] in ("B", "C") else None,
                "charUsed": column["charUsed"],
                "dataLength": column["dataLength"],
                "precision": column["precision"],
                "scale": column["scale"] if column["scale"] is not None else (int(timestamp_match.group(1)) if timestamp_match and timestamp_match.group(1) else None),
                "default": column["default"],
            })
        normalized_tables.append({"name": table, "primaryKey": PRIMARY_KEYS[table], "columns": columns})
    metadata = {"schema": SCHEMA, "tables": normalized_tables, "characterSet": charset,
                "summaryQueryAvailable": bool(actual.get("DSH_SUMMARY_QUERY"))}
    # Include constraint details in the fingerprint even though the public
    # metadata payload is the compact normalized column contract.
    fingerprint_material = {"metadata": metadata, "constraints": constraints}
    return metadata, _fingerprint_metadata(fingerprint_material)


def _normalize_default(value: str | None) -> str | None:
    if value is None:
        return None
    text = re.sub(r"\s+", "", value).upper()
    while text.startswith("(") and text.endswith(")"):
        depth = 0
        wraps_all = True
        for index, char in enumerate(text):
            if char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
                if depth == 0 and index != len(text) - 1:
                    wraps_all = False
                    break
        if not wraps_all:
            break
        text = text[1:-1]
    return text


def _database_character_set(connection: Any) -> str | None:
    with _cursor(connection) as cursor:
        cursor.execute("SELECT VALUE FROM NLS_DATABASE_PARAMETERS WHERE PARAMETER='NLS_CHARACTERSET'")
        row = cursor.fetchone()
    return row[0] if row else None


def _fingerprint_metadata(metadata: Mapping[str, Any]) -> str:
    encoded = json.dumps(metadata, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _fingerprint(identity: Mapping[str, Any], metadata: Mapping[str, Any], metadata_hash: str | None = None) -> str:
    payload = {"identity": _public_identity(identity, metadata.get("characterSet")),
               "metadataFingerprint": metadata_hash or _fingerprint_metadata({"metadata": dict(metadata)})}
    return _fingerprint_metadata(payload)


def _assert_fingerprint(connection: Any, request: Mapping[str, Any], identity: Mapping[str, Any]) -> tuple[dict[str, Any], str]:
    metadata, metadata_hash = _inspect_metadata(connection)
    # The caller presents the same stable public shape returned by load.
    current = _fingerprint(identity, metadata, metadata_hash)
    expected = request.get("fingerprint", request.get("schemaFingerprint"))
    if not isinstance(expected, str) or not expected:
        raise _MonitoringError("FINGERPRINT_REQUIRED", "A schema fingerprint from a complete load is required.",
                               state="Incompatible")
    if expected != current:
        raise _MonitoringError("SCHEMA_FINGERPRINT_MISMATCH", "MONITORING schema identity or metadata changed since load.",
                               state="Incompatible", details={"expected": expected, "actual": current})
    return metadata, current


def _normalize_number(value: Any, spec: Mapping[str, Any]) -> dict[str, str]:
    if isinstance(value, Mapping):
        if set(value) != {"type", "value"} or value.get("type") != "number":
            raise _MonitoringError("INVALID_TYPED_VALUE", "NUMBER values must use the number wrapper.")
        raw = value.get("value")
    else:
        raw = value
    if isinstance(raw, bool) or raw is None:
        raise _MonitoringError("INVALID_TYPED_VALUE", "NUMBER values must be finite decimal values.")
    try:
        number = Decimal(str(raw))
    except (InvalidOperation, ValueError):
        raise _MonitoringError("INVALID_TYPED_VALUE", "NUMBER value is not a valid decimal.") from None
    if not number.is_finite():
        raise _MonitoringError("INVALID_TYPED_VALUE", "NUMBER value must be finite.")
    if number == 0:
        canonical = "0"
    else:
        canonical = format(number.normalize(), "f")
        if "." in canonical:
            canonical = canonical.rstrip("0").rstrip(".")
    precision, scale = spec.get("precision"), spec.get("scale")
    if precision is not None:
        quantum = Decimal(1).scaleb(-int(scale or 0))
        try:
            quantized = number.quantize(quantum)
        except InvalidOperation:
            raise _MonitoringError("INVALID_TYPED_VALUE", "NUMBER precision exceeds the Oracle column precision.") from None
        if quantized != number:
            raise _MonitoringError("INVALID_TYPED_VALUE", "NUMBER scale exceeds the Oracle column scale.")
        if number != 0 and number.adjusted() + 1 > int(precision) - int(scale or 0):
            raise _MonitoringError("INVALID_TYPED_VALUE", "NUMBER precision exceeds the Oracle column precision.")
    return {"type": "number", "value": canonical}


def _parse_datetime_text(value: Any, *, kind: str, precision: int | None = None) -> str:
    if not isinstance(value, str):
        raise _MonitoringError("INVALID_TYPED_VALUE", f"{kind.upper()} value must be an ISO text string.")
    if "Z" in value or re.search(r"[+-]\d\d:\d\d$", value):
        raise _MonitoringError("INVALID_TYPED_VALUE", "Timezone-aware Oracle values are not supported by this schema contract.")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        raise _MonitoringError("INVALID_TYPED_VALUE", f"{kind.upper()} value is not a valid local datetime.") from None
    if parsed.tzinfo is not None:
        raise _MonitoringError("INVALID_TYPED_VALUE", "Timezone-aware Oracle values are not supported by this schema contract.")
    if kind == "date":
        if parsed.microsecond:
            raise _MonitoringError("INVALID_TYPED_VALUE", "Oracle DATE values have second precision.")
        return parsed.strftime("%Y-%m-%dT%H:%M:%S")
    digits = int(precision or 0)
    if digits < 0 or digits > 6:
        raise _MonitoringError("INVALID_TYPED_VALUE", "TIMESTAMP precision is outside the supported range.")
    if digits == 0:
        if parsed.microsecond:
            raise _MonitoringError("INVALID_TYPED_VALUE", "TIMESTAMP value exceeds declared precision.")
        return parsed.strftime("%Y-%m-%dT%H:%M:%S")
    fraction = f"{parsed.microsecond:06d}"
    if any(char != "0" for char in fraction[digits:]):
        raise _MonitoringError("INVALID_TYPED_VALUE", "TIMESTAMP value exceeds declared precision.")
    return parsed.strftime("%Y-%m-%dT%H:%M:%S") + "." + fraction[:digits]


def _normalize_typed(value: Any, spec: Mapping[str, Any], *, charset: str | None = None) -> Any:
    kind = spec["kind"]
    if value is None:
        if not spec["nullable"]:
            raise _MonitoringError("INVALID_TYPED_VALUE", "A required Oracle value cannot be NULL.")
        return None
    if kind == "NUMBER":
        return _normalize_number(value, spec)
    if kind in ("DATE", "TIMESTAMP"):
        if not isinstance(value, Mapping) or value.get("type") != kind.lower():
            raise _MonitoringError("INVALID_TYPED_VALUE", f"{kind} values must use the {kind.lower()} wrapper.")
        expected_keys = {"type", "value"} if kind == "DATE" else {"type", "precision", "value"}
        if set(value) != expected_keys:
            raise _MonitoringError("INVALID_TYPED_VALUE", f"{kind} wrapper has unexpected or missing fields.")
        precision = spec.get("scale", 0)
        if kind == "TIMESTAMP" and value.get("precision") != precision:
            raise _MonitoringError("INVALID_TYPED_VALUE", "TIMESTAMP precision differs from schema metadata.")
        canonical = _parse_datetime_text(value.get("value"), kind=kind.lower(), precision=precision)
        result = {"type": kind.lower(), "value": canonical}
        if kind == "TIMESTAMP":
            result["precision"] = int(precision or 0)
            result = {"type": result["type"], "precision": result["precision"], "value": result["value"]}
        return result
    if kind == "CLOB":
        if not isinstance(value, Mapping) or set(value) != {"type", "value"} or value.get("type") != "clob":
            raise _MonitoringError("INVALID_TYPED_VALUE", "CLOB values must use the clob wrapper.")
        if not isinstance(value.get("value"), str):
            raise _MonitoringError("INVALID_TYPED_VALUE", "CLOB content must be a string.")
        return {"type": "clob", "value": value["value"]}
    if kind in ("VARCHAR2", "CHAR"):
        if not isinstance(value, str):
            raise _MonitoringError("INVALID_TYPED_VALUE", f"{kind} values must be strings or NULL.")
        if value == "":
            if not spec["nullable"]:
                raise _MonitoringError("INVALID_TYPED_VALUE", "A required Oracle value cannot be NULL.")
            return None  # Oracle stores an empty VARCHAR2/CHAR as NULL.
        length = spec.get("length")
        if length is not None and len(value) > int(length):
            raise _MonitoringError("VALUE_TOO_LONG", f"Text exceeds the Oracle {kind} character limit.")
        used = spec.get("charUsed")
        # Character-semantics limits are covered above. For byte semantics use
        # the database charset, and fail closed when it cannot be represented.
        if kind == "VARCHAR2" and used == "B":
            encoding = _python_encoding(charset)
            try:
                byte_length = len(value.encode(encoding))
            except (LookupError, UnicodeEncodeError):
                raise _MonitoringError("CHARSET_UNSUPPORTED", "Text cannot be validated against the database character set.") from None
            max_bytes = spec.get("dataLength")
            if max_bytes is not None and byte_length > int(max_bytes):
                raise _MonitoringError("VALUE_TOO_LONG", "Text exceeds the Oracle VARCHAR2 byte limit.")
        if kind == "CHAR" and len(value) != int(length or 1):
            raise _MonitoringError("INVALID_TYPED_VALUE", "CHAR values must match the declared fixed width.")
        return value
    raise _MonitoringError("SCHEMA_INCOMPATIBLE", "The schema contains an unsupported Oracle column type.", state="Incompatible")


def _python_encoding(charset: str | None) -> str:
    mappings = {
        "AL32UTF8": "utf-8", "UTF8": "utf-8", "AL16UTF16": "utf-16-be",
        "WE8MSWIN1252": "cp1252", "WE8ISO8859P1": "iso8859-1",
        "EE8MSWIN1250": "cp1250", "CL8MSWIN1251": "cp1251",
    }
    if not charset or charset.upper() not in mappings:
        raise _MonitoringError("CHARSET_UNSUPPORTED", "The Oracle database character set is not supported for byte-length validation.",
                               state="Incompatible", details={"characterSet": charset})
    return mappings[charset.upper()]


def _column_specs(metadata: Mapping[str, Any]) -> dict[str, dict[str, dict[str, Any]]]:
    result = {}
    for table_metadata in metadata["tables"]:
        table = table_metadata["name"]
        specs = {name: dict(spec) for name, spec in TABLE_COLUMNS[table].items()}
        actual = {column["name"]: column for column in table_metadata["columns"]}
        for name, spec in specs.items():
            spec.update({
                "dataLength": actual[name].get("dataLength"),
                "charLength": actual[name].get("length"),
                "charUsed": actual[name].get("charUsed"),
            })
            if spec["kind"] == "TIMESTAMP":
                # The declared fractional precision is carried in DATA_SCALE.
                spec["scale"] = actual[name]["scale"]
        result[table] = specs
    return result


def _db_value(value: Any, spec: Mapping[str, Any]) -> Any:
    kind = spec["kind"]
    if value is None:
        return None
    if kind == "NUMBER":
        return _normalize_number(value, spec)
    if kind == "CLOB":
        value = _read_clob_complete(value)
        if not isinstance(value, str):
            raise _MonitoringError("READ_FAILED", "Oracle did not return complete text for a CLOB column.", state="Failed")
        return {"type": "clob", "value": value}
    if kind in ("TIMESTAMP", "DATE"):
        if isinstance(value, str):
            # A connection-level output handler may stringify temporal columns;
            # parsing the explicit ISO representation preserves its value.
            text_value = value
        elif isinstance(value, datetime):
            if value.tzinfo is not None:
                raise _MonitoringError("SCHEMA_INCOMPATIBLE", "Oracle returned an unexpected timezone-aware temporal value.", state="Incompatible")
            text_value = value.strftime("%Y-%m-%dT%H:%M:%S")
            if kind == "TIMESTAMP" and int(spec.get("scale") or 0):
                text_value += "." + f"{value.microsecond:06d}"[:int(spec["scale"])]
        elif isinstance(value, date):
            text_value = value.strftime("%Y-%m-%dT00:00:00")
        else:
            raise _MonitoringError("READ_FAILED", "Oracle returned an unexpected temporal value type.", state="Failed")
        precision = spec.get("scale") if kind == "TIMESTAMP" else None
        normalized = _parse_datetime_text(text_value, kind=kind.lower(), precision=precision)
        if kind == "DATE":
            return {"type": "date", "value": normalized}
        return {"type": "timestamp", "precision": int(precision or 0), "value": normalized}
    return str(value) if kind in ("VARCHAR2", "CHAR") else value


def _read_clob_complete(value: Any) -> Any:
    if not hasattr(value, "read"):
        return value
    expected_size = None
    size = getattr(value, "size", None)
    if callable(size):
        expected_size = size()
    elif size is not None:
        expected_size = size
    content = value.read()
    if expected_size is not None and isinstance(content, str):
        # Oracle LOB sizes count UTF-16 code units; Python len() counts Unicode
        # code points, so a supplementary-plane character contributes two to
        # the Oracle length and one to len().
        read_units = len(content.encode("utf-16-le")) // 2
        if read_units != int(expected_size):
            raise _MonitoringError("INCOMPLETE_CLOB", "Oracle returned a truncated CLOB value.", state="Failed",
                                   details={"expectedCharacters": int(expected_size), "readCharacters": read_units})
    return content


def _row_from_db(row: Iterable[Any], columns: list[str], specs: Mapping[str, Mapping[str, Any]]) -> dict[str, Any]:
    return {name: _db_value(value, specs[name]) for name, value in zip(columns, row)}


def _row_to_db(row: Mapping[str, Any], specs: Mapping[str, Mapping[str, Any]], *, charset: str | None = None,
               allow_missing: bool = False) -> dict[str, Any]:
    unknown = sorted(set(row) - set(specs))
    if unknown:
        raise _MonitoringError("INVALID_ROW", "A row contains columns outside the supported schema.", details={"columns": unknown})
    if not allow_missing:
        missing = sorted(set(specs) - set(row))
        if missing:
            raise _MonitoringError("INVALID_ROW", "A complete baseline or desired row is required.", details={"missingColumns": missing})
    return {name: _normalize_typed(row[name], spec, charset=charset) for name, spec in specs.items() if name in row}


def _canonical_compare(row: Mapping[str, Any]) -> str:
    return json.dumps(row, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _make_db_bind(connection: Any, cursor: Any, value: Any, spec: Mapping[str, Any], lobs: list[Any]) -> Any:
    if value is None:
        return None
    kind = spec["kind"]
    if kind == "CLOB":
        # Bind the complete string as a CLOB (the caller declares the bind type
        # with cursor.setinputsizes). Holding temporary LOB locators across
        # readback/audit DML can invalidate the Oracle connection when those
        # locators are closed after commit (ORA-64219). python-oracledb supports
        # direct string-to-CLOB binds. Empty CLOBs are emitted with EMPTY_CLOB()
        # by the DML builders because Oracle treats a bound empty string as NULL.
        return value["value"]
    if kind == "NUMBER":
        return Decimal(value["value"])
    if kind == "DATE":
        import oracledb
        variable = cursor.var(oracledb.DB_TYPE_DATE)
        variable.setvalue(0, datetime.strptime(value["value"], "%Y-%m-%dT%H:%M:%S"))
        return variable
    if kind == "TIMESTAMP":
        import oracledb
        fmt = "%Y-%m-%dT%H:%M:%S" + (".%f" if value["precision"] else "")
        variable = cursor.var(oracledb.DB_TYPE_TIMESTAMP)
        variable.setvalue(0, datetime.strptime(value["value"], fmt))
        return variable
    return value


def _release_lobs(lobs: Iterable[Any]) -> None:
    for lob in lobs:
        try:
            lob.close()
        except Exception:
            pass


def _sql_projection(table: str, alias: str | None = None) -> str:
    prefix = f'{alias}.' if alias else ""
    return ",".join(f'{prefix}"{column}"' for column in TABLE_COLUMNS[table])


def _read_count(connection: Any, table: str, where: str = "", binds: Mapping[str, Any] | None = None) -> int:
    with _cursor(connection) as cursor:
        cursor.execute(f'SELECT COUNT(*) FROM "{SCHEMA}"."{table}" {where}', dict(binds or {}))
        row = cursor.fetchone()
    return int(row[0] or 0)


def _read_pages(connection: Any, table: str, specs: Mapping[str, Mapping[str, Any]], *, where: str = "",
                 binds: Mapping[str, Any] | None = None, order_by: str | None = None,
                 alias: str | None = None, page_size: int = PAGE_SIZE_DEFAULT) -> list[dict[str, Any]]:
    pk = PRIMARY_KEYS[table]
    projection = _sql_projection(table, alias)
    source = f'"{SCHEMA}"."{table}"' + (f" {alias}" if alias else "")
    count_where = where
    total = _read_count(connection, table, count_where, binds)
    result: list[dict[str, Any]] = []
    offset = 0
    sort = order_by or (f'{alias}."{pk}"' if alias else f'"{pk}"')
    while offset < total:
        sql = f"SELECT {projection} FROM {source} {where} ORDER BY {sort} OFFSET :mq_offset ROWS FETCH NEXT :mq_limit ROWS ONLY"
        page_binds = dict(binds or {})
        page_binds.update({"mq_offset": offset, "mq_limit": page_size})
        with _cursor(connection) as cursor:
            cursor.execute(sql, page_binds)
            columns = [item[0] for item in cursor.description]
            rows = cursor.fetchmany(page_size)
        if not rows:
            break
        result.extend(_row_from_db(row, columns, specs) for row in rows)
        offset += len(rows)
    if len(result) != total:
        raise _MonitoringError("INCOMPLETE_READ", "Oracle page results changed or ended before the complete row count was read.",
                               state="Failed", details={"table": table, "expectedRows": total, "readRows": len(result)})
    return result


def _read_id_inventory(connection: Any, table: str, *, page_size: int = PAGE_SIZE_DEFAULT) -> list[str]:
    key = PRIMARY_KEYS[table]
    total = _read_count(connection, table)
    values: list[str] = []
    offset = 0
    while offset < total:
        with _cursor(connection) as cursor:
            cursor.execute(
                f'SELECT "{key}" FROM "{SCHEMA}"."{table}" ORDER BY "{key}" '
                "OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY",
                {"offset": offset, "limit": page_size},
            )
            rows = cursor.fetchmany(page_size)
        if not rows:
            break
        values.extend(str(row[0]) for row in rows)
        offset += len(rows)
    if len(values) != total:
        raise _MonitoringError("INCOMPLETE_READ", "The global ID inventory is incomplete.", state="Failed",
                               details={"table": table, "expectedRows": total, "readRows": len(values)})
    return values


def _read_datasource_projection(connection: Any, specs: Mapping[str, Mapping[str, Any]], *, page_size: int) -> list[dict[str, Any]]:
    # Never select JDBC_URL or CREDENTIAL_REF, even transiently in the sidecar.
    projection = '"DATASOURCE_ID","DISPLAY_NAME","IS_ACTIVE","POOL_MAX","CONNECT_TIMEOUT_MS"'
    total = _read_count(connection, "DSH_DATASOURCE")
    result = []
    offset = 0
    columns = ["DATASOURCE_ID", "DISPLAY_NAME", "IS_ACTIVE", "POOL_MAX", "CONNECT_TIMEOUT_MS"]
    while offset < total:
        with _cursor(connection) as cursor:
            cursor.execute(
                f'SELECT {projection} FROM "{SCHEMA}"."DSH_DATASOURCE" ORDER BY "DATASOURCE_ID" '
                "OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY",
                {"offset": offset, "limit": page_size},
            )
            rows = cursor.fetchmany(page_size)
        if not rows:
            break
        result.extend(_row_from_db(row, columns, specs["DSH_DATASOURCE"]) for row in rows)
        offset += len(rows)
    if len(result) != total:
        raise _MonitoringError("INCOMPLETE_READ", "Datasource projection was incomplete.", state="Failed",
                               details={"expectedRows": total, "readRows": len(result)})
    return result


def _load(connection: Any, request: Mapping[str, Any]) -> dict[str, Any]:
    identity = _identity_with_profile(connection, request)
    metadata, metadata_hash = _inspect_metadata(connection)
    fingerprint = _fingerprint(identity, metadata, metadata_hash)
    specs = _column_specs(metadata)
    menu_id = request.get("menuId")
    if menu_id is not None and (not isinstance(menu_id, str) or not menu_id):
        raise _MonitoringError("INVALID_MENU_ID", "menuId must be a non-empty string when supplied.")
    page_size = _page_size(request.get("pageSize", PAGE_SIZE_DEFAULT))
    menu_filter = 'WHERE "MENU_ID"=:menu_id' if menu_id is not None else ""
    menu_binds = {"menu_id": menu_id} if menu_id is not None else {}
    menu_rows = _read_pages(connection, "DSH_MENU", specs["DSH_MENU"], where=menu_filter,
                             binds=menu_binds, page_size=page_size)
    if menu_id is not None and len(menu_rows) != 1:
        raise _MonitoringError("MENU_NOT_FOUND", "The selected menu does not exist.", state="Conflict",
                               details={"menuId": menu_id})
    groups = _read_pages(connection, "DSH_SUMMARY_GROUP", specs["DSH_SUMMARY_GROUP"],
                          where=menu_filter, binds=menu_binds, page_size=page_size)
    all_fields = _read_pages(connection, "DSH_SUMMARY_FIELD", specs["DSH_SUMMARY_FIELD"], page_size=page_size)
    group_ids = {row["GROUP_ID"] for row in groups}
    fields = all_fields if menu_id is None else [row for row in all_fields if row["GROUP_ID"] in group_ids]
    all_group_ids = group_ids if menu_id is None else set(_read_id_inventory(
        connection, "DSH_SUMMARY_GROUP", page_size=page_size))
    orphan_fields = [row for row in all_fields if row["GROUP_ID"] not in all_group_ids]
    detail_tables = _read_pages(connection, "DSH_DETAIL_TABLE", specs["DSH_DETAIL_TABLE"],
                                 where=menu_filter, binds=menu_binds, page_size=page_size)
    detail_table_ids = {row["TABLE_ID"] for row in detail_tables}
    all_detail_columns = _read_pages(connection, "DSH_DETAIL_COLUMN", specs["DSH_DETAIL_COLUMN"], page_size=page_size)
    detail_columns = all_detail_columns if menu_id is None else [row for row in all_detail_columns if row["TABLE_ID"] in detail_table_ids]
    datasources = _read_datasource_projection(connection, specs, page_size=page_size)
    summary_queries = []
    if metadata["summaryQueryAvailable"]:
        summary_queries = _read_pages(connection, "DSH_SUMMARY_QUERY", specs["DSH_SUMMARY_QUERY"],
                                      where=menu_filter, binds=menu_binds, page_size=page_size)
    id_inventory = {table: _read_id_inventory(connection, table, page_size=page_size) for table in MANAGED_TABLES}
    public_identity = _public_identity(identity, metadata.get("characterSet"))
    permission_gaps = _dml_privilege_gaps(connection, identity, all_supported=True)
    issues = [{"type": "orphan-summary-field", "row": row} for row in orphan_fields]
    if permission_gaps:
        issues.append({"type": "write-permission", "missing": permission_gaps})
    return {
        "ok": True,
        "action": "load",
        "state": "Loaded",
        "identity": public_identity,
        "fingerprint": fingerprint,
        "schemaFingerprint": fingerprint,
        "metadata": metadata,
        "menuId": menu_id,
        "tables": {
            "DSH_MENU": menu_rows,
            "DSH_SUMMARY_GROUP": groups,
            "DSH_SUMMARY_FIELD": fields,
            "DSH_DETAIL_TABLE": detail_tables,
            "DSH_DETAIL_COLUMN": detail_columns,
            "DSH_DATASOURCE": datasources,
            "DSH_SUMMARY_QUERY": summary_queries,
        },
        "health": {"orphanSummaryFields": orphan_fields},
        "issues": issues,
        "idInventory": id_inventory,
        "complete": True,
        "writable": not permission_gaps,
        "readScope": "complete configuration graph" if menu_id is None else "selected menu hierarchy; all summary fields for orphan detection; all managed primary keys",
    }


def _page_size(value: Any) -> int:
    try:
        value = int(value)
    except (TypeError, ValueError):
        raise _MonitoringError("INVALID_PAGE_SIZE", "Page size must be a positive integer.") from None
    if value < 1 or value > PAGE_SIZE_MAX:
        raise _MonitoringError("INVALID_PAGE_SIZE", f"Page size must be between 1 and {PAGE_SIZE_MAX}.")
    return value


def _public_audit_id(value: Any) -> str:
    """Return Oracle NUMBER identifiers as exact decimal text for JavaScript consumers."""
    return str(int(value))


def _parse_public_audit_id(value: Any) -> int:
    if isinstance(value, bool):
        raise ValueError("Boolean values are not audit IDs.")
    if isinstance(value, int):
        result = value
    elif isinstance(value, str) and re.fullmatch(r"[0-9]+", value):
        result = int(value)
    else:
        raise ValueError("Audit IDs must be unsigned decimal integers.")
    if result < 1:
        raise ValueError("Audit IDs must be positive integers.")
    return result


def _actor(request: Mapping[str, Any], identity: Mapping[str, Any]) -> tuple[str, str]:
    actor = request.get("actor")
    if isinstance(actor, Mapping):
        name = actor.get("name") or actor.get("value")
        source = actor.get("source") or "declared"
    elif isinstance(actor, str) and actor:
        name, source = actor, "declared"
    else:
        name, source = identity.get("sessionUser"), "oracle-session"
    if not isinstance(name, str) or not name:
        raise _MonitoringError("ACTOR_REQUIRED", "A declared actor or connected Oracle user is required.")
    if len(name) > 50:
        raise _MonitoringError("ACTOR_TOO_LONG", "Actor exceeds the DSH_CONFIG_AUDIT.CHANGED_BY limit.")
    if not isinstance(source, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", source):
        raise _MonitoringError("INVALID_ACTOR_SOURCE", "Actor source must be a short identifier.")
    if isinstance(actor, Mapping):
        supplied_database_user = actor.get("databaseUsername")
        if supplied_database_user is not None and str(supplied_database_user).upper() != str(identity.get("sessionUser") or "").upper():
            raise _MonitoringError("IDENTITY_MISMATCH", "Actor databaseUsername does not match the connected Oracle user.",
                                   state="Incompatible")
    return name, source


def _dml_privilege_gaps(connection: Any, identity: Mapping[str, Any],
                        operations: list[dict[str, Any]] | None = None, *, all_supported: bool = False) -> list[dict[str, str]]:
    if str(identity.get("sessionUser") or "").upper() == SCHEMA:
        return []  # Table owner has the required object privileges.
    required: dict[str, set[str]] = {table: set() for table in ALL_TABLES}
    required[AUDIT_TABLE].update({"SELECT", "INSERT"})
    if all_supported:
        for table in MANAGED_TABLES:
            required[table].update({"SELECT", "INSERT", "UPDATE"})
        required["DSH_DATASOURCE"].update({"SELECT", "UPDATE"})
    else:
        operations = operations or []
        insert_keys = {(op["table"], op["key"]) for op in operations if op["action"] == "INSERT"}
        for operation in operations:
            required[operation["table"]].add("SELECT")
            required[operation["table"]].add(operation["action"])
            for parent_table, parent_id in _parent_references(operation):
                if (parent_table, parent_id) in insert_keys:
                    continue
                # SELECT FOR UPDATE requires the row to be lockable for the batch.
                required[parent_table].add("SELECT")
                required[parent_table].add("UPDATE")
    with _cursor(connection) as cursor:
        cursor.execute(
            "SELECT TABLE_NAME,PRIVILEGE FROM ALL_TAB_PRIVS "
            f"WHERE TABLE_SCHEMA='{SCHEMA}' AND TABLE_NAME IN ({','.join(repr(name) for name in ALL_TABLES)}) "
            "AND GRANTEE IN (SELECT ROLE FROM SESSION_ROLES UNION SELECT SYS_CONTEXT('USERENV','SESSION_USER') FROM DUAL "
            "UNION SELECT 'PUBLIC' FROM DUAL)"
        )
        grants = cursor.fetchall()
        cursor.execute("SELECT PRIVILEGE FROM SESSION_PRIVS")
        system_privileges = {str(row[0]).upper() for row in cursor.fetchall()}
    actual: dict[str, set[str]] = {}
    for table, privilege in grants:
        actual.setdefault(table, set()).add(str(privilege).upper())
    gaps = []
    for table, privileges in required.items():
        for privilege in sorted(privileges):
            any_privilege = f"{privilege} ANY TABLE"
            if privilege not in actual.get(table, set()) and any_privilege not in system_privileges:
                gaps.append({"table": table, "privilege": privilege})
    return gaps


def _assert_dml_privileges(connection: Any, identity: Mapping[str, Any], operations: list[dict[str, Any]]) -> None:
    gaps = _dml_privilege_gaps(connection, identity, operations)
    if gaps:
        raise _MonitoringError("ORACLE_PERMISSION", "The connected Oracle user lacks required table privileges.",
                               state="Incompatible", details={"missing": gaps})


def _operation_key(operation: Mapping[str, Any], specs: Mapping[str, Mapping[str, Mapping[str, Any]]]) -> tuple[str, str]:
    table = operation.get("table")
    if table not in MANAGED_TABLES:
        raise _MonitoringError("TABLE_NOT_ALLOWED", "The operation table is outside the five-table allowlist.")
    action = operation.get("action")
    if action not in ("INSERT", "UPDATE"):
        raise _MonitoringError("INTENT_INVALID", "Operation action must be INSERT or UPDATE.")
    desired = operation.get("desired")
    if not isinstance(desired, Mapping):
        raise _MonitoringError("INVALID_ROW", "Every operation requires a typed desired row.")
    key = desired.get(PRIMARY_KEYS[table])
    if not isinstance(key, str) or not key:
        raise _MonitoringError("INVALID_PRIMARY_KEY", "Operation primary key must be a non-empty string.")
    if len(key) > int(specs[table][PRIMARY_KEYS[table]]["length"] or 50):
        raise _MonitoringError("INVALID_PRIMARY_KEY", "Operation primary key exceeds its Oracle column limit.")
    return table, key


def _validate_operations(request: Mapping[str, Any], specs: Mapping[str, Mapping[str, Mapping[str, Any]]],
                         charset: str | None, actor_name: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    operations = request.get("operations")
    if not isinstance(operations, list) or not operations:
        raise _MonitoringError("OPERATIONS_REQUIRED", "Apply requires at least one reviewed operation.")
    prepared = []
    seen = set()
    insert_keys = set()
    for index, raw in enumerate(operations):
        if not isinstance(raw, Mapping):
            raise _MonitoringError("INVALID_OPERATION", "Each operation must be an object.", details={"index": index})
        table, key = _operation_key(raw, specs)
        operation_id = raw.get("operationId")
        if operation_id is not None and (not isinstance(operation_id, str) or not operation_id or len(operation_id) > 128):
            raise _MonitoringError("INVALID_OPERATION_ID", "operationId must be a non-empty string of at most 128 characters.")
        action = raw["action"]
        op_key = (table, key)
        if op_key in seen:
            raise _MonitoringError("DUPLICATE_OPERATION", "A table and primary key may appear only once.", details={"table": table, "primaryKey": key})
        seen.add(op_key)
        desired_raw = raw["desired"]
        baseline_raw = raw.get("baseline")
        if action == "INSERT":
            if baseline_raw is not None:
                raise _MonitoringError("INTENT_INVALID", "INSERT operations must have a null baseline.", details={"table": table, "primaryKey": key})
            desired = _row_to_db(desired_raw, specs[table], charset=charset, allow_missing=True)
            if desired.get(PRIMARY_KEYS[table]) != key:
                raise _MonitoringError("INVALID_PRIMARY_KEY", "Desired row primary key does not match the operation key.")
            backend_generated = {"CREATED_AT", "UPDATED_BY", "UPDATED_AT"} if table == "DSH_MENU" else set()
            missing = sorted(set(specs[table]) - set(desired) - backend_generated)
            if missing:
                raise _MonitoringError("INVALID_ROW", "INSERT requires a complete typed desired row.",
                                       details={"table": table, "missingColumns": missing})
            if table == "DSH_MENU":
                if "CREATED_AT" in desired_raw or "UPDATED_BY" in desired_raw or "UPDATED_AT" in desired_raw:
                    raise _MonitoringError("IMMUTABLE_COLUMN", "Menu audit timestamps and update attributes are backend-managed.")
                if "CREATED_BY" in desired and desired["CREATED_BY"] not in (None, actor_name):
                    raise _MonitoringError("IMMUTABLE_COLUMN", "New menu CREATED_BY must use the declared actor.")
                desired["CREATED_BY"] = actor_name
            insert_keys.add(op_key)
        else:
            if not isinstance(baseline_raw, Mapping):
                raise _MonitoringError("INTENT_INVALID", "UPDATE operations require a complete typed baseline.", details={"table": table, "primaryKey": key})
            baseline = _row_to_db(baseline_raw, specs[table], charset=charset)
            desired = _row_to_db(desired_raw, specs[table], charset=charset)
            if baseline[PRIMARY_KEYS[table]] != key or desired[PRIMARY_KEYS[table]] != key:
                raise _MonitoringError("INVALID_PRIMARY_KEY", "Baseline and desired primary keys must match the operation key.")
            immutable = {PRIMARY_KEYS[table]} | _PARENT_COLUMNS.get(table, set())
            if table == "DSH_MENU":
                immutable |= {"CREATED_BY", "CREATED_AT"}
                if desired["UPDATED_BY"] != baseline["UPDATED_BY"] or desired["UPDATED_AT"] != baseline["UPDATED_AT"]:
                    raise _MonitoringError("IMMUTABLE_COLUMN", "Menu update audit attributes are backend-managed.")
            changed_immutable = [name for name in immutable if baseline.get(name) != desired.get(name)]
            if changed_immutable:
                raise _MonitoringError("IMMUTABLE_COLUMN", "Primary keys, parent IDs and creation attributes cannot be changed.",
                                       details={"columns": sorted(changed_immutable)})
            for name in specs[table]:
                if name not in immutable and name not in _EDITABLE_COLUMNS[table] and baseline.get(name) != desired.get(name):
                    raise _MonitoringError("IMMUTABLE_COLUMN", "An uneditable column changed in the reviewed row.", details={"column": name})
            changed = {name for name in _EDITABLE_COLUMNS[table] if baseline.get(name) != desired.get(name)}
            prepared.append({"index": index, "table": table, "action": action, "key": key,
                             "baseline": baseline, "desired": desired, "changed": changed, "operationId": operation_id})
            continue
        prepared.append({"index": index, "table": table, "action": action, "key": key,
                         "baseline": None, "desired": desired, "changed": set(desired), "operationId": operation_id})
    if len(prepared) > 500:
        raise _MonitoringError("TOO_MANY_OPERATIONS", "A single reviewed transaction is limited to 500 rows.")
    return prepared, list(insert_keys)


def _parent_references(operation: Mapping[str, Any]) -> list[tuple[str, str]]:
    row = operation["desired"]
    table = operation["table"]
    refs = []
    if table in ("DSH_SUMMARY_GROUP", "DSH_DETAIL_TABLE"):
        refs.append(("DSH_MENU", row["MENU_ID"]))
        refs.append(("DSH_DATASOURCE", row["DATASOURCE_ID"]))
    elif table == "DSH_SUMMARY_FIELD":
        refs.append(("DSH_SUMMARY_GROUP", row["GROUP_ID"]))
    elif table == "DSH_DETAIL_COLUMN":
        refs.append(("DSH_DETAIL_TABLE", row["TABLE_ID"]))
    return refs


def _select_one(connection: Any, table: str, key: str, specs: Mapping[str, Mapping[str, Mapping[str, Any]]], *, lock: bool = False) -> dict[str, Any] | None:
    columns = list(TABLE_COLUMNS[table])
    if table == "DSH_DATASOURCE":
        columns = ["DATASOURCE_ID"]
    projection = ",".join(f'"{column}"' for column in columns)
    sql = f'SELECT {projection} FROM "{SCHEMA}"."{table}" WHERE "{PRIMARY_KEYS[table]}"=:pk'
    if lock:
        sql += " FOR UPDATE WAIT 5"
    with _cursor(connection) as cursor:
        cursor.execute(sql, {"pk": key})
        row = cursor.fetchone()
        names = [item[0] for item in cursor.description] if cursor.description else []
    if row is None:
        return None
    return _row_from_db(row, names, specs[table])


def _lock_plan(connection: Any, operations: list[dict[str, Any]], specs: Mapping[str, Mapping[str, Mapping[str, Any]]]) -> tuple[dict[tuple[str, str], dict[str, Any] | None], list[dict[str, Any]]]:
    inserts = {(op["table"], op["key"]) for op in operations if op["action"] == "INSERT"}
    locks: set[tuple[str, str]] = {
        (op["table"], op["key"]) for op in operations if op["action"] == "UPDATE"
    }
    for operation in operations:
        for parent in _parent_references(operation):
            if parent not in inserts:
                locks.add(parent)
    locked: dict[tuple[str, str], dict[str, Any] | None] = {}
    for table, key in sorted(locks, key=lambda item: (item[0], item[1])):
        row = _select_one(connection, table, key, specs, lock=True)
        locked[(table, key)] = row
    return locked, []


def _insert_order(operation: Mapping[str, Any]) -> tuple[int, str, str]:
    return (_INSERT_ORDER[operation["table"]], operation["table"], operation["key"])


def _resolve_menu_id(operation: Mapping[str, Any], prepared: list[dict[str, Any]],
                     locked: Mapping[tuple[str, str], dict[str, Any] | None]) -> str | None:
    table, desired = operation["table"], operation["desired"]
    if table in ("DSH_MENU", "DSH_SUMMARY_GROUP", "DSH_DETAIL_TABLE"):
        return desired.get("MENU_ID") if table != "DSH_MENU" else desired.get("MENU_ID")
    if table == "DSH_SUMMARY_FIELD":
        parent_table, parent_id = "DSH_SUMMARY_GROUP", desired["GROUP_ID"]
    elif table == "DSH_DETAIL_COLUMN":
        parent_table, parent_id = "DSH_DETAIL_TABLE", desired["TABLE_ID"]
    else:
        return None
    parent = locked.get((parent_table, parent_id))
    if parent is not None:
        return parent.get("MENU_ID")
    planned = next((candidate for candidate in prepared
                   if candidate["table"] == parent_table and candidate["key"] == parent_id), None)
    return planned["desired"].get("MENU_ID") if planned else None


def _row_exists(connection: Any, table: str, key: str) -> bool:
    with _cursor(connection) as cursor:
        cursor.execute(f'SELECT 1 FROM "{SCHEMA}"."{table}" WHERE "{PRIMARY_KEYS[table]}"=:pk', {"pk": key})
        return cursor.fetchone() is not None


def _tx_timestamp(connection: Any) -> datetime:
    with _cursor(connection) as cursor:
        cursor.execute("SELECT CAST(SYSTIMESTAMP AS TIMESTAMP(6)) FROM DUAL")
        row = cursor.fetchone()
    if not row or not isinstance(row[0], datetime) or row[0].tzinfo is not None:
        raise _MonitoringError("READ_FAILED", "Oracle did not return a usable transaction timestamp.")
    return row[0]


def _timestamp_wrapper(value: datetime, precision: int = 6) -> dict[str, Any]:
    iso = value.strftime("%Y-%m-%dT%H:%M:%S")
    if precision:
        iso += "." + f"{value.microsecond:06d}"[:precision]
    return {"type": "timestamp", "precision": precision, "value": iso}


def _execute_insert(connection: Any, operation: dict[str, Any], specs: Mapping[str, Mapping[str, Mapping[str, Any]]],
                    actor_name: str, tx_timestamp: datetime, transaction_lobs: list[Any]) -> None:
    table, desired = operation["table"], dict(operation["desired"])
    if table == "DSH_MENU":
        desired["CREATED_BY"] = actor_name
        desired["CREATED_AT"] = _timestamp_wrapper(tx_timestamp)
        desired["UPDATED_BY"] = None
        desired["UPDATED_AT"] = None
        operation["effectiveDesired"] = desired
    cols = [name for name in TABLE_COLUMNS[table] if name in desired]
    binds: dict[str, Any] = {}
    names = []
    values = []
    for index, name in enumerate(cols):
        bind_name = f"v{index}"
        names.append(f'"{name}"')
        if specs[table][name]["kind"] == "CLOB" and desired[name] is not None and desired[name]["value"] == "":
            values.append("EMPTY_CLOB()")
            continue
        values.append(f":{bind_name}")
        binds[bind_name] = _make_db_bind(connection, None, desired[name], specs[table][name], transaction_lobs)
    sql = f'INSERT INTO "{SCHEMA}"."{table}" ({",".join(names)}) VALUES ({",".join(values)})'
    with _cursor(connection) as cursor:
        clob_binds = {f"v{index}": _oracledb_clob_type() for index, name in enumerate(cols)
                      if f"v{index}" in binds and specs[table][name]["kind"] == "CLOB"}
        if clob_binds:
            cursor.setinputsizes(**clob_binds)
        cursor.execute(sql, binds)
        if cursor.rowcount != 1:
            raise _MonitoringError("ROW_COUNT_MISMATCH", "INSERT did not affect exactly one row.", details={"table": table, "primaryKey": operation["key"]})
    operation["effectiveDesired"] = desired


def _execute_update(connection: Any, operation: dict[str, Any], current: Mapping[str, Any],
                    specs: Mapping[str, Mapping[str, Mapping[str, Any]]], actor_name: str,
                    tx_timestamp: datetime, transaction_lobs: list[Any]) -> None:
    table = operation["table"]
    changes = set(operation["changed"])
    if not changes:
        operation["effectiveDesired"] = dict(current)
        return
    desired = dict(current)
    for name in changes:
        desired[name] = operation["desired"][name]
    assignment_columns = sorted(changes)
    if table == "DSH_MENU":
        desired["UPDATED_BY"] = actor_name
        desired["UPDATED_AT"] = _timestamp_wrapper(tx_timestamp)
        assignment_columns.extend(["UPDATED_BY", "UPDATED_AT"])
    binds = {"pk": operation["key"]}
    assignments = []
    with _cursor(connection) as cursor:
        clob_binds = {}
        for index, name in enumerate(assignment_columns):
            bind_name = f"v{index}"
            if specs[table][name]["kind"] == "CLOB" and desired[name] is not None and desired[name]["value"] == "":
                assignments.append(f'"{name}"=EMPTY_CLOB()')
                continue
            assignments.append(f'"{name}"=:{bind_name}')
            binds[bind_name] = _make_db_bind(connection, cursor, desired[name], specs[table][name], transaction_lobs)
            if specs[table][name]["kind"] == "CLOB":
                clob_binds[bind_name] = _oracledb_clob_type()
        if clob_binds:
            cursor.setinputsizes(**clob_binds)
        cursor.execute(
            f'UPDATE "{SCHEMA}"."{table}" SET {",".join(assignments)} '
            f'WHERE "{PRIMARY_KEYS[table]}"=:pk', binds
        )
        if cursor.rowcount != 1:
            raise _MonitoringError("ROW_COUNT_MISMATCH", "UPDATE did not affect exactly one row.", details={"table": table, "primaryKey": operation["key"]})
    operation["effectiveDesired"] = desired


def _read_operation_row(connection: Any, operation: Mapping[str, Any], specs: Mapping[str, Mapping[str, Mapping[str, Any]]]) -> dict[str, Any] | None:
    return _select_one(connection, operation["table"], operation["key"], specs)


def _json_clob_bind(connection: Any, text: str, lobs: list[Any]) -> Any:
    # The audit cursor explicitly declares this bind as DB_TYPE_CLOB. Avoid a
    # temporary locator so audit readback and post-commit cleanup cannot leave
    # the connection with an invalid LOB locator (ORA-64219).
    return text


def _oracledb_clob_type() -> Any:
    import oracledb
    return oracledb.DB_TYPE_CLOB


def _insert_audit_row(connection: Any, *, operation: Mapping[str, Any], before: Mapping[str, Any] | None,
                      after: Mapping[str, Any], envelope_base: Mapping[str, Any], actor_name: str,
                      tx_timestamp: datetime, transaction_lobs: list[Any] | None = None) -> int:
    old_envelope = None if before is None else {**envelope_base, "row": dict(before)}
    new_envelope = {**envelope_base, "row": dict(after)}
    old_text = json.dumps(old_envelope, ensure_ascii=False, separators=(",", ":")) if old_envelope is not None else None
    new_text = json.dumps(new_envelope, ensure_ascii=False, separators=(",", ":"))
    lobs = transaction_lobs if transaction_lobs is not None else []
    release_lobs_here = transaction_lobs is None
    try:
        import oracledb
        with _cursor(connection) as cursor:
            audit_id_var = cursor.var(oracledb.DB_TYPE_NUMBER)
            changed_at_var = cursor.var(oracledb.DB_TYPE_TIMESTAMP)
            changed_at_var.setvalue(0, tx_timestamp)
            binds = {
                "table_name": operation["table"],
                "record_id": operation["key"],
                "action": operation["action"],
                "old_value": _json_clob_bind(connection, old_text, lobs) if old_text is not None else None,
                "new_value": _json_clob_bind(connection, new_text, lobs),
                "changed_by": actor_name,
                "changed_at": changed_at_var,
                "audit_id": audit_id_var,
            }
            cursor.setinputsizes(old_value=oracledb.DB_TYPE_CLOB, new_value=oracledb.DB_TYPE_CLOB)
            cursor.execute(
                f'INSERT INTO "{SCHEMA}"."{AUDIT_TABLE}" '
                '("TABLE_NAME","RECORD_ID","ACTION","OLD_VALUE","NEW_VALUE","CHANGED_BY","CHANGED_AT") '
                'VALUES (:table_name,:record_id,:action,:old_value,:new_value,:changed_by,:changed_at) '
                'RETURNING "AUDIT_ID" INTO :audit_id', binds
            )
            returned = audit_id_var.getvalue()
            if isinstance(returned, list):
                returned = returned[0]
            if returned is None:
                raise _MonitoringError("AUDIT_READBACK_FAILED", "Oracle did not return the generated audit ID.")
            audit_id = int(returned)
    finally:
        if release_lobs_here:
            _release_lobs(lobs)
    with _cursor(connection) as cursor:
        cursor.execute(
            f'SELECT "TABLE_NAME","RECORD_ID","ACTION","OLD_VALUE","NEW_VALUE","CHANGED_BY","CHANGED_AT" '
            f'FROM "{SCHEMA}"."{AUDIT_TABLE}" WHERE "AUDIT_ID"=:audit_id', {"audit_id": audit_id}
        )
        row = cursor.fetchone()
    if row is None:
        raise _MonitoringError("AUDIT_READBACK_FAILED", "The inserted audit record could not be read back.")
    old_read = _read_clob_complete(row[3])
    new_read = _read_clob_complete(row[4])
    expected_actor = actor_name
    if (row[0], row[1], row[2], row[5]) != (operation["table"], operation["key"], operation["action"], expected_actor):
        raise _MonitoringError("AUDIT_READBACK_MISMATCH", "The audit record does not match the reviewed operation.")
    if old_read != old_text or new_read != new_text:
        raise _MonitoringError("AUDIT_READBACK_MISMATCH", "The complete audit envelope did not round-trip exactly.")
    if not isinstance(row[6], datetime) or row[6] != tx_timestamp:
        raise _MonitoringError("AUDIT_READBACK_MISMATCH", "Audit CHANGED_AT does not match the transaction timestamp.")
    return audit_id


def _apply(connection: Any, request: Mapping[str, Any]) -> dict[str, Any]:
    commit_started = False
    action = "apply"
    request_id = request.get("requestId")
    change_id = request.get("changeId")
    transaction_lobs: list[Any] = []
    try:
        if not isinstance(request_id, str) or not request_id:
            raise _MonitoringError("REQUEST_ID_REQUIRED", "Apply requires a requestId for correlation.")
        _require_expected_identity(request)
        if not isinstance(change_id, str):
            raise _MonitoringError("CHANGE_ID_REQUIRED", "Apply requires a UUID changeId allocated before dispatch.")
        try:
            parsed_change_id = uuid.UUID(change_id)
        except (ValueError, AttributeError):
            raise _MonitoringError("CHANGE_ID_REQUIRED", "Apply requires a UUID changeId allocated before dispatch.") from None
        if str(parsed_change_id) != change_id.lower():
            raise _MonitoringError("CHANGE_ID_REQUIRED", "changeId must use canonical UUID text.")
        change_id = str(parsed_change_id)
        if hasattr(connection, "autocommit"):
            connection.autocommit = False
        identity = _identity_with_profile(connection, request)
        metadata, fingerprint = _assert_fingerprint(connection, request, identity)
        specs = _column_specs(metadata)
        actor_name, actor_source = _actor(request, identity)
        prepared, _ = _validate_operations(request, specs, metadata.get("characterSet"), actor_name)
        _assert_dml_privileges(connection, identity, prepared)
        # Identity and metadata are checked again while the transaction is open,
        # then all current rows and referenced existing parents are locked.
        identity_inside = _identity_with_profile(connection, request)
        if identity_inside != identity:
            raise _MonitoringError("IDENTITY_MISMATCH", "Oracle identity changed before the transaction.", state="Incompatible")
        locked, _ = _lock_plan(connection, prepared, specs)
        conflicts = []
        update_keys = {(op["table"], op["key"]) for op in prepared if op["action"] == "UPDATE"}
        insert_keys = {(op["table"], op["key"]) for op in prepared if op["action"] == "INSERT"}
        parent_keys = {parent for op in prepared for parent in _parent_references(op)} - insert_keys
        for table, key in sorted(update_keys):
            if locked.get((table, key)) is None:
                conflicts.append({"table": table, "primaryKey": key, "reason": "original-missing", "baseline": next(
                    op["baseline"] for op in prepared if op["table"] == table and op["key"] == key), "current": None})
        missing_parents = [{"table": table, "primaryKey": key} for table, key in sorted(parent_keys)
                           if (table, key) not in update_keys and locked.get((table, key)) is None]
        if missing_parents:
            raise _MonitoringError("PARENT_MISSING", "A referenced parent is absent from Oracle and the insert plan.",
                                   details={"parents": missing_parents})
        for operation in prepared:
            key = (operation["table"], operation["key"])
            if operation["action"] == "UPDATE":
                current = locked.get(key)
                if current is not None and _canonical_compare(current) != _canonical_compare(operation["baseline"]):
                    conflicts.append({"table": operation["table"], "primaryKey": operation["key"],
                                      "reason": "baseline-changed", "baseline": operation["baseline"], "current": current})
            elif _row_exists(connection, operation["table"], operation["key"]):
                conflicts.append({"table": operation["table"], "primaryKey": operation["key"], "reason": "primary-key-exists", "baseline": None})
        if conflicts:
            connection.rollback()
            return {"ok": False, "action": action, "state": "Conflict", "identity": _public_identity(identity, metadata.get("characterSet")),
                    "fingerprint": fingerprint, "schemaFingerprint": fingerprint, "requestId": request_id, "changeId": change_id,
                    "conflicts": conflicts}

        operation_menu_ids = {
            (operation["table"], operation["key"]): _resolve_menu_id(operation, prepared, locked)
            for operation in prepared
        }
        if any(not isinstance(menu_id, str) or not menu_id for menu_id in operation_menu_ids.values()):
            raise _MonitoringError("MENU_SCOPE_REQUIRED", "Every changed row must resolve to one owning menu.")

        # All parent references must resolve either to a locked existing row or
        # to an INSERT in this same reviewed plan. Never infer parents from UI.
        inserts = insert_keys
        for operation in prepared:
            for parent in _parent_references(operation):
                if parent not in inserts and locked.get(parent) is None:
                    raise _MonitoringError("PARENT_MISSING", "A referenced parent is absent from Oracle and the insert plan.",
                                           details={"table": operation["table"], "parentTable": parent[0], "parentId": parent[1]})

        changed_operations = [op for op in prepared if op["action"] == "INSERT" or op["changed"]]
        if not changed_operations:
            connection.rollback()
            return {"ok": True, "action": action, "state": "Committed", "noOp": True,
                    "identity": _public_identity(identity, metadata.get("characterSet")), "fingerprint": fingerprint,
                    "schemaFingerprint": fingerprint, "requestId": request_id,
                    "changeId": change_id, "rows": [], "auditIds": []}
        timestamp = _tx_timestamp(connection)
        for operation in sorted((op for op in changed_operations if op["action"] == "INSERT"), key=_insert_order):
            _execute_insert(connection, operation, specs, actor_name, timestamp, transaction_lobs)
        for operation in sorted((op for op in changed_operations if op["action"] == "UPDATE"),
                                key=lambda op: (op["table"], op["key"])):
            _execute_update(connection, operation, locked[(operation["table"], operation["key"])],
                            specs, actor_name, timestamp, transaction_lobs)

        readbacks = []
        for operation in sorted(changed_operations, key=lambda op: (op["table"], op["key"])):
            actual = _read_operation_row(connection, operation, specs)
            expected = operation["effectiveDesired"]
            if actual is None or _canonical_compare(actual) != _canonical_compare(expected):
                differing_columns = sorted(
                    name for name in set(expected) | (set(actual) if actual is not None else set())
                    if actual is None or _canonical_compare({name: expected.get(name)}) !=
                    _canonical_compare({name: actual.get(name)})
                )
                raise _MonitoringError("READBACK_MISMATCH", "Configuration values did not match after the write; the transaction was rolled back.",
                                       details={"table": operation["table"], "primaryKey": operation["key"],
                                                "columns": differing_columns})
            operation["readback"] = actual
            readbacks.append({"table": operation["table"], "action": operation["action"],
                              "primaryKey": operation["key"], "row": actual})

        envelope_base = {
            "source": "ad-tools.monitoring-query",
            "version": 1,
            "changeId": change_id,
            "requestId": request_id,
            "operationId": None,
            "operationCount": len(changed_operations),
            "actorSource": actor_source,
            "databaseUsername": identity.get("sessionUser"),
        }
        audit_ids = []
        for operation in sorted(changed_operations, key=lambda op: (op["table"], op["key"])):
            before = operation["baseline"] if operation["action"] == "UPDATE" else None
            envelope = dict(envelope_base)
            envelope["operationId"] = operation.get("operationId") or f'{operation["table"]}:{operation["key"]}'
            envelope["menuId"] = operation_menu_ids[(operation["table"], operation["key"])]
            audit_ids.append(_insert_audit_row(connection, operation=operation, before=before,
                                               after=operation["readback"], envelope_base=envelope,
                                               actor_name=actor_name, tx_timestamp=timestamp,
                                               transaction_lobs=transaction_lobs))
        commit_started = True
        connection.commit()
        return {"ok": True, "action": action, "state": "Committed", "noOp": False,
                "identity": _public_identity(identity, metadata.get("characterSet")), "fingerprint": fingerprint,
                "schemaFingerprint": fingerprint, "requestId": request_id,
                "changeId": change_id, "actor": {"name": actor_name, "source": actor_source},
                "changedAt": _timestamp_wrapper(timestamp), "rows": readbacks,
                "auditIds": [_public_audit_id(audit_id) for audit_id in audit_ids]}
    except _MonitoringError as error:
        if not commit_started:
            try:
                connection.rollback()
            except Exception:
                pass
        return _error_result(action, error, request_id=request_id, change_id=change_id)
    except Exception as error:
        if commit_started:
            return _error_result(action, _MonitoringError(
                "OUTCOME_UNKNOWN", "Oracle connection failed while committing; reconcile by loading configuration and history before retrying.",
                state="Outcome Unknown", details={"oracleCode": _oracle_code(error)}),
                request_id=request_id, change_id=change_id)
        try:
            connection.rollback()
        except Exception:
            pass
        return _error_result(action, _oracle_failure(error), request_id=request_id, change_id=change_id)
    finally:
        _release_lobs(transaction_lobs)


def _oracle_code(error: Exception) -> int | None:
    try:
        detail = error.args[0]
        code = getattr(detail, "code", None)
        return int(code) if code is not None else None
    except Exception:
        return None


def _oracle_failure(error: Exception) -> _MonitoringError:
    code = _oracle_code(error)
    if code in (54, 30006):
        return _MonitoringError("LOCK_TIMEOUT", "Oracle could not acquire a required row lock within five seconds.", state="Busy",
                                details={"oracleCode": code})
    if code == 1:
        return _MonitoringError("CONSTRAINT_CONFLICT", "Oracle rejected the operation because a unique key already exists.", state="Conflict",
                                details={"oracleCode": code})
    if code in (942, 1031):
        return _MonitoringError("ORACLE_PERMISSION", "Oracle denied access to a required MONITORING table or operation.", state="Incompatible",
                                details={"oracleCode": code})
    if code is not None:
        return _MonitoringError("ORACLE_ERROR", "Oracle rejected the Monitoring Query operation.", state="Failed",
                                details={"oracleCode": code})
    return _MonitoringError("EXECUTION_FAILED", "Monitoring Query operation failed before commit.", state="Failed")


def _verify(connection: Any, request: Mapping[str, Any]) -> dict[str, Any]:
    action = "verify"
    _require_expected_identity(request)
    identity = _identity_with_profile(connection, request)
    metadata, fingerprint = _assert_fingerprint(connection, request, identity)
    specs = _column_specs(metadata)
    operations = request.get("operations")
    if not isinstance(operations, list) or not operations:
        raise _MonitoringError("OPERATIONS_REQUIRED", "Verify requires the expected operation rows.")
    change_id = request.get("changeId")
    audit_required = bool(request.get("outcomeUnknown") or request.get("auditRequired"))
    if audit_required and not change_id:
        raise _MonitoringError(
            "RECONCILIATION_REQUIRED",
            "An uncertain apply must be reconciled with its changeId and committed audit group.",
            state="Reconciliation Required",
        )
    if change_id is not None:
        return _verify_audited_change(connection, request, identity, metadata, fingerprint, specs, operations)

    mismatches = []
    matches = []
    seen: set[tuple[str, str]] = set()
    for raw in operations:
        operation = _prepare_verify_operation(raw, specs, metadata.get("characterSet"))
        table, key, desired = operation["table"], operation["key"], operation["desired"]
        op_key = (table, key)
        if op_key in seen:
            raise _MonitoringError("DUPLICATE_OPERATION", "A table and primary key may appear only once.")
        seen.add(op_key)
        actual = _select_one(connection, table, key, specs)
        action_hint = operation.get("action")
        dynamic_columns = _generated_verification_columns(table, action_hint) if action_hint else set()
        differing = _row_difference_columns(desired, actual, ignore=dynamic_columns)
        if actual is None or differing:
            mismatches.append({"table": table, "primaryKey": key, "columns": differing or sorted(desired)})
        else:
            matches.append({"table": table, "primaryKey": key, "row": actual,
                            "generatedAttributesObserved": sorted(dynamic_columns)})
    state = "Verified" if not mismatches else "Verification Mismatch"
    return {"ok": not mismatches, "action": action, "state": state,
            "identity": _public_identity(identity, metadata.get("characterSet")), "fingerprint": fingerprint,
            "schemaFingerprint": fingerprint, "matches": matches, "mismatches": mismatches,
            "auditVerified": False, "complete": True}


def _prepare_verify_operation(raw: Any, specs: Mapping[str, Mapping[str, Mapping[str, Any]]],
                              charset: str | None) -> dict[str, Any]:
    if not isinstance(raw, Mapping):
        raise _MonitoringError("INVALID_OPERATION", "Each verification operation must be an object.")
    table = raw.get("table")
    desired_raw = raw.get("desired")
    if table not in MANAGED_TABLES or not isinstance(desired_raw, Mapping):
        raise _MonitoringError("INVALID_OPERATION", "Verify accepts only typed rows from the managed table allowlist.")
    action = raw.get("action")
    if action is not None and action not in ("INSERT", "UPDATE"):
        raise _MonitoringError("INTENT_INVALID", "Verification action must be INSERT or UPDATE.")
    generated = _generated_verification_columns(table, action)
    desired = _row_to_db(desired_raw, specs[table], charset=charset, allow_missing=bool(generated))
    missing = sorted(set(specs[table]) - set(desired) - generated)
    if missing:
        raise _MonitoringError("INVALID_ROW", "Verify requires every non-generated column in the expected row.",
                               details={"table": table, "missingColumns": missing})
    key = desired.get(PRIMARY_KEYS[table])
    if not isinstance(key, str) or not key:
        raise _MonitoringError("INVALID_PRIMARY_KEY", "Expected row does not contain a primary key.")
    if len(key) > int(specs[table][PRIMARY_KEYS[table]].get("length") or 50):
        raise _MonitoringError("INVALID_PRIMARY_KEY", "Expected row primary key exceeds its Oracle column limit.")
    return {"table": table, "key": key, "action": action, "desired": desired,
            "baseline": raw.get("baseline"), "operationId": raw.get("operationId")}


def _generated_verification_columns(table: str, action: str | None) -> set[str]:
    if table != "DSH_MENU":
        return set()
    if action == "INSERT":
        return {"CREATED_AT", "UPDATED_BY", "UPDATED_AT"}
    if action == "UPDATE":
        return {"UPDATED_BY", "UPDATED_AT"}
    return set()


def _row_difference_columns(expected: Mapping[str, Any], actual: Mapping[str, Any] | None,
                            *, ignore: set[str] | None = None) -> list[str]:
    if actual is None:
        return sorted(set(expected) - set(ignore or set()))
    ignored = ignore or set()
    names = (set(expected) | set(actual)) - ignored
    return sorted(name for name in names
                  if _canonical_compare({name: expected.get(name)}) != _canonical_compare({name: actual.get(name)}))


def _database_menu_id(connection: Any, table: str, row: Mapping[str, Any]) -> str | None:
    if table in ("DSH_MENU", "DSH_SUMMARY_GROUP", "DSH_DETAIL_TABLE"):
        value = row.get("MENU_ID")
        return str(value) if value is not None else None
    if table == "DSH_SUMMARY_FIELD":
        parent_table, parent_key, parent_id = "DSH_SUMMARY_GROUP", "GROUP_ID", row.get("GROUP_ID")
    elif table == "DSH_DETAIL_COLUMN":
        parent_table, parent_key, parent_id = "DSH_DETAIL_TABLE", "TABLE_ID", row.get("TABLE_ID")
    else:
        return None
    with _cursor(connection) as cursor:
        cursor.execute(
            f'SELECT "MENU_ID" FROM "{SCHEMA}"."{parent_table}" WHERE "{parent_key}"=:parent_id',
            {"parent_id": parent_id},
        )
        result = cursor.fetchone()
    return str(result[0]) if result and result[0] is not None else None


def _verify_audited_change(connection: Any, request: Mapping[str, Any], identity: Mapping[str, Any],
                           metadata: Mapping[str, Any], fingerprint: str,
                           specs: Mapping[str, Mapping[str, Mapping[str, Any]]],
                           raw_operations: list[Any]) -> dict[str, Any]:
    action = "verify"
    change_id = request.get("changeId")
    request_id = request.get("requestId")
    if not isinstance(change_id, str):
        raise _MonitoringError("CHANGE_ID_REQUIRED", "Audit-backed verification requires the original changeId.")
    try:
        parsed_change_id = uuid.UUID(change_id)
    except (ValueError, AttributeError):
        raise _MonitoringError("CHANGE_ID_REQUIRED", "Audit-backed verification requires a UUID changeId.") from None
    if str(parsed_change_id) != change_id.lower():
        raise _MonitoringError("CHANGE_ID_REQUIRED", "changeId must use canonical UUID text.")
    if not isinstance(request_id, str) or not request_id:
        raise _MonitoringError("REQUEST_ID_REQUIRED", "Audit-backed verification requires the original requestId.")
    actor = request.get("actor")
    if not isinstance(actor, Mapping) or not all(isinstance(actor.get(key), str) and actor.get(key)
                                                 for key in ("source", "name", "databaseUsername")):
        raise _MonitoringError("ACTOR_REQUIRED", "Audit-backed verification requires the declared actor target.")
    actor_name, actor_source = _actor(request, identity)
    if actor.get("databaseUsername", "").upper() != str(identity.get("sessionUser") or "").upper():
        raise _MonitoringError("IDENTITY_MISMATCH", "Actor databaseUsername does not match the connected Oracle user.",
                               state="Incompatible")

    operations = [_prepare_verify_operation(raw, specs, metadata.get("characterSet")) for raw in raw_operations]
    expected_by_key = {(operation["table"], operation["key"]): operation for operation in operations}
    if len(expected_by_key) != len(operations):
        raise _MonitoringError("DUPLICATE_OPERATION", "A table and primary key may appear only once.")
    with _cursor(connection) as cursor:
        cursor.execute(
            f'SELECT "AUDIT_ID","TABLE_NAME","RECORD_ID","ACTION","OLD_VALUE","NEW_VALUE","CHANGED_BY","CHANGED_AT" '
            f'FROM "{SCHEMA}"."{AUDIT_TABLE}" '
            "WHERE JSON_VALUE(NEW_VALUE,'$.changeId' RETURNING VARCHAR2(36) NULL ON ERROR)=:change_id "
            "OR JSON_VALUE(OLD_VALUE,'$.changeId' RETURNING VARCHAR2(36) NULL ON ERROR)=:change_id "
            'ORDER BY "AUDIT_ID" OFFSET 0 ROWS FETCH NEXT :audit_limit ROWS ONLY',
            {"change_id": change_id, "audit_limit": len(operations) + 1},
        )
        raw_audit_rows = cursor.fetchall()
    if len(raw_audit_rows) != len(operations):
        raise _MonitoringError("AUDIT_GROUP_INCOMPLETE", "The committed audit group does not contain exactly one row per operation.",
                               state="Reconciliation Required",
                               details={"expectedOperations": len(operations), "auditRows": len(raw_audit_rows)})

    audit_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    menu_ids: set[str] = set()
    changed_at_values = set()
    audit_ids = []
    for row in raw_audit_rows:
        audit_id, table, record_id, db_action, old_lob, new_lob, changed_by, changed_at = row
        if not isinstance(changed_at, datetime) or changed_at.tzinfo is not None:
            raise _MonitoringError("AUDIT_GROUP_INVALID", "Audit CHANGED_AT is not a local Oracle timestamp.",
                                   state="Reconciliation Required")
        changed_at_values.add(changed_at)
        old_value = _parse_audit_value(_read_clob_complete(old_lob))
        new_value = _parse_audit_value(_read_clob_complete(new_lob))
        if not isinstance(new_value, Mapping) or (db_action == "UPDATE" and not isinstance(old_value, Mapping)):
            raise _MonitoringError("AUDIT_GROUP_INVALID", "An audit envelope is missing or malformed.",
                                   state="Reconciliation Required")
        key = (str(table), str(record_id))
        operation = expected_by_key.get(key)
        if operation is None or key in audit_by_key:
            raise _MonitoringError("AUDIT_GROUP_MISMATCH", "Audit rows do not match the reviewed operation set.",
                                   state="Reconciliation Required", details={"table": table, "primaryKey": record_id})
        if operation.get("action") is not None and operation["action"] != db_action:
            raise _MonitoringError("AUDIT_GROUP_MISMATCH", "Audit action differs from the reviewed operation.",
                                   state="Reconciliation Required", details={"table": table, "primaryKey": record_id})
        if db_action not in ("INSERT", "UPDATE"):
            raise _MonitoringError("AUDIT_GROUP_INVALID", "The audit group contains an unsupported action.",
                                   state="Reconciliation Required")
        if (new_value.get("source"), new_value.get("version"), new_value.get("changeId"),
                new_value.get("requestId"), new_value.get("operationCount"),
                new_value.get("actorSource"), new_value.get("databaseUsername")) != (
                "ad-tools.monitoring-query", 1, change_id, request_id, len(operations), actor_source,
                identity.get("sessionUser")):
            raise _MonitoringError("AUDIT_GROUP_MISMATCH", "The new-value audit envelope does not match the requested transaction.",
                                   state="Reconciliation Required", details={"table": table, "primaryKey": record_id})
        if db_action == "UPDATE":
            if (old_value.get("source"), old_value.get("version"), old_value.get("changeId"),
                    old_value.get("requestId"), old_value.get("operationCount"),
                    old_value.get("actorSource"), old_value.get("databaseUsername")) != (
                    "ad-tools.monitoring-query", 1, change_id, request_id, len(operations), actor_source,
                    identity.get("sessionUser")):
                raise _MonitoringError("AUDIT_GROUP_MISMATCH", "The old-value audit envelope does not match the requested transaction.",
                                       state="Reconciliation Required", details={"table": table, "primaryKey": record_id})
        operation_id = operation.get("operationId") or f"{table}:{record_id}"
        if new_value.get("operationId") != operation_id or (db_action == "UPDATE" and old_value.get("operationId") != operation_id):
            raise _MonitoringError("AUDIT_GROUP_MISMATCH", "Audit operation identity does not match the reviewed row.",
                                   state="Reconciliation Required", details={"table": table, "primaryKey": record_id})
        menu_id = new_value.get("menuId")
        if not isinstance(menu_id, str) or not menu_id:
            raise _MonitoringError("AUDIT_GROUP_INVALID", "Audit envelope does not identify its owning menu.",
                                   state="Reconciliation Required")
        menu_ids.add(menu_id)
        if old_value is not None and old_value.get("menuId") != menu_id:
            raise _MonitoringError("AUDIT_GROUP_MISMATCH", "Before and after audit envelopes identify different menus.",
                                   state="Reconciliation Required")
        if str(changed_by) != actor_name:
            raise _MonitoringError("AUDIT_ACTOR_MISMATCH", "CHANGED_BY does not match the reviewed actor.",
                                   state="Reconciliation Required", details={"table": table, "primaryKey": record_id})
        after_raw = new_value.get("row")
        before_raw = old_value.get("row") if isinstance(old_value, Mapping) else None
        after = _row_to_db(after_raw, specs[table], charset=metadata.get("characterSet")) if isinstance(after_raw, Mapping) else None
        before = _row_to_db(before_raw, specs[table], charset=metadata.get("characterSet")) if isinstance(before_raw, Mapping) else None
        if after is None or after.get(PRIMARY_KEYS[table]) != record_id:
            raise _MonitoringError("AUDIT_GROUP_INVALID", "The audit after-row is incomplete or has the wrong key.",
                                   state="Reconciliation Required", details={"table": table, "primaryKey": record_id})
        if _database_menu_id(connection, str(table), after) != menu_id:
            raise _MonitoringError("AUDIT_GROUP_MISMATCH", "Audit menu scope differs from the row's database parent.",
                                   state="Reconciliation Required", details={"table": table, "primaryKey": record_id})
        if (db_action == "INSERT" and (before is not None or old_value is not None)) or (
                db_action == "UPDATE" and before is None):
            raise _MonitoringError("AUDIT_GROUP_INVALID", "The audit before-row does not match the operation action.",
                                   state="Reconciliation Required", details={"table": table, "primaryKey": record_id})
        expected_before = operation.get("baseline")
        if db_action == "UPDATE":
            if not isinstance(expected_before, Mapping):
                raise _MonitoringError("BASELINE_REQUIRED", "Audit-backed UPDATE verification requires its complete original baseline.",
                                       state="Reconciliation Required", details={"table": table, "primaryKey": record_id})
            normalized_before = _row_to_db(expected_before, specs[table], charset=metadata.get("characterSet"))
            if _canonical_compare(normalized_before) != _canonical_compare(before):
                raise _MonitoringError("AUDIT_BASELINE_MISMATCH", "The committed audit before-row differs from the reviewed baseline.",
                                       state="Reconciliation Required", details={"table": table, "primaryKey": record_id})
        expected_after = operation["desired"]
        generated = _generated_verification_columns(table, db_action)
        missing_static = sorted(set(specs[table]) - set(expected_after) - generated)
        if missing_static or _row_difference_columns(expected_after, after, ignore=generated):
            raise _MonitoringError("AUDIT_DESIRED_MISMATCH", "The committed audit after-row differs from the reviewed desired values.",
                                   state="Reconciliation Required",
                                   details={"table": table, "primaryKey": record_id,
                                            "columns": _row_difference_columns(expected_after, after, ignore=generated)})
        changed_at_wrapper = _timestamp_wrapper(changed_at)
        if table == "DSH_MENU" and db_action == "INSERT":
            generated_mismatches = []
            if after.get("CREATED_BY") != actor_name:
                generated_mismatches.append("CREATED_BY")
            if after.get("CREATED_AT") != changed_at_wrapper:
                generated_mismatches.append("CREATED_AT")
            if after.get("UPDATED_BY") is not None:
                generated_mismatches.append("UPDATED_BY")
            if after.get("UPDATED_AT") is not None:
                generated_mismatches.append("UPDATED_AT")
            if generated_mismatches:
                raise _MonitoringError("AUDIT_GENERATED_ATTRIBUTE_MISMATCH",
                                       "Inserted menu attributes differ from the committed transaction envelope.",
                                       state="Reconciliation Required",
                                       details={"table": table, "primaryKey": record_id,
                                                "columns": generated_mismatches})
        if table == "DSH_MENU" and db_action == "UPDATE":
            generated_mismatches = []
            if after.get("UPDATED_BY") != actor_name:
                generated_mismatches.append("UPDATED_BY")
            if after.get("UPDATED_AT") != changed_at_wrapper:
                generated_mismatches.append("UPDATED_AT")
            if generated_mismatches:
                raise _MonitoringError("AUDIT_GENERATED_ATTRIBUTE_MISMATCH",
                                       "Updated menu attributes differ from the committed transaction envelope.",
                                       state="Reconciliation Required",
                                       details={"table": table, "primaryKey": record_id,
                                                "columns": generated_mismatches})
        actual = _select_one(connection, table, record_id, specs)
        if actual is None or _canonical_compare(actual) != _canonical_compare(after):
            raise _MonitoringError("CONFIGURATION_MISMATCH", "Current configuration no longer matches the committed audit after-row.",
                                   state="Reconciliation Required",
                                   details={"table": table, "primaryKey": record_id,
                                            "columns": _row_difference_columns(after, actual)})
        audit_by_key[key] = {"table": table, "primaryKey": record_id, "row": actual,
                             "auditId": _public_audit_id(audit_id), "action": db_action}
        audit_ids.append(int(audit_id))

    requested_menu_id = request.get("menuId")
    if not menu_ids or (requested_menu_id is not None and menu_ids != {requested_menu_id}):
        raise _MonitoringError("AUDIT_GROUP_MISMATCH", "Audit rows do not belong to the requested menu scope.",
                               state="Reconciliation Required")
    if len(changed_at_values) != 1:
        raise _MonitoringError("AUDIT_GROUP_MISMATCH", "Audit rows do not share one transaction timestamp.",
                               state="Reconciliation Required")
    matches = [audit_by_key[(operation["table"], operation["key"])] for operation in operations]
    return {"ok": True, "action": action, "state": "Verified", "identity": _public_identity(identity, metadata.get("characterSet")),
            "fingerprint": fingerprint, "schemaFingerprint": fingerprint, "changeId": change_id,
            "requestId": request_id, "menuIds": sorted(menu_ids), "matches": matches,
            "mismatches": [], "auditIds": sorted((_public_audit_id(audit_id) for audit_id in audit_ids), key=int),
            "auditVerified": True, "complete": True}


def _history_query_cte() -> str:
    return (
        "WITH audit_rows AS ("
        " SELECT AUDIT_ID,TABLE_NAME,RECORD_ID,ACTION,CHANGED_BY,CHANGED_AT,"
        " JSON_VALUE(NEW_VALUE,'$.source' RETURNING VARCHAR2(100) NULL ON ERROR) NEW_SOURCE,"
        " JSON_VALUE(OLD_VALUE,'$.source' RETURNING VARCHAR2(100) NULL ON ERROR) OLD_SOURCE,"
        " JSON_VALUE(NEW_VALUE,'$.version' RETURNING NUMBER NULL ON ERROR) NEW_VERSION,"
        " JSON_VALUE(OLD_VALUE,'$.version' RETURNING NUMBER NULL ON ERROR) OLD_VERSION,"
        " COALESCE(JSON_VALUE(NEW_VALUE,'$.operationCount' RETURNING NUMBER NULL ON ERROR),"
        " JSON_VALUE(OLD_VALUE,'$.operationCount' RETURNING NUMBER NULL ON ERROR)) EXPECTED_OPERATION_COUNT,"
        " COALESCE(JSON_VALUE(NEW_VALUE,'$.changeId' RETURNING VARCHAR2(36) NULL ON ERROR),"
        " JSON_VALUE(OLD_VALUE,'$.changeId' RETURNING VARCHAR2(36) NULL ON ERROR)) CHANGE_ID,"
        " COALESCE(JSON_VALUE(NEW_VALUE,'$.menuId' RETURNING VARCHAR2(50) NULL ON ERROR),"
        " JSON_VALUE(OLD_VALUE,'$.menuId' RETURNING VARCHAR2(50) NULL ON ERROR)) MENU_ID"
        f' FROM "{SCHEMA}"."{AUDIT_TABLE}"'
        "), scoped AS ("
        " SELECT A.*, CASE WHEN A.CHANGE_ID IS NOT NULL AND "
        " COALESCE(A.NEW_SOURCE,A.OLD_SOURCE)='ad-tools.monitoring-query' AND "
        " COALESCE(A.NEW_VERSION,A.OLD_VERSION)=1 THEN A.CHANGE_ID "
        " ELSE 'legacy:'||TO_CHAR(A.AUDIT_ID) END GROUP_KEY "
        " FROM audit_rows A WHERE A.MENU_ID=:menu_id OR "
        "(A.MENU_ID IS NULL AND A.TABLE_NAME='DSH_MENU' AND A.RECORD_ID=:menu_id)"
        ") "
    )


def _safe_operation_count(raw_count: Any) -> tuple[int | None, bool]:
    if raw_count is None:
        return None, False
    if isinstance(raw_count, bool):
        return None, True
    try:
        numeric_count = Decimal(str(raw_count))
        count = int(numeric_count)
    except (InvalidOperation, TypeError, ValueError, OverflowError):
        return None, True
    if not numeric_count.is_finite() or numeric_count != count or count < 1 or count > 500:
        return None, True
    return count, False


def _history_group_metadata(old_value: Any, new_value: Any) -> tuple[str | None, int | None, bool]:
    envelopes = [value for value in (new_value, old_value) if isinstance(value, Mapping)]
    change_id = next((value.get("changeId") for value in envelopes
                      if isinstance(value.get("changeId"), str) and value.get("changeId")), None)
    raw_count = next((value.get("operationCount") for value in envelopes
                      if value.get("operationCount") is not None), None)
    expected_count, invalid_count = _safe_operation_count(raw_count)
    return change_id, expected_count, invalid_count


def _history(connection: Any, request: Mapping[str, Any]) -> dict[str, Any]:
    action = "history"
    identity = _identity_with_profile(connection, request)
    metadata, fingerprint = _inspect_metadata(connection)
    menu_id = request.get("menuId")
    if not isinstance(menu_id, str) or not menu_id:
        raise _MonitoringError("MENU_REQUIRED", "History requires a menuId.")
    page_size = _page_size(request.get("pageSize", 50))
    detail_ids = request.get("auditIds")
    change_id = request.get("changeId")
    if detail_ids is not None or change_id is not None:
        if detail_ids is not None and (not isinstance(detail_ids, list) or len(detail_ids) > 200):
            raise _MonitoringError("INVALID_HISTORY_DETAIL", "auditIds must contain at most 200 numeric IDs.")
        requested_ids: set[int] = set()
        if detail_ids is not None:
            try:
                requested_ids = {_parse_public_audit_id(audit_id) for audit_id in detail_ids}
            except (TypeError, ValueError, OverflowError):
                raise _MonitoringError("INVALID_HISTORY_DETAIL", "auditIds must be positive decimal integers.") from None
        if change_id is not None:
            if not isinstance(change_id, str) or len(change_id) > 64:
                raise _MonitoringError("INVALID_HISTORY_DETAIL", "changeId is malformed.")
            with _cursor(connection) as cursor:
                cursor.execute(
                    f'SELECT COUNT(*) FROM "{SCHEMA}"."{AUDIT_TABLE}" WHERE '
                    "((JSON_VALUE(NEW_VALUE,'$.menuId' RETURNING VARCHAR2(50) NULL ON ERROR)=:menu_id "
                    "OR JSON_VALUE(OLD_VALUE,'$.menuId' RETURNING VARCHAR2(50) NULL ON ERROR)=:menu_id) "
                    "OR (JSON_VALUE(NEW_VALUE,'$.menuId' RETURNING VARCHAR2(50) NULL ON ERROR) IS NULL "
                    "AND JSON_VALUE(OLD_VALUE,'$.menuId' RETURNING VARCHAR2(50) NULL ON ERROR) IS NULL "
                    "AND TABLE_NAME='DSH_MENU' AND RECORD_ID=:menu_id)) AND "
                    "(JSON_VALUE(NEW_VALUE,'$.changeId' RETURNING VARCHAR2(64) NULL ON ERROR)=:change_id "
                    "OR JSON_VALUE(OLD_VALUE,'$.changeId' RETURNING VARCHAR2(64) NULL ON ERROR)=:change_id)",
                    {"menu_id": menu_id, "change_id": change_id},
                )
                membership_count = int(cursor.fetchone()[0] or 0)
            if membership_count == 0:
                raise _MonitoringError("HISTORY_GROUP_NOT_FOUND", "The requested menu is not part of this audit transaction.",
                                       state="Not Found", details={"menuId": menu_id})
            detail_sql = (
                'SELECT AUDIT_ID,TABLE_NAME,RECORD_ID,ACTION,OLD_VALUE,NEW_VALUE,CHANGED_BY,CHANGED_AT '
                f'FROM "{SCHEMA}"."{AUDIT_TABLE}" WHERE '
                "(JSON_VALUE(NEW_VALUE,'$.changeId' RETURNING VARCHAR2(64) NULL ON ERROR)=:change_id "
                "OR JSON_VALUE(OLD_VALUE,'$.changeId' RETURNING VARCHAR2(64) NULL ON ERROR)=:change_id) "
                'ORDER BY CHANGED_AT DESC,AUDIT_ID DESC'
            )
            binds: dict[str, Any] = {"change_id": change_id}
        elif requested_ids:
            slots = []
            binds = {"menu_id": menu_id}
            for index, audit_id in enumerate(sorted(requested_ids)):
                binds[f"audit_{index}"] = audit_id
                slots.append(f":audit_{index}")
            detail_sql = (
                'SELECT AUDIT_ID,TABLE_NAME,RECORD_ID,ACTION,OLD_VALUE,NEW_VALUE,CHANGED_BY,CHANGED_AT '
                f'FROM "{SCHEMA}"."{AUDIT_TABLE}" WHERE '
                "(((COALESCE(JSON_VALUE(NEW_VALUE,'$.menuId' RETURNING VARCHAR2(50) NULL ON ERROR),"
                "JSON_VALUE(OLD_VALUE,'$.menuId' RETURNING VARCHAR2(50) NULL ON ERROR))=:menu_id) OR "
                "(JSON_VALUE(NEW_VALUE,'$.menuId' RETURNING VARCHAR2(50) NULL ON ERROR) IS NULL AND "
                "JSON_VALUE(OLD_VALUE,'$.menuId' RETURNING VARCHAR2(50) NULL ON ERROR) IS NULL AND "
                "TABLE_NAME='DSH_MENU' AND RECORD_ID=:menu_id)) AND "
                f'AUDIT_ID IN ({",".join(slots)})) ORDER BY CHANGED_AT DESC,AUDIT_ID DESC'
            )
        else:
            raise _MonitoringError("INVALID_HISTORY_DETAIL", "History detail requires a changeId or auditIds.")
        with _cursor(connection) as cursor:
            cursor.execute(detail_sql, binds)
            rows = cursor.fetchall()
        parsed_entries = []
        for row in rows:
            old_text = _read_clob_complete(row[4])
            new_text = _read_clob_complete(row[5])
            old_value, new_value = _parse_audit_value(old_text), _parse_audit_value(new_text)
            group_change_id, expected_count, invalid_expected = _history_group_metadata(old_value, new_value)
            parsed_entries.append({
                "auditId": int(row[0]), "table": row[1], "recordId": row[2], "action": row[3],
                "oldValue": old_value, "newValue": new_value,
                "changedBy": row[6], "changedAt": _db_value(row[7], TABLE_COLUMNS[AUDIT_TABLE]["CHANGED_AT"]),
                "_changeId": group_change_id, "_expectedOperationCount": expected_count,
                "_invalidExpectedOperationCount": invalid_expected,
            })
        loaded_by_change: dict[str, int] = {}
        expected_by_change: dict[str, int | None] = {}
        invalid_change_ids: set[str] = set()
        for entry in parsed_entries:
            group_change_id = entry["_changeId"]
            if group_change_id is None:
                continue
            loaded_by_change[group_change_id] = loaded_by_change.get(group_change_id, 0) + 1
            previous_expected = expected_by_change.get(group_change_id)
            current_expected = entry["_expectedOperationCount"]
            if previous_expected is not None and current_expected is not None and previous_expected != current_expected:
                invalid_change_ids.add(group_change_id)
            if current_expected is not None:
                expected_by_change[group_change_id] = current_expected
            if entry["_invalidExpectedOperationCount"]:
                invalid_change_ids.add(group_change_id)
        total_by_change: dict[str, int] = {}
        if change_id is not None:
            total_by_change[change_id] = len(parsed_entries)
        else:
            for group_change_id in loaded_by_change:
                with _cursor(connection) as cursor:
                    cursor.execute(
                        f'SELECT COUNT(*) FROM "{SCHEMA}"."{AUDIT_TABLE}" WHERE '
                        "JSON_VALUE(NEW_VALUE,'$.changeId' RETURNING VARCHAR2(64) NULL ON ERROR)=:change_id "
                        "OR JSON_VALUE(OLD_VALUE,'$.changeId' RETURNING VARCHAR2(64) NULL ON ERROR)=:change_id",
                        {"change_id": group_change_id},
                    )
                    total_by_change[group_change_id] = int(cursor.fetchone()[0] or 0)
        entries = []
        group_completeness = []
        for entry in parsed_entries:
            group_change_id = entry.pop("_changeId")
            expected_count = entry.pop("_expectedOperationCount")
            invalid_expected = entry.pop("_invalidExpectedOperationCount")
            if group_change_id is None:
                group_complete = True  # Legacy rows have no transaction grouping envelope.
            else:
                group_complete = (
                    expected_count is not None and not invalid_expected and group_change_id not in invalid_change_ids
                    and loaded_by_change.get(group_change_id) == expected_count
                    and total_by_change.get(group_change_id) == expected_count
                )
            group_completeness.append(group_complete)
            entry["auditId"] = _public_audit_id(entry["auditId"])
            entry["groupComplete"] = group_complete
            entry["expectedOperationCount"] = expected_count
            entries.append(entry)
        returned_ids = {int(entry["auditId"]) for entry in entries}
        missing_ids = sorted(requested_ids - returned_ids)
        details_complete = (change_id is None or bool(parsed_entries)) and not missing_ids and all(group_completeness)
        return {"ok": True, "action": action, "state": "Loaded",
                "identity": _public_identity(identity, metadata.get("characterSet")), "fingerprint": fingerprint,
                "schemaFingerprint": fingerprint, "menuId": menu_id, "entries": entries,
                "complete": details_complete,
                **({"missingAuditIds": [_public_audit_id(audit_id) for audit_id in missing_ids]} if missing_ids else {})}

    offset = request.get("offset", 0)
    try:
        offset = int(offset)
    except (TypeError, ValueError):
        raise _MonitoringError("INVALID_OFFSET", "History offset must be a non-negative integer.") from None
    if offset < 0:
        raise _MonitoringError("INVALID_OFFSET", "History offset must be a non-negative integer.")
    cte = _history_query_cte()
    count_sql = cte + "SELECT COUNT(DISTINCT GROUP_KEY) FROM scoped"
    with _cursor(connection) as cursor:
        cursor.execute(count_sql, {"menu_id": menu_id})
        total = int(cursor.fetchone()[0] or 0)
    # Keep aggregation in a CTE and pagination in the outer query. Oracle
    # reports ORA-00935 when this grouped projection, ordering and OFFSET/FETCH
    # are combined in one SELECT, even though each clause works in isolation.
    sql = cte + (
        ", summaries AS ("
        " SELECT GROUP_KEY, MAX(CHANGE_ID) CHANGE_ID, MAX(CHANGED_AT) CHANGED_AT, "
        " MAX(CHANGED_BY) ACTOR, COUNT(*) OPERATION_COUNT, "
        " COUNT(EXPECTED_OPERATION_COUNT) ENVELOPE_COUNT, "
        " MAX(EXPECTED_OPERATION_COUNT) EXPECTED_OPERATION_COUNT, "
        " MIN(EXPECTED_OPERATION_COUNT) MIN_EXPECTED_OPERATION_COUNT, "
        " SUM(CASE WHEN ACTION='INSERT' THEN 1 ELSE 0 END) INSERT_COUNT, "
        " SUM(CASE WHEN ACTION='UPDATE' THEN 1 ELSE 0 END) UPDATE_COUNT, "
        " MAX(AUDIT_ID) MAX_AUDIT_ID FROM scoped GROUP BY GROUP_KEY"
        ") SELECT GROUP_KEY,CHANGE_ID,CHANGED_AT,ACTOR,OPERATION_COUNT,ENVELOPE_COUNT,EXPECTED_OPERATION_COUNT,"
        "MIN_EXPECTED_OPERATION_COUNT,INSERT_COUNT,UPDATE_COUNT,MAX_AUDIT_ID "
        "FROM summaries ORDER BY CHANGED_AT DESC,MAX_AUDIT_ID DESC "
        "OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY"
    )
    with _cursor(connection) as cursor:
        cursor.execute(sql, {"menu_id": menu_id, "offset": offset, "limit": page_size})
        rows = cursor.fetchall()
    transactions = []
    for row in rows:
        legacy = str(row[0]).startswith("legacy:")
        scoped_count = int(row[4])
        envelope_count = int(row[5])
        raw_expected_count, raw_min_expected_count = row[6], row[7]
        expected_count, invalid_expected = _safe_operation_count(raw_expected_count)
        min_expected_count, invalid_min_expected = _safe_operation_count(raw_min_expected_count)
        expected_consistent = expected_count == min_expected_count and invalid_expected == invalid_min_expected
        if not expected_consistent:
            expected_count = None
        if legacy:
            group_complete = envelope_count == 0
        else:
            group_complete = (expected_consistent and not invalid_expected and envelope_count == scoped_count
                              and expected_count is not None and scoped_count == expected_count)
        transactions.append({
            "groupKey": row[0], "changeId": None if legacy else row[1],
            "changedAt": _db_value(row[2], TABLE_COLUMNS[AUDIT_TABLE]["CHANGED_AT"]),
            "actor": row[3], "operationCount": scoped_count, "expectedOperationCount": expected_count,
            "insertCount": int(row[8]), "updateCount": int(row[9]), "groupComplete": group_complete,
            "legacy": legacy,
            "auditId": _public_audit_id(str(row[0])[7:]) if legacy else None,
        })
    next_offset = offset + len(transactions)
    page_complete = next_offset >= total
    groups_complete = all(transaction["groupComplete"] for transaction in transactions)
    return {"ok": True, "action": action, "state": "Loaded",
            "identity": _public_identity(identity, metadata.get("characterSet")), "fingerprint": fingerprint,
            "schemaFingerprint": fingerprint, "menuId": menu_id, "transactions": transactions,
            "offset": offset, "nextOffset": next_offset if next_offset < total else None,
            "complete": page_complete and groups_complete, "pageComplete": page_complete,
            "totalTransactions": total}


def _parse_audit_value(value: Any) -> Any:
    if value is None:
        return None
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return {"format": "unrecognized", "raw": value}


def _error_result(action: str, error: _MonitoringError, *, request_id: Any = None, change_id: Any = None) -> dict[str, Any]:
    result = {"ok": False, "action": action, "state": error.state,
              "error": {"code": error.code, "message": error.message}}
    if error.details is not None:
        result["error"]["details"] = error.details
    if request_id is not None:
        result["requestId"] = request_id
    if change_id is not None:
        result["changeId"] = change_id
    return result


def handle(connection: Any, request: Mapping[str, Any]) -> dict[str, Any]:
    """Run one Monitoring Query action on an acquired Oracle connection.

    Args:
        connection: Acquired python-oracledb connection. ``apply`` commits or
            rolls back its own transaction; other actions are read-only.
        request: JSON-like action object with ``action`` in load/apply/verify/
            history. Each action has an explicit request contract documented in
            this module's top-level docstring and the PRD.
    """
    if not isinstance(request, Mapping):
        return _error_result("unknown", _MonitoringError("INVALID_REQUEST", "Request must be an object."))
    action = request.get("action")
    if action not in ("load", "apply", "verify", "history"):
        return _error_result(str(action or "unknown"), _MonitoringError("ACTION_INVALID", "Action must be load, apply, verify or history."))
    previous_handler = getattr(connection, "outputtypehandler", None)
    try:
        # The repository owns conversion so DATE/TIMESTAMP precision and CLOB
        # reads do not depend on the generic query endpoint's output handler.
        if hasattr(connection, "outputtypehandler"):
            connection.outputtypehandler = None
        if action == "load":
            return _load(connection, request)
        if action == "apply":
            return _apply(connection, request)
        if action == "verify":
            return _verify(connection, request)
        return _history(connection, request)
    except _MonitoringError as error:
        return _error_result(str(action), error)
    except Exception as error:
        return _error_result(str(action), _oracle_failure(error))
    finally:
        if hasattr(connection, "outputtypehandler"):
            try:
                connection.outputtypehandler = previous_handler
            except Exception:
                pass
