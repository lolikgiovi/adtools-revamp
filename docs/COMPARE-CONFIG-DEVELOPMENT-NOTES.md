# Database Configuration Comparison – Development Notes

Date: 2025-11-06
Scope: Backend foundations for Oracle-based Compare Config feature (Tauri v2, macOS)

## Overview

This document captures what’s implemented so far for the Compare Config feature, where the code lives, and how to test the backend without using the browser UI. The feature is optional and gated behind Oracle Instant Client availability.

## Backend Phases Completed

- Phase 0 — Scaffolding & Guardrails
  - Oracle module skeleton with Tauri commands wired and graceful gating when client is missing.
  - Files: `src-tauri/src/oracle/{mod.rs, types.rs, client.rs, credentials.rs, commands.rs}`.
  - Commands: `check_oracle_client_ready`, `prime_oracle_client`, credential commands, plus stubbed comparison/export.

- Phase 1 — Client Detection & Priming
  - Detects Oracle Instant Client at `~/Documents/adtools_library/instantclient/` by checking for `libclntsh.dylib`.
  - `prime_oracle_client` sets `DYLD_LIBRARY_PATH` and attempts explicit load with `libloading`.
  - File: `src-tauri/src/oracle/client.rs`.

- Phase 2 — Credentials & Connection Management
  - Stores credentials per connection ID in macOS Keychain (`keyring` crate).
  - Implements `test_oracle_connection` using the `oracle` crate to validate EZCONNECT connections.
  - Files: `src-tauri/src/oracle/credentials.rs`, `src-tauri/src/oracle/commands.rs`.

- Phase 3 — Metadata & Sanitization
  - Adds metadata types and helpers to fetch table columns and primary keys via dictionary views.
  - Sanitizes identifiers and flags suspicious WHERE clauses (for later query helpers).
  - Files: `src-tauri/src/oracle/{types.rs, sanitize.rs, query.rs}`, command in `commands.rs`.

## Implemented Tauri Commands (v2)

These are exposed via the Tauri command handler in `src-tauri/src/lib.rs`:

- `check_oracle_client_ready() -> { installed, version, lib_paths, message }`
- `prime_oracle_client() -> ()`
- `set_oracle_credentials(connection_id, username, password) -> ()`
- `get_oracle_credentials(connection_id) -> { connection_id, username?, has_password }`
- `test_oracle_connection(config: { id, host, port, service_name, schema? }) -> bool`
- `fetch_table_metadata(config, schema?, table) -> { schema?, table, columns: [...] }`
- `compare_configurations(...) -> JSON` (stub; Phase 4)
- `export_comparison_result(format, payload) -> String` (stub; Phase 4)

Notes:
- Commands are guarded — if client is not detected, they return readable errors.
- `test_oracle_connection` and metadata commands prime the client and connect via stored keychain credentials.

## Backend Code Map

- `src-tauri/src/oracle/mod.rs` — module exports.
- `src-tauri/src/oracle/types.rs` — `OracleClientStatus`, `OracleConnectionConfig`, `OracleColumnMeta`, `OracleTableMeta`.
- `src-tauri/src/oracle/client.rs` — detection and priming (`DYLD_LIBRARY_PATH` + `libloading`).
- `src-tauri/src/oracle/credentials.rs` — `CredentialManager` using macOS Keychain.
- `src-tauri/src/oracle/commands.rs` — Tauri v2 commands.
- `src-tauri/src/oracle/sanitize.rs` — identifier checks and WHERE clause gate.
- `src-tauri/src/oracle/query.rs` — `fetch_table_metadata` and PK resolution via data dictionary views.
- `src-tauri/src/bin/oracle_smoke.rs` — CLI smoke tester (no WebView needed).

## Dependencies

- `oracle = "0.5"` — Oracle DB access (EZCONNECT).
- `keyring = "2"` — macOS Keychain for credentials.
- `libloading = "0.8"` — Explicit `libclntsh.dylib` load validation during priming.
- `tauri = "2.x"` and plugins (log, updater, process).

## Installing the Oracle Instant Client

- Script: `scripts/install-oracle-instant-client.sh`
- Expected install path: `~/Documents/adtools_library/instantclient/`
- Detection checks for `libclntsh.dylib` inside the above directory.

## CLI Smoke Testing (Backend Only)

All commands below run from `src-tauri`:

1) Detection

```bash
cargo run --bin oracle_smoke -- ready
```

Expected JSON if not installed:

```json
{
  "installed": false,
  "version": null,
  "lib_paths": ["/Users/<you>/Documents/adtools_library/instantclient"],
  "message": "Oracle Instant Client not detected. Install via the provided script and restart AD Tools."
}
```

2) Priming

```bash
cargo run --bin oracle_smoke -- prime
```

Success: prints a confirmation; failure: prints a readable error.

3) Credentials

```bash
cargo run --bin oracle_smoke -- set-creds UAT1 scott tiger
cargo run --bin oracle_smoke -- get-creds UAT1
```

Expected JSON:

```json
{ "connection_id": "UAT1", "username": "scott", "has_password": true }
```

4) Connection Test

```bash
cargo run --bin oracle_smoke -- test-conn --id UAT1 --host db-uat1.company.com --port 1521 --service ORCLPDB1
```

Success: prints a success line; failure: prints Oracle driver error message.

5) Metadata Fetch

```bash
cargo run --bin oracle_smoke -- meta --id UAT1 --host db-uat1.company.com --port 1521 --service ORCLPDB1 --schema APP_SCHEMA --table CONFIGS
```

Success: prints JSON with columns and PK flags.

## Frontend Invocation (Tauri v2)

Use ESM import (no `window.__TAURI__.invoke` in v2):

```js
import { invoke } from '@tauri-apps/api/core';

const ready = await invoke('check_oracle_client_ready');
await invoke('prime_oracle_client');
await invoke('set_oracle_credentials', { connection_id: 'UAT1', username: 'scott', password: 'tiger' });
const ok = await invoke('test_oracle_connection', {
  id: 'UAT1', host: 'db-uat1.company.com', port: 1521, service_name: 'ORCLPDB1', schema: 'APP_SCHEMA'
});
const meta = await invoke('fetch_table_metadata', {
  config: { id: 'UAT1', host: 'db-uat1.company.com', port: 1521, service_name: 'ORCLPDB1', schema: 'APP_SCHEMA' },
  schema: 'APP_SCHEMA',
  table: 'CONFIGS'
});
```

## Error Messages & Troubleshooting

- "Oracle Instant Client not detected" → Run the install script and verify `libclntsh.dylib` exists.
- "Oracle client not ready; cannot prime environment" → Library path missing; confirm location and rerun prime.
- Connection failed → Check host/port/service and credentials; try connecting with `sqlplus` to validate network.
- Metadata fetch failed → Table/schema name must be valid identifiers; ensure read access to dictionary views.

## Security Notes

- Credentials stored securely via macOS Keychain; scoped per `connection_id`.
- No credentials written to disk or logs; only in-memory access during connection.
- Feature is optional; app remains functional without Oracle client.

## Next Steps (Phase 4)

- Implement `compare_configurations`:
  - Fetch rows from Env1/Env2 with sanitized field set and optional WHERE.
  - Align by primary key and produce per-field differences and summary.
  - Return display-ready JSON with diff markers per spec.
- Implement `export_comparison_result` to write JSON/CSV to `~/Documents/adtools_library/comparisons/`.

## Commands Registry

Registered in `src-tauri/src/lib.rs`:

- `check_oracle_client_ready`, `prime_oracle_client`
- `set_oracle_credentials`, `get_oracle_credentials`
- `test_oracle_connection`, `fetch_table_metadata`
- `compare_configurations`, `export_comparison_result` (stubbed for Phase 4)