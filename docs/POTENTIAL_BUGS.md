# Potential Bugs Analysis: Quick Query & Run Query

> **Analysis Date:** January 2025  
> **Last Updated:** January 2025  
> **Scope:** Quick Query and Run Query (Jenkins Query Runner) - the most used features of AD Tools  
> **Severity Scale:** 🔴 Critical | 🟡 Medium | 🟠 Low | ✅ Fixed

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Critical Issues](#critical-issues)
3. [Medium Priority Issues](#medium-priority-issues)
4. [Low Priority Issues](#low-priority-issues)
5. [Recommended Fixes](#recommended-fixes)
6. [Testing Recommendations](#testing-recommendations)

---

## Executive Summary

This document outlines potential bugs discovered in the Quick Query and Run Query features. These two tools are the most frequently used components of AD Tools, making their reliability critical.

### Key Findings

| Severity | Count | Primary Risk Areas |
|----------|-------|-------------------|
| ✅ Fixed | 5 | SQL correctness, Runtime crashes, Race conditions, Type safety |
| 🔴 Critical | 1 | XSS |
| 🟠 Low | 2 | SQL injection, Resource leaks |

### Affected Components

- **Quick Query**: `frontend/tools/quick-query/`
  - `main.js` - Core UI and orchestration
  - `services/QueryGenerationService.js` - SQL generation logic
  - `services/ValueProcessorService.js` - Data type handling
  
- **Run Query**: `frontend/tools/run-query/`
  - `main.js` - Jenkins integration and UI
  - `service.js` - Backend communication

---

## Critical Issues

### 1. ✅ ~~Composite Primary Key WHERE Clause Bug~~ (FIXED)

**Status:** ✅ **FIXED** (January 2025)

**Location:** `frontend/tools/quick-query/services/QueryGenerationService.js`

**Description:**  
When generating SELECT or UPDATE statements with composite primary keys, the previous implementation produced incorrect SQL that matched unintended row combinations.

**Previous Behavior (FIXED):**
```sql
-- Previously generated SQL (INCORRECT)
SELECT * FROM SCHEMA.TABLE 
WHERE pk1 IN ('A', 'B') AND pk2 IN ('1', '2');
-- Matched 4 combinations: (A,1), (A,2), (B,1), (B,2)
```

**Current Behavior (CORRECT):**
```sql
-- Now generates correct tuple-IN syntax
SELECT * FROM SCHEMA.TABLE 
WHERE (pk1, pk2) IN (('A', '1'), ('B', '2'));
-- Matches exactly 2 rows: (A,1), (B,2)
```

**Fix Details:**
- Added `_buildCompositePkWhereClause()` helper method
- Modified `generateSelectStatement()` to collect PK tuples per row
- Modified `generateUpdateStatement()` to collect PK tuples per row
- Single PK still uses simple `IN (...)` syntax for efficiency
- Composite PKs now use Oracle tuple-IN syntax `(pk1, pk2) IN ((v1, v2), ...)`

**Affected Methods (Updated):**
- `generateSelectStatement()`
- `generateUpdateStatement()`
- `_buildCompositePkWhereClause()` (new)

**Code Reference (Fixed Implementation):**
```javascript
// New helper method (QueryGenerationService.js)
_buildCompositePkWhereClause(primaryKeys, pkTuples) {
  if (pkTuples.length === 0) return "1=0";
  const formattedPkNames = primaryKeys.map((pk) => this.formatFieldName(pk));

  if (primaryKeys.length === 1) {
    // Single PK: use simple IN clause
    const values = pkTuples.map((tuple) => tuple[0]);
    return `${formattedPkNames[0]} IN (${values.join(", ")})`;
  }

  // Composite PK: use tuple-IN syntax
  const tupleStrings = pkTuples.map((tuple) => `(${tuple.join(", ")})`);
  return `(${formattedPkNames.join(", ")}) IN (${tupleStrings.join(", ")})`;
}
```

---

### 2. 🔴 XSS Vulnerability via innerHTML

**Location:** `frontend/tools/run-query/main.js#L626`

**Description:**  
Jenkins environment choices are rendered using `innerHTML` without sanitization. If Jenkins returns malicious content (or the response is compromised), this becomes an XSS vector.

**Vulnerable Code:**
```javascript
// run-query/main.js
envSelect.innerHTML = this.state.envChoices
  .map((c) => `<option value="${c}">${c}</option>`)
  .join("");
```

**Attack Vector:**
If `envChoices` contains: `<img src=x onerror=alert(1)>`

**Impact:**
- In Tauri desktop context, XSS can escalate to calling backend `invoke` commands
- Potential for credential theft or destructive actions
- Complete compromise of user session

**Other Affected Areas:**
- Template list rendering (`templateListEl.innerHTML`)
- History table rendering (`historyList.innerHTML`)
- Warning/error message panels with HTML content
- Duplicate PK warnings using `<br>` tags

---

### 3. ✅ ~~Crash on Missing Schema Field~~ (FIXED)

**Status:** ✅ **FIXED** (January 2025)

**Location:** `frontend/tools/quick-query/services/QueryGenerationService.js`

**Description:**  
When a column exists in the data sheet but not in the schema definition, the code previously attempted to destructure `undefined`, causing an unhandled exception.

**Previous Behavior (FIXED):**
```javascript
// QueryGenerationService.js - generateQuery()
return fieldNames.map((fieldName, colIndex) => {
  const schemaRow = schemaMap.get(fieldName);
  // schemaRow can be undefined if field doesn't exist in schema!
  const [, dataType, nullable] = schemaRow; // 💥 CRASH
  // ...
});
```

**Current Behavior (CORRECT):**
```javascript
// Now validates schema row exists before destructuring
const schemaRow = schemaMap.get(fieldName);

if (!schemaRow) {
  const columnLetter = this.columnIndexToLetter(colIndex);
  throw new Error(
    `Column "${fieldName}" (column ${columnLetter}) exists in data but not in schema definition. ` +
    `Please add this field to the schema or remove it from the data.`
  );
}

const [, dataType, nullable] = schemaRow;
```

**Fix Details:**
- Added null check before destructuring `schemaRow`
- Provides clear, actionable error message with column letter reference
- User can now understand exactly which field is missing from schema

---

## Medium Priority Issues

### 4. ✅ ~~Invalid MERGE SQL with Empty UPDATE Fields~~ (FIXED)

**Status:** ✅ **FIXED** (January 2025)

**Location:** `frontend/tools/quick-query/services/QueryGenerationService.js`

**Description:**  
When all non-PK fields are either `created_time`, `created_by`, or primary keys, the MERGE statement previously generated an invalid `UPDATE SET` clause with no fields.

**Previous Behavior (FIXED):**
```sql
MERGE INTO SCHEMA.TABLE tgt
USING (SELECT ... FROM DUAL) src
ON (tgt.ID = src.ID)
WHEN MATCHED THEN UPDATE SET
  -- Empty! Invalid SQL syntax
WHEN NOT MATCHED THEN INSERT (...)
VALUES (...);
```

**Current Behavior (CORRECT):**
```sql
-- Now omits WHEN MATCHED clause entirely if no updateable fields
MERGE INTO SCHEMA.TABLE tgt
USING (SELECT ... FROM DUAL) src
ON (tgt.ID = src.ID)
WHEN NOT MATCHED THEN INSERT (...)
VALUES (...);
```

**Additional Fix - updated_time Assumption:**
- Previously assumed all tables have `updated_time` field
- Now checks if `updated_time`/`updated_by` exist in schema before referencing
- SELECT statements no longer include ORDER BY or time-based queries for tables without these fields

**Fix Details:**
- `generateMergeStatement()`: Only includes `WHEN MATCHED` clause if updateable fields exist
- `generateUpdateStatement()`: Only adds audit fields to SELECT if they exist in schema
- `generateSelectStatement()`: Conditionally includes `updated_time` in ORDER BY and verification queries

---

### 5. ✅ ~~Race Conditions in Async Operations~~ (FIXED)

**Status:** ✅ **FIXED** (January 2025)

**Location:** `frontend/tools/quick-query/main.js`

**Description:**  
Multiple async operations (query generation) previously lacked request ID gating. Stale results from earlier requests could overwrite newer UI state.

**Previous Scenario (FIXED):**
1. User clicks "Generate Query" with Dataset A
2. Before completion, user changes data to Dataset B and clicks again
3. Dataset A's result (slower) completes last and overwrites Dataset B's result

**Current Behavior (CORRECT):**
```javascript
// Now uses request ID gating to discard stale results
this._genReqId = (this._genReqId || 0) + 1;
const currentReqId = this._genReqId;

const result = await this.queryWorkerService.generateQuery(...);

// Guard against stale results
if (currentReqId !== this._genReqId) {
  console.log("[QuickQuery] Discarding stale generation result");
  return;
}

this.editor.setValue(result.sql);
```

**Fix Details:**
- Added `_genReqId` counter to track generation requests
- Progress updates only apply if request is still current
- Results discarded if a newer request was initiated
- Error handling also checks for stale requests

---

### 6. ✅ ~~Type Coercion Crash on Non-String Values~~ (FIXED)

**Status:** ✅ **FIXED** (January 2025)

**Location:** `frontend/tools/quick-query/services/ValueProcessorService.js`

**Description:**  
Several methods previously called `.toLowerCase()` on values without first ensuring they are strings. Spreadsheet cells can contain numbers, booleans, or other types.

**Previous Behavior (FIXED):**
```javascript
// Would crash if value is a number (e.g., 123)
const isExplicitNull = value?.toLowerCase() === "null";
```

**Current Behavior (CORRECT):**
```javascript
// Now safely converts to string first
_toString(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

const strValue = this._toString(value);
const isExplicitNull = strValue.toLowerCase() === "null";
```

**Fix Details:**
- Added `_toString()` helper method for safe string conversion
- All string operations now use `strValue` instead of raw `value`
- Handles numbers, booleans, and other types from spreadsheet cells
- Consistent behavior regardless of input data type

---

## Low Priority Issues

### 7. 🟠 SQL Injection via Identifier Names

**Location:** `frontend/tools/quick-query/services/QueryGenerationService.js` (multiple methods)

**Description:**  
Table names and column names are interpolated directly into SQL without validation. While value escaping is implemented, identifier injection remains possible.

**Current Code:**
```javascript
// Table name used directly
return `INSERT INTO ${tableName} (${fields.join(", ")}) ...`;

// formatFieldName only handles reserved words, not injection
formatFieldName(fieldName) {
  if (fieldName === fieldName.toLowerCase()) {
    return oracleReservedWords.has(fieldName.toLowerCase()) 
      ? `"${fieldName.toLowerCase()}"` 
      : fieldName;
  }
  return fieldName.toLowerCase();
}
```

**Attack Vector:**
If table name contains: `SCHEMA.TABLE; DROP TABLE USERS; --`

**Mitigation:**
Validate identifiers against Oracle naming rules:
- Characters: `[A-Za-z][A-Za-z0-9_$#]*`
- Maximum length: 128 characters
- No semicolons, quotes, or whitespace

---

### 8. 🟠 Resource Leaks on Component Unmount

**Location:** 
- `frontend/tools/run-query/main.js`
- `frontend/tools/quick-query/main.js`

**Description:**  
When navigating away from these tools, various resources may not be properly cleaned up:

**Leaked Resources:**
- Web Workers (`QueryWorkerService`, `SplitWorkerService`)
- Tauri event listeners (`this._logUnsubscribes`)
- DOM event listeners (sidebar, resize, document click)
- Polling timeouts (queue polling, env refresh retries)
- Monaco editor instances

**Evidence:**
```javascript
// run-query/main.js - listeners stored but cleanup not guaranteed
this._sidebarUnsubs = [];
this._logUnsubscribes = [];

// No onUnmount() implementation visible in BaseTool usage
```

**Impact:**
- Memory usage grows over time with repeated navigation
- Potential for duplicate event handlers
- Stale listeners may cause unexpected behavior

---

## Recommended Fixes

### Priority 1: Critical Fixes (Immediate)

#### Fix 1.1: Composite Primary Key WHERE Clause

```javascript
// QueryGenerationService.js - generateSelectStatement()
generateSelectStatement(tableName, primaryKeys, processedRows) {
  // ... existing validation ...

  // Collect PK value tuples per row
  const pkTuples = [];
  processedRows.forEach((row) => {
    const tuple = primaryKeys.map(pk => {
      const field = row.find(f => f.fieldName === pk);
      return field?.formattedValue || 'NULL';
    });
    // Only include if all PKs have values
    if (!tuple.includes('NULL')) {
      pkTuples.push(`(${tuple.join(', ')})`);
    }
  });

  if (pkTuples.length === 0) return null;

  // Use tuple-IN for composite keys
  const pkColumns = primaryKeys.map(pk => this.formatFieldName(pk)).join(', ');
  const whereClause = primaryKeys.length === 1
    ? `${pkColumns} IN (${pkTuples.map(t => t.slice(1, -1)).join(', ')})`
    : `(${pkColumns}) IN (${pkTuples.join(', ')})`;

  return `\nSELECT * FROM ${tableName} WHERE ${whereClause};`;
}
```

#### Fix 1.2: XSS Prevention

```javascript
// run-query/main.js - Safe DOM rendering
const refreshEnvChoices = async (retry = 0) => {
  // ... existing code ...
  
  // SAFE: Use DOM APIs instead of innerHTML
  envSelect.replaceChildren(
    ...this.state.envChoices.map(c => {
      const option = document.createElement('option');
      option.value = c;
      option.textContent = c; // Safe text content
      return option;
    })
  );
  
  // ... rest of function ...
};
```

#### Fix 1.3: Schema Field Validation

```javascript
// QueryGenerationService.js - generateQuery()
return fieldNames.map((fieldName, colIndex) => {
  const schemaRow = schemaMap.get(fieldName);
  
  // Add null check with descriptive error
  if (!schemaRow) {
    throw new Error(
      `Column "${fieldName}" exists in data but not in schema definition. ` +
      `Please add this field to the schema or remove it from the data.`
    );
  }
  
  const [, dataType, nullable] = schemaRow;
  // ... rest of processing ...
});
```

### Priority 2: Medium Fixes (This Sprint)

#### Fix 2.1: Empty UPDATE SET Prevention

```javascript
// QueryGenerationService.js - generateMergeStatement()
generateMergeStatement(tableName, processedFields, primaryKeys) {
  // ... existing code ...

  const updateFields = processedFields
    .filter((f) => !primaryKeys.includes(f.fieldName) && 
                   !["created_time", "created_by"].includes(String(f.fieldName).toLowerCase()))
    .map((f) => `  tgt.${this.formatFieldName(f.fieldName)} = src.${this.formatFieldName(f.fieldName)}`)
    .join(",\n");

  // Handle empty update fields
  if (!updateFields.trim()) {
    // Generate INSERT-only MERGE (skip WHEN MATCHED clause)
    let mergeStatement = `MERGE INTO ${tableName} tgt`;
    mergeStatement += `\nUSING (SELECT${selectFields}\n  FROM DUAL) src`;
    mergeStatement += `\nON (${pkConditions})`;
    mergeStatement += `\nWHEN NOT MATCHED THEN INSERT (${insertFields})\nVALUES (${insertValues});`;
    return mergeStatement;
  }

  // ... existing MERGE with UPDATE ...
}
```

#### Fix 2.2: Request ID Gating for Async Operations

```javascript
// quick-query/main.js
async _generateQueryAsync(tableName, queryType, schemaData, inputData) {
  // Increment and capture request ID
  this._genReqId = (this._genReqId || 0) + 1;
  const currentReqId = this._genReqId;

  try {
    this.isGenerating = true;
    this._showProgress(`Processing ${rowCount.toLocaleString()} rows...`, 0);

    const result = await this.queryWorkerService.generateQuery(
      tableName, queryType, schemaData, inputData, this.processedFiles,
      (percent, message) => {
        // Check if still current request before updating UI
        if (currentReqId === this._genReqId) {
          this._updateProgress(message, percent);
        }
      }
    );

    // Guard against stale results
    if (currentReqId !== this._genReqId) {
      console.log('Discarding stale generation result');
      return;
    }

    this._hideProgress();
    this.isGenerating = false;
    this.editor.setValue(result.sql);
    // ... rest of success handling ...
    
  } catch (error) {
    // Only handle if still current request
    if (currentReqId !== this._genReqId) return;
    
    this._hideProgress();
    this.isGenerating = false;
    // ... error handling ...
  }
}
```

#### Fix 2.3: Type-Safe String Operations

```javascript
// ValueProcessorService.js - Add helper and use consistently
_toString(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

processValue(value, dataType, nullable, fieldName, tableName, queryType = null) {
  // ... existing code ...

  const stringValue = this._toString(value);
  const isExplicitNull = stringValue.toLowerCase() === "null";

  // Use stringValue throughout instead of raw value for string operations
  if (upperDataType.startsWith("VARCHAR") && stringValue.toLowerCase() === "uuid") {
    // ...
  }
}
```

### Priority 3: Low Fixes (Backlog)

#### Fix 3.1: Identifier Validation

```javascript
// Add to QueryGenerationService.js
validateOracleIdentifier(name, type = 'identifier') {
  if (!name || typeof name !== 'string') {
    throw new Error(`Invalid ${type}: must be a non-empty string`);
  }
  
  // Oracle identifier rules
  const pattern = /^[A-Za-z][A-Za-z0-9_$#]{0,127}$/;
  
  // For qualified names (schema.table), validate each part
  if (name.includes('.')) {
    const parts = name.split('.');
    if (parts.length !== 2) {
      throw new Error(`Invalid ${type}: "${name}" must be in format SCHEMA.TABLE`);
    }
    parts.forEach((part, i) => {
      if (!pattern.test(part)) {
        throw new Error(`Invalid ${type}: "${part}" contains invalid characters`);
      }
    });
    return true;
  }
  
  if (!pattern.test(name)) {
    throw new Error(`Invalid ${type}: "${name}" contains invalid characters`);
  }
  return true;
}

// Use in generateQuery()
generateQuery(tableName, queryType, schemaData, inputData, attachments) {
  this.validateOracleIdentifier(tableName, 'table name');
  // ... rest of method ...
}
```

#### Fix 3.2: Resource Cleanup on Unmount

```javascript
// quick-query/main.js - Add cleanup method
destroy() {
  // Terminate workers
  this.queryWorkerService?.terminate();
  this.splitWorkerService?.terminate();
  
  // Dispose Monaco editor
  this.editor?.dispose();
  
  // Clear any pending timers
  clearTimeout(this._layoutScheduled);
}

// run-query/main.js - Add cleanup method
onUnmount() {
  // Clear log listeners
  this._logUnsubscribes.forEach(unsub => {
    try { unsub(); } catch (_) {}
  });
  this._logUnsubscribes = [];
  
  // Clear sidebar listeners
  this._sidebarUnsubs.forEach(unsub => {
    try { unsub(); } catch (_) {}
  });
  
  // Remove DOM listeners
  document.removeEventListener('sidebarStateChange', this._sidebarDomListener);
  window.removeEventListener('resize', this._resizeListener);
  
  // Dispose Monaco editors
  this.editor?.dispose();
  this.templateEditor?.dispose();
  this.splitEditor?.dispose();
}
```

---

## Testing Recommendations

### Unit Tests Required

1. **Composite Primary Key Tests**
   - Single PK with multiple rows
   - Composite PK (2 columns) with multiple rows
   - Composite PK (3+ columns) with multiple rows
   - Mixed NULL values in PKs

2. **Edge Case Tests**
   - Empty schema data
   - Mismatched schema/data columns
   - Only PK and audit fields (no updateable fields)
   - Numeric values in string operations

3. **XSS Prevention Tests**
   - Special characters in env names: `<script>`, `"onclick=`, etc.
   - Unicode in template names
   - HTML in SQL content

### Integration Tests Required

1. **Async Race Condition Tests**
   - Rapid successive generate requests
   - Cancel during generation
   - Navigation during async operation

2. **Resource Cleanup Tests**
   - Verify no listeners after unmount
   - Verify workers terminated
   - Memory usage after repeated navigation

---

## Appendix: File References

| File | Lines of Interest | Issue |
|------|-------------------|-------|
| `frontend/tools/quick-query/services/QueryGenerationService.js` | 352-358, 246-260, 167-170 | Composite PK, Empty UPDATE, Crash |
| `frontend/tools/quick-query/services/ValueProcessorService.js` | 27, 57, 63, 130 | Type coercion |
| `frontend/tools/quick-query/main.js` | 641-683 | Race conditions |
| `frontend/tools/run-query/main.js` | 626, 1301-1348 | XSS via innerHTML |
| `frontend/tools/run-query/service.js` | 32-42 | Env choices source |

---

*Document generated by AD Tools code analysis. Last updated: January 2025*
