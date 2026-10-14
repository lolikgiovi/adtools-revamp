#!/usr/bin/env python3
"""Repeatable LOCAL Oracle integration check for the Monitoring Query backend.

This script only targets 127.0.0.1:1521/FREEPDB1. It creates the MONITORING
schema user only when absent, imports missing discovery tables without their
source tablespace clauses, and adds uniquely named synthetic E2E rows. It never
drops schema objects or prints credentials, stored SQL, or full query results.
"""

from __future__ import annotations

import argparse
import copy
from datetime import datetime, timezone
import hashlib
import json
import os
import re
import sys
import uuid
from pathlib import Path
from typing import Any

try:
    import oracledb
except ImportError as exc:  # pragma: no cover - depends on the caller's Python.
    raise SystemExit(
        "python-oracledb is unavailable. Run this script with "
        "tauri/sidecar/venv/bin/python; do not install dependencies for this check."
    ) from exc


REPO_ROOT = Path(__file__).resolve().parents[2]
SIDECAR_DIR = REPO_ROOT / "tauri" / "sidecar"
SCHEMA_DDL_PATH = REPO_ROOT / "docs" / "monitoring" / "schema-ddl-2026-10-12.json"
DEFAULT_ENV_FILE = (
    REPO_ROOT.parent / "content-bridge-nextjs" / "content-bridge" / "database" / "local" / ".env.oracle-poc"
)
LOCAL_DSN = "127.0.0.1:1521/FREEPDB1"
ADMIN_USER = "SYSTEM"
SCHEMA_USER = "MONITORING"
TABLE_CREATE_ORDER = (
    "DSH_MENU",
    "DSH_DATASOURCE",
    "USERS",
    "DSH_SUMMARY_GROUP",
    "DSH_SUMMARY_QUERY",
    "DSH_DETAIL_TABLE",
    "DSH_SUMMARY_FIELD",
    "DSH_DETAIL_COLUMN",
    "TOKEN",
    "DSH_CONFIG_AUDIT",
    "flyway_schema_history",
)

sys.path.insert(0, str(SIDECAR_DIR))


class E2EFailure(RuntimeError):
    """An integration assertion failed without including database row content."""


class InjectedAuditFailure(RuntimeError):
    """Controlled failure used to verify rollback after audit writes begin."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise E2EFailure(message)


def read_local_credentials(env_file: Path) -> tuple[str, str, str]:
    """Read only the named local Oracle variables and never echo their values."""
    values: dict[str, str] = {}
    if env_file.is_file():
        try:
            from dotenv import dotenv_values

            values = {key: str(value) for key, value in dotenv_values(env_file).items() if value is not None}
        except ImportError:
            for raw_line in env_file.read_text(encoding="utf-8").splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip().strip('"').strip("'")

    admin_password = os.environ.get("ORACLE_POC_ADMIN_PASSWORD") or values.get("ORACLE_POC_ADMIN_PASSWORD", "")
    test_password = (
        os.environ.get("ORACLE_MONITORING_TEST_PASSWORD")
        or values.get("ORACLE_MONITORING_TEST_PASSWORD", "")
        or os.environ.get("ORACLE_POC_APP_PASSWORD")
        or values.get("ORACLE_POC_APP_PASSWORD", "")
    )
    require(bool(admin_password), "Set ORACLE_POC_ADMIN_PASSWORD or provide the local .env.oracle-poc file.")
    require(
        bool(test_password),
        "Set ORACLE_MONITORING_TEST_PASSWORD or provide ORACLE_POC_APP_PASSWORD in the local env file.",
    )
    return admin_password, test_password, str(env_file)


def read_local_test_password(env_file: Path) -> tuple[str, str]:
    """Read only the MONITORING account credential for package replay checks."""
    values: dict[str, str] = {}
    if env_file.is_file():
        for raw_line in env_file.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            if key.strip() in {"ORACLE_MONITORING_TEST_PASSWORD", "ORACLE_POC_APP_PASSWORD"}:
                values[key.strip()] = value.strip().strip('"').strip("'")
    test_password = (
        os.environ.get("ORACLE_MONITORING_TEST_PASSWORD")
        or values.get("ORACLE_MONITORING_TEST_PASSWORD", "")
        or os.environ.get("ORACLE_POC_APP_PASSWORD")
        or values.get("ORACLE_POC_APP_PASSWORD", "")
    )
    require(
        bool(test_password),
        "Set ORACLE_MONITORING_TEST_PASSWORD or provide ORACLE_POC_APP_PASSWORD in the local env file.",
    )
    return test_password, str(env_file)


def oracle_error_code(error: BaseException) -> str:
    """Return only an Oracle error code, excluding SQL, binds, and credentials."""
    try:
        code = error.args[0].code
        return f"ORA-{int(code):05d}"
    except Exception:
        return type(error).__name__


def assert_local_identity(connection: Any) -> None:
    cursor = connection.cursor()
    cursor.execute(
        "SELECT SYS_CONTEXT('USERENV','DB_NAME'), SYS_CONTEXT('USERENV','SERVICE_NAME'), "
        "SYS_CONTEXT('USERENV','CON_NAME') FROM DUAL"
    )
    db_name, service_name, container_name = cursor.fetchone()
    cursor.close()
    require(str(db_name).upper() == "FREEPDB1", "Refusing writes: database identity is not FREEPDB1.")
    require(str(service_name).lower() == "freepdb1", "Refusing writes: service is not the local FREEPDB1 service.")
    require(str(container_name).upper() == "FREEPDB1", "Refusing writes: current container is not FREEPDB1.")


def find_schema_user(admin_connection: Any) -> bool:
    cursor = admin_connection.cursor()
    cursor.execute("SELECT 1 FROM DBA_USERS WHERE USERNAME = :username", username=SCHEMA_USER)
    exists = cursor.fetchone() is not None
    cursor.close()
    return exists


def quote_oracle_password(password: str) -> str:
    """Quote an Oracle password for CREATE USER, which does not support binds."""
    return '"' + password.replace('"', '""') + '"'


def ensure_schema_user(admin_connection: Any, test_password: str) -> bool:
    cursor = admin_connection.cursor()
    created = not find_schema_user(admin_connection)
    if created:
        cursor.execute(
            f'CREATE USER "{SCHEMA_USER}" IDENTIFIED BY {quote_oracle_password(test_password)} '
            'DEFAULT TABLESPACE USERS TEMPORARY TABLESPACE TEMP'
        )
        cursor.execute(f'GRANT CREATE SESSION, CREATE TABLE, CREATE SEQUENCE TO "{SCHEMA_USER}"')
        cursor.execute(f'ALTER USER "{SCHEMA_USER}" QUOTA UNLIMITED ON USERS')
    else:
        cursor.execute(
            "SELECT 1 FROM DBA_SYS_PRIVS WHERE GRANTEE = :username AND PRIVILEGE = 'CREATE SEQUENCE'",
            username=SCHEMA_USER,
        )
        if cursor.fetchone() is None:
            cursor.execute(f'GRANT CREATE SEQUENCE TO "{SCHEMA_USER}"')
    cursor.close()
    admin_connection.commit()
    return created


def load_discovery_ddls() -> dict[str, str]:
    payload = json.loads(SCHEMA_DDL_PATH.read_text(encoding="utf-8"))
    rows = next((value for value in payload.values() if isinstance(value, list)), None)
    require(isinstance(rows, list), "Discovery DDL JSON has no table row list.")
    ddls: dict[str, str] = {}
    for row in rows:
        name = str(row.get("TABLE_NAME", ""))
        ddl = str(row.get("DDL", "")).strip()
        if name and ddl:
            # Use the destination schema's default tablespace and storage defaults.
            ddl = re.sub(r'\bTABLESPACE\s+(?:"(?:""|[^"])+"|[A-Za-z0-9_$#]+)', "", ddl, flags=re.IGNORECASE)
            ddl = strip_storage_clauses(ddl)
            # Create objects while connected as MONITORING. Keeping the export's
            # explicit owner on CREATE TABLE makes Oracle treat its identity
            # sequence as a cross-schema object and require broad ANY privileges.
            ddl = re.sub(r'"MONITORING"\s*\.\s*', "", ddl, flags=re.IGNORECASE)
            ddls[name] = ddl
    require(bool(ddls), "No table DDL was found in the discovery export.")
    return ddls


def strip_storage_clauses(sql: str) -> str:
    """Remove physical STORAGE(...) clauses while respecting nested parentheses."""
    cursor = 0
    result = sql
    while True:
        match = re.search(r"\bSTORAGE\s*\(", result[cursor:], flags=re.IGNORECASE)
        if not match:
            return result
        start = cursor + match.start()
        open_paren = cursor + match.end() - 1
        depth = 0
        in_single = False
        index = open_paren
        while index < len(result):
            char = result[index]
            if char == "'":
                if in_single and index + 1 < len(result) and result[index + 1] == "'":
                    index += 2
                    continue
                in_single = not in_single
            elif not in_single:
                if char == "(":
                    depth += 1
                elif char == ")":
                    depth -= 1
                    if depth == 0:
                        index += 1
                        break
            index += 1
        require(depth == 0, "Unbalanced STORAGE clause in the discovery DDL export.")
        result = result[:start] + result[index:]
        cursor = start


def ensure_discovery_tables(schema_connection: Any) -> list[str]:
    ddls = load_discovery_ddls()
    cursor = schema_connection.cursor()
    cursor.execute("SELECT TABLE_NAME FROM USER_TABLES")
    existing = {str(row[0]) for row in cursor.fetchall()}
    cursor.close()

    ordered_names = [name for name in TABLE_CREATE_ORDER if name in ddls]
    ordered_names.extend(sorted(set(ddls) - set(ordered_names)))
    created: list[str] = []
    for name in ordered_names:
        if name in existing:
            continue
        cursor = schema_connection.cursor()
        try:
            cursor.execute(ddls[name])
            created.append(name)
        except Exception as error:
            cursor.close()
            raise E2EFailure(f"Could not create missing discovery table {name} ({oracle_error_code(error)}).") from None
        cursor.close()
    if created:
        schema_connection.commit()
    return created


def make_run_ids() -> dict[str, str]:
    suffix = uuid.uuid4().hex[:16].upper()
    return {
        "menu": f"E2E_MENU_{suffix}",
        "secondary_menu": f"E2E_MENU_{suffix}_SECONDARY",
        "datasource": f"E2EDS_{suffix}",
        "group": f"E2E_GROUP_{suffix}",
        "field": f"E2E_FIELD_{suffix}",
        "table": f"E2E_TABLE_{suffix}",
        "column": f"E2E_COLUMN_{suffix}",
        "apply_group": f"E2E_APPLY_GROUP_{suffix}",
        "apply_field": f"E2E_APPLY_FIELD_{suffix}",
        "rollback_group": f"E2E_ROLLBACK_GROUP_{suffix}",
        "rollback_field": f"E2E_ROLLBACK_FIELD_{suffix}",
    }


def synthetic_sql() -> str:
    content = (
        "SELECT :startDate AS START_DATE, :endDate AS END_DATE, :offset AS ROW_OFFSET, :limit AS ROW_LIMIT FROM DUAL\r\n"
        "/* E2E literal/comment bind: ':nestedBind'; unicode: 東京, café, 😀, 🌴 */\r\n"
        "/* lossless CLOB payload begins\r\n"
        + ("雪🌴CLOB-E2E-東京\r\n" * 620)
        + "lossless CLOB payload ends */"
    )
    require(len(content) > 4000, "Synthetic CLOB fixture must exceed 4,000 characters.")
    return content


def seed_synthetic_hierarchy(connection: Any, ids: dict[str, str], long_sql: str) -> None:
    cursor = connection.cursor()
    cursor.execute(
        "INSERT INTO DSH_DATASOURCE "
        "(DATASOURCE_ID, DISPLAY_NAME, JDBC_URL, CREDENTIAL_REF, POOL_MAX, CONNECT_TIMEOUT_MS, "
        "DESCRIPTION, IS_ACTIVE, CREATED_BY) "
        "VALUES (:id, :name, :url, :credential_ref, 1, 5000, :description, 'Y', 'LOCAL_E2E')",
        id=ids["datasource"],
        name="Synthetic Local E2E datasource",
        url="jdbc:oracle:thin:@127.0.0.1:1521/FREEPDB1",
        credential_ref="LOCAL_E2E_ONLY",
        description="Synthetic fixture. This URL is never connected or shown by the feature.",
    )
    cursor.execute(
        "INSERT INTO DSH_MENU (MENU_ID, CHANNEL_NAME, MENU_LABEL, DISPLAY_ORDER, IS_ACTIVE, CREATED_BY) "
        "VALUES (:id, 'AD_TOOLS_LOCAL_E2E', 'Synthetic menu before update', 1, 'Y', 'LOCAL_E2E')",
        id=ids["menu"],
    )
    cursor.setinputsizes(sql_text=oracledb.DB_TYPE_CLOB)
    cursor.execute(
        "INSERT INTO DSH_SUMMARY_GROUP "
        "(GROUP_ID, MENU_ID, DATASOURCE_ID, GROUP_TITLE, SQL_TEXT, TIMEOUT_MS, DISPLAY_ORDER) "
        "VALUES (:id, :menu_id, :datasource_id, 'Synthetic long CLOB group', :sql_text, 60000, 1)",
        id=ids["group"],
        menu_id=ids["menu"],
        datasource_id=ids["datasource"],
        sql_text=long_sql,
    )
    cursor.execute(
        "INSERT INTO DSH_SUMMARY_FIELD "
        "(FIELD_ID, GROUP_ID, FIELD_TITLE, SOURCE_FIELD, VALUE_FORMAT, TONE, DISPLAY_ORDER) "
        "VALUES (:id, :group_id, 'Synthetic count', 'E2E_COUNT', 'number', NULL, 1)",
        id=ids["field"],
        group_id=ids["group"],
    )
    cursor.execute(
        "INSERT INTO DSH_DETAIL_TABLE "
        "(TABLE_ID, MENU_ID, DATASOURCE_ID, TABLE_TITLE, PAGE_SIZE, SQL_TEXT, TIMEOUT_MS, DISPLAY_ORDER, SHOW_CHART) "
        "VALUES (:id, :menu_id, :datasource_id, 'Synthetic detail', 10, :sql_text, 5000, 1, 'N')",
        id=ids["table"],
        menu_id=ids["menu"],
        datasource_id=ids["datasource"],
        sql_text="SELECT :startDate AS START_DATE, :endDate AS END_DATE, :offset AS OFFSET_VALUE, :limit AS LIMIT_VALUE FROM DUAL",
    )
    cursor.execute(
        "INSERT INTO DSH_DETAIL_COLUMN "
        "(COLUMN_ID, TABLE_ID, COLUMN_TITLE, SOURCE_FIELD, VALUE_FORMAT, ALIGN, DISPLAY_ORDER) "
        "VALUES (:id, :table_id, 'Synthetic value', 'E2E_VALUE', 'text', 'left', 1)",
        id=ids["column"],
        table_id=ids["table"],
    )
    cursor.close()
    connection.commit()


def table_rows(load_result: dict[str, Any], table_name: str) -> list[dict[str, Any]]:
    tables = load_result.get("tables")
    require(isinstance(tables, dict), "Monitoring load did not return the typed tables map.")
    rows = tables.get(table_name)
    require(isinstance(rows, list), f"Monitoring load omitted {table_name} rows.")
    return rows


def row_by_id(rows: list[dict[str, Any]], id_column: str, expected_id: str) -> dict[str, Any]:
    row = next((item for item in rows if item.get(id_column) == expected_id), None)
    require(isinstance(row, dict), f"Monitoring load did not include the synthetic {id_column} fixture.")
    return row


def number_value(value: int | str) -> dict[str, str]:
    return {"type": "number", "value": str(value)}


def clob_value(text: str) -> dict[str, str]:
    return {"type": "clob", "value": text}


def typed_clob_text(value: Any) -> str | None:
    if isinstance(value, dict) and value.get("type") == "clob":
        return str(value.get("value", ""))
    return value if isinstance(value, str) else None


def typed_number(value: Any) -> bool:
    return isinstance(value, dict) and value.get("type") == "number" and "value" in value


def write_ui_fixture(load_result: dict[str, Any], ids: dict[str, str], destination: Path) -> None:
    """Write one synthetic menu graph without unrelated Oracle rows or datasource secrets."""
    fixture = copy.deepcopy(load_result)
    table_keys = {
        "DSH_MENU": ("MENU_ID", ids["menu"]),
        "DSH_SUMMARY_GROUP": ("GROUP_ID", ids["group"]),
        "DSH_SUMMARY_FIELD": ("FIELD_ID", ids["field"]),
        "DSH_DETAIL_TABLE": ("TABLE_ID", ids["table"]),
        "DSH_DETAIL_COLUMN": ("COLUMN_ID", ids["column"]),
        "DSH_DATASOURCE": ("DATASOURCE_ID", ids["datasource"]),
    }
    tables = fixture.get("tables")
    require(isinstance(tables, dict), "Cannot export a UI fixture without loaded configuration tables.")
    for table, (key, allowed_id) in table_keys.items():
        tables[table] = [row for row in tables.get(table, []) if row.get(key) == allowed_id]
    tables["DSH_SUMMARY_QUERY"] = [
        row for row in tables.get("DSH_SUMMARY_QUERY", []) if row.get("MENU_ID") == ids["menu"]
    ]
    require(len(tables["DSH_MENU"]) == 1, "UI fixture export must contain exactly one synthetic menu.")
    require(
        all(
            set(row) == {"DATASOURCE_ID", "DISPLAY_NAME", "IS_ACTIVE", "POOL_MAX", "CONNECT_TIMEOUT_MS"}
            for row in tables["DSH_DATASOURCE"]
        ),
        "UI fixture datasource projection unexpectedly included connection details.",
    )
    inventory_keys = {
        "DSH_MENU": ids["menu"],
        "DSH_SUMMARY_GROUP": ids["group"],
        "DSH_SUMMARY_FIELD": ids["field"],
        "DSH_DETAIL_TABLE": ids["table"],
        "DSH_DETAIL_COLUMN": ids["column"],
        "DSH_SUMMARY_QUERY": ids["menu"],
    }
    inventory = fixture.get("idInventory")
    if isinstance(inventory, dict):
        fixture["idInventory"] = {
            table: [value for value in values if value == inventory_keys.get(table)]
            for table, values in inventory.items()
            if table in inventory_keys
        }
    fixture["health"] = {"orphanSummaryFields": []}
    fixture["issues"] = [
        issue
        for issue in fixture.get("issues", [])
        if not isinstance(issue, dict) or issue.get("type") != "orphan-summary-field"
    ]
    fixture["readScope"] = "single synthetic LOCAL E2E menu hierarchy"
    fixture["readAt"] = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    identity = fixture.get("identity")
    if isinstance(identity, dict):
        fixture["identity"] = {
            key: identity[key]
            for key in ("database", "service", "schema", "username", "characterSet")
            if key in identity
        }
    serialized = json.dumps(fixture, ensure_ascii=False, indent=2) + "\n"
    require("jdbc:oracle:" not in serialized.lower(), "UI fixture contains a datasource connection URL.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(serialized, encoding="utf-8")


def apply_request(load_result: dict[str, Any], request_id: str, change_id: str, operations: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "action": "apply",
        "identity": copy.deepcopy(load_result["identity"]),
        "schemaFingerprint": load_result["schemaFingerprint"],
        "requestId": request_id,
        "changeId": change_id,
        "actor": {"source": "declared", "name": "AD Tools LOCAL E2E"},
        "operations": operations,
    }


def insert_operation(table: str, desired: dict[str, Any]) -> dict[str, Any]:
    return {"table": table, "action": "INSERT", "baseline": None, "desired": desired}


def update_operation(table: str, baseline: dict[str, Any], desired: dict[str, Any]) -> dict[str, Any]:
    return {"table": table, "action": "UPDATE", "baseline": copy.deepcopy(baseline), "desired": desired}


def assert_success(result: dict[str, Any], state: str, description: str) -> None:
    require(isinstance(result, dict), f"{description}: handler returned no result object.")
    backend_state = result.get("state") or result.get("errorCode") or "no state"
    error = result.get("error") if isinstance(result.get("error"), dict) else {}
    error_code = error.get("code") or "no error code"
    details = error.get("details") if isinstance(error.get("details"), dict) else {}
    table = details.get("table") if isinstance(details.get("table"), str) else "unknown table"
    oracle_code = details.get("oracleCode")
    oracle_hint = f", oracleCode={int(oracle_code)}" if isinstance(oracle_code, int) else ""
    expected = details.get("expected") if isinstance(details.get("expected"), dict) else {}
    actual = details.get("actual") if isinstance(details.get("actual"), dict) else {}
    mismatch_columns = sorted(name for name in set(expected) | set(actual) if expected.get(name) != actual.get(name))
    mismatch_hint = ",".join(mismatch_columns)
    require(
        result.get("ok") is True,
        f"{description}: backend returned ok=false ({backend_state}, {error_code}{oracle_hint}, {table}, {mismatch_hint}).",
    )
    if state:
        require(result.get("state") == state, f"{description}: expected state {state}, received {result.get('state')}.")


def import_monitoring_module() -> Any:
    try:
        import monitoring  # type: ignore[import-not-found]
    except Exception as error:
        raise E2EFailure(f"Could not import tauri/sidecar/monitoring.py ({type(error).__name__}).") from None
    require(callable(getattr(monitoring, "handle", None)), "monitoring.handle(conn, request) is unavailable.")
    return monitoring


def run_integration(
    connection: Any, long_sql: str, ids: dict[str, str], ui_fixture_path: Path | None = None
) -> dict[str, str]:
    monitoring = import_monitoring_module()
    initial = monitoring.handle(connection, {"action": "load", "menuId": ids["menu"]})
    assert_success(initial, "Loaded", "initial load")
    require(initial.get("complete") is True, "Load did not assert a complete baseline.")
    require("identity" in initial and "schemaFingerprint" in initial, "Load omitted target identity or schema fingerprint.")
    if ui_fixture_path is not None:
        write_ui_fixture(initial, ids, ui_fixture_path)
        print(f"ui_fixture_written={ui_fixture_path}")

    baseline_menu = row_by_id(table_rows(initial, "DSH_MENU"), "MENU_ID", ids["menu"])
    source_group = row_by_id(table_rows(initial, "DSH_SUMMARY_GROUP"), "GROUP_ID", ids["group"])
    actual_sql = typed_clob_text(source_group.get("SQL_TEXT"))
    require(actual_sql == long_sql, "Load did not preserve the full synthetic CLOB byte-for-byte at the text boundary.")
    require(len(actual_sql or "") > 4000, "Loaded CLOB was unexpectedly truncated below 4,000 characters.")
    require(typed_number(source_group.get("TIMEOUT_MS")), "Load did not return NUMBER values in the typed representation.")
    datasource = row_by_id(table_rows(initial, "DSH_DATASOURCE"), "DATASOURCE_ID", ids["datasource"])
    require(
        set(datasource) == {"DATASOURCE_ID", "DISPLAY_NAME", "IS_ACTIVE", "POOL_MAX", "CONNECT_TIMEOUT_MS"},
        "Load datasource rows did not use the safe read projection.",
    )

    updated_menu = copy.deepcopy(baseline_menu)
    updated_menu["MENU_LABEL"] = "Synthetic menu after mixed apply"
    inserted_group = {
        "GROUP_ID": ids["apply_group"],
        "MENU_ID": ids["menu"],
        "DATASOURCE_ID": ids["datasource"],
        "GROUP_TITLE": "Synthetic inserted group",
        "SQL_TEXT": clob_value(long_sql),
        "TIMEOUT_MS": number_value(60000),
        "DISPLAY_ORDER": number_value(2),
    }
    inserted_field = {
        "FIELD_ID": ids["apply_field"],
        "GROUP_ID": ids["apply_group"],
        "FIELD_TITLE": "Synthetic inserted field",
        "SOURCE_FIELD": "E2E_INSERTED_VALUE",
        "VALUE_FORMAT": "number",
        "TONE": None,
        "DISPLAY_ORDER": number_value(1),
    }
    change_id = str(uuid.uuid4())
    request_id = str(uuid.uuid4())
    mixed_ops = [
        update_operation("DSH_MENU", baseline_menu, updated_menu),
        insert_operation("DSH_SUMMARY_GROUP", inserted_group),
        insert_operation("DSH_SUMMARY_FIELD", inserted_field),
    ]
    applied = monitoring.handle(connection, apply_request(initial, request_id, change_id, mixed_ops))
    assert_success(applied, "Committed", "mixed INSERT/UPDATE apply")
    health_check = getattr(connection, "is_healthy", None)
    connection_healthy = health_check() if callable(health_check) else None
    print(f"connection_healthy_after_apply={connection_healthy if connection_healthy is not None else 'unknown'}")
    require(connection_healthy is True, "Oracle connection became unhealthy after a committed apply.")
    require(len(applied.get("rows", [])) == 3, "Mixed apply did not return readback for all three changed rows.")
    applied_audit_ids = applied.get("auditIds", [])
    require(
        len(applied_audit_ids) == 3 and all(isinstance(item, str) and item.isdecimal() for item in applied_audit_ids),
        "Mixed apply did not return three audit IDs as decimal strings.",
    )

    after_apply = monitoring.handle(connection, {"action": "load", "menuId": ids["menu"]})
    assert_success(after_apply, "Loaded", "post-apply load")
    actual_menu = row_by_id(table_rows(after_apply, "DSH_MENU"), "MENU_ID", ids["menu"])
    actual_group = row_by_id(table_rows(after_apply, "DSH_SUMMARY_GROUP"), "GROUP_ID", ids["apply_group"])
    actual_field = row_by_id(table_rows(after_apply, "DSH_SUMMARY_FIELD"), "FIELD_ID", ids["apply_field"])
    require(actual_menu.get("MENU_LABEL") == "Synthetic menu after mixed apply", "Menu UPDATE did not persist.")
    require(typed_clob_text(actual_group.get("SQL_TEXT")) == long_sql, "Inserted CLOB did not round-trip exactly.")
    require(actual_field.get("GROUP_ID") == ids["apply_group"], "Inserted field does not reference its new group.")

    actual_rows = applied.get("rows", [])
    require(len(actual_rows) == 3, "Mixed apply omitted committed row readback values.")
    verify_operations = [
        {"table": row["table"], "desired": copy.deepcopy(row["row"])}
        for row in actual_rows
    ]
    verification = monitoring.handle(
        connection,
        {
            "action": "verify",
            "identity": copy.deepcopy(initial["identity"]),
            "schemaFingerprint": initial["schemaFingerprint"],
            "operations": verify_operations,
        },
    )
    assert_success(verification, "Verified", "database verification")

    audit_verification = monitoring.handle(
        connection,
        {
            "action": "verify",
            "identity": copy.deepcopy(initial["identity"]),
            "schemaFingerprint": initial["schemaFingerprint"],
            "requestId": request_id,
            "changeId": change_id,
            "actor": {
                "source": "declared",
                "name": "AD Tools LOCAL E2E",
                "databaseUsername": initial["identity"].get("sessionUser") or initial["identity"]["username"],
            },
            "operations": copy.deepcopy(mixed_ops),
        },
    )
    assert_success(audit_verification, "Verified", "audit-backed verification")
    require(audit_verification.get("auditVerified") is True, "Verify did not confirm the committed audit group.")
    require(
        all(isinstance(item, str) and item.isdecimal() for item in audit_verification.get("auditIds", [])),
        "Audit-backed verify did not return audit IDs as decimal strings.",
    )
    require(
        all(
            isinstance(match.get("auditId"), str) and match["auditId"].isdecimal()
            for match in audit_verification.get("matches", [])
        ),
        "Audit-backed verify did not return match audit IDs as decimal strings.",
    )
    outcome_unknown = monitoring.handle(
        connection,
        {
            "action": "verify",
            "identity": copy.deepcopy(initial["identity"]),
            "schemaFingerprint": initial["schemaFingerprint"],
            "outcomeUnknown": True,
            "operations": copy.deepcopy(mixed_ops),
        },
    )
    require(
        outcome_unknown.get("state") == "Reconciliation Required"
        and (outcome_unknown.get("error") or {}).get("code") == "RECONCILIATION_REQUIRED",
        "Outcome Unknown verification without a changeId did not require reconciliation.",
    )

    history = monitoring.handle(
        connection,
        {
            "action": "history",
            "menuId": ids["menu"],
            "offset": 0,
            "pageSize": 50,
            "changeId": change_id,
            "auditIds": applied["auditIds"],
        },
    )
    assert_success(history, "Loaded", "history readback")
    history_entries = history.get("entries")
    require(isinstance(history_entries, list) and len(history_entries) == 3, "History detail omitted committed audit entries.")
    require(
        all(isinstance(entry.get("auditId"), str) and entry["auditId"].isdecimal() for entry in history_entries),
        "History detail did not return audit IDs as decimal strings.",
    )
    require(
        {int(entry["auditId"]) for entry in history_entries} == {int(item) for item in applied["auditIds"]},
        "History omitted one or more committed audit IDs.",
    )
    require(history.get("complete") is True, "History detail did not prove a complete transaction group.")
    require(
        all(entry.get("groupComplete") is True and entry.get("expectedOperationCount") == 3 for entry in history_entries),
        "History detail did not expose a complete three-operation group.",
    )
    by_table = {entry["table"]: entry for entry in history_entries}
    group_history = by_table.get("DSH_SUMMARY_GROUP", {}).get("newValue", {})
    history_group_row = group_history.get("row", {}) if isinstance(group_history, dict) else {}
    require(
        typed_clob_text(history_group_row.get("SQL_TEXT")) == long_sql,
        "History did not preserve the full Unicode CLOB in its parsed after envelope.",
    )
    require(
        all(entry.get("newValue", {}).get("changeId") == change_id for entry in history_entries),
        "History detail did not retain the transaction change ID in every envelope.",
    )
    history_summary = monitoring.handle(
        connection,
        {"action": "history", "menuId": ids["menu"], "offset": 0, "pageSize": 50},
    )
    assert_success(history_summary, "Loaded", "history transaction summary")
    matching_transactions = [
        item for item in history_summary.get("transactions", []) if item.get("changeId") == change_id
    ]
    require(len(matching_transactions) == 1, "History summary did not group the mixed apply into one transaction.")
    transaction = matching_transactions[0]
    require(
        (transaction.get("operationCount"), transaction.get("insertCount"), transaction.get("updateCount"))
        == (3, 2, 1),
        "History summary did not preserve mixed INSERT/UPDATE counts.",
    )
    require(
        transaction.get("groupComplete") is True and transaction.get("expectedOperationCount") == 3,
        "History summary did not report the complete expected operation count.",
    )

    # Change the row outside the managed handler after its baseline was loaded.
    stale_baseline = copy.deepcopy(actual_menu)
    cursor = connection.cursor()
    cursor.execute(
        "UPDATE DSH_MENU SET MENU_LABEL = :label WHERE MENU_ID = :menu_id",
        label="Synthetic external edit before conflict check",
        menu_id=ids["menu"],
    )
    connection.commit()
    stale_draft = copy.deepcopy(stale_baseline)
    stale_draft["MENU_LABEL"] = "Synthetic stale draft must not win"
    before_conflict_audits = count_audits(connection, ids["menu"])
    conflict = monitoring.handle(
        connection,
        apply_request(
            after_apply,
            str(uuid.uuid4()),
            str(uuid.uuid4()),
            [update_operation("DSH_MENU", stale_baseline, stale_draft)],
        ),
    )
    require(conflict.get("state") == "Conflict", "Stale managed update did not return Conflict.")
    require(count_audits(connection, ids["menu"]) == before_conflict_audits, "Conflict unexpectedly wrote audit history.")
    cursor = connection.cursor()
    cursor.execute("SELECT MENU_LABEL FROM DSH_MENU WHERE MENU_ID = :menu_id", menu_id=ids["menu"])
    latest_label = cursor.fetchone()[0]
    cursor.close()
    require(latest_label == "Synthetic external edit before conflict check", "Conflict path overwrote the external edit.")

    # Exercise a failure after configuration changes and two audit rows have been
    # inserted on the same transaction connection. The module helper is private
    # and patched only for this one in-process call; no database object is added.
    rollback_load = monitoring.handle(connection, {"action": "load", "menuId": ids["menu"]})
    assert_success(rollback_load, "Loaded", "rollback baseline load")
    rollback_menu = row_by_id(table_rows(rollback_load, "DSH_MENU"), "MENU_ID", ids["menu"])
    rollback_draft = copy.deepcopy(rollback_menu)
    rollback_draft["MENU_LABEL"] = "Synthetic rollback must restore this row"
    rollback_group = dict(inserted_group)
    rollback_group["GROUP_ID"] = ids["rollback_group"]
    rollback_group["GROUP_TITLE"] = "Synthetic group rolled back"
    rollback_field = dict(inserted_field)
    rollback_field["FIELD_ID"] = ids["rollback_field"]
    rollback_field["GROUP_ID"] = ids["rollback_group"]
    rollback_field["FIELD_TITLE"] = "Synthetic field rolled back"
    rollback_id = str(uuid.uuid4())
    rollback_ops = [
        update_operation("DSH_MENU", rollback_menu, rollback_draft),
        insert_operation("DSH_SUMMARY_GROUP", rollback_group),
        insert_operation("DSH_SUMMARY_FIELD", rollback_field),
    ]
    original_audit_insert = getattr(monitoring, "_insert_audit_row", None)
    require(callable(original_audit_insert), "Backend does not expose the private audit helper required for rollback injection.")
    audit_calls = 0

    def fail_after_two_audit_writes(*args: Any, **kwargs: Any) -> Any:
        nonlocal audit_calls
        audit_calls += 1
        inserted = original_audit_insert(*args, **kwargs)
        if audit_calls == 2:
            raise InjectedAuditFailure("LOCAL E2E injected failure after second audit row")
        return inserted

    monitoring._insert_audit_row = fail_after_two_audit_writes
    try:
        rollback_result = monitoring.handle(
            connection,
            apply_request(rollback_load, str(uuid.uuid4()), rollback_id, rollback_ops),
        )
    finally:
        monitoring._insert_audit_row = original_audit_insert
    require(audit_calls >= 2, "Rollback injection did not reach the audit write phase.")
    require(rollback_result.get("state") == "Failed", "Injected audit failure did not return Failed.")
    connection.rollback()
    cursor = connection.cursor()
    cursor.execute("SELECT MENU_LABEL FROM DSH_MENU WHERE MENU_ID = :menu_id", menu_id=ids["menu"])
    rolled_back_label = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM DSH_SUMMARY_GROUP WHERE GROUP_ID = :group_id", group_id=ids["rollback_group"])
    rolled_back_group_count = int(cursor.fetchone()[0])
    cursor.execute(
        "SELECT COUNT(*) FROM DSH_CONFIG_AUDIT "
        "WHERE DBMS_LOB.INSTR(NEW_VALUE, :change_id) > 0 OR DBMS_LOB.INSTR(OLD_VALUE, :change_id) > 0",
        change_id=rollback_id,
    )
    rolled_back_audit_count = int(cursor.fetchone()[0])
    cursor.close()
    require(rolled_back_label == "Synthetic external edit before conflict check", "Configuration UPDATE survived the rollback.")
    require(rolled_back_group_count == 0, "Configuration INSERT survived the rollback.")
    require(rolled_back_audit_count == 0, "Audit INSERT survived the rollback.")

    return {
        "load": str(initial.get("state")),
        "mixed_apply": str(applied.get("state")),
        "verification": str(verification.get("state")),
        "audit_verification": str(audit_verification.get("state")),
        "outcome_unknown_reconciliation": str(outcome_unknown.get("state")),
        "history": str(history.get("state")),
        "history_summary": str(history_summary.get("state")),
        "history_group": f"complete/{transaction.get('expectedOperationCount')}",
        "audit_id_contract": "decimal strings",
        "stale_conflict": str(conflict.get("state")),
        "rollback": str(rollback_result.get("state")),
    }


def export_ui_fixture(connection: Any, long_sql: str, ids: dict[str, str], destination: Path) -> None:
    monitoring = import_monitoring_module()
    result = monitoring.handle(connection, {"action": "load", "menuId": ids["menu"]})
    assert_success(result, "Loaded", "UI fixture load")
    require(result.get("complete") is True, "UI fixture load did not return a complete baseline.")
    group = row_by_id(table_rows(result, "DSH_SUMMARY_GROUP"), "GROUP_ID", ids["group"])
    require(
        typed_clob_text(group.get("SQL_TEXT")) == long_sql,
        "UI fixture load did not preserve the full synthetic Unicode CLOB.",
    )
    write_ui_fixture(result, ids, destination)
    print(f"ui_fixture_written={destination}")


def count_audits(connection: Any, menu_id: str) -> int:
    cursor = connection.cursor()
    cursor.execute(
        "SELECT COUNT(*) FROM DSH_CONFIG_AUDIT "
        "WHERE DBMS_LOB.INSTR(NEW_VALUE, :menu_id) > 0 OR DBMS_LOB.INSTR(OLD_VALUE, :menu_id) > 0",
        menu_id=menu_id,
    )
    count = int(cursor.fetchone()[0])
    cursor.close()
    return count


def run_multimenu_history(connection: Any, ids: dict[str, str]) -> str:
    monitoring = import_monitoring_module()
    secondary_id = ids["secondary_menu"]
    cursor = connection.cursor()
    cursor.execute(
        "INSERT INTO DSH_MENU (MENU_ID, CHANNEL_NAME, MENU_LABEL, DISPLAY_ORDER, IS_ACTIVE, CREATED_BY) "
        "VALUES (:id, 'AD_TOOLS_LOCAL_E2E', 'Synthetic second menu before update', 2, 'Y', 'LOCAL_E2E')",
        id=secondary_id,
    )
    cursor.close()
    connection.commit()

    first_load = monitoring.handle(connection, {"action": "load", "menuId": ids["menu"]})
    second_load = monitoring.handle(connection, {"action": "load", "menuId": secondary_id})
    assert_success(first_load, "Loaded", "multi-menu primary baseline")
    assert_success(second_load, "Loaded", "multi-menu secondary baseline")
    first_before = row_by_id(table_rows(first_load, "DSH_MENU"), "MENU_ID", ids["menu"])
    second_before = row_by_id(table_rows(second_load, "DSH_MENU"), "MENU_ID", secondary_id)
    first_after = copy.deepcopy(first_before)
    second_after = copy.deepcopy(second_before)
    first_after["MENU_LABEL"] = "Synthetic first menu multi-menu update"
    second_after["MENU_LABEL"] = "Synthetic second menu multi-menu update"
    change_id = str(uuid.uuid4())
    request_id = str(uuid.uuid4())
    operations = [
        update_operation("DSH_MENU", first_before, first_after),
        update_operation("DSH_MENU", second_before, second_after),
    ]
    applied = monitoring.handle(connection, apply_request(first_load, request_id, change_id, operations))
    assert_success(applied, "Committed", "multi-menu apply")
    require(
        len(applied.get("auditIds", [])) == 2
        and all(isinstance(value, str) and value.isdecimal() for value in applied.get("auditIds", [])),
        "Multi-menu apply did not return two decimal-string audit IDs.",
    )

    summary_states = []
    for menu_id in (ids["menu"], secondary_id):
        summary = monitoring.handle(
            connection, {"action": "history", "menuId": menu_id, "offset": 0, "pageSize": 50}
        )
        assert_success(summary, "Loaded", "multi-menu history summary")
        matches = [item for item in summary.get("transactions", []) if item.get("changeId") == change_id]
        require(len(matches) == 1, "Menu-scoped summary omitted its multi-menu transaction.")
        item = matches[0]
        require(
            item.get("groupComplete") is False and item.get("expectedOperationCount") == 2,
            "Menu-scoped summary did not mark the cross-menu transaction as partial.",
        )
        summary_states.append((item.get("operationCount"), item.get("groupComplete")))
    require(summary_states == [(1, False), (1, False)], "Multi-menu summaries did not report one scoped operation each.")

    expected_audit_ids = {str(value) for value in applied["auditIds"]}
    for menu_id in (ids["menu"], secondary_id):
        detail = monitoring.handle(
            connection,
            {"action": "history", "menuId": menu_id, "changeId": change_id, "pageSize": 50},
        )
        assert_success(detail, "Loaded", "multi-menu history detail")
        entries = detail.get("entries", [])
        require(detail.get("complete") is True and len(entries) == 2, "Change detail did not load the full cross-menu group.")
        require(
            {str(entry.get("auditId")) for entry in entries} == expected_audit_ids
            and all(entry.get("groupComplete") is True and entry.get("expectedOperationCount") == 2 for entry in entries),
            "Cross-menu detail did not report the complete two-operation audit group.",
        )
        menu_ids = {entry.get("newValue", {}).get("menuId") for entry in entries}
        require(menu_ids == {ids["menu"], secondary_id}, "Cross-menu audit envelopes did not preserve both menu IDs.")
    return "scoped 1/2; detail complete/2 from either menu"


def package_sql_block(script_path: Path, manifest_path: Path) -> tuple[dict[str, Any], str]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    source_identity = manifest.get("sourceIdentity")
    require(
        isinstance(source_identity, dict)
        and str(source_identity.get("database", "")).upper() == "FREEPDB1"
        and str(source_identity.get("service", "")).lower() == "freepdb1"
        and str(source_identity.get("schema", "")).upper() == SCHEMA_USER
        and str(source_identity.get("username", "")).upper() == SCHEMA_USER,
        "Refusing package execution: manifest target is not the local MONITORING identity.",
    )
    script_bytes = script_path.read_bytes()
    expected_hash = manifest.get("scriptSha256")
    actual_hash = hashlib.sha256(script_bytes).hexdigest()
    require(isinstance(expected_hash, str) and actual_hash == expected_hash, "Package script hash differs from its manifest.")
    script = script_bytes.decode("utf-8")
    lines = script.splitlines()
    starts = [index for index, line in enumerate(lines) if line.strip().upper() in {"DECLARE", "BEGIN"}]
    require(bool(starts), "Package must contain an anonymous PL/SQL block.")
    start = starts[0]
    try:
        end = next(index for index in range(start + 1, len(lines)) if lines[index].strip() == "/")
    except StopIteration:
        raise E2EFailure("Package is missing the SQL*Plus anonymous-block terminator.") from None
    trailing = [line.strip() for line in lines[end + 1:] if line.strip() and not line.lstrip().startswith("--")]
    allowed_directives = ("SET ", "WHENEVER ", "PROMPT ", "SPOOL ", "EXIT")
    require(
        all(line.upper().startswith(allowed_directives) for line in trailing),
        "Package contains unsupported statements after its anonymous PL/SQL block.",
    )
    require(
        any(line.strip().upper() == "SET DEFINE OFF" for line in lines[:start]),
        "Package must disable SQL*Plus substitution before its anonymous PL/SQL block.",
    )
    return manifest, "\n".join(lines[start:end])


def package_operation_keys(manifest: dict[str, Any]) -> tuple[str, str, str]:
    operations = manifest.get("operations")
    require(isinstance(operations, list) and len(operations) == 3, "Package must contain the expected three synthetic operations.")
    expected = [("DSH_MENU", "UPDATE"), ("DSH_SUMMARY_GROUP", "INSERT"), ("DSH_SUMMARY_FIELD", "INSERT")]
    actual = [(item.get("table"), item.get("action")) for item in operations if isinstance(item, dict)]
    require(actual == expected, "Package operation set or parent-first order is not the expected synthetic batch.")
    ids = []
    for item, (table, _) in zip(operations, expected):
        primary_key = item.get("primaryKey")
        require(isinstance(primary_key, dict), f"Package omitted the {table} primary key.")
        value = primary_key.get("value")
        require(isinstance(value, str), f"Package has an invalid {table} primary key.")
        ids.append(value)
    require(ids[0].startswith("E2E_MENU_"), "Package menu key is not a synthetic LOCAL E2E key.")
    for value in ids[1:]:
        if not value.startswith(("PKG_GROUP_", "PKG_FIELD_")):
            try:
                require(str(uuid.UUID(value)) == value.lower(), "Package insert keys must be synthetic UUIDs.")
            except (ValueError, AttributeError):
                raise E2EFailure("Package insert keys are not synthetic.") from None
    return ids[0], ids[1], ids[2]


def expected_clob_from_fixture(fixture_path: Path, menu_id: str) -> tuple[int, str]:
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    rows = fixture.get("tables", {}).get("DSH_SUMMARY_GROUP", [])
    matches = [row for row in rows if row.get("MENU_ID") == menu_id]
    require(len(matches) == 1, "Expected CLOB fixture must contain one source summary group for the package menu.")
    text_value = typed_clob_text(matches[0].get("SQL_TEXT"))
    require(isinstance(text_value, str), "Expected CLOB fixture omitted the typed SQL_TEXT value.")
    return len(text_value), hashlib.sha256(text_value.encode("utf-8")).hexdigest()


def package_scalar_count(connection: Any, table: str, key_column: str, key_value: str) -> int:
    allowed = {
        ("DSH_SUMMARY_GROUP", "GROUP_ID"),
        ("DSH_SUMMARY_FIELD", "FIELD_ID"),
    }
    require((table, key_column) in allowed, "Package verification requested an unsupported row key.")
    cursor = connection.cursor()
    cursor.execute(f"SELECT COUNT(*) FROM {table} WHERE {key_column} = :key_value", key_value=key_value)
    count = int(cursor.fetchone()[0])
    cursor.close()
    return count


def package_menu_label(connection: Any, menu_id: str) -> str | None:
    cursor = connection.cursor()
    cursor.execute("SELECT MENU_LABEL FROM DSH_MENU WHERE MENU_ID = :menu_id", menu_id=menu_id)
    row = cursor.fetchone()
    cursor.close()
    return str(row[0]) if row and row[0] is not None else None


def verify_package_clob(connection: Any, group_id: str, expected_chars: int, expected_sha256: str) -> None:
    cursor = connection.cursor()
    cursor.execute("SELECT SQL_TEXT FROM DSH_SUMMARY_GROUP WHERE GROUP_ID = :group_id", group_id=group_id)
    row = cursor.fetchone()
    cursor.close()
    require(row is not None and row[0] is not None, "Standalone package did not persist the synthetic CLOB.")
    text_value = row[0].read() if hasattr(row[0], "read") else str(row[0])
    digest = hashlib.sha256(text_value.encode("utf-8")).hexdigest()
    require(len(text_value) == expected_chars, "Standalone package CLOB code-point length did not match.")
    require(digest == expected_sha256, "Standalone package CLOB SHA-256 did not match.")
    print(
        f"package_clob_codepoints={len(text_value)} package_clob_utf8_bytes={len(text_value.encode('utf-8'))} "
        f"package_clob_sha256={digest}"
    )


def run_standalone_package(
    connection: Any, script_path: Path, manifest_path: Path, expected_chars: int, expected_sha256: str
) -> dict[str, Any]:
    manifest, block = package_sql_block(script_path, manifest_path)
    menu_id, group_id, field_id = package_operation_keys(manifest)
    initial = import_monitoring_module().handle(connection, {"action": "load", "menuId": menu_id})
    assert_success(initial, "Loaded", "package baseline load")
    baseline_menu = row_by_id(table_rows(initial, "DSH_MENU"), "MENU_ID", menu_id)
    original_label = baseline_menu.get("MENU_LABEL")
    initial_audits = count_audits(connection, menu_id)
    require(package_scalar_count(connection, "DSH_SUMMARY_GROUP", "GROUP_ID", group_id) == 0, "Package group key already exists.")
    require(package_scalar_count(connection, "DSH_SUMMARY_FIELD", "FIELD_ID", field_id) == 0, "Package field key already exists.")

    cursor = connection.cursor()
    try:
        cursor.execute(block)
    except Exception as error:
        connection.rollback()
        label_after_failure = package_menu_label(connection, menu_id)
        group_count = package_scalar_count(connection, "DSH_SUMMARY_GROUP", "GROUP_ID", group_id)
        field_count = package_scalar_count(connection, "DSH_SUMMARY_FIELD", "FIELD_ID", field_id)
        audit_count = count_audits(connection, menu_id)
        require(
            label_after_failure == original_label and group_count == 0 and field_count == 0 and audit_count == initial_audits,
            "Failed standalone package left configuration or audit changes behind.",
        )
        raise E2EFailure(
            f"standalone package execution failed ({oracle_error_code(error)}); offset="
            f"{getattr(error.args[0], 'offset', 'unknown') if error.args else 'unknown'}; rollback=clean"
        ) from None
    finally:
        cursor.close()

    health_check = getattr(connection, "is_healthy", None)
    connection_healthy = health_check() if callable(health_check) else None
    require(connection_healthy is True, "Oracle connection became unhealthy after standalone package execution.")
    after = import_monitoring_module().handle(connection, {"action": "load", "menuId": menu_id})
    assert_success(after, "Loaded", "package readback")
    menu = row_by_id(table_rows(after, "DSH_MENU"), "MENU_ID", menu_id)
    group = row_by_id(table_rows(after, "DSH_SUMMARY_GROUP"), "GROUP_ID", group_id)
    field = row_by_id(table_rows(after, "DSH_SUMMARY_FIELD"), "FIELD_ID", field_id)
    require(menu.get("MENU_LABEL") != original_label, "Standalone package did not update its existing menu row.")
    require(field.get("GROUP_ID") == group_id, "Standalone package field does not reference its inserted group.")
    verify_package_clob(connection, group_id, expected_chars, expected_sha256)

    history_summary = import_monitoring_module().handle(
        connection, {"action": "history", "menuId": menu_id, "offset": 0, "pageSize": 50}
    )
    assert_success(history_summary, "Loaded", "package history summary")
    matching = [
        entry for entry in history_summary.get("transactions", [])
        if entry.get("operationCount") == 3 and entry.get("insertCount") == 2 and entry.get("updateCount") == 1
    ]
    require(len(matching) == 1, "Standalone package did not write one grouped three-row audit transaction.")
    change_id = matching[0].get("changeId")
    require(isinstance(change_id, str) and change_id, "Standalone package history did not return its transaction change ID.")
    history_detail = import_monitoring_module().handle(
        connection, {"action": "history", "menuId": menu_id, "changeId": change_id, "pageSize": 50}
    )
    assert_success(history_detail, "Loaded", "package history detail")
    entries = history_detail.get("entries")
    require(isinstance(entries, list) and len(entries) == 3, "Standalone package audit detail omitted an operation.")
    require(
        all(isinstance(entry.get("auditId"), str) and entry["auditId"].isdecimal() for entry in entries),
        "Standalone package history did not return audit IDs as decimal strings.",
    )
    entry_by_table = {entry.get("table"): entry for entry in entries}
    require(
        set(entry_by_table) == {"DSH_MENU", "DSH_SUMMARY_GROUP", "DSH_SUMMARY_FIELD"},
        "Package audit rows do not match the operation set.",
    )
    group_after = entry_by_table["DSH_SUMMARY_GROUP"].get("newValue", {}).get("row", {})
    clob_value = group_after.get("SQL_TEXT")
    require(isinstance(clob_value, dict) and clob_value.get("type") == "clob", "Package audit envelope omitted its typed CLOB.")
    history_clob = clob_value.get("value", "")
    require(
        len(history_clob) == expected_chars and hashlib.sha256(history_clob.encode("utf-8")).hexdigest() == expected_sha256,
        "Standalone package audit envelope CLOB did not match the exact expected payload.",
    )
    audited_ops = []
    for table in ("DSH_MENU", "DSH_SUMMARY_GROUP", "DSH_SUMMARY_FIELD"):
        entry = entry_by_table[table]
        after_envelope = entry.get("newValue", {})
        old_envelope = entry.get("oldValue")
        audited_ops.append({
            "table": table,
            "action": entry.get("action"),
            "operationId": after_envelope.get("operationId"),
            "baseline": old_envelope.get("row") if isinstance(old_envelope, dict) else None,
            "desired": after_envelope.get("row"),
        })
    actor = manifest.get("declaredActor")
    require(isinstance(actor, dict), "Package manifest omitted its declared actor.")
    audit_verification = import_monitoring_module().handle(
        connection,
        {
            "action": "verify",
            "identity": copy.deepcopy(after["identity"]),
            "schemaFingerprint": after["schemaFingerprint"],
            "requestId": manifest.get("packageId"),
            "changeId": change_id,
            "actor": {
                "source": actor.get("source"),
                "name": actor.get("name"),
                "databaseUsername": actor.get("databaseUsername"),
            },
            "operations": audited_ops,
        },
    )
    assert_success(audit_verification, "Verified", "package audit-backed verification")
    require(audit_verification.get("auditVerified") is True, "Package verification did not validate its audit group.")
    public_audit_ids = audit_verification.get("auditIds", [])
    require(
        len(public_audit_ids) == 3 and all(isinstance(value, str) and value.isdecimal() for value in public_audit_ids),
        "Package audit verification did not return three audit IDs as decimal strings.",
    )
    require(
        all(
            isinstance(match.get("auditId"), str) and match["auditId"].isdecimal()
            for match in audit_verification.get("matches", [])
        ),
        "Package audit verification did not return match audit IDs as decimal strings.",
    )
    audit_ids = sorted(int(value) for value in public_audit_ids)

    # Replay must reject the stale full-row baseline before any writes.
    cursor = connection.cursor()
    try:
        cursor.execute(block)
        replay_rejected = False
        replay_code = "none"
    except Exception as error:
        connection.rollback()
        replay_rejected = True
        replay_code = oracle_error_code(error)
    finally:
        cursor.close()
    require(replay_rejected, "Standalone package replay unexpectedly passed its stale-baseline guard.")
    replay_load = import_monitoring_module().handle(connection, {"action": "load", "menuId": menu_id})
    assert_success(replay_load, "Loaded", "post-replay configuration readback")
    require(count_audits(connection, menu_id) == initial_audits + 3, "Rejected package replay created additional audit rows.")
    require(
        package_scalar_count(connection, "DSH_SUMMARY_GROUP", "GROUP_ID", group_id) == 1,
        "Rejected replay changed the group row count.",
    )
    require(
        package_scalar_count(connection, "DSH_SUMMARY_FIELD", "FIELD_ID", field_id) == 1,
        "Rejected replay changed the field row count.",
    )
    replay_menu = row_by_id(table_rows(replay_load, "DSH_MENU"), "MENU_ID", menu_id)
    require(replay_menu.get("MENU_LABEL") == menu.get("MENU_LABEL"), "Rejected replay modified the menu row.")
    verify_package_clob(connection, group_id, expected_chars, expected_sha256)
    return {
        "package": "Committed",
        "readback": "Loaded",
        "audit_verification": str(audit_verification.get("state")),
        "replay": f"Rejected ({replay_code})",
        "audit_ids": audit_ids,
        "package_id": str(manifest.get("packageId")),
        "script_sha256": str(manifest.get("scriptSha256")),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--env-file",
        type=Path,
        default=DEFAULT_ENV_FILE,
        help="Local env file containing the LOCAL Oracle credentials.",
    )
    parser.add_argument(
        "--prepare-only",
        action="store_true",
        help="Create the absent local schema user/tables and synthetic fixture, then exit.",
    )
    parser.add_argument(
        "--write-ui-fixture",
        type=Path,
        help="Write the selected synthetic menu load as a sanitized frontend fixture.",
    )
    parser.add_argument(
        "--fixture-only",
        action="store_true",
        help="Seed one new synthetic hierarchy, load it, and export a fixture without running apply checks.",
    )
    parser.add_argument(
        "--run-package",
        type=Path,
        help="Execute one hash-checked standalone package against its synthetic LOCAL fixture.",
    )
    parser.add_argument(
        "--package-manifest",
        type=Path,
        help="Manifest paired with --run-package.",
    )
    parser.add_argument(
        "--expected-clob-chars",
        type=int,
        help="Expected Unicode code-point count for the synthetic package CLOB.",
    )
    parser.add_argument(
        "--expected-clob-sha256",
        help="Expected UTF-8 SHA-256 for the synthetic package CLOB.",
    )
    parser.add_argument(
        "--expected-clob-fixture",
        type=Path,
        help="Sanitized UI fixture holding the package source SQL_TEXT for exact length/hash verification.",
    )
    args = parser.parse_args()
    if args.fixture_only and args.write_ui_fixture is None:
        parser.error("--fixture-only requires --write-ui-fixture PATH")
    if args.fixture_only and args.prepare_only:
        parser.error("--fixture-only and --prepare-only cannot be combined")

    if args.run_package is not None:
        has_expected_pair = args.expected_clob_chars is not None and args.expected_clob_sha256 is not None
        if args.package_manifest is None or (not has_expected_pair and args.expected_clob_fixture is None):
            parser.error("--run-package requires --package-manifest and either --expected-clob-fixture or both expected CLOB values")
        if args.prepare_only or args.fixture_only or args.write_ui_fixture is not None:
            parser.error("--run-package cannot be combined with schema preparation or fixture seeding options")
        test_password, env_source = read_local_test_password(args.env_file.expanduser())
        try:
            connection = oracledb.connect(user=SCHEMA_USER, password=test_password, dsn=LOCAL_DSN)
        except Exception as error:
            raise E2EFailure(f"Could not connect to the fixed LOCAL MONITORING account ({oracle_error_code(error)}).") from None
        try:
            assert_local_identity(connection)
            require(str(connection.username).upper() == SCHEMA_USER, "Connected package runner user is not MONITORING.")
            print("target=LOCAL FREEPDB1 (127.0.0.1:1521)")
            print(f"credential_source={env_source} (values withheld)")
            print("package_execution=anonymous PL/SQL block only; SQL*Plus directives and slash terminator stripped")
            expected_chars = args.expected_clob_chars
            expected_sha256 = args.expected_clob_sha256
            if args.expected_clob_fixture is not None:
                parsed_manifest, _ = package_sql_block(args.run_package.expanduser(), args.package_manifest.expanduser())
                expected_menu_id, _, _ = package_operation_keys(parsed_manifest)
                expected_chars, expected_sha256 = expected_clob_from_fixture(
                    args.expected_clob_fixture.expanduser(), expected_menu_id
                )
            outcomes = run_standalone_package(
                connection,
                args.run_package.expanduser(),
                args.package_manifest.expanduser(),
                int(expected_chars),
                str(expected_sha256),
            )
            print("package_states=" + json.dumps(outcomes, sort_keys=True))
            print("result=PACKAGE_PASS")
            return 0
        except Exception as error:
            if isinstance(error, E2EFailure):
                print(f"result=FAIL reason={error}", file=sys.stderr)
            else:
                print(f"result=FAIL error_type={type(error).__name__}; package data withheld", file=sys.stderr)
            return 1
        finally:
            connection.close()

    admin_password, test_password, env_source = read_local_credentials(args.env_file.expanduser())
    try:
        admin = oracledb.connect(user=ADMIN_USER, password=admin_password, dsn=LOCAL_DSN)
    except Exception as error:
        raise E2EFailure(f"Could not connect to the fixed LOCAL Oracle target ({oracle_error_code(error)}).") from None
    try:
        assert_local_identity(admin)
        user_created = ensure_schema_user(admin, test_password)
    finally:
        admin.close()

    try:
        connection = oracledb.connect(user=SCHEMA_USER, password=test_password, dsn=LOCAL_DSN)
    except Exception as error:
        raise E2EFailure(
            "Could not connect as MONITORING. If this existing account uses another password, set "
            f"ORACLE_MONITORING_TEST_PASSWORD explicitly ({oracle_error_code(error)})."
        ) from None

    try:
        assert_local_identity(connection)
        require(str(connection.username).upper() == SCHEMA_USER, "Connected schema user is not MONITORING.")
        created_tables = ensure_discovery_tables(connection)
        ids = make_run_ids()
        long_sql = synthetic_sql()
        seed_synthetic_hierarchy(connection, ids, long_sql)
        print("target=LOCAL FREEPDB1 (127.0.0.1:1521)")
        print(f"credential_source={env_source} (values withheld)")
        print(f"monitoring_user={'created' if user_created else 'already existed'}")
        print(f"discovery_tables_created={len(created_tables)}")
        if created_tables:
            print("created_table_names=" + ",".join(created_tables))
        print("synthetic_hierarchy=seeded (menu, datasource, summary group/field, detail table/column)")
        print(f"synthetic_sql_chars={len(long_sql)} synthetic_sql_utf8_bytes={len(long_sql.encode('utf-8'))}")
        if args.prepare_only:
            print("result=PREPARED; no backend integration actions were run")
            return 0

        fixture_path = args.write_ui_fixture
        if fixture_path is not None and not fixture_path.is_absolute():
            fixture_path = REPO_ROOT / fixture_path
        if args.fixture_only:
            assert fixture_path is not None
            export_ui_fixture(connection, long_sql, ids, fixture_path)
            print("result=FIXTURE_PASS; only read-only handler load ran after seeding")
            return 0

        outcomes = run_integration(connection, long_sql, ids, fixture_path)
        outcomes["multimenu_history"] = run_multimenu_history(connection, ids)
        print("integration_states=" + json.dumps(outcomes, sort_keys=True))
        print("result=PASS")
        print("note=synthetic fixture rows and successful audit history are retained for repeatable local inspection")
        return 0
    except Exception as error:
        if isinstance(error, E2EFailure):
            print(f"result=FAIL reason={error}", file=sys.stderr)
        elif isinstance(error, InjectedAuditFailure):
            print("result=FAIL unexpected injected audit failure escaped the backend handler", file=sys.stderr)
        else:
            print(f"result=FAIL error_type={type(error).__name__}; database and fixture values withheld", file=sys.stderr)
        return 1
    finally:
        connection.close()


if __name__ == "__main__":
    raise SystemExit(main())
