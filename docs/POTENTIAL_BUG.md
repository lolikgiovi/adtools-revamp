# Potential Bugs Report

**Analysis Range**: Commit `762c770f3c7bb154eeb72960357022bbde086c4e` to `HEAD`  
**Date**: 2026-01-19  
**Affected Areas**: Quick Query (IndexedDB migration), Keychain Migration, Run Query (Split Execution)

---

## Summary

| Severity | Count | Description |
|----------|-------|-------------|
| 🔴 Critical | 1 | Split execution uses stale closure variables |
| 🟠 Medium | 3 | Race conditions, data loss risk, keychain prompt handling |
| 🟡 Low | 1 | Transaction completion not properly awaited |

---

## 🔴 Critical Issues

### 1. Run Query: Split "Execute All" Captures Stale Variables

**File**: `frontend/tools/run-query/main.js`  
**Lines**: ~2327-2466

**Status**: ✅ FIXED

**Description**:  
The "Execute All" button handler is bound only once using a `dataset.bound` flag. However, the handler closes over variables (`chunks`, `env`, `baseUrl`, `job`) from the **first time it was bound**. If a user runs a split query, dismisses it, then runs a different large query, the Execute All button will execute the **first query's chunks** instead of the current one.

**Fix Applied**:  
Handler now reads current state at click time using `currentChunks = this.state.split.chunks`, `currentEnv = envSelect.value`, `currentBaseUrl = this.state.jenkinsUrl`, and `currentJob = jobInput.value.trim()` instead of relying on closure variables.

**Code**:
```javascript
if (splitExecuteAllBtn && !splitExecuteAllBtn.dataset.bound) {
  splitExecuteAllBtn.dataset.bound = "true";
  splitExecuteAllBtn.addEventListener("click", async () => {
    // ❌ These variables are captured from first bind, not current state
    // chunks, baseUrl, job, env are from outer scope at bind time
    for (let idx = 0; idx < chunks.length; idx++) {
      const chunkSql = chunks[idx];
      // ...executes wrong chunks on subsequent splits
    }
  });
}
```

**Impact**:  
- User executes wrong SQL against production database
- Data corruption or unintended modifications
- Difficult to debug since UI shows correct chunks but wrong ones execute

**Reproduction Steps**:
1. Paste a large query (>90KB) and confirm split → opens modal with chunks A
2. Cancel or dismiss the modal
3. Paste a different large query → opens modal with chunks B
4. Click "Execute All"
5. **Result**: Chunks A are executed, not chunks B

**Recommended Fix**:  
Read current state at click time instead of relying on closure:
```javascript
splitExecuteAllBtn.addEventListener("click", async () => {
  const chunks = this.state.split.chunks;  // Read current state
  const env = envSelect.value;
  const baseUrl = this.state.jenkinsUrl;
  const job = jobInput.value.trim();
  // ...rest of handler
});
```

Or clone the button to remove previous listeners before rebinding (pattern used elsewhere in codebase).

---

## 🟠 Medium Issues

### 2. Quick Query: Storage Calls Before IndexedDB Initialization

**File**: `frontend/tools/quick-query/main.js`  
**Lines**: ~119-128

**Status**: ✅ FIXED

**Description**:  
The `init()` method sets up event listeners and initializes Handsontable **before** awaiting `storageService.init()`. This means user interactions (typing in data grid, searching schemas) can trigger storage operations while `this.db` is still `null`.

**Fix Applied**:  
Moved `await this.storageService.init()` to run BEFORE `initializeComponents()`, `setupEventListeners()`, and `setupTableNameSearch()`.

**Code**:
```javascript
async init() {
  // ...
  await this.initializeComponents();  // Sets up Handsontable with afterChange callback
  this.setupEventListeners();         // Binds click handlers that call storage methods
  this.setupTableNameSearch();        // Binds search that calls searchSavedSchemas()
  
  // ❌ Storage init happens AFTER listeners are bound
  await this.storageService.init();
  this._storageReady = true;
  
  await this.loadMostRecentSchema();
}
```

**Impact**:  
- `TypeError: Cannot read properties of null` if user interacts quickly
- Data not persisted if early edits fail silently
- Inconsistent UI state

**Reproduction Steps**:
1. Open Quick Query tool
2. Immediately start typing in the data grid before schema loads
3. `afterChange` callback fires → calls `updateTableData()` → `this.db.transaction()` throws

**Recommended Fix**:  
Move storage initialization before UI setup:
```javascript
async init() {
  // Initialize storage FIRST
  await this.storageService.init();
  this._storageReady = true;
  
  // Then set up UI
  await this.initializeComponents();
  this.setupEventListeners();
  this.setupTableNameSearch();
  await this.loadMostRecentSchema();
}
```

Additionally, add guards in storage-calling methods:
```javascript
if (!this._storageReady) return;
```

---

### 3. IndexedDB: Migration Clears localStorage Even If Nothing Migrated

**File**: `frontend/tools/quick-query/services/IndexedDBStorageService.js`  
**Lines**: ~107-167

**Status**: ✅ FIXED

**Description**:  
The migration logic parses legacy localStorage data and iterates over it. If the data has an unexpected shape (corrupted, different version, or empty `tables` object), the loop migrates 0 records but still removes the localStorage keys afterward.

**Fix Applied**:  
Added check `if (migratedCount > 0)` before clearing localStorage. If 0 tables migrated but legacy data exists, a warning is logged and localStorage is preserved as backup.

**Code**:
```javascript
async _migrateFromLocalStorage() {
  // ...
  const legacySchemaStore = legacySchemaRaw ? JSON.parse(legacySchemaRaw) : {};
  
  let migratedCount = 0;
  for (const [schemaName, schemaData] of Object.entries(legacySchemaStore)) {
    const tables = schemaData?.tables || {};  // ❌ If shape differs, tables = {}
    for (const [tableName, tableSchema] of Object.entries(tables)) {
      // ...migration logic
      migratedCount++;
    }
  }
  
  // ❌ Clears localStorage regardless of migratedCount
  localStorage.removeItem(LEGACY_SCHEMA_KEY);
  localStorage.removeItem(LEGACY_DATA_KEY);
  
  console.log(`[IndexedDB Migration] Successfully migrated ${migratedCount} tables.`);
}
```

**Impact**:  
- User loses all cached schemas if legacy format differs
- Silent data loss with misleading "Successfully migrated 0 tables" log
- No recovery path once localStorage is cleared

**Reproduction Steps**:
1. Have legacy localStorage with non-standard shape (e.g., flat structure without `.tables`)
2. Open Quick Query → migration runs
3. Migration iterates 0 tables, clears localStorage
4. User loses all saved schemas

**Recommended Fix**:  
Only clear localStorage if migration actually succeeded:
```javascript
if (migratedCount > 0) {
  localStorage.removeItem(LEGACY_SCHEMA_KEY);
  localStorage.removeItem(LEGACY_DATA_KEY);
  console.log(`[IndexedDB Migration] Successfully migrated ${migratedCount} tables.`);
} else if (legacySchemaRaw || legacyDataRaw) {
  console.warn("[IndexedDB Migration] Legacy data found but 0 tables migrated. Keeping localStorage as backup.");
}
```

---

### 4. Keychain: User Cancellation Misinterpreted as "No Credentials"

**File**: `tauri/src/lib.rs`  
**Lines**: ~206-220 (`load_unified_secrets`) and ~230-282 (`migrate_to_unified_keychain`)

**Status**: ✅ FIXED

**Description**:  
The `load_unified_secrets()` function treats **all** keyring errors as "entry not found" and returns empty secrets. This includes user cancellation of the macOS keychain prompt. When migration runs, it may incorrectly determine `no_credentials = true` and the JavaScript side will permanently set the migration flag, preventing future retry.

**Fix Applied**:  
1. Rust: `load_unified_secrets()` now distinguishes between `keyring::Error::NoEntry` (returns default) and `keyring::Error::NoStorageAccess` (propagates error for user cancellation/permission denied).
2. JavaScript: Removed `no_credentials` from the condition that sets the migration flag. New users will have migration retried after they save credentials.

**Code**:
```rust
fn load_unified_secrets() -> Result<UnifiedSecrets, String> {
    let entry = Entry::new(UNIFIED_KEYCHAIN_SERVICE, UNIFIED_KEYCHAIN_KEY).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(json_str) => serde_json::from_str(&json_str).map_err(|e| ...),
        Err(_) => Ok(UnifiedSecrets::default()),  // ❌ Treats ALL errors as "no entry"
    }
}
```

In `migrate_to_unified_keychain()`:
```rust
// If user cancelled prompt, had_* = false, found_old_* = false
let no_credentials = !had_jenkins && !had_confluence && !found_old_jenkins && !found_old_confluence;
// no_credentials becomes true incorrectly
```

Then in JavaScript (`KeychainMigration.js`):
```javascript
if (result.migrated_jenkins || result.migrated_confluence || result.already_unified || result.no_credentials) {
  setMigrated();  // ❌ Permanently sets flag even though user just cancelled
}
```

**Impact**:  
- User cancels keychain prompt once → migration marked complete forever
- Future app launches still fail to read credentials
- User must manually clear localStorage flag to retry

**Reproduction Steps**:
1. Fresh install or after app update triggers migration
2. macOS keychain prompt appears
3. User clicks "Deny" or "Cancel"
4. Migration returns `no_credentials: true`
5. JavaScript sets `keychain.unified.migrated = true`
6. Next app launch: credentials not found, migration doesn't retry

**Recommended Fix**:  

Rust - distinguish "not found" from "access denied":
```rust
fn load_unified_secrets() -> Result<UnifiedSecrets, String> {
    let entry = Entry::new(UNIFIED_KEYCHAIN_SERVICE, UNIFIED_KEYCHAIN_KEY)
        .map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(json_str) => serde_json::from_str(&json_str)
            .map_err(|e| format!("Failed to parse secrets: {}", e)),
        Err(keyring::Error::NoEntry) => Ok(UnifiedSecrets::default()),
        Err(e) => Err(format!("Keychain access error: {}", e)),  // Propagate other errors
    }
}
```

Add a `prompt_cancelled` flag to `MigrationResult` for explicit handling.

JavaScript - don't set migrated flag on error:
```javascript
// Only mark migrated on actual success, not on no_credentials
if (result.migrated_jenkins || result.migrated_confluence || result.already_unified) {
  setMigrated();
}
// If no_credentials and no error, user is new - don't set flag yet, wait for first credential save
```

---

## 🟡 Low Issues

### 5. IndexedDB: Transaction Completion Not Properly Awaited

**File**: `frontend/tools/quick-query/services/IndexedDBStorageService.js`  
**Lines**: ~184-194 (`_putRecord`)

**Status**: ✅ FIXED

**Description**:  
The `_putRecord()` method resolves the promise on `request.onsuccess`, but IndexedDB transactions can still abort after the request succeeds. The proper pattern is to resolve on `tx.oncomplete`.

**Fix Applied**:  
Updated `_putRecord()`, `_deleteRecord()`, and `_clearStore()` to resolve on `tx.oncomplete` and handle `tx.onabort` for proper transaction lifecycle management.

**Code**:
```javascript
_putRecord(storeName, record) {
  return new Promise((resolve, reject) => {
    const tx = this.db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const request = store.put(record);
    
    request.onsuccess = () => resolve(request.result);  // ❌ Transaction may still abort
    request.onerror = () => reject(request.error);
  });
}
```

**Impact**:  
- Rare edge case where caller thinks write succeeded but transaction was aborted
- Data inconsistency between in-memory state and persisted state
- Difficult to reproduce and debug

**Recommended Fix**:
```javascript
_putRecord(storeName, record) {
  return new Promise((resolve, reject) => {
    const tx = this.db.transaction(storeName, "readwrite");
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
    
    const store = tx.objectStore(storeName);
    const request = store.put(record);
    request.onerror = () => reject(request.error);
  });
}
```

Apply same pattern to `_deleteRecord()` and `_clearStore()`.

---

## Testing Recommendations

### Manual Test Cases

1. **Split Execution Stale Closure**
   - Run split with query A → Cancel → Run split with query B → Execute All
   - Verify query B chunks are executed (check Jenkins job parameters)

2. **Quick Query Early Interaction**
   - Open Quick Query and immediately type in data grid
   - Verify no console errors and data persists after reload

3. **IndexedDB Migration Edge Case**
   - Manually set malformed localStorage: `localStorage.setItem("tool:quick-query:schema", "{}")`
   - Open Quick Query → verify localStorage is NOT cleared and warning is logged

4. **Keychain Prompt Cancellation**
   - Clear migration flag: `localStorage.removeItem("keychain.unified.migrated")`
   - Open app → Cancel keychain prompt
   - Verify migration flag is NOT set
   - Restart app → Verify prompt appears again

---

## Priority Order for Fixes

1. **🔴 Critical**: Split "Execute All" stale closure (immediate - data safety)
2. **🟠 Medium**: Keychain prompt cancellation (high - user experience)
3. **🟠 Medium**: Quick Query storage init order (medium - error prevention)
4. **🟠 Medium**: IndexedDB migration data loss (medium - data safety)
5. **🟡 Low**: Transaction completion awaiting (low - edge case)
