# Oracle Integration — Developer Guide

This guide describes how the optional Oracle-based Compare Config feature is integrated, packaged, and tested.

## Overview

- Feature is gated by Oracle Instant Client detection and priming.
- No bundling of Oracle client in AD Tools due to licensing and size.
- Works on macOS via Tauri; the web app continues to function without Oracle.

## Architecture

- Tauri commands in `src-tauri/src/oracle/commands.rs`
- Client detection and priming in `src-tauri/src/oracle/client.rs`
- Sanitization helpers in `src-tauri/src/oracle/sanitize.rs`
- Query/metadata helpers in `src-tauri/src/oracle/query.rs`
- Comparison and exporters in `src-tauri/src/oracle/comparison.rs`

Frontend UI lives under `app/tools/compare-config/` using `BaseTool`:
- `main.js`: wiring, actions, filters, presets, CSV preview
- `template.js`: UI structure
- `styles.css`: tool styling

## Client Detection & Priming

- Install path: `~/Documents/adtools_library/instantclient`
- Detect: `check_oracle_client_ready` returns status and guidance
- Prime: `prime_oracle_client` sets `DYLD_LIBRARY_PATH` and attempts explicit load of `libclntsh.dylib`

## CLI Smoke Tests

Run from `src-tauri`:

```
cargo run --bin oracle_smoke -- ready
cargo run --bin oracle_smoke -- prime
cargo run --bin oracle_smoke -- set-creds <ID> <USER> <PASS>
cargo run --bin oracle_smoke -- get-creds <ID>
cargo run --bin oracle_smoke -- test-conn --id <ID> --host <HOST> --port 1521 --service <SERVICE>
```

## Testing

- Rust unit tests: `cargo test` (no Oracle client required)
  - `sanitize.rs`: identifier checks, normalization, WHERE clause detection
  - `comparison.rs`: `to_csv` differences-only behavior
- Frontend tests: `npm test`
  - CSV generation, filters, presets
- Integration tests that require a real client should be skipped in CI; run locally on developer machines if needed.

## Packaging

- Tauri config: `src-tauri/tauri.conf.json` keeps Oracle optional; no special capabilities required beyond default.
- Build web assets: `npm run build:tauri`
- Desktop release scripts: `src-tauri/scripts/build_release.sh` and `upload_to_r2.sh`
- Do not include Oracle client in the app bundle; provide install guidance instead.

## Documentation

- User guide: `docs/user-guide/compare-config.md`
- Development notes: `docs/COMPARE-CONFIG-DEVELOPMENT-NOTES.md`
- Feature spec: `docs/COMPARE-CONFIG-FEATURE.md`

## CI Notes

- Add GitLab jobs to run `npm test` and `cargo test` without Oracle client.
- Avoid integration tests in CI; ensure unit tests cover sanitization/export logic.