# Oracle Instant Client Integration Plan (macOS, Tauri Desktop)

## Goals
- Enable optional Oracle SELECT capabilities in the desktop app without breaking when the client isn’t installed.
- Keep installation user-driven (no admin rights), with a predictable local path.
- Integrate with Quick Query for table properties and Jenkins Runner for preflight backup SELECTs.

## Summary Approach
- Ship app code compiled with the Rust `oracle` crate, but do not bundle the Oracle Instant Client.
- Provide an installer script that places Instant Client under `~/Documents/adtools_library/instantclient` and records the path.
- At runtime, explicitly load `libclntsh.dylib` from that path (no reliance on `DYLD_LIBRARY_PATH`).
- Gate UI features in Quick Query and Jenkins Runner based on a readiness check. If not ready, show guidance but keep the app fully usable.

## Install Location
- Target directory: `~/Documents/adtools_library/instantclient`
- Rationale:
  - User-writable; no admin privileges required.
  - Not in `Applications`; avoids system-level constraints and auto-managed updates.
  - Easy for users to inspect and back up.

## Backend Safety Requirements
- Never panic if the client isn’t present. All Tauri commands must return `Result<_, String>`.
- Provide a dedicated “readiness” command that returns `true/false` and a friendly error message when loading fails.
- Only attempt to load the client on demand (when the user initiates an Oracle action).
- Explicitly load `libclntsh.dylib` using `libloading::Library::new(path)` and keep the handle alive (e.g., leak/park the handle) to ensure it stays loaded.
- Prefer setting `ODPI_LIB_DIR` or `OCI_LIB_DIR` to point to the Instant Client directory before creating Oracle connections, but the primary approach is explicit loading.

## Runtime Detection & Gating (UI)
- On tool init (Quick Query, Jenkins Runner):
  - Call `check_oracle_client_ready(customDir?)`.
  - If `false`, disable local-execution buttons and show: “Oracle client not installed. Run installer and configure path.”
  - If `true`, call `prime_oracle_client(customDir?)` once to load `libclntsh.dylib`.
- Avoid relying on `DYLD_LIBRARY_PATH` for Finder-launched apps; explicit loading is deterministic on macOS.

## Tauri Backend Commands (Examples)
- Readiness check:
```rust
#[tauri::command]
fn check_oracle_client_ready(custom_dir: Option<String>) -> Result<bool, String> {
  // Resolve directory (custom or default) and check existence of libclntsh.dylib
}
```

- Prime loader:
```rust
#[tauri::command]
fn prime_oracle_client(custom_dir: Option<String>) -> Result<bool, String> {
  // Load libclntsh.dylib via libloading::Library::new()
}
```

- Execute SELECT and return JSON:
```rust
#[tauri::command]
fn oracle_select_json(connect: String, username: String, password: String, sql: String) -> Result<serde_json::Value, String> {
  // Ensure client loaded, connect via oracle::Connection, execute query, map rows to JSON
}
```

- Fetch table properties (for Quick Query):
```rust
#[tauri::command]
fn oracle_table_properties(owner: String, table: String, connect: String, username: String, password: String) -> Result<serde_json::Value, String> {
  // Query ALL_TAB_COLUMNS / ALL_CONSTRAINTS to produce columns + PK flags
}
```

## SQL for Table Properties
- Columns and datatypes:
```sql
SELECT c.COLUMN_ID,
       c.COLUMN_NAME,
       c.DATA_TYPE,
       c.DATA_LENGTH,
       c.DATA_PRECISION,
       c.DATA_SCALE,
       c.NULLABLE,
       c.DATA_DEFAULT
FROM   ALL_TAB_COLUMNS c
WHERE  c.OWNER = :owner
AND    c.TABLE_NAME = :table
ORDER BY c.COLUMN_ID;
```

- Primary key columns:
```sql
SELECT cc.COLUMN_NAME
FROM   ALL_CONSTRAINTS cons
JOIN   ALL_CONS_COLUMNS cc
  ON   cons.OWNER = cc.OWNER
 AND   cons.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
WHERE  cons.OWNER = :owner
AND    cons.TABLE_NAME = :table
AND    cons.CONSTRAINT_TYPE = 'P';
```

- Merge PK info by marking columns returned in the PK query.

## Quick Query Integration
- UI changes:
  - Add “Fetch Table Properties” action that calls `oracle_table_properties` and populates the schema grid.
  - Add “Execute Locally” action to run ad-hoc SELECT using `oracle_select_json`.
- Behavior when client missing:
  - Disable both actions and show a short tip, but keep the editor and other tooling usable.
- Data mapping:
  - Map `columns` to grid headers and `rows` to table body.
  - Validate schema using existing `SchemaValidationService` after fetching.

## Jenkins Runner Integration
- New preflight step (optional toggle):
  - Before running MERGE/INSERT/UPDATE, perform a local SELECT snapshot of the target table (limited rows, e.g., `FETCH FIRST 100 ROWS ONLY`).
  - Save as JSON/CSV under `~/Documents/adtools_library/backups/<schema>.<table>-<timestamp>.json`.
- Behavior when client missing:
  - Show “Local snapshot unavailable” and allow proceeding with Jenkins execution.
- Example snapshot query:
```sql
SELECT * FROM :owner.:table FETCH FIRST 100 ROWS ONLY;
```
- Note: Use bound variables or sanitized identifiers; for identifiers, resolve via `oracle_table_properties` to avoid injection.

## Installer Script Plan (install-oracle-client.sh)
- Goals:
  - Download or accept path to official Instant Client (Basic Light) ZIP for macOS.
  - Install to `~/Documents/adtools_library/instantclient` without admin rights.
  - Create `libclntsh.dylib` symlink if only versioned file exists.
  - Record path for the app to discover (e.g., `~/.adtools/oracle_ic_path`).
  - Do not auto-update; store a fixed version and never change it without explicit user action.

- Architecture detection:
  - Detect CPU via `uname -m` (`arm64` vs `x86_64`).
  - Validate the ZIP matches the architecture; error/warn if mismatch.

- Download modes:
  1) Manual: user downloads the ZIP from Oracle and passes the local path to the script.
  2) Direct URL (advanced): if a direct, authenticated URL is provided, use `curl` to fetch. The script never stores credentials.

- Steps:
  - Create directories: `~/Documents/adtools_library/instantclient` and `~/.adtools`.
  - Unzip into the instantclient directory; flatten nested structure if needed.
  - Ensure `libclntsh.dylib` exists; create a symlink to `libclntsh.dylib.*` if only versioned file is present.
  - Write path to `~/.adtools/oracle_ic_path`.
  - Optionally write `version.lock` with the installed version string.
  - Print concise success message and short usage tip.

- Example outline:
```bash
#!/usr/bin/env bash
set -euo pipefail
ARCH="$(uname -m)" # arm64 or x86_64
TARGET="$HOME/Documents/adtools_library/instantclient"
CONF_DIR="$HOME/.adtools"
ZIP_PATH="${1:-}"

mkdir -p "$TARGET" "$CONF_DIR"

if [[ -z "$ZIP_PATH" ]]; then
  echo "Usage: install-oracle-client.sh /path/to/instantclient-basiclite-<arch>.zip"
  exit 1
fi

unzip -q "$ZIP_PATH" -d "$TARGET"
# Flatten and link libclntsh.dylib, record path, write version.lock
```

## Security & Credentials
- Do not store DB credentials in `localStorage`.
- Reuse macOS Keychain (similar to Jenkins credentials) for Oracle username/password.
- Use read-only DB users for SELECT operations and strictly read-only data paths.
- For TCPS/wallets: users can place wallet files under `~/.adtools/wallet` and set `TNS_ADMIN` via app config; document separately if needed.

## Testing & Verification
- Unit test backend commands with mocked availability (client present/absent) to ensure safe fallbacks.
- Manual tests:
  - With no client installed: app loads, buttons disabled, clear guidance shown.
  - With client installed: prime load succeeds; SELECT returns rows; table properties populate correctly.
  - Wrong architecture ZIP: installer warns and aborts.

## Known Caveats
- Oracle licensing requires user acceptance and login for downloads; avoid embedding credentials or scraping.
- Apple Silicon vs Intel builds are not interchangeable; enforce architecture checks.
- Complex datatypes (LOBs, RAW) require careful mapping; initial implementation can stringify or null.

## Next Steps
- Implement the readiness and prime commands in `src-tauri`.
- Add Settings entries for DSN and optional custom Instant Client path.
- Wire Quick Query actions to fetch properties and run local SELECT.
- Add Jenkins Runner preflight snapshot toggle and storage path.
- Create `scripts/install-oracle-client.sh` following the outline above.