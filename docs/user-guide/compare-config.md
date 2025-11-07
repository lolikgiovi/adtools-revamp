# Compare Config — User Guide

This tool compares configuration tables across two Oracle environments and highlights differences. It is optional and requires Oracle Instant Client, which is not bundled with AD Tools.

## Prerequisites

- macOS (desktop build via Tauri)
- Oracle Instant Client installed locally
- Network access to your Oracle databases

## Install Oracle Instant Client

Quick install via Terminal:

```
curl -fsSL https://adtools.lolik.workers.dev/install-oracle-instant-client.sh | bash
```

Details:
- Installs to `~/Documents/adtools_library/instantclient`
- Validates library (`libclntsh.dylib`) using `otool -L`
- No admin privileges required

If installation fails, use the local script:
- `scripts/install-oracle-instant-client.sh`

## Enabling the Feature

- Open the tool and click `Check & Prime Client`.
- If the client is missing, the tool shows guidance and disables Oracle actions.
- When installed, priming loads the Oracle library and enables actions.

## Using the Tool

1. Define saved connections in Settings:
   - Open Settings → "Oracle Database Connections".
   - Add a connection using a name and JSON value, for example:
     - `{ "host": "db-uat1.company.com", "port": 1521, "service_name": "ORCLPDB1", "schema": "APP_SCHEMA" }`
   - The list in Settings is used to populate Env 1/Env 2 dropdowns.
2. Select Env 1 and Env 2 in Compare Config:
   - Use the "Saved Connection" dropdowns to pick your environments.
   - Click `Set Credentials` to store username/password securely (macOS Keychain).
   - Click `Test Connection` to verify access; the tool shows status as Success, Fail, or Error.
3. Enter `Table` and optional `WHERE` clause.
   - Field selection is optional; you can run comparisons without editing fields.
4. Click `Compare` to run the comparison.
5. Inspect summary metrics and detailed rows:
   - Status: `Match`, `Differ`, `OnlyInEnv1`, `OnlyInEnv2`
   - Use filters to focus on specific statuses
6. Export:
   - JSON/CSV via backend export (saved to `~/Documents/adtools_library/comparisons/`)
   - Client-side CSV preview and download in the browser
7. Presets:
   - Save, apply, and delete comparison presets (stored in `localStorage`)

## Export Details

- Backend CSV: differences-focused (`primary_key,status,field,env1,env2`)
- Frontend CSV: includes differences plus only-in rows expanded by fields
- Exports save under `~/Documents/adtools_library/comparisons/` with timestamps

## Troubleshooting

- “Oracle Instant Client not detected”: run the install script and restart AD Tools.
- Priming failed: check architecture and that `libclntsh.dylib` exists in `instantclient`.
- Connection failed: verify host/port/service, schema access, and credentials.
- WHERE clause errors: ensure valid SQL identifiers; avoid comments or DDL.

## Security

- Credentials are stored in macOS Keychain via Tauri; never written to disk.
- Presets exclude usernames/passwords; only non-sensitive fields are saved.

## Notes

- The Oracle client is not bundled due to licensing and size constraints.
- The web app remains fully usable without the Oracle feature.