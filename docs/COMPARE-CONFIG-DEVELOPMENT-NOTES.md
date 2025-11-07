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

## Phase 5 — Frontend UI (Compare Config Tool)

- Implemented a new tool at `app/tools/compare-config/` with `main.js`, `template.js`, and `styles.css`.
- Registers in the app via `app/App.js` and `app/config/tools.json` (category `config`, icon `database`).
- UI capabilities:
  - Oracle client readiness check and priming.
  - Env1/Env2 credential management (Keychain) and connectivity tests.
  - Compare form (table, fields, optional WHERE) with results summary and detailed per-key rows.
  - Export buttons wired to `export_comparison_result` (JSON and CSV) with clipboard path copy.

Notes:
- The tool is gated by runtime detection (`isTauri()`); desktop-only actions are disabled on pure web.
- Parameter names in `invoke` match Rust commands (snake_case where required).

## Phase 6 — UI Enhancements

- Filters: Toggle visibility for `Match`, `Differ`, `OnlyInEnv1`, and `OnlyInEnv2` to focus on relevant results.
- Presets: Save/apply/delete compare presets (Env configs, table, fields, WHERE) to `localStorage`.
- CSV Preview: Client-side CSV generation mirroring backend format for quick inspection and browser download.

Usage (Frontend):

```js
// Filters: check/uncheck the four toggles and results list updates immediately
// Presets: enter a name, click Save; select from dropdown and Apply/Delete
// CSV Preview: click Generate CSV Preview to fill the textarea; Download CSV saves via browser
```

Implementation files:
- `app/tools/compare-config/main.js` — filters, presets, CSV preview/download; invokes Tauri commands.
- `app/tools/compare-config/template.js` — updated template with filters, presets, preview area.
- `app/tools/compare-config/styles.css` — styles for clean layout.

## Implemented Tauri Commands (v2)

These are exposed via the Tauri command handler in `src-tauri/src/lib.rs`:

- `check_oracle_client_ready() -> { installed, version, lib_paths, message }`
- `prime_oracle_client() -> ()`
- `set_oracle_credentials(connection_id, username, password) -> ()`
- `get_oracle_credentials(connection_id) -> { connection_id, username?, has_password }`
- `test_oracle_connection(config: { id, host, port, service_name, schema? }) -> bool`
- `fetch_table_metadata(config, schema?, table) -> { schema?, table, columns: [...] }`
- `compare_configurations(env1, env2, table, where_clause?, fields?) -> JSON`
- `export_comparison_result(format, payload) -> String`

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

- One-command install: `curl -fsSL https://adtools.lolik.workers.dev/install-oracle-instant-client.sh | bash`
- Expected install path: `~/Documents/adtools_library/instantclient/`
- Detection checks for `libclntsh.dylib` inside the above directory.
- Alternative (manual): local script is available at `scripts/install-oracle-instant-client.sh` for reference or offline use.

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

## Phase 4 — Comparison & Export

Implemented a comparison engine and exporter focusing on safe, display-ready outputs:

- Row fetching: builds a `SELECT` with type-aware expressions (e.g., `TO_CHAR` for numbers/dates, `DBMS_LOB.SUBSTR` for CLOB, `RAWTOHEX` for RAW) and aliases back to the original column names. Identifiers are sanitized; suspicious `WHERE` clauses are rejected.
- Primary key alignment: uses dictionary views to detect PK columns; falls back to the first selected field if none found.
- JSON result shape:

```jsonc
{
  "env1": "UAT1",
  "env2": "PROD1",
  "table": "CONFIGS",
  "timestamp": "2025-11-06T12:34:56Z",
  "summary": { "total": 10, "matches": 7, "differences": 2, "only_env1": 1, "only_env2": 0 },
  "fields": ["ID", "KEY", "VALUE"],
  "primary_key": ["ID"],
  "comparisons": [
    { "primary_key": { "ID": "42" }, "status": "Match", "env1_data": { "ID": "42", "KEY": "X", "VALUE": "A" }, "env2_data": { "ID": "42", "KEY": "X", "VALUE": "A" } },
    { "primary_key": { "ID": "43" }, "status": "Differ", "differences": [ { "field": "VALUE", "env1": "B", "env2": "C" } ], "env1_data": { "ID": "43", "KEY": "Y", "VALUE": "B" }, "env2_data": { "ID": "43", "KEY": "Y", "VALUE": "C" } },
    { "primary_key": { "ID": "99" }, "status": "OnlyInEnv1", "env1_data": { "ID": "99", "KEY": "Z", "VALUE": "K" }, "env2_data": null }
  ]
}
```

- CSV export: generates a differences-focused CSV with columns `primary_key,status,field,env1,env2`. Files are saved to `~/Documents/adtools_library/comparisons/comparison-YYYYMMDD-HHMMSS.csv`.

### Backend Testing (Phase 4)

```js
import { invoke } from '@tauri-apps/api/core';

// Ensure client is ready
const ready = await invoke('check_oracle_client_ready');
if (!ready.installed) throw new Error('Oracle client not installed');
await invoke('prime_oracle_client');

// Compare two environments
const result = await invoke('compare_configurations', {
  env1: { id: 'UAT1', host: 'db-uat1.company.com', port: 1521, service_name: 'ORCLPDB1', schema: 'APP_SCHEMA' },
  env2: { id: 'PROD1', host: 'db-prod1.company.com', port: 1521, service_name: 'ORCLPDB1', schema: 'APP_SCHEMA' },
  table: 'CONFIGS',
  where_clause: "KEY IN ('X','Y','Z')", // optional; rejected if suspicious
  fields: ['ID', 'KEY', 'VALUE']        // optional; defaults to all columns
});

// Export JSON
const jsonPath = await invoke('export_comparison_result', {
  format: 'json',
  payload: JSON.stringify(result)
});

// Export CSV (differences only)
const csvPath = await invoke('export_comparison_result', {
  format: 'csv',
  payload: JSON.stringify(result)
});
```

Notes:
- `fields` allow narrowing the diff to relevant columns, improving performance.
- `where_clause` is passed through after a safety check; advanced parameterized filters are future work.
- For tables without PKs, the first selected field is used as an alignment key.

### Frontend Testing (Phase 5/6)

- Start the dev server (`npm run dev`) or ensure it’s already running on port `5173`.
- Open `http://localhost:5173/`, navigate to `Compare Config`.
- Use `Check & Prime Client`, set/get credentials for Env1/Env2, and test connections.
- Fill `Table`, `Fields`, optional `WHERE`; click `Compare`.
- Use Filters and Presets as needed; preview/download CSV; export via Tauri for desktop file writes.

## Commands Registry

Registered in `src-tauri/src/lib.rs`:

- `check_oracle_client_ready`, `prime_oracle_client`
- `set_oracle_credentials`, `get_oracle_credentials`
- `test_oracle_connection`, `fetch_table_metadata`
- `compare_configurations`, `export_comparison_result` (stubbed for Phase 4)

## Diff Rendering Contract (Frontend ⇄ Backend)

- Backend returns `DiffChunk[]` segments for each differing field via `env1_chunks` and `env2_chunks`.
- Allowed `chunk_type` values: `Same`, `Added`, `Removed`, `Modified`.
- Backend sanitizes all chunk text; the frontend only inserts markup generated by `renderDiffChunks()` via `innerHTML`.
- For plain values (no chunks), the frontend uses `textContent` or escapes via `escapeHtml()` before composing HTML, preventing HTML injection.
- CSS classes mapped to chunk types: `.diff-same`, `.diff-added`, `.diff-removed`, `.diff-modified`.

## Filters and Search Behavior

- Status toggles (`Match`, `Differ`, `OnlyInEnv1`, `OnlyInEnv2`) and text search (`cmpSearch`) are combined.
- Filtering applies status constraints first; if a search query is present, results must also match the query on the primary key string.

## Performance Guardrails

- When result sets exceed ~1,000 rows, the frontend switches to chunked rendering (200 items per chunk).
- DOM updates are deferred using microtasks and idle callbacks to avoid blocking the UI thread.
- Copy-to-clipboard listeners are bound after the final chunk append.