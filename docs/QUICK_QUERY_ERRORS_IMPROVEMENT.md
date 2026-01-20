# Quick Query Error Analysis & Improvement Plan

> **Analysis Date:** January 20, 2026  
> **Data Source:** Production error telemetry from `trackEvent` calls  
> **Period:** November 12, 2025 - January 20, 2026

---

## Executive Summary

Analysis of 545 total error events across 21 error types reveals that **validation errors** (null constraints, missing headers) are the primary pain point affecting the most users. Infrastructure errors like `minify_worker_failed` have high volume but are isolated to single users/devices.

### Priority Matrix

| Priority | Error Type | Impact | Effort | Action |
|----------|-----------|--------|--------|--------|
| 🔴 P0 | `null_not_allowed` | 14 users, 91 errors | Medium | Better defaults & UX |
| 🔴 P0 | `header_fields_missing` | 10 users, 63 errors | Low | Improved messaging |
| 🟡 P1 | `quota_exceeded` | 4 users, 68 errors | Medium | Warning + IndexedDB migration |
| 🟡 P1 | `minify_worker_failed/fallback` | 1 user, 96+96 errors | Medium | Graceful degradation |
| 🟢 P2 | `generate_failed` | 10 users, 44 errors | Low | Already resolved? |
| 🟢 P2 | `max_length_exceeded` | 6 users, 8 errors | Low | Pre-validation |

---

## Detailed Error Analysis

### 1. `null_not_allowed` — **PRIORITY 0**

**Volume:** 91 errors | **Users:** 14 | **Devices:** 15  
**Status:** ⚠️ Active (last seen: 2026-01-20)

#### Root Cause Analysis

**Source:** [`ValueProcessorService.js#L46-L58`](file:///Users/mcomacbook/ad-tools-revamp-workspace/patch/frontend/tools/quick-query/services/ValueProcessorService.js#L46-L58)

```javascript
if (isEmptyValue) {
  if (queryType === "update") {
    return null; // Skip empty values for UPDATE - correct behavior
  }
  if (nullable?.toLowerCase() !== "yes") {
    UsageTracker.trackEvent("quick-query", "value_error", { type: "null_not_allowed", ... });
    throw new Error(`NULL value not allowed for non-nullable field "${fieldName}"`);
  }
  return "NULL";
}
```

**Why it happens:**
1. User pastes data from Excel with empty cells for non-nullable columns
2. Schema defines field as `Null: No` but data has missing values
3. User doesn't understand which cells are causing the error
4. Explicit "null" or "NULL" strings in nullable=No columns

**User Journey:**
1. User loads schema from saved tables
2. Pastes data from Excel into data table
3. Clicks "Generate" → Gets generic error
4. Has no idea which row/column is the problem

#### Proposed Improvements

##### A. Pre-validation with Cell Highlighting (Medium Effort) — ❌ NOT IMPLEMENTED
```javascript
// Before generation, scan all cells and highlight problematic ones
validateDataBeforeGeneration(schemaData, inputData) {
  const errors = [];
  const schemaMap = new Map(schemaData.map(row => [row[0], row]));
  const fieldNames = inputData[0];
  
  inputData.slice(1).forEach((row, rowIndex) => {
    fieldNames.forEach((fieldName, colIndex) => {
      const schema = schemaMap.get(fieldName);
      const nullable = schema?.[2];
      const value = row[colIndex];
      
      if ((value === null || value === '' || value === undefined) && 
          nullable?.toLowerCase() !== 'yes') {
        errors.push({
          row: rowIndex + 2, // 1-indexed, skip header
          col: colIndex,
          columnLetter: this.columnIndexToLetter(colIndex),
          fieldName,
          message: `Required field "${fieldName}" cannot be empty`
        });
      }
    });
  });
  
  return errors;
}
```

##### B. Smart Defaults for Common Fields — ✅ IMPLEMENTED
**Location:** [`ValueProcessorService.js#L19-L32`](file:///Users/mcomacbook/ad-tools-revamp-workspace/patch/frontend/tools/quick-query/services/ValueProcessorService.js#L19-L32)

Audit fields are auto-filled:
- `created_time`, `updated_time` → `SYSDATE`
- `created_by`, `updated_by` → `'SYSTEM'` (or provided value)

##### C. Better Error Messages with Location — ✅ IMPLEMENTED
**Location:** [`QueryGenerationService.js#L289-L292`](file:///Users/mcomacbook/ad-tools-revamp-workspace/patch/frontend/tools/quick-query/services/QueryGenerationService.js#L289-L292)

Errors from `processValue()` are wrapped with cell location:
```javascript
const columnLetter = this.columnIndexToLetter(colIndex);
throw new Error(`Error in Cell ${columnLetter}${rowIndex + 2}, Field "${fieldName}":<br>${fieldError.message}`);
```

Example output: `Error in Cell G2, Field "PARAMETER_TYPE": NULL value not allowed for non-nullable field "PARAMETER_TYPE"`

##### D. Visual Indicator in Data Table (Medium Effort) — ❌ NOT IMPLEMENTED
- Add red border to cells with validation errors
- Show tooltip on hover explaining the issue
- Add "Fix All" button to auto-fill with defaults

---

### 2. `header_fields_missing` — **PRIORITY 0**

**Volume:** 63 errors | **Users:** 10 | **Devices:** 10  
**Status:** ⚠️ Active (last seen: 2026-01-15)

#### Root Cause Analysis

**Source:** [`IndexedDBStorageService.js#L868-L876`](file:///Users/mcomacbook/ad-tools-revamp-workspace/patch/frontend/tools/quick-query/services/IndexedDBStorageService.js#L868-L876) and [`LocalStorageService.js#L726-L728`](file:///Users/mcomacbook/ad-tools-revamp-workspace/patch/frontend/tools/quick-query/services/LocalStorageService.js#L726-L728)

```javascript
const missing = header.filter((h) => !columns.includes(h));
if (missing.length > 0) {
  UsageTracker.trackEvent("quick-query", "validation_error", { type: "header_fields_missing", missing });
  throw new Error(`Data columns missing in schema: ${missing.join(", ")}`);
}
```

**Why it happens:**
1. User copies data with different column names than schema
2. Case sensitivity issues (Oracle is case-sensitive for quoted identifiers)
3. Extra spaces in column headers from Excel copy-paste
4. Schema was updated but data wasn't refreshed

**User Journey:**
1. User has schema loaded with columns: `CUSTOMER_ID`, `NAME`, `STATUS`
2. Pastes data with headers: `customer_id`, `name`, `status` (different case)
3. Error: "Data columns missing in schema: customer_id, name, status"
4. User confused because columns "exist" visually

#### Proposed Improvements

##### A. Case-Insensitive Matching with Warning (Low Effort)
```javascript
const columnsLower = columns.map(c => c.toLowerCase());
const missingExact = header.filter(h => !columns.includes(h));
const missingCaseInsensitive = header.filter(h => !columnsLower.includes(h.toLowerCase()));

if (missingCaseInsensitive.length > 0) {
  throw new Error(`Data columns missing in schema: ${missingCaseInsensitive.join(", ")}`);
}

if (missingExact.length > 0) {
  // Warn but auto-correct
  console.warn(`Case mismatch in columns: ${missingExact.join(", ")}. Auto-correcting...`);
  // Auto-correct header row to match schema case
}
```

##### B. Trim Whitespace Before Comparison (Low Effort)
```javascript
const header = Array.isArray(tableData[0]) 
  ? tableData[0].map(h => String(h || '').trim()) 
  : [];
```

##### C. Show Diff Dialog (Medium Effort)
When mismatch is detected, show a dialog:
```
Column Mismatch Detected:

In Schema        | In Data
-----------------|------------------
CUSTOMER_ID      | customer_id (case mismatch)
NAME             | name (case mismatch)
STATUS           | status (case mismatch)
EMAIL            | (missing in data)
                 | extra_col (not in schema)

[Auto-Fix] [Cancel] [Ignore Case Differences]
```

---

### 3. `quota_exceeded` — **PRIORITY 1**

**Volume:** 68 errors | **Users:** 4 | **Devices:** 4  
**Status:** ⚠️ Active (last seen: 2026-01-20)

#### Root Cause Analysis

**Source:** [`LocalStorageService.js#L77-L88`](file:///Users/mcomacbook/ad-tools-revamp-workspace/patch/frontend/tools/quick-query/services/LocalStorageService.js#L77-L88) and [`LocalStorageService.js#L96-L107`](file:///Users/mcomacbook/ad-tools-revamp-workspace/patch/frontend/tools/quick-query/services/LocalStorageService.js#L96-L107)

```javascript
saveSchemaStore(store) {
  try {
    const payload = JSON.stringify(store);
    localStorage.setItem(this.SCHEMA_STORAGE_KEY, payload);
    // ...
  } catch (error) {
    const type = error?.name?.toLowerCase().includes("quota") ? "quota_exceeded" : "schema_write_failed";
    UsageTracker.trackEvent("quick-query", "storage_error", { type, message: error.message });
  }
}
```

**Why it happens:**
1. localStorage limit is ~5-10MB per origin
2. Users store many large schemas with lots of columns
3. Cached data rows (up to 300 per table) accumulate
4. No storage management or cleanup mechanism

**Affected Users Profile:**
- Power users with 50+ saved schemas
- Users who work with tables having 100+ columns
- Long-term users with accumulated cache

#### Proposed Improvements

##### A. Complete IndexedDB Migration (Already in Progress)
The `IndexedDBStorageService` exists but migration may not be complete. Verify:
1. All users are migrated from localStorage to IndexedDB
2. localStorage fallback still tracks quota errors
3. Consider removing localStorage fallback entirely

##### B. Storage Usage Indicator (Medium Effort)
```javascript
// Add to UI: Show storage usage bar
getStorageUsage() {
  const schemaSize = localStorage.getItem(SCHEMA_STORAGE_KEY)?.length || 0;
  const dataSize = localStorage.getItem(DATA_STORAGE_KEY)?.length || 0;
  const totalUsed = schemaSize + dataSize;
  const estimatedLimit = 5 * 1024 * 1024; // 5MB conservative estimate
  
  return {
    used: totalUsed,
    limit: estimatedLimit,
    percentage: (totalUsed / estimatedLimit) * 100,
    warning: totalUsed > estimatedLimit * 0.8
  };
}
```

##### C. Proactive Warning at 80% Capacity (Low Effort)
Before save operations, check capacity:
```javascript
async saveSchema(fullTableName, schemaData, tableData = null) {
  const usage = this.getStorageUsage();
  if (usage.percentage > 80) {
    console.warn(`Storage at ${usage.percentage.toFixed(1)}% capacity`);
    // Show UI warning
  }
  // ... rest of save logic
}
```

##### D. Data Cleanup Options (Medium Effort)
- Add "Manage Storage" dialog in settings
- Show tables sorted by size
- Allow bulk delete of old/unused schemas
- Add "Export & Delete" for archival

---

### 4. `minify_worker_failed` / `minify_worker_fallback` — **PRIORITY 1**

**Volume:** 96 + 96 errors | **Users:** 1 | **Devices:** 1  
**Status:** Isolated issue (2026-01-09 to 2026-01-15)

#### Root Cause Analysis

**Source:** [`AttachmentProcessorService.js#L151-L168`](file:///Users/mcomacbook/ad-tools-revamp-workspace/patch/frontend/tools/quick-query/services/AttachmentProcessorService.js#L151-L168)

```javascript
try {
  minified = await this.#minifyHtmlWithWorker(original, tableName);
} catch (err) {
  console.error("HTML Minify Worker failed, falling back to basic minify:", err);
  UsageTracker.trackEvent("quick-query", "attachment_error", {
    type: "minify_worker_fallback",
    // ...
  });
  // Fallback to simple regex-based minification
  minified = original.replace(/<!--[\s\S]*?-->/g, "")...
}
```

**Why it happens:**
1. Web Worker may fail to spawn in certain browser configurations
2. Browser extensions blocking workers
3. CSP (Content Security Policy) restrictions
4. Memory issues with very large HTML files

**Why isolated to one user:**
- Likely a specific browser/device configuration
- Could be corporate proxy or security software
- Possibly an older browser version

#### Proposed Improvements

##### A. Better Diagnostics (Low Effort)
```javascript
async #minifyHtmlWithWorker(html, tableName) {
  // Check Worker availability first
  if (typeof Worker === 'undefined') {
    console.warn('Web Workers not supported, using fallback');
    return this.#minifyHtmlFallback(html);
  }
  
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new MinifyWorker();
    } catch (e) {
      UsageTracker.trackEvent("quick-query", "attachment_error", {
        type: "minify_worker_create_failed",
        message: e.message,
        userAgent: navigator.userAgent,
        table_name: tableName,
      });
      return resolve(this.#minifyHtmlFallback(html));
    }
    // ... rest of worker logic
  });
}
```

##### B. Skip Worker for Small Files (Low Effort)
```javascript
async minifyContent(file, tableName) {
  const original = file.processedFormats?.original || "";
  
  // For small files, skip worker overhead
  const WORKER_THRESHOLD = 50 * 1024; // 50KB
  if (original.length < WORKER_THRESHOLD) {
    return this.#minifyHtmlFallback(original);
  }
  
  // Try worker for larger files
  // ...
}
```

##### C. Timeout Handling (Medium Effort)
```javascript
async #minifyHtmlWithWorker(html, tableName) {
  return new Promise((resolve, reject) => {
    const worker = new MinifyWorker();
    
    const timeout = setTimeout(() => {
      worker.terminate();
      UsageTracker.trackEvent("quick-query", "attachment_error", {
        type: "minify_worker_timeout",
        table_name: tableName,
      });
      resolve(this.#minifyHtmlFallback(html));
    }, 10000); // 10 second timeout
    
    worker.onmessage = (event) => {
      clearTimeout(timeout);
      // ... handle result
    };
    
    worker.postMessage({ type: "minify", html });
  });
}
```

---

### 5. `generate_failed` — **PRIORITY 2 (Possibly Resolved)**

**Volume:** 44 errors | **Users:** 10 | **Devices:** 11  
**Status:** ✅ Inactive since 2025-12-17

#### Root Cause Analysis

This error type doesn't appear in current code, suggesting it was:
1. Renamed to more specific error types (e.g., `generation_error`)
2. The underlying issue was fixed
3. Error was from legacy code path

**Recommendation:** 
- Verify this error type no longer occurs
- If it resurfaces, search git history for removed code
- Consider this resolved unless errors reappear

---

### 6. `max_length_exceeded` — **PRIORITY 2**

**Volume:** 8 errors | **Users:** 6 | **Devices:** 6  
**Status:** ⚠️ Active (last seen: 2026-01-20)

#### Root Cause Analysis

**Source:** [`ValueProcessorService.js#L157-L171`](file:///Users/mcomacbook/ad-tools-revamp-workspace/patch/frontend/tools/quick-query/services/ValueProcessorService.js#L157-L171)

```javascript
if (fieldDataType.maxLength) {
  const length = fieldDataType.unit === "BYTE" 
    ? new TextEncoder().encode(strValue).length 
    : strValue.length;

  if (length > fieldDataType.maxLength) {
    UsageTracker.trackEvent("quick-query", "value_error", {
      type: "max_length_exceeded",
      fieldName,
      maxLength: fieldDataType.maxLength,
      length,
      unit: fieldDataType.unit,
      table_name: tableName,
    });
    throw new Error(`Value exceeds maximum length of ${fieldDataType.maxLength} ${fieldDataType.unit} for field "${fieldName}"`);
  }
}
```

**Why it happens:**
1. User pastes long text into VARCHAR(50) field
2. Multi-byte characters (UTF-8) exceed BYTE limit while appearing short
3. Data exported from another system has longer values

#### Proposed Improvements

##### A. Real-time Length Indicator in Data Table (Medium Effort)
When editing a cell, show: `42/50 chars` or `⚠️ 65/50 chars (exceeds limit)`

##### B. Pre-validation with Character Count (Low Effort)
```javascript
// Show in error which value is too long
const preview = strValue.substring(0, 20) + (strValue.length > 20 ? '...' : '');
throw new Error(
  `Value "${preview}" (${length} ${fieldDataType.unit}) exceeds maximum length of ` +
  `${fieldDataType.maxLength} ${fieldDataType.unit} for field "${fieldName}"`
);
```

##### C. Auto-truncate Option (Low Effort)
Add checkbox: "Auto-truncate values that exceed field length"

---

### 7. `invalid_number` — **PRIORITY 2**

**Volume:** 4 errors | **Users:** 4 | **Devices:** 4  
**Status:** ⚠️ Active (last seen: 2026-01-20)

#### Root Cause Analysis

**Source:** [`ValueProcessorService.js#L123-L128`](file:///Users/mcomacbook/ad-tools-revamp-workspace/patch/frontend/tools/quick-query/services/ValueProcessorService.js#L123-L128)

```javascript
const num = parseFloat(normalizedValue);

if (isNaN(num)) {
  UsageTracker.trackEvent("quick-query", "value_error", { type: "invalid_number", fieldName, value, table_name: tableName });
  throw new Error(`Invalid numeric value "${value}" for field "${fieldName}"`);
}
```

**Why it happens:**
1. Text in NUMBER column (e.g., "N/A", "TBD")
2. Currency symbols (e.g., "$100", "€50")
3. Percentage with symbol (e.g., "50%")
4. Locale-specific formatting not recognized

#### Proposed Improvements

##### A. Better Number Parsing (Low Effort)
```javascript
// Strip common non-numeric prefixes/suffixes
let normalizedValue = strValue.trim()
  .replace(/^[$€£¥₹]/, '')  // Currency symbols
  .replace(/%$/, '')         // Percentage
  .replace(/\s/g, '');       // Spaces
```

##### B. Show Acceptable Formats in Error (Low Effort)
```javascript
throw new Error(
  `Invalid numeric value "${value}" for field "${fieldName}". ` +
  `Accepted formats: 123, 123.45, 1,234.56, 1.234,56`
);
```

---

### 8-12. Lower Priority Errors

| Error | Count | Users | Status | Quick Fix |
|-------|-------|-------|--------|-----------|
| `timestamp_parse_failed` | 31 | 2 | Inactive (Nov 2025) | Add more date formats |
| `convert_data_failed` | 9 | 2 | Inactive (Dec 2025) | May be resolved |
| `invalid_table_format` | 5 | 2 | Active | Better validation message |
| `update_table_data_failed` | 5 | 2 | Active | Retry logic + better logging |
| `missing_pk_for_update` | 3 | 2 | Active | Pre-validation for UPDATE |
| `no_fields_to_update` | 13 | 1 | Active | Clear guidance message |
| `invalid_values` | 3 | 1 | Active | Show specific invalid value |
| `precision_exceeded` | 2 | 1 | Inactive | Pre-validation |
| `pk_missing_in_row` | 1 | 1 | Active | Highlight row with issue |
| `exceeds_max_length` | 1 | 1 | Active | Same as max_length_exceeded |
| `processing` | 3 | 1 | Active | Add retry for file processing |
| `read_error` | 3 | 1 | Active | Better file error handling |

---

## Implementation Roadmap

### Phase 1: Quick Wins (1-2 weeks)
- [ ] Better error messages with cell locations for `null_not_allowed`
- [ ] Case-insensitive header matching for `header_fields_missing`
- [ ] Trim whitespace from headers before comparison
- [ ] Add storage usage warning at 80% capacity

### Phase 2: Validation Improvements (2-3 weeks)
- [ ] Pre-generation validation with cell highlighting
- [ ] Smart defaults for audit fields (created_time, updated_time, etc.)
- [ ] Real-time length indicator for VARCHAR fields
- [ ] Worker fallback improvements with timeout

### Phase 3: UX Enhancements (3-4 weeks)
- [ ] Column mismatch dialog with auto-fix option
- [ ] Storage management dialog for power users
- [ ] Visual indicators (red borders) for validation errors
- [ ] "Fix All" button for common issues

### Phase 4: Monitoring & Prevention (Ongoing)
- [ ] Add more specific error types for better debugging
- [ ] Include browser/device info in error tracking
- [ ] Create dashboard for error trends
- [ ] Set up alerts for new error spikes

---

## Metrics for Success

| Metric | Current | Target | Timeline |
|--------|---------|--------|----------|
| `null_not_allowed` errors/week | ~10 | < 2 | 4 weeks |
| `header_fields_missing` errors/week | ~7 | < 1 | 2 weeks |
| `quota_exceeded` errors/week | ~8 | 0 | 6 weeks |
| Users affected by errors | 14+ | < 5 | 8 weeks |
| Error-to-success ratio | Unknown | < 5% | 8 weeks |

---

## Appendix: Error Source Code References

| Error Type | File | Line | Function |
|------------|------|------|----------|
| `null_not_allowed` | ValueProcessorService.js | 46, 56 | `processValue()` |
| `header_fields_missing` | IndexedDBStorageService.js | 872 | `_convertArrayDataToJsonRows()` |
| `quota_exceeded` | LocalStorageService.js | 84, 104 | `saveSchemaStore()`, `saveDataStore()` |
| `minify_worker_failed` | AttachmentProcessorService.js | 226 | `#minifyHtmlWithWorker()` |
| `minify_worker_fallback` | AttachmentProcessorService.js | 155 | `minifyContent()` |
| `max_length_exceeded` | ValueProcessorService.js | 161 | `processValue()` |
| `invalid_number` | ValueProcessorService.js | 126 | `processValue()` |
| `invalid_table_format` | IndexedDBStorageService.js | 252 | `parseTableIdentifier()` |
| `update_table_data_failed` | IndexedDBStorageService.js | 377 | `updateTableData()` |
| `missing_pk_for_update` | QueryGenerationService.js | 408 | `generateUpdateStatement()` |
| `no_fields_to_update` | QueryGenerationService.js | 414 | `generateUpdateStatement()` |
| `pk_missing_in_row` | QueryGenerationService.js | 443 | `generateUpdateStatement()` |
| `invalid_values` | SchemaValidationService.js | 61 | `validateSchema()` |
| `precision_exceeded` | ValueProcessorService.js | 230 | `validateNumberPrecision()` |
| `exceeds_max_length` | AttachmentValidationService.js | 36, 50 | `handleVarcharType()` |
| `processing` | AttachmentProcessorService.js | 55 | `processAttachments()` |
| `read_error` | AttachmentProcessorService.js | 116 | `readFileAs()` |
