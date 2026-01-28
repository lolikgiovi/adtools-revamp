# Compare Config: Python Sidecar for Oracle Database

> **Status**: ✅ Production ready  
> **Date**: 2026-01-28

## Background

Previous attempts to bundle Oracle Instant Client with the Tauri app failed due to:

- macOS code signing/notarization issues
- DYLD library path restrictions on signed apps
- Complex symlink setup requirements

The Python sidecar approach bypasses all these issues by using `oracledb` in **thin mode**, which connects directly to Oracle without native client libraries.

## Current State

### What's Done ✅

| Component                        | Status         | Location                                                     |
| -------------------------------- | -------------- | ------------------------------------------------------------ |
| Python FastAPI sidecar           | ✅ Working     | `tauri/sidecar/oracle_sidecar.py`                            |
| Connection pooling               | ✅ Implemented | Pool per connection config, auto-cleanup                     |
| Health endpoint                  | ✅ Working     | `GET /health`                                                |
| Query endpoint                   | ✅ Implemented | `POST /query`, `POST /query-dict`                            |
| Test connection                  | ✅ Implemented | `POST /test-connection`                                      |
| Rust sidecar manager             | ✅ Compiles    | `tauri/src/oracle_sidecar.rs`                                |
| Frontend client                  | ✅ Created     | `frontend/tools/compare-config/lib/oracle-sidecar-client.js` |
| Tauri config                     | ✅ Updated     | `externalBin`, shell plugin, capabilities                    |
| PyInstaller build script         | ✅ Created     | `tauri/sidecar/build_sidecar.py`                             |
| **Phase 1: UI Integration**      | ✅ Complete    | `service.js`, `main.js`, `unified-data-service.js`           |
| **Phase 1: Credentials**         | ✅ Complete    | `service.js` - `buildSidecarConnection()`                    |
| **Phase 1: Status Indicator**    | ✅ Complete    | `template.js`, `styles.css`                                  |
| **Phase 2: Auto-lifecycle**      | ✅ Complete    | `lib.rs` - auto-start on launch, auto-stop on exit           |
| **Phase 2: Dual-arch build**     | ✅ Complete    | `build.sh` - builds arm64 + x86_64 via Rosetta               |
| **Phase 2: Ad-hoc signing**      | ✅ Complete    | `build_sidecar.py` - codesign after PyInstaller              |
| **Phase 2: Release integration** | ✅ Complete    | `build_release.sh` - auto-builds sidecar before Tauri        |
| **Phase 3: Error handling**      | ✅ Complete    | `OracleSidecarError` with user-friendly messages + hints     |
| **Phase 3: Sidecar restart**     | ✅ Complete    | Restart button in sidecar status indicator                   |
| **Phase 3: Check Connection**    | ✅ Complete    | Settings → Oracle Connections → Check button                 |
| **Phase 3: Orphan cleanup**      | ✅ Complete    | `kill_orphan_sidecar()` on startup in `oracle_sidecar.rs`    |
| **Phase 4: IC cleanup**          | ✅ Complete    | Removed legacy Oracle IC bundling code                       |

### What's Not Done ❌

| Component               | Status     | Notes                                       |
| ----------------------- | ---------- | ------------------------------------------- |
| Fallback to Rust Oracle | ❌ Pending | For users who have Instant Client installed |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Tauri App                                 │
│                                                                     │
│  ┌────────────────────┐                                             │
│  │   Compare Config   │                                             │
│  │   UI (frontend)    │                                             │
│  └─────────┬──────────┘                                             │
│            │                                                        │
│            │ HTTP (fetch)                                           │
│            ▼                                                        │
│  ┌─────────────────────┐        ┌─────────────────────────────────┐ │
│  │ oracle-sidecar-     │        │    Tauri Rust Backend           │ │
│  │ client.js           │        │                                 │ │
│  │                     │        │  • start_oracle_sidecar()       │ │
│  │ • start()           │        │  • stop_oracle_sidecar()        │ │
│  │ • query()           │        │  • Manages sidecar lifecycle    │ │
│  │ • testConnection()  │        │                                 │ │
│  └─────────┬───────────┘        └─────────────────────────────────┘ │
│            │                                                        │
└────────────┼────────────────────────────────────────────────────────┘
             │
             │ localhost:21522
             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Python Sidecar (FastAPI)                         │
│                                                                     │
│  ┌─────────────────┐    ┌─────────────────────────────────────────┐ │
│  │  Pool Manager   │    │  Endpoints                              │ │
│  │                 │    │                                         │ │
│  │  • pool per DSN │    │  GET  /health                           │ │
│  │  • min=1, max=2 │    │  POST /test-connection                  │ │
│  │  • timeout=120s │    │  POST /query         → rows as arrays   │ │
│  │  • auto cleanup │    │  POST /query-dict    → rows as objects  │ │
│  └────────┬────────┘    │  GET  /pools                            │ │
│           │             └─────────────────────────────────────────┘ │
│           │                                                         │
│           │ oracledb (thin mode - NO Instant Client!)               │
│           ▼                                                         │
└─────────────────────────────────────────────────────────────────────┘
             │
             │ Oracle TNS Protocol
             ▼
      ┌──────────────┐
      │    Oracle    │
      │   Database   │
      └──────────────┘
```

## Next Steps

### Phase 1: Integration (Priority: High) ✅ COMPLETE

1. **Wire up Compare Config UI to use sidecar** ✅
   - [x] Modify `service.js` to use `OracleSidecarClient` instead of Tauri invoke
   - [x] Add sidecar startup on tool initialization
   - [x] Handle sidecar connection errors gracefully
   - [x] Add sidecar status indicator in UI header

2. **Credentials handling** ✅
   - [x] Retrieve credentials from keychain (existing `oracle::get_oracle_credentials`)
   - [x] Pass to sidecar in request (don't store in sidecar)
   - [x] `buildSidecarConnection()` method in service.js handles this

3. **Test with real Oracle database**
   - [ ] Test connection to DEV/UAT environments
   - [ ] Verify 1000+ row queries work
   - [ ] Check performance vs Rust implementation

### Phase 2: Build & Distribution (Priority: High) ✅ COMPLETE

4. **Build the sidecar executable** ✅

   ```bash
   # Builds both arm64 and x86_64 (via Rosetta on Apple Silicon)
   npm run sidecar:build

   # Or manually:
   cd tauri/sidecar
   source venv/bin/activate
   pip install pyinstaller
   python build_sidecar.py
   ```

5. **Auto-lifecycle** ✅
   - [x] Sidecar auto-starts when Tauri app launches (`lib.rs` setup hook)
   - [x] Sidecar auto-stops when app window closes (`on_window_event` hook)

6. **Dual-architecture build** ✅
   - [x] `build.sh` builds arm64 natively
   - [x] `build.sh` builds x86_64 via Rosetta (using `venv-x64`)
   - [x] Ad-hoc signing (`codesign --force --sign -`) after PyInstaller
   - [x] Integrated into `npm run release:build`

7. **Code signing & notarization**
   - [x] Ad-hoc signing implemented in `build_sidecar.py`
   - [x] Sidecar included in app bundle correctly
   - [ ] Full Apple notarization (requires $99/year Developer ID)

   **Note on notarization bypass**: For internal distribution without notarization:
   - Initial install: Users run `xattr -cr "AD Tools.app"` once
   - Future updates via Tauri updater work automatically (no user action needed)

### Phase 3: Polish (Priority: Medium) ✅ COMPLETE

8. **Error handling improvements** ✅
   - [x] Map Oracle error codes to user-friendly messages (in `OracleSidecarError`)
   - [x] Show connection hints in UI (error hints displayed with messages)
   - [x] Retry logic for transient failures (restart button for sidecar)

9. **Sidecar status indicator enhancements** ✅
   - [x] Show sidecar status in UI (starting/ready/error)
   - [x] Allow manual restart if sidecar crashes (restart button in header)

10. **Check Connection in Settings** ✅
    - [x] Added "Check" button to Oracle Connections list in Settings
    - [x] Tests connection via sidecar with visual feedback

### Phase 4: Cleanup (Priority: Low) ✅ COMPLETE

10. **Remove old Oracle IC bundling code** ✅
    - [x] Remove `setup_oracle_library_path()` function from `oracle.rs`
    - [x] Remove `get_bundled_ic_path()` function from `oracle.rs`
    - [x] Remove `debug_oracle_setup()` command from `oracle.rs`
    - [x] Remove `check_oracle_client_ready` and `prime_oracle_client` commands
    - [x] Remove legacy IC setup call in `lib.rs`
    - [x] Remove frontend service methods for legacy IC commands
    - [x] Note: `build.rs` was already clean (no IC bundling code)

11. **Documentation**
    - [x] Update architecture docs (this file)
    - [ ] Update README with new architecture
    - [ ] Document troubleshooting steps

## API Reference

### Sidecar Endpoints

#### `GET /health`

```json
{ "status": "ok", "active_pools": 0, "timestamp": "2026-01-28T10:38:36.308025" }
```

#### `POST /test-connection`

```json
{
  "connection": {
    "name": "DEV",
    "connect_string": "hostname:1521/service_name",
    "username": "myuser",
    "password": "mypass"
  }
}
```

#### `POST /query`

```json
{
  "connection": { ... },
  "sql": "SELECT id, name FROM users WHERE status = 'active'",
  "max_rows": 1000
}
```

Response:

```json
{
  "columns": ["ID", "NAME"],
  "rows": [
    [1, "Alice"],
    [2, "Bob"]
  ],
  "row_count": 2,
  "execution_time_ms": 45.23
}
```

#### `POST /query-dict`

Same request, but response rows are objects:

```json
{
  "columns": ["ID", "NAME"],
  "rows": [
    { "ID": 1, "NAME": "Alice" },
    { "ID": 2, "NAME": "Bob" }
  ],
  "row_count": 2,
  "execution_time_ms": 45.23
}
```

## Development

### Running sidecar locally

```bash
cd tauri/sidecar
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python oracle_sidecar.py
```

### Testing endpoints

```bash
# Health check
curl http://127.0.0.1:21522/health

# Test connection
curl -X POST http://127.0.0.1:21522/test-connection \
  -H "Content-Type: application/json" \
  -d '{"connection": {"name": "TEST", "connect_string": "host:1521/svc", "username": "u", "password": "p"}}'
```

### Building for distribution

```bash
# Build sidecar for both architectures (recommended)
npm run sidecar:build

# This runs tauri/sidecar/build.sh which:
# 1. Builds arm64 binary using native venv
# 2. Builds x86_64 binary using venv-x64 (via Rosetta)
# 3. Ad-hoc signs both binaries

# Output files:
#   tauri/oracle-sidecar-aarch64-apple-darwin
#   tauri/oracle-sidecar-x86_64-apple-darwin
```

### Full release build

```bash
# Builds sidecar + Tauri app for both architectures
npm run release:build

# This automatically:
# 1. Runs npm run sidecar:build (both archs)
# 2. Builds Tauri for aarch64-apple-darwin
# 3. Builds Tauri for x86_64-apple-darwin
# 4. Creates DMG and tar.gz for each
# 5. Signs update packages
```

## Risks & Mitigations

| Risk                         | Mitigation                                     |
| ---------------------------- | ---------------------------------------------- |
| PyInstaller bundle too large | Currently ~50-80MB; acceptable for desktop app |
| Sidecar crashes              | Rust manager can detect and restart            |
| Port conflict (21522)        | Could make port configurable                   |
| Startup delay                | Pre-start sidecar, show loading indicator      |
| Security (password in HTTP)  | localhost only, could add encryption if needed |

## Decision Log

| Date       | Decision                        | Rationale                                                                      |
| ---------- | ------------------------------- | ------------------------------------------------------------------------------ |
| 2026-01-28 | Use Python sidecar              | Oracle IC bundling failed; oracledb thin mode works without IC                 |
| 2026-01-28 | FastAPI + uvicorn               | Lightweight, async, easy to use                                                |
| 2026-01-28 | Port 21522                      | Easy to remember (2 + Oracle default 1521)                                     |
| 2026-01-28 | Frontend calls sidecar directly | Simpler than routing through Rust backend                                      |
| 2026-01-28 | Dual-arch build via Rosetta     | PyInstaller only builds for current arch; Rosetta enables x86_64 builds on ARM |
| 2026-01-28 | Ad-hoc signing                  | Allows distribution without $99/year Apple Developer ID; users run xattr once  |
| 2026-01-28 | Tauri updater for updates       | After initial xattr, updates work seamlessly without user action               |
