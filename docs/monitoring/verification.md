# Monitoring Oracle E2E verification

`e2e.py` exercises the local `tauri/sidecar/monitoring.py` handler against the
LOCAL Oracle Free database. It discovers Oracle using the fixed
`127.0.0.1:1521/FREEPDB1` DSN, then confirms the database, service, container,
and connected user before provisioning or writing. It does not accept a remote
DSN.

The runner imports the discovery DDL in `schema-ddl-2026-10-12.json`, removes
tablespace and physical storage placement clauses, and creates only missing
objects in MONITORING. It creates MONITORING only when absent. The test
hierarchy uses generated `E2E_` identifiers and synthetic datasource/configuration
values; it never imports UAT snapshots or production content. Every run uses
new identifiers and leaves successful fixture rows and audit history in place
for inspection. The injected rollback change and its audit rows must be absent
after rollback.

## Run locally

Use the existing sidecar virtual environment; this repository task does not install dependencies.

```sh
tauri/sidecar/venv/bin/python docs/monitoring/e2e.py --prepare-only
tauri/sidecar/venv/bin/python docs/monitoring/e2e.py
```

Export a one-menu synthetic frontend fixture and use it to generate and execute a guarded package:

```sh
tauri/sidecar/venv/bin/python docs/monitoring/e2e.py --fixture-only --write-ui-fixture frontend/tools/monitoring-query/tests/fixture.json
node docs/monitoring/package-smoke.mjs /tmp/ad-tools-monitoring-package
tauri/sidecar/venv/bin/python docs/monitoring/e2e.py --run-package /tmp/ad-tools-monitoring-package/apply.sql --package-manifest /tmp/ad-tools-monitoring-package/manifest.json --expected-clob-fixture frontend/tools/monitoring-query/tests/fixture.json
```

Generate the package immediately after exporting the fixture, before another action changes that fixture menu. The package runner
checks the manifest hash and LOCAL identity, strips SQL*Plus commands and the slash terminator, and executes only the anonymous PL/SQL
block through the existing Python Oracle driver. It checks exact CLOB contents against the sanitized fixture, loads the written rows,
verifies all audit envelopes, then replays the same script to confirm stale-baseline rejection leaves configuration and audit history
unchanged. It reads only the MONITORING test user's existing local credential for this mode.

The default credential source is the existing Content Bridge local Oracle env
file at `../content-bridge-nextjs/content-bridge/database/local/.env.oracle-poc`.
The script reads only `ORACLE_POC_ADMIN_PASSWORD` and the test password
variables it needs, and never prints their values. To override credentials, set
`ORACLE_POC_ADMIN_PASSWORD` and `ORACLE_MONITORING_TEST_PASSWORD` in the process
environment. When MONITORING is absent, `ORACLE_POC_APP_PASSWORD` is used as the
local test user's password fallback. An existing MONITORING account is never
reset; set `ORACLE_MONITORING_TEST_PASSWORD` if its password differs.
`--env-file PATH` selects another local env file.

The local MONITORING user receives only `CREATE SESSION`, `CREATE TABLE`, and
`CREATE SEQUENCE` plus quota on USERS. The sequence privilege is needed for the
discovery audit table's identity key. If the account already exists, the runner
adds only the missing `CREATE SEQUENCE` privilege needed by that identity DDL.
No Oracle container restart, recreation, volume change, or schema drop is part
of this setup.

`--prepare-only` creates missing discovery tables and adds a fresh synthetic
hierarchy, then exits before invoking the handler. Running without that flag
repeats preparation idempotently for DDL while adding a new uniquely named
fixture, then runs the integration checks.

## Coverage

The integration checks a complete typed load for the selected synthetic menu,
including a >4,000-character Unicode CLOB with bind placeholders; safe
datasource projection; a mixed two-INSERT/one-UPDATE apply; Oracle readback and
explicit verify; summary and detail audit history; stale-baseline conflict
behavior; multi-menu transaction history scope and complete detail; and
rollback after the configuration DML and audit writes have started. It reports
only state names and sanitized error codes, never
credentials, JDBC configuration, full rows, or SQL payloads.

## Recorded evidence

LOCAL target identity was `FREEPDB1` / service `freepdb1` / container `FREEPDB1`, connected as `MONITORING`. Docker inspection was
read-only. The existing Oracle container and data volume were not restarted, recreated or changed; no schema was dropped. The existing
MONITORING user was retained. The repeatable runner found the required tables already present on its last setup run
(`discovery_tables_created=0`). Credentials, connection URL, stored SQL and configuration row values were withheld from command output.

`tauri/sidecar/venv/bin/python docs/monitoring/e2e.py` completed with exit code 0:

```text
target=LOCAL FREEPDB1 (127.0.0.1:1521)
credential_source=/Users/ddl/projects/content-bridge-nextjs/content-bridge/database/local/.env.oracle-poc (values withheld)
monitoring_user=already existed
discovery_tables_created=0
synthetic_hierarchy=seeded (menu, datasource, summary group/field, detail table/column)
synthetic_sql_chars=9543 synthetic_sql_utf8_bytes=15134
connection_healthy_after_apply=True
integration_states={"audit_id_contract": "decimal strings", "audit_verification": "Verified", "history": "Loaded", "history_group": "complete/3", "history_summary": "Loaded", "load": "Loaded", "mixed_apply": "Committed", "multimenu_history": "scoped 1/2; detail complete/2 from either menu", "outcome_unknown_reconciliation": "Reconciliation Required", "rollback": "Failed", "stale_conflict": "Conflict", "verification": "Verified"}
result=PASS
note=synthetic fixture rows and successful audit history are retained for repeatable local inspection
```

The rollback result is the expected injected precommit failure; the runner confirmed the menu update, inserted child and associated audit
rows were all absent after rollback. Audit-backed verification passed for the mixed apply, and an uncertain outcome without its change ID
returned `Reconciliation Required`. Public audit IDs from apply, verify and history were checked as decimal strings; the complete audit
group reported the expected three operations.

The same direct run also updated two separate synthetic menus in one transaction. Each menu's summary marked the group as partially
scoped (`operationCount=1`, `expectedOperationCount=2`, `groupComplete=false`); requesting change detail from either menu returned both
audit rows with `groupComplete=true` and both owning menu IDs. The package/UI fixture path still exports only one complete hierarchy.

The latest sanitized fixture export used:

```text
tauri/sidecar/venv/bin/python docs/monitoring/e2e.py --fixture-only --write-ui-fixture frontend/tools/monitoring-query/tests/fixture.json
result=FIXTURE_PASS; only read-only handler load ran after seeding
```

It contained one generated synthetic menu hierarchy and recorded its UTC `readAt`. The datasource projection omitted JDBC_URL and
CREDENTIAL_REF. The fixture included a 9,543-code-point CLOB with Unicode, CRLF, apostrophes and bind-like text.

The standalone package was generated with
`node docs/monitoring/package-smoke.mjs /tmp/ad-tools-monitoring-package`. The final command returned package ID
`6a48eec9-f8f5-41ed-a4c0-45027f447a67`, SQL SHA-256
`ee99966ae97301a1b6f6c27a42c640f11b88eb4a194622fda8459d4ae38ed698`, and 69,097 SQL bytes. The Oracle runner completed with exit
code 0 using the command above:

```text
package_clob_codepoints=9543 package_clob_utf8_bytes=15134 package_clob_sha256=321b6adf5b6cd62f58b624d154a7ced385442f6cdb6255dc6f0003befa45514f
package_states={"audit_ids": [54, 55, 56], "audit_verification": "Verified", "package": "Committed", "package_id": "6a48eec9-f8f5-41ed-a4c0-45027f447a67", "readback": "Loaded", "replay": "Rejected (ORA-20011)", "script_sha256": "ee99966ae97301a1b6f6c27a42c640f11b88eb4a194622fda8459d4ae38ed698"}
result=PACKAGE_PASS
```

The second identical CLOB line is from the post-replay readback. Audit IDs 54, 55 and 56 cover the UPDATE and both INSERTs; the public
handler surface represents them as decimal strings. The replay
was rejected by the stale baseline guard and left the committed configuration and audit row counts unchanged. The Run Query/Jenkins
handoff was not available in this environment; the generated manifest still reports `runnerCompatibility.verified=false` and
`handoffReady=false`, so managed handoff remains disabled.
