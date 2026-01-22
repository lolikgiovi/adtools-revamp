# Quick Query Error Analysis & Improvement Plan

> **Analysis Date:** January 20, 2026  
> **Last Updated:** January 21, 2026  
> **Data Source:** Production error telemetry from `trackEvent` calls  
> **Period:** November 12, 2025 - January 20, 2026

---

## Executive Summary

Analysis of 545 total error events across 21 error types reveals that **validation errors** (null constraints, missing headers) are the primary pain point affecting the most users. Infrastructure errors like `minify_worker_failed` have high volume but are isolated to single users/devices.

### Priority Matrix

| Priority | Error Type | Impact | Effort | Status |
|----------|-----------|--------|--------|--------|
| 🔴 P0 | `null_not_allowed` | 14 users, 91 errors | Medium | ✅ Partially Solved (B, C) |
| 🔴 P0 | `header_fields_missing` | 10 users, 63 errors | Low | ⚠️ Pending |
| 🟡 P1 | `quota_exceeded` | 4 users, 68 errors | Medium | ✅ Solved (IndexedDB migration) |
| 🟡 P1 | `minify_worker_failed/fallback` | 1 user, 96+96 errors | Medium | ✅ Solved (fallback removed) |
| 🟢 P2 | `generate_failed` | 10 users, 44 errors | Low | ✅ Resolved (inactive since Dec 2025) |
| 🟢 P2 | `max_length_exceeded` | 6 users, 8 errors | Low | ⚠️ Pending |

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

##### A. Pre-validation with Cell Highlighting (Medium Effort) — ⚠️ FUTURE CONSIDERATION
**Status:** Not implemented. Low performance impact (~50ms for 10K cells). Would validate all cells before generation and show ALL errors at once.

**User clarification:** This runs before clicking Generate, catching errors proactively. Minimal performance impact since data is already in memory.

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

##### D. Visual Indicator in Data Table (Medium Effort) — ⚠️ FUTURE CONSIDERATION
**Status:** Not implemented. Would highlight cells AFTER clicking Generate (differs from A which is pre-validation).
- Add red border to cells with validation errors
- Show tooltip on hover explaining the issue

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

##### A. Case-Insensitive Matching with Warning (Low Effort) — ⚠️ PENDING
**Status:** Not implemented. Current code uses exact matching only.

**Important consideration:** Oracle reserved keywords (e.g., `sequence`, `type`) must be quoted in SQL as `"sequence"`, `"type"`. Implementation should:
1. Use case-insensitive matching for validation only
2. Preserve original schema case when generating SQL
3. Wrap reserved keywords in double quotes regardless of case

##### B. Trim Whitespace Before Comparison (Low Effort) — ⚠️ PENDING
**Status:** Not implemented. Oracle doesn't allow whitespace in unquoted identifiers, so trimming is safe and fixes Excel copy-paste issues.

##### C. Show Diff Dialog (Medium Effort) — ⚠️ FUTURE CONSIDERATION
**Status:** Not implemented. Good idea for UX improvement.
When mismatch is detected, show a dialog comparing schema columns vs data columns with auto-fix option.

---

### 3. `quota_exceeded` — **PRIORITY 1** ✅ SOLVED

**Volume:** 68 errors | **Users:** 4 | **Devices:** 4  
**Status:** ✅ Solved via IndexedDB migration

#### Root Cause Analysis

**Source:** [`LocalStorageService.js#L77-L88`](file:///Users/mcomacbook/ad-tools-revamp-workspace/patch/frontend/tools/quick-query/services/LocalStorageService.js#L77-L88)

**Why it happened:**
1. localStorage limit is ~5-10MB per origin
2. Users store many large schemas with lots of columns
3. Cached data rows (up to 300 per table) accumulate

#### Resolution — ✅ IMPLEMENTED

##### A. Complete IndexedDB Migration
**Location:** [`IndexedDBStorageService.js#L99-L171`](file:///Users/mcomacbook/ad-tools-revamp-workspace/patch/frontend/tools/quick-query/services/IndexedDBStorageService.js#L99-L171)

IndexedDB migration is fully implemented:
- `_migrateFromLocalStorage()` handles automatic migration on init
- All users are automatically migrated from localStorage to IndexedDB
- IndexedDB has much higher storage limits (~50MB+ depending on browser)

**Evidence:**
```javascript
// IndexedDBStorageService.js#L49
.then(() => this._migrateFromLocalStorage())

// IndexedDBStorageService.js#L110-L155
console.log("[IndexedDB Migration] Starting migration from localStorage...");
// ... migration logic
console.log(`[IndexedDB Migration] Successfully migrated ${migratedCount} tables.`);
```

---

### 4. `minify_worker_failed` / `minify_worker_fallback` — **PRIORITY 1** ✅ SOLVED

**Volume:** 96 + 96 errors | **Users:** 1 | **Devices:** 1  
**Status:** ✅ Solved — regex fallback removed

#### Root Cause Analysis

**Why it was a problem:**
The regex-based fallback (`#minifyHtmlFallback`) could destroy HTML containing `<script>` tags.

#### Resolution — ✅ IMPLEMENTED

**Location:** [`AttachmentProcessorService.js#L150-L162`](file:///Users/mcomacbook/ad-tools-revamp-workspace/patch/frontend/tools/quick-query/services/AttachmentProcessorService.js#L150-L162)

The regex fallback has been removed. When the worker fails, the original HTML is kept intact:

**Evidence:**
```javascript
// AttachmentProcessorService.js#L150-L162
try {
  minified = await this.#minifyHtmlWithWorker(original, tableName);
} catch (err) {
  console.error("HTML Minify Worker failed, keeping original:", err);
  UsageTracker.trackEvent("quick-query", "attachment_error", {
    type: "minify_worker_fallback",
    file: file.name,
    message: err.message,
    table_name: tableName,
  });
  return { file, minifyFailed: true }; // Keep original, no regex fallback
}
```

**Verification:** No `#minifyHtmlFallback` method exists in the codebase (confirmed via grep).

---

### 5. `generate_failed` — **PRIORITY 2** ✅ RESOLVED

**Volume:** 44 errors | **Users:** 10 | **Devices:** 11  
**Status:** ✅ Inactive since 2025-12-17

#### Resolution

This error type no longer appears in the current codebase. Verified via grep search — no `generate_failed` error type exists in any Quick Query service files.

**Likely resolution:**
1. Error was renamed to more specific error types (e.g., `generation_error`)
2. The underlying issue was fixed
3. Error was from legacy code path that was refactored

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

##### A. Real-time Length Indicator in Data Table (Medium Effort) — ⚠️ FUTURE CONSIDERATION
**Status:** Not implemented. Good UX improvement.
When editing a cell, show: `42/50 chars` or `⚠️ 65/50 chars (exceeds limit)`

##### B. Pre-validation with Character Count (Low Effort) — ⚠️ PENDING
**Status:** Not implemented. Would improve error message clarity.

~~##### C. Auto-truncate Option~~ — ❌ REJECTED
**Reason:** User decision — auto-truncate could cause data loss without user awareness.

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

### ✅ Completed
- [x] Better error messages with cell locations for `null_not_allowed` (QueryGenerationService.js)
- [x] Smart defaults for audit fields (created_time, updated_time, created_by, updated_by)
- [x] IndexedDB migration to solve `quota_exceeded`
- [x] Remove regex fallback for minify worker (keeps original on failure)
- [x] `generate_failed` error type removed/refactored

### Phase 1: Quick Wins (Pending)
- [ ] Case-insensitive header matching for `header_fields_missing` (with Oracle keyword handling)
- [ ] Trim whitespace from headers before comparison

### Phase 2: UX Enhancements (Future)
- [ ] Pre-generation validation with cell highlighting
- [ ] Real-time length indicator for VARCHAR fields
- [ ] Column mismatch dialog with auto-fix option
- [ ] Visual indicators (red borders) for validation errors

### Phase 3: Monitoring & Prevention (Ongoing)
- [ ] Add more specific error types for better debugging
- [ ] Include browser/device info in error tracking
- [ ] Create dashboard for error trends

---

## Metrics for Success

| Metric | Current | Target | Status |
|--------|---------|--------|--------|
| `null_not_allowed` errors/week | ~10 | < 2 | ⚠️ Partially mitigated |
| `header_fields_missing` errors/week | ~7 | < 1 | ⚠️ Pending |
| `quota_exceeded` errors/week | ~8 | 0 | ✅ Solved |
| `minify_worker_*` errors/week | ~12 | 0 | ✅ Solved |
| `generate_failed` errors/week | ~3 | 0 | ✅ Resolved |

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
