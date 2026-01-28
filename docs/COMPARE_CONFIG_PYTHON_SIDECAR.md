# Compare Config: Python Sidecar for Oracle Database

> **Status**: ✅ Proof of concept working  
> **Date**: 2026-01-28

## Background

Previous attempts to bundle Oracle Instant Client with the Tauri app failed due to:
- macOS code signing/notarization issues
- DYLD library path restrictions on signed apps
- Complex symlink setup requirements

The Python sidecar approach bypasses all these issues by using `oracledb` in **thin mode**, which connects directly to Oracle without native client libraries.

## Current State

### What's Done ✅

| Component | Status | Location |
|-----------|--------|----------|
| Python FastAPI sidecar | ✅ Working | `tauri/sidecar/oracle_sidecar.py` |
| Connection pooling | ✅ Implemented | Pool per connection config, auto-cleanup |
| Health endpoint | ✅ Working | `GET /health` |
| Query endpoint | ✅ Implemented | `POST /query`, `POST /query-dict` |
| Test connection | ✅ Implemented | `POST /test-connection` |
| Rust sidecar manager | ✅ Compiles | `tauri/src/oracle_sidecar.rs` |
| Frontend client | ✅ Created | `frontend/tools/compare-config/lib/oracle-sidecar-client.js` |
| Tauri config | ✅ Updated | `externalBin`, shell plugin, capabilities |
| PyInstaller build script | ✅ Created | `tauri/sidecar/build_sidecar.py` |
| **Phase 1: UI Integration** | ✅ Complete | `service.js`, `main.js`, `unified-data-service.js` |
| **Phase 1: Credentials** | ✅ Complete | `service.js` - `buildSidecarConnection()` |
| **Phase 1: Status Indicator** | ✅ Complete | `template.js`, `styles.css` |

### What's Not Done ❌

| Component | Status | Notes |
|-----------|--------|-------|
| Build & bundle testing | ❌ Pending | Need to test PyInstaller + Tauri bundle |
| Error handling in UI | ❌ Pending | Map sidecar errors to user-friendly messages |
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
             │ localhost:21521
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

### Phase 2: Build & Distribution (Priority: High)

4. **Build the sidecar executable**
   ```bash
   cd tauri/sidecar
   source venv/bin/activate
   pip install pyinstaller
   python build_sidecar.py
   ```

5. **Test bundled app**
   - [ ] Build Tauri app: `cargo tauri build`
   - [ ] Verify sidecar starts with app
   - [ ] Verify sidecar stops when app closes
   - [ ] Test on clean macOS (no Python installed)

6. **Code signing & notarization**
   - [ ] Sign the sidecar executable
   - [ ] Include in app bundle correctly
   - [ ] Test notarization passes

### Phase 3: Polish (Priority: Medium)

7. **Error handling improvements**
   - [ ] Map Oracle error codes to user-friendly messages
   - [ ] Show connection hints in UI
   - [ ] Retry logic for transient failures

8. **Sidecar status indicator**
   - [ ] Show sidecar status in UI (starting/ready/error)
   - [ ] Allow manual restart if sidecar crashes

9. **Fallback strategy** (Optional)
   - [ ] Detect if Oracle Instant Client is installed
   - [ ] Use Rust implementation if available (faster)
   - [ ] Fall back to Python sidecar otherwise

### Phase 4: Cleanup (Priority: Low)

10. **Remove old Oracle IC bundling code**
    - [ ] Remove `setup_oracle_library_path()` complexity
    - [ ] Remove `build.rs` Oracle IC bundling
    - [ ] Remove symlink creation in `$HOME/lib`

11. **Documentation**
    - [ ] Update README with new architecture
    - [ ] Document troubleshooting steps
    - [ ] Add development setup guide

## API Reference

### Sidecar Endpoints

#### `GET /health`
```json
{"status": "ok", "active_pools": 0, "timestamp": "2026-01-28T10:38:36.308025"}
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
  "rows": [[1, "Alice"], [2, "Bob"]],
  "row_count": 2,
  "execution_time_ms": 45.23
}
```

#### `POST /query-dict`
Same request, but response rows are objects:
```json
{
  "columns": ["ID", "NAME"],
  "rows": [{"ID": 1, "NAME": "Alice"}, {"ID": 2, "NAME": "Bob"}],
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
curl http://127.0.0.1:21521/health

# Test connection
curl -X POST http://127.0.0.1:21521/test-connection \
  -H "Content-Type: application/json" \
  -d '{"connection": {"name": "TEST", "connect_string": "host:1521/svc", "username": "u", "password": "p"}}'
```

### Building for distribution
```bash
cd tauri/sidecar
source venv/bin/activate
pip install pyinstaller
python build_sidecar.py
# Output: tauri/binaries/oracle-sidecar-aarch64-apple-darwin
```

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| PyInstaller bundle too large | Currently ~50-80MB; acceptable for desktop app |
| Sidecar crashes | Rust manager can detect and restart |
| Port conflict (21521) | Could make port configurable |
| Startup delay | Pre-start sidecar, show loading indicator |
| Security (password in HTTP) | localhost only, could add encryption if needed |

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-01-28 | Use Python sidecar | Oracle IC bundling failed; oracledb thin mode works without IC |
| 2026-01-28 | FastAPI + uvicorn | Lightweight, async, easy to use |
| 2026-01-28 | Port 21521 | Easy to remember (2 + Oracle default 1521) |
| 2026-01-28 | Frontend calls sidecar directly | Simpler than routing through Rust backend |
