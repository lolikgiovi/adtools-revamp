#!/usr/bin/env python3
"""Read-only Jira Data Center create-field discovery.

Loads connection details from .env, fetches Jira create metadata and selected
sample issues, then writes a sanitized JSON report. The PAT is never included
in the report or error messages.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import ssl
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlparse
from urllib.request import Request, urlopen


DEFAULT_SAMPLE_ISSUES = [
    "EVDEV-350443",
    "EVDEV-344706",
    "EVDEV-355352",
    "EVDEV-350979",
    "EVDEV-350851",
]
DEFAULT_ISSUE_TYPES = ["BE-Sub-Task", "FE-Sub-Task"]
EXCLUDED_FIELDS = {"description", "comment", "attachment", "worklog"}
MAX_STRING_LENGTH = 240
MAX_ARRAY_ITEMS = 8
MAX_ALLOWED_VALUES = 50


def load_dotenv(path: Path) -> None:
    """Load a small, predictable subset of dotenv syntax without dependencies."""
    if not path.exists():
        return
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            raise ValueError(f"{path}:{line_number}: expected KEY=VALUE")
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            raise ValueError(f"{path}:{line_number}: invalid variable name")
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        os.environ.setdefault(key, value)


def csv_values(value: str | None, defaults: list[str]) -> list[str]:
    if value is None:
        return list(defaults)
    values = [item.strip() for item in value.split(",") if item.strip()]
    return values or list(defaults)


def env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    normalized = raw.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{name} must be true or false")


def validate_base_url(value: str) -> str:
    base_url = value.strip().rstrip("/")
    parsed = urlparse(base_url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("JIRA_BASE_URL must be an HTTPS URL")
    if parsed.query or parsed.fragment:
        raise ValueError("JIRA_BASE_URL cannot contain a query string or fragment")
    return base_url


def validate_project_key(value: str) -> str:
    key = value.strip().upper()
    if not re.fullmatch(r"[A-Z][A-Z0-9_-]*", key):
        raise ValueError("JIRA_PROJECT_KEY is invalid")
    return key


def validate_issue_key(value: str) -> str:
    key = value.strip().upper()
    if not re.fullmatch(r"[A-Z][A-Z0-9_]*-\d+", key):
        raise ValueError(f"Invalid Jira issue key: {value}")
    return key


def ssl_context(verify_tls: bool, ca_bundle: str | None) -> ssl.SSLContext:
    if not verify_tls:
        return ssl._create_unverified_context()  # noqa: SLF001 - explicit CLI fallback
    if ca_bundle:
        ca_path = Path(ca_bundle).expanduser().resolve()
        if not ca_path.is_file():
            raise ValueError(f"JIRA_CA_BUNDLE does not exist: {ca_path}")
        return ssl.create_default_context(cafile=str(ca_path))
    return ssl.create_default_context()


class JiraClient:
    def __init__(self, base_url: str, pat: str, context: ssl.SSLContext) -> None:
        self.base_url = base_url
        self.pat = pat
        self.context = context

    def get(self, path: str, query: dict[str, Any] | None = None) -> Any:
        suffix = f"?{urlencode(query, doseq=True)}" if query else ""
        request = Request(
            f"{self.base_url}{path}{suffix}",
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {self.pat}",
                "User-Agent": "ad-tools-jira-explorer/1.0",
            },
            method="GET",
        )
        try:
            with urlopen(request, timeout=30, context=self.context) as response:
                return json.load(response)
        except HTTPError as error:
            if error.code == 401:
                raise RuntimeError("Jira authentication failed (401). Check JIRA_PAT.") from error
            if error.code == 403:
                raise RuntimeError(f"Jira denied access (403) to {path}.") from error
            if error.code == 404:
                raise RuntimeError(f"Jira resource was not found (404) for {path}.") from error
            raise RuntimeError(f"Jira returned HTTP {error.code} for {path}.") from error
        except URLError as error:
            reason = str(error.reason).lower()
            if "certificate" in reason or "self signed" in reason or "unknown ca" in reason:
                raise RuntimeError(
                    "Jira certificate is not trusted. Set JIRA_CA_BUNDLE to the corporate CA, "
                    "or temporarily set JIRA_VERIFY_TLS=false."
                ) from error
            raise RuntimeError(f"Unable to connect to Jira at {self.base_url}.") from error

    def paged_values(self, path: str) -> list[dict[str, Any]]:
        values: list[dict[str, Any]] = []
        start_at = 0
        for _ in range(20):
            page = self.get(path, {"startAt": start_at, "maxResults": 50})
            page_values = page.get("values", [])
            if not isinstance(page_values, list):
                raise RuntimeError(f"Jira returned an unexpected pagination shape for {path}.")
            values.extend(item for item in page_values if isinstance(item, dict))
            if page.get("last") is True or not page_values or len(page_values) < 50:
                return values
            start_at += int(page.get("size") or len(page_values))
        raise RuntimeError(f"Jira returned more than 20 pages for {path}.")


def compact_value(value: Any, depth: int = 0) -> Any:
    if depth >= 4:
        return "[nested value]"
    if isinstance(value, str):
        return value if len(value) <= MAX_STRING_LENGTH else f"{value[:MAX_STRING_LENGTH]}…"
    if isinstance(value, list):
        compacted = [compact_value(item, depth + 1) for item in value[:MAX_ARRAY_ITEMS]]
        if len(value) > MAX_ARRAY_ITEMS:
            compacted.append(f"[{len(value) - MAX_ARRAY_ITEMS} more items]")
        return compacted
    if isinstance(value, dict):
        return {
            key: compact_value(item, depth + 1)
            for key, item in value.items()
            if key not in {"avatarUrls", "emailAddress"}
        }
    return value


def field_metadata(field: dict[str, Any]) -> dict[str, Any]:
    schema = field.get("schema") if isinstance(field.get("schema"), dict) else {}
    allowed = field.get("allowedValues") if isinstance(field.get("allowedValues"), list) else []
    return {
        "id": str(field.get("fieldId") or field.get("key") or ""),
        "name": str(field.get("name") or ""),
        "required": bool(field.get("required")),
        "schema_type": str(schema.get("type") or "unknown"),
        "schema_items": schema.get("items"),
        "custom_type": schema.get("custom"),
        "operations": field.get("operations") if isinstance(field.get("operations"), list) else [],
        "has_default_value": bool(field.get("hasDefaultValue")),
        "default_value": compact_value(field.get("defaultValue")),
        "allowed_values": [compact_value(item) for item in allowed[:MAX_ALLOWED_VALUES]],
        "allowed_values_truncated": len(allowed) > MAX_ALLOWED_VALUES,
    }


def sample_issue(issue: dict[str, Any]) -> dict[str, Any]:
    fields = issue.get("fields") if isinstance(issue.get("fields"), dict) else {}
    names = issue.get("names") if isinstance(issue.get("names"), dict) else {}
    issue_type = fields.get("issuetype") if isinstance(fields.get("issuetype"), dict) else {}
    parent = fields.get("parent") if isinstance(fields.get("parent"), dict) else {}
    populated = []
    for field_id, value in fields.items():
        if field_id in EXCLUDED_FIELDS or value in (None, "", [], {}):
            continue
        populated.append(
            {
                "id": field_id,
                "name": str(names.get(field_id) or field_id),
                "value": compact_value(value),
            }
        )
    populated.sort(key=lambda item: (item["name"].lower(), item["id"]))
    return {
        "key": str(issue.get("key") or ""),
        "summary": str(fields.get("summary") or ""),
        "issue_type": str(issue_type.get("name") or ""),
        "parent_key": parent.get("key"),
        "populated_fields": populated,
    }


def discover(
    client: JiraClient,
    project_key: str,
    issue_type_names: list[str],
    sample_keys: list[str],
) -> dict[str, Any]:
    server = client.get("/rest/api/2/serverInfo")
    user = client.get("/rest/api/2/myself")
    type_path = f"/rest/api/2/issue/createmeta/{quote(project_key, safe='')}/issuetypes"
    issue_types = []
    wanted = {name.lower() for name in issue_type_names}
    for issue_type in client.paged_values(type_path):
        name = str(issue_type.get("name") or "")
        if wanted and name.lower() not in wanted:
            continue
        issue_type_id = str(issue_type.get("id") or "")
        fields_path = f"{type_path}/{quote(issue_type_id, safe='')}"
        fields = [field_metadata(field) for field in client.paged_values(fields_path)]
        fields.sort(key=lambda field: (not field["required"], field["name"].lower()))
        issue_types.append(
            {
                "id": issue_type_id,
                "name": name,
                "subtask": bool(issue_type.get("subtask")),
                "fields": fields,
            }
        )

    samples = []
    for key in sample_keys:
        issue = client.get(
            f"/rest/api/2/issue/{quote(key, safe='')}",
            {"expand": "names,schema", "fields": "*all"},
        )
        samples.append(sample_issue(issue))

    return {
        "server": {
            "base_url": server.get("baseUrl"),
            "version": server.get("version"),
            "deployment_type": server.get("deploymentType"),
            "server_title": server.get("serverTitle"),
        },
        "user": {
            "username": user.get("name"),
            "display_name": user.get("displayName"),
            "active": user.get("active"),
        },
        "project_key": project_key,
        "issue_types": sorted(issue_types, key=lambda item: item["name"].lower()),
        "samples": samples,
    }


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--env-file", default=".env", help="dotenv file to load (default: .env)")
    result.add_argument("--output", default="jira-discovery.json", help="sanitized JSON output path")
    result.add_argument("--insecure", action="store_true", help="disable TLS certificate verification for this run")
    return result


def main() -> int:
    args = parser().parse_args()
    try:
        load_dotenv(Path(args.env_file))
        base_url = validate_base_url(os.getenv("JIRA_BASE_URL", ""))
        project_key = validate_project_key(os.getenv("JIRA_PROJECT_KEY", "EVDEV"))
        pat = os.getenv("JIRA_PAT", "").strip()
        if not pat or pat == "replace-with-your-personal-access-token":
            raise ValueError("Set JIRA_PAT in the local .env file")
        verify_tls = False if args.insecure else env_bool("JIRA_VERIFY_TLS", True)
        ca_bundle = os.getenv("JIRA_CA_BUNDLE") or None
        issue_types = csv_values(os.getenv("JIRA_ISSUE_TYPES"), DEFAULT_ISSUE_TYPES)
        sample_keys = [
            validate_issue_key(key)
            for key in csv_values(os.getenv("JIRA_SAMPLE_ISSUES"), DEFAULT_SAMPLE_ISSUES)
        ]

        if not verify_tls:
            print("WARNING: TLS certificate verification is disabled for Jira.", file=sys.stderr)
        client = JiraClient(base_url, pat, ssl_context(verify_tls, ca_bundle))
        report = discover(client, project_key, issue_types, sample_keys)
        output_path = Path(args.output).expanduser().resolve()
        output_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"Wrote sanitized Jira discovery to {output_path}")
        print(f"Found {len(report['issue_types'])} target issue types and {len(report['samples'])} samples.")
        return 0
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
