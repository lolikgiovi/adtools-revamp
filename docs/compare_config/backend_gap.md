# Compare Config Backend - Implementation Gaps

This document outlines the gaps between the Oracle Instant Client Integration Plan (`docs/oracle-instant-client-integration-plan.md`) and the current implementation in `tauri/src/oracle.rs`.

> **Scope**: Phase 2 (Compare Config Backend) only. Quick Query and Jenkins Runner integrations are out of scope.

---

## Implemented

### Gap 1: Query Timeout ✅

**Status**: Implemented on 2026-01-15

**Plan Requirement**:
> "Implement query timeout (default 5 minutes) to prevent hung connections."

**Implementation Details**:

1. Added `QUERY_TIMEOUT_SECS` constant (`oracle.rs:218`):
   ```rust
   const QUERY_TIMEOUT_SECS: u64 = 300; // 5 minutes
   ```

2. Applied timeout on connection creation in `ConnectionPool::get_connection()` (`oracle.rs:285-287`):
   ```rust
   let conn = Connection::connect(username, password, connect_string)?;
   conn.set_call_timeout(Some(Duration::from_secs(QUERY_TIMEOUT_SECS)))?;
   ```

3. Applied timeout on one-off connections in `create_connection()` (`oracle.rs:403-409`):
   ```rust
   let conn = Connection::connect(username, password, connect_string)?;
   conn.set_call_timeout(Some(Duration::from_secs(QUERY_TIMEOUT_SECS)))?;
   Ok(conn)
   ```

4. Added error hints for timeout-related errors (`oracle.rs:45-46`):
   - ORA-03136: Query exceeded timeout limit
   - ORA-03114: Connection to database lost

**Unit Tests Added**:
- `test_query_timeout_constant_is_5_minutes`
- `test_error_hint_for_timeout`
- `test_error_hint_for_connection_lost`

---

### Gap 2: Complex Datatype Handling ✅

**Status**: Implemented on 2026-01-15

**Plan Requirement**:
> - LOB, BLOB, RAW: stringify as hex or base64, or return null with warning.
> - DATE/TIMESTAMP: return as ISO 8601 string.
> - NUMBER: return as string to preserve precision for large numbers.

**Implementation Details**:

Based on user requirements, the following approach was implemented:

1. **BLOB**: Show placeholder with size instead of fetching binary data
   ```rust
   OracleType::BLOB => {
       Ok(serde_json::Value::String(format!("[BLOB: {} bytes]", bytes.len())))
   }
   ```

2. **RAW/LONG RAW**: Same placeholder approach
   ```rust
   OracleType::Raw(_) | OracleType::LongRaw => {
       Ok(serde_json::Value::String(format!("[RAW: {} bytes]", bytes.len())))
   }
   ```

3. **CLOB/NCLOB**: Return as string (often contains base64 in user's use case), truncate if > 1MB
   ```rust
   OracleType::CLOB | OracleType::NCLOB => {
       if s.len() > MAX_LOB_SIZE_BYTES {
           let truncated = format!(
               "{}... [truncated, total {} bytes]",
               &s[..MAX_LOB_SIZE_BYTES],
               s.len()
           );
           Ok(serde_json::Value::String(truncated))
       } else {
           Ok(serde_json::Value::String(s))
       }
   }
   ```

4. **BFILE**: Show placeholder for external file references
   ```rust
   OracleType::BFILE => {
       Ok(serde_json::Value::String("[BFILE: external file]".to_string()))
   }
   ```

5. Added `MAX_LOB_SIZE_BYTES` constant (`oracle.rs:594`):
   ```rust
   const MAX_LOB_SIZE_BYTES: usize = 1_048_576; // 1MB
   ```

**Key Changes**:
- `execute_select()` now passes column type info to `row_to_json_value()`
- `row_to_json_value()` accepts `OracleType` parameter and handles LOB types specially
- Added `row_to_json_value_default()` for non-LOB type handling

**Unit Tests Added**:
- `test_max_lob_size_is_1mb`

**Note**: DATE/TIMESTAMP and NUMBER precision handling were not implemented as the current String-first approach works adequately for comparison purposes. These can be added later if needed.

---

## Pending Gaps

### Gap 3: Bundled Oracle Instant Client Loading

**Status**: Not implemented (low priority for internal tools)

**Plan Requirement**:
> Load `libclntsh.dylib` from the app bundle using `@executable_path` relative paths.
>
> ```
> ADTools.app/Contents/Frameworks/instantclient/libclntsh.dylib
> ```

**Current State**:
Uses compile-time linking via the `oracle` crate. Requires:
- `OCI_LIB_DIR` environment variable at build time
- Oracle Instant Client in system library paths at runtime

This works for development but may not work for end-user distribution without IC installed.

**Implementation Plan**:

Two options:

#### Option A: Runtime Library Loading (Matches Plan)

1. **Add `libloading` dependency**
   ```toml
   [dependencies]
   libloading = "0.8"
   ```

2. **Implement dynamic loading from app bundle**
   ```rust
   use std::sync::OnceLock;
   use libloading::Library;

   static ORACLE_LIB: OnceLock<Result<Library, String>> = OnceLock::new();

   fn load_oracle_lib() -> Result<&'static Library, String> {
       ORACLE_LIB.get_or_init(|| {
           let exe_path = std::env::current_exe()
               .map_err(|e| format!("Failed to get exe path: {}", e))?;

           let lib_path = exe_path
               .parent()  // MacOS/
               .and_then(|p| p.parent())  // Contents/
               .map(|p| p.join("Frameworks/instantclient/libclntsh.dylib"))
               .ok_or_else(|| "Invalid app bundle structure".to_string())?;

           if !lib_path.exists() {
               return Err(format!("Oracle client not found at {:?}", lib_path));
           }

           // Set DYLD_LIBRARY_PATH for the oracle crate to find dependencies
           std::env::set_var("DYLD_LIBRARY_PATH", lib_path.parent().unwrap());

           unsafe { Library::new(&lib_path) }
               .map_err(|e| format!("Failed to load Oracle client: {}", e))
       }).as_ref().map_err(|e| e.clone())
   }
   ```

3. **Update `check_oracle_available` to verify bundle**
   ```rust
   pub fn check_oracle_available() -> Result<bool, OracleError> {
       load_oracle_lib()
           .map(|_| true)
           .map_err(|e| OracleError::internal(e))
   }
   ```

4. **Update build script** to copy IC files
   - Copy IC files to `Frameworks/instantclient/` during build
   - Sign all dylibs: `codesign --force --sign "$IDENTITY" *.dylib`

#### Option B: Keep Compile-Time Linking (Current Approach)

Keep the current approach but document requirements:
- End users must have Oracle Instant Client installed
- Or ship with install instructions for IC

**Recommendation**: Option A for seamless user experience, Option B for simplicity.

**Files to Modify**:
- `tauri/src/oracle.rs`: Add dynamic loading (Option A)
- `tauri/Cargo.toml`: Add `libloading` (Option A)
- `build_release.sh`: Copy IC files to bundle (Option A)
- `tauri/tauri.conf.json`: Configure bundle resources (Option A)

---

## Assessed Differences (No Action Needed)

### Difference 1: Keychain Library

**Plan Specification**:
Uses `security_framework` crate with `get_generic_password`, `set_generic_password`, `delete_generic_password`.

**Current Implementation**:
Uses `keyring` crate (`oracle.rs:7`, `oracle.rs:424-472`).

**Assessment**:
**No action needed.** The `keyring` crate is functionally equivalent and provides:
- Cross-platform support (macOS Keychain, Windows Credential Manager, Linux Secret Service)
- Simpler API
- Active maintenance

The current implementation is acceptable and arguably better for future cross-platform support.

---

### Difference 2: Connection Test Not Pooled

**Plan Specification**:
Implies test connections might be added to pool.

**Current Implementation**:
`test_oracle_connection` (`oracle.rs:881-899`) creates a one-off connection using `create_connection`, not `with_pooled_connection`.

**Assessment**:
**No action needed.** This is correct behavior:
- Test connections are for validation only
- Adding untested connections to pool could leave bad connections
- One-off connections are closed after test, keeping pool clean

---

## Summary

| Item | Status | Priority | Effort |
|------|--------|----------|--------|
| Query Timeout | ✅ Implemented | High | Low |
| Complex Datatypes | ✅ Implemented | Medium | Medium |
| Bundled IC Loading | ❌ Pending | Low* | High |
| Keychain Library | ✅ Acceptable | - | - |
| Connection Test Not Pooled | ✅ Correct | - | - |

*Bundled IC is low priority if users are expected to have Oracle IC installed (internal tool use case).

---

## Next Steps

1. ~~Implement Query Timeout (Gap 1)~~ ✅ Done
2. ~~Add BLOB/CLOB/RAW handling (Gap 2)~~ ✅ Done
3. Evaluate need for Bundled IC based on deployment model (Gap 3)

---

## Optional Future Enhancements

These were identified in the plan but not implemented as they weren't critical for the current use case:

1. **DATE/TIMESTAMP as ISO 8601**: Current implementation returns as string which works for comparison
2. **NUMBER precision preservation**: Current i64/f64 handling works for most cases
3. **User-configurable timeouts**: Could add `timeout_secs` parameter to request structs
4. **User-configurable LOB size limits**: Could make MAX_LOB_SIZE_BYTES configurable per request
