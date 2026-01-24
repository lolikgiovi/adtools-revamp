# Plan: Unified Compare Config Revamp

## Overview

Transform the Unified Compare Config into the sole UI for all comparison modes (Oracle vs Oracle, Oracle vs Excel, Excel vs Excel). The goal is to perfect the Unified view with improved UX based on the source type combinations selected.

## Current State Analysis

### Existing Components
- **Unified Compare Mode**: Basic dual-source panel with Oracle/Excel selection
- **Excel Compare Mode**: Full-featured file upload with folder support, searchable dropdowns, IndexedDB caching
- **Schema/Table Mode**: Oracle connection with schema/table selection
- **Raw SQL Mode**: Oracle connection with custom SQL queries

### Key Libraries to Reuse
- `lib/indexed-db-manager.js` - File caching
- `lib/file-parser.js` - Excel/CSV parsing
- `lib/file-matcher.js` - Auto-matching files
- `lib/unified-data-service.js` - Data fetching abstraction
- `lib/diff-engine.js` - Comparison logic

---

## Implementation Plan

### Phase 1: Oracle vs Oracle Mode Improvements ✅ COMPLETED

> **Implementation Date**: 2026-01-24
>
> **Files Modified**:
> - `lib/unified-compare-utils.js` (NEW) - Core business logic utilities
> - `tests/unified-compare-utils.test.js` (NEW) - 44 unit tests
> - `main.js` - Updated with follow mode logic
> - `template.js` - Added follow mode note element
> - `styles.css` - Added follow mode styling

#### 1.1 Source B Oracle Config Auto-Sync ✅
**Implementation**:
- Created `updateSourceBFollowModeUI()` method that detects Oracle vs Oracle mode
- Uses `isSourceBFollowMode()` utility to check if both sources are Oracle
- Hides Query Mode, Schema, Table, WHERE, Max Rows, SQL in Source B
- Shows follow mode note: "Other options will follow Source A configuration"
- Added CSS styling for disabled fields with `.disabled-follow-mode` class

#### 1.2 Pre-Load Validation for Oracle vs Oracle ✅
**Implementation**:
- Created `validateOracleTableExistsInSourceB()` method
- Uses `validateOracleToOracleConfig()` utility for early validation
- Validates schema.table exists in Source B before loading data
- Shows clear error message if table doesn't exist
- Updated `loadUnifiedData()` to call validation first
- Updated `fetchUnifiedSourceData()` to use `createSourceBConfigFromSourceA()` for Source B

#### 1.3 Primary Key Auto-Select for Comparison Fields ✅
**Implementation**:
- Created `syncPkFieldsToCompareFields()` utility function (pure, testable)
- Updated PK checkbox event handler to auto-sync PKs to compare fields
- Updated "Select All PK" button to also trigger auto-sync
- Re-renders field selection UI to show updated checkboxes
- 44 unit tests covering all utility functions

---

### Phase 2: Mixed Mode (Oracle vs Excel / Excel vs Oracle) ✅ COMPLETED

> **Implementation Date**: 2026-01-24
>
> **Files Modified**:
> - `template.js` - Enhanced Excel config sections for both sources
> - `main.js` - Multi-file upload handlers, searchable dropdown, IndexedDB caching, restore on init
> - `styles.css` - Added `.file-selection-dropdown` styles
> - `lib/indexed-db-manager.js` - Added `UNIFIED_EXCEL_FILES` store (DB_VERSION 3)

The enhanced Excel config applies to **any source set to Excel**, whether Source A or Source B. This phase covers both:
- **Oracle vs Excel**: Source A = Oracle, Source B = Excel
- **Excel vs Oracle**: Source A = Excel, Source B = Oracle

| Mode | Source A | Source B |
|------|----------|----------|
| Oracle vs Oracle | Full Oracle config | Connection only (follows A) |
| Oracle vs Excel | Full Oracle config | Enhanced Excel upload |
| Excel vs Oracle | Enhanced Excel upload | Full Oracle config |
| Excel vs Excel | Enhanced Excel upload | Enhanced Excel upload |

#### 2.1 Enhanced Excel Config (for Any Source) ✅
**Implementation**:
- Replaced simple file input with full Excel selection UI for both sources
- Template structure with IDs using pattern: `source-{a|b}-*`
- Components: upload zone, file list, searchable dropdown, clear all button

**Template Structure** (implemented for both `source-a` and `source-b`):
```html
<div class="excel-config" id="source-{x}-excel-config" style="display: none;">
    <div class="file-upload-zone compact" id="source-{x}-upload-zone">
        <div class="upload-zone-header">
            <span class="zone-label">Excel Files</span>
            <button class="btn btn-ghost btn-xs btn-clear-files" id="source-{x}-clear-all">
                Clear All
            </button>
        </div>
        <div class="upload-area">
            <p>Click to <a href="#" class="browse-link" id="source-{x}-browse-files">browse files</a>
               or <a href="#" class="browse-link" id="source-{x}-browse-folder">select folder</a></p>
            <p class="file-types">Supports .xlsx, .xls, .csv</p>
        </div>
        <input type="file" id="source-{x}-file-input" multiple accept=".xlsx,.xls,.csv" style="display: none;">
        <input type="file" id="source-{x}-folder-input" webkitdirectory style="display: none;">
        <div class="file-list" id="source-{x}-file-list"></div>
    </div>
    <div class="file-selection-dropdown" id="source-{x}-file-selection" style="display: none;">
        <label>Select File to Compare</label>
        <div class="searchable-select" id="source-{x}-file-wrapper">
            <input type="text" class="form-input searchable-input"
                   id="source-{x}-file-search" placeholder="Search or select file..." autocomplete="off">
            <div class="searchable-dropdown" id="source-{x}-file-dropdown"></div>
        </div>
    </div>
</div>
```

#### 2.2 Multi-File Upload Support (Symmetric for Both Sources) ✅
**Implementation**:

1. **State Management** - Added to `this.unified.sourceA` and `this.unified.sourceB`:
   ```javascript
   excelFiles: [],           // Array of {id, file}
   selectedExcelFile: null,  // Selected {id, file} for comparison
   ```

2. **File Upload Handlers**:
   - `bindUnifiedExcelConfigEvents()` - binds browse files/folder links and inputs
   - `handleUnifiedExcelFileSelection(sourceKey, files)` - handles multi-file selection with IndexedDB caching
   - `_handleUnifiedFileBrowseTauri(source, isFolder)` - Tauri file/folder selection dialog
   - `_scanFolderForExcelFiles(folderPath, readDir, readFile, files)` - recursive folder scanning
   - `clearUnifiedExcelFiles(sourceKey)` - clear all files from a source (with IndexedDB cleanup)
   - `removeUnifiedExcelFile(sourceKey, fileId)` - remove single file (with IndexedDB cleanup)

3. **UI Update Functions**:
   - `updateUnifiedExcelUI(sourceKey)` - updates file list, dropdown visibility, clear button
   - `setupUnifiedExcelFileDropdown(sourceKey)` - searchable dropdown with keyboard navigation (ArrowUp/Down/Enter/Escape)
   - `selectUnifiedExcelFile(sourceKey, fileId)` - select file for comparison, clears parsedData

4. **Data Loading Updates**:
   - `isUnifiedSourceConfigured()` - updated to check `selectedExcelFile` instead of `file`
   - `fetchUnifiedSourceData()` - updated to use `selectedExcelFile.file`

5. **IndexedDB Integration**:
   - Files cached automatically on upload via `IndexedDBManager.saveUnifiedExcelFile()`
   - Files restored on init via `restoreCachedUnifiedExcelFiles()`
   - Helper: `_getMimeType(filename)` for MIME type detection

#### 2.3 Pre-Load Validation for Mixed Mode (Oracle + Excel) ✅
**Implementation**:
- Created `isMixedMode()` utility to detect Oracle+Excel or Excel+Oracle modes
- Created `findCommonFields()` utility for case-insensitive field matching
- Created `validateMixedModeConfig()` utility that validates:
  - Both sources have headers available
  - At least one common field exists between sources
  - Returns warning if significant mismatch (>50% fields don't match)
- Updated `loadUnifiedData()` to call validation after both sources loaded
- Shows error if no common fields, warning if significant mismatch
- 24 new unit tests covering all new utility functions

---

### Phase 3: Excel vs Excel Mode (Leverages Phase 2) ✅ COMPLETED

Since Phase 2 implements **symmetric** Excel upload for both Source A and Source B, the Excel vs Excel mode is automatically supported.

#### 3.1 Excel vs Excel Specific Behavior ✅
**Implementation** (automatic via Phase 2):
- When both sources are Excel, no special "follow" mode is needed (unlike Oracle vs Oracle)
- Both sources independently select their files
- Validation ensures at least some common fields exist between the two Excel files

#### 3.2 IndexedDB Store Configuration ✅
**Implementation** (completed as part of Phase 2):
- Added `UNIFIED_EXCEL_FILES` store with `source` index
- Incremented DB_VERSION to 3
- Implemented helper methods:
  - `saveUnifiedExcelFile(fileData)` - save file with source field
  - `getUnifiedExcelFile(id)` - get single file
  - `getUnifiedExcelFiles(source)` - get files for specific source
  - `getAllUnifiedExcelFiles()` - get all files
  - `deleteUnifiedExcelFile(id)` - remove single file
  - `clearUnifiedExcelFiles(source)` - clear files for a source
  - `clearAllUnifiedExcelFiles()` - clear all files
- Updated `clearAllData()` and `getStorageStats()` to include new store

---

### Phase 4: New Comparison Reset Behavior ✅ COMPLETED

> **Implementation Date**: 2026-01-24
>
> **Files Modified**:
> - `lib/unified-compare-utils.js` - Added reset behavior utilities
> - `tests/unified-compare-utils.test.js` - Added 19 new unit tests
> - `main.js` - Added `handleUnifiedNewComparison()` and `resetUnifiedSourceUI()` methods

#### 4.1 Reset Logic Based on Source Types ✅
**Implementation**:
1. Created `handleUnifiedNewComparison()` method that:
   - Clears results and hides results section
   - Hides field reconciliation UI
   - Resets field selections (PK and compare fields)
   - Resets field reconciliation state
   - Uses `createResetSourceState()` utility for source-specific resets
   - Calls `resetUnifiedSourceUI()` to reset UI elements
   - Updates button states

2. Created utility functions in `unified-compare-utils.js`:
   - `getResetBehaviorForSourceType(sourceType)` - Determines reset behavior by type
   - `createResetSourceState(sourceType, existingExcelFiles)` - Creates reset state object
   - `canStartUnifiedComparison(unified)` - Validates if comparison can start

3. For Excel sources:
   - `keepCachedFiles: true` - Preserves files in IndexedDB and state
   - File list remains visible in UI
   - Only clears `selectedExcelFile` and data preview
   - User must click "Clear All" to remove cached files

4. For Oracle sources:
   - `clearConnection: true` - Resets connection selection
   - Resets schema, table, SQL, WHERE clause to defaults
   - Clears all form fields to initial state

5. Updated `resetForm()` to delegate to `handleUnifiedNewComparison()` when in unified mode

---

### Phase 5: UI/UX Polish

#### 5.1 Visual Feedback for Mode Detection ✅
**Status**: COMPLETED

> **Implementation Date**: 2026-01-24
>
> **Files Modified**:
> - `template.js` - Updated follow mode note to styled badge with link icon
> - `styles.css` - Added follow-mode-badge styles, panel indicator, PK auto-add animations
> - `main.js` - Added follow-mode-active class to panel, animation tracking for PK sync
> - `lib/unified-compare-utils.js` - Added `syncPkFieldsWithTracking()` utility
> - `tests/unified-compare-utils.test.js` - Added 8 new tests (95 total)

**Implementation**:
1. **Follow Mode Badge** (Oracle vs Oracle):
   - Replaced plain text note with styled badge showing link icon + "Following Source A"
   - Badge has primary color background, subtle border, fade-in animation
   - Source B panel gets `follow-mode-active` class with animated left border indicator

2. **PK to Compare Field Animation**:
   - Created `syncPkFieldsWithTracking()` utility that returns both updated fields and newly added fields
   - Compare field chips get `pk-auto-added` class for pulse animation when auto-synced from PK
   - Checkboxes get `pk-synced` class for box-shadow pulse effect
   - Animation clears after 600ms to allow re-triggering

#### 5.2 Loading States ✅
**Status**: COMPLETED

> **Implementation Date**: 2026-01-24
>
> **Files Modified**:
> - `template.js` - Added unified progress overlay with 4 dynamic steps
> - `main.js` - Added `showUnifiedProgress()`, `hideUnifiedProgress()`, `updateUnifiedProgressStep()`, `resetUnifiedProgressSteps()`, `showUnifiedUploadLoading()`, `hideUnifiedUploadLoading()`
> - `styles.css` - Added `.file-upload-zone.uploading` and `.upload-loading-indicator` styles
> - `lib/unified-compare-utils.js` - Added `getUnifiedProgressSteps()`, `getVisibleStepsForMode()`, `getStepLabel()`
> - `tests/unified-compare-utils.test.js` - Added 17 new tests (112 total)

**Implementation**:
1. **Unified Progress Overlay**:
   - Created dedicated progress overlay (`#unified-progress-overlay`) with 4 steps
   - Step visibility is dynamic based on comparison mode
   - "Validating Source B" step only shown for Oracle vs Oracle mode
   - Each step shows state (pending/active/done/error) with detail text

2. **File Upload Loading States**:
   - Added `.uploading` class to upload zone during multi-file processing
   - Shows spinner with progress text (e.g., "Caching files (3/10)...")
   - Folder scanning in Tauri shows "Scanning folder..." loading state

3. **Utility Functions**:
   - `getUnifiedProgressSteps()` - Returns step definitions
   - `getVisibleStepsForMode()` - Returns which steps to show based on mode
   - `getStepLabel()` - Gets label for a step ID

#### 5.3 Error Handling Improvements ✅
**Status**: COMPLETED

> **Implementation Date**: 2026-01-24
>
> **Files Modified**:
> - `lib/unified-compare-utils.js` - Added error handling utilities
> - `tests/unified-compare-utils.test.js` - Added 36 new tests (148 total)
> - `main.js` - Added error banner methods, updated error handling
> - `template.js` - Added inline validation and error banner elements
> - `styles.css` - Added inline-validation and unified-error-banner styles

**Implementation**:
1. **Actionable Error Messages**:
   - Created `UnifiedErrorType` enum for categorizing errors
   - Created `getActionableErrorMessage()` utility that returns title, message, and actionable hint
   - Supports: TABLE_NOT_FOUND, SCHEMA_NOT_FOUND, CONNECTION_FAILED, NO_COMMON_FIELDS, NO_DATA, FILE_PARSE_ERROR, VALIDATION_ERROR
   - Created `parseOracleError()` to convert Oracle error codes (ORA-xxxxx) to user-friendly messages
   - Created `formatFieldList()` for displaying field lists with truncation

2. **Inline Validation UI**:
   - Added inline validation message elements to both source panels
   - Created `validateSourceConfig()` utility to determine validation state
   - Added `showUnifiedSourceValidation()` / `hideUnifiedSourceValidation()` methods
   - Shows info/warning/error states with appropriate styling

3. **Error Banner**:
   - Added unified error banner between source panels and Load button
   - Shows title, detailed message, and actionable hint
   - Supports error and warning variants
   - Dismissible with X button
   - Auto-hides when starting new data load

4. **Improved Error Flow**:
   - Table not found in Source B → Shows banner with table name and hint to verify/change connection
   - Schema not accessible → Shows banner with Oracle error details
   - No common fields → Shows banner with field lists from both sources
   - Field mismatch warning → Shows warning banner instead of toast
   - Generic errors → Parsed for Oracle codes, shown with friendly messages

---

## File Changes Summary

| File | Changes |
|------|---------|
| `template.js` | Enhanced Excel config sections for both sources, follow mode badge, unified progress overlay, inline validation elements, error banner |
| `main.js` | Multi-file upload handlers, searchable dropdown, IndexedDB caching, Oracle follow mode, PK auto-select with animation, `handleUnifiedNewComparison()`, `resetUnifiedSourceUI()`, unified progress methods, upload loading states, error banner methods |
| `styles.css` | Styles for enhanced Excel upload, disabled states, file-selection-dropdown, follow-mode-badge, PK auto-add animations, upload loading indicator, inline-validation, unified-error-banner |
| `lib/indexed-db-manager.js` | New `UNIFIED_EXCEL_FILES` store with helper methods |
| `lib/unified-compare-utils.js` | Core business logic utilities including reset behavior, progress steps, error handling utilities (UnifiedErrorType, getActionableErrorMessage, parseOracleError, validateSourceConfig, formatFieldList) |
| `tests/unified-compare-utils.test.js` | 148 unit tests |

---

## Implementation Order

1. ~~**Phase 1.3** - PK auto-select for comparison fields (quick win, isolated change)~~ ✅ DONE
2. ~~**Phase 4.1** - New Comparison reset logic (foundation for all modes)~~ ✅ DONE
3. ~~**Phase 1.1 & 1.2** - Oracle vs Oracle improvements (Source B follows A)~~ ✅ DONE
4. ~~**Phase 2.1 & 2.2** - Enhanced Excel upload (symmetric for both sources)~~ ✅ DONE
5. ~~**Phase 2.3** - Mixed mode validation (Oracle + Excel field matching)~~ ✅ DONE
6. ~~**Phase 3.2** - IndexedDB store for unified Excel files~~ ✅ DONE (part of Phase 2)
7. **Phase 5** - UI/UX polish

---

## Testing Checklist

### Unit Tests (Phase 1, 2.3, 4 & 5) ✅
- [x] `getComparisonMode()` - 7 tests
- [x] `isSourceBFollowMode()` - 6 tests
- [x] `syncPkFieldsToCompareFields()` - 9 tests
- [x] `validateOracleToOracleConfig()` - 10 tests
- [x] `createSourceBConfigFromSourceA()` - 3 tests
- [x] `getSourceBDisabledFieldsForFollowMode()` - 2 tests
- [x] `validateFieldSelection()` - 7 tests
- [x] `isMixedMode()` - 6 tests
- [x] `findCommonFields()` - 7 tests
- [x] `validateMixedModeConfig()` - 11 tests
- [x] `getResetBehaviorForSourceType()` - 5 tests
- [x] `createResetSourceState()` - 8 tests
- [x] `canStartUnifiedComparison()` - 6 tests
- [x] `syncPkFieldsWithTracking()` - 8 tests
- [x] `getUnifiedProgressSteps()` - 4 tests
- [x] `getVisibleStepsForMode()` - 5 tests
- [x] `getStepLabel()` - 6 tests
- [x] `UnifiedErrorType` - 4 tests
- [x] `getActionableErrorMessage()` - 9 tests
- [x] `formatFieldList()` - 6 tests
- [x] `validateSourceConfig()` - 12 tests
- [x] `parseOracleError()` - 9 tests

**Total: 148 unit tests passing**

### Oracle vs Oracle (Manual Testing)
- [ ] Source B shows only Connection when both sources are Oracle
- [ ] Helper text appears explaining "follow" mode
- [ ] Validation catches missing table in Source B before load
- [ ] Data loads successfully when table exists in both
- [ ] Primary Key selection auto-adds to Compare Fields
- [ ] New Comparison resets Oracle configs properly

### Oracle vs Excel (Source A = Oracle, Source B = Excel)
- [ ] Source A shows full Oracle config
- [ ] Source B shows enhanced Excel upload
- [ ] Can upload single file to Source B
- [ ] Can upload multiple files to Source B
- [ ] Can select folder (Tauri) for Source B
- [ ] Can select folder (Web) for Source B
- [ ] File selection dropdown appears when multiple files
- [ ] Auto-selects when only 1 file uploaded
- [ ] **Validation shows error if no common fields between Oracle and Excel** (Phase 2.3)
- [ ] **Validation shows warning if significant field mismatch (>50%)** (Phase 2.3)
- [ ] Files persist in IndexedDB across sessions
- [ ] New Comparison keeps cached files, clears selection

### Excel vs Oracle (Source A = Excel, Source B = Oracle)
- [ ] Source A shows enhanced Excel upload
- [ ] Source B shows full Oracle config
- [ ] Can upload single/multiple files to Source A
- [ ] Can select folder for Source A
- [ ] File selection dropdown works for Source A
- [ ] Auto-selects when only 1 file uploaded
- [ ] **Validation shows error if no common fields between Excel and Oracle** (Phase 2.3)
- [ ] **Validation shows warning if significant field mismatch (>50%)** (Phase 2.3)
- [ ] Files persist in IndexedDB across sessions
- [ ] New Comparison keeps cached files, clears selection

### Excel vs Excel
- [ ] Source A shows enhanced file upload when Excel selected
- [ ] Source B shows enhanced file upload when Excel selected
- [ ] Both sources can have multiple files
- [ ] Can select different files from each source
- [ ] Files cached separately for Source A and Source B
- [ ] New Comparison keeps cached files for both sources

### General
- [ ] Quick presets work correctly
- [ ] Tab switching preserves state
- [ ] Results display correctly for all mode combinations
- [ ] Export (JSON/CSV) works for all modes

---

## Progress Summary

| Phase | Status | Completion Date |
|-------|--------|-----------------|
| Phase 1: Oracle vs Oracle | ✅ COMPLETED | 2026-01-24 |
| Phase 2: Mixed Mode | ✅ COMPLETED | 2026-01-24 |
| Phase 3: Excel vs Excel | ✅ COMPLETED | 2026-01-24 |
| Phase 4: Reset Behavior | ✅ COMPLETED | 2026-01-24 |
| Phase 5.1: Visual Feedback | ✅ COMPLETED | 2026-01-24 |
| Phase 5.2: Loading States | ✅ COMPLETED | 2026-01-24 |
| Phase 5.3: Error Handling | ✅ COMPLETED | 2026-01-24 |

**Overall Progress**: 7/11 sub-phases completed (64%)

---

## Phase 6: Unify Diff Engine (Refactoring)

### Problem Statement

Currently there are **two diff engines** in the codebase:

| Engine | Location | Used By |
|--------|----------|---------|
| **Rust Diff Engine** | `tauri/src/oracle.rs` → `compare_data()` | Schema/Table mode, Raw SQL mode |
| **JavaScript Diff Engine** | `lib/diff-engine.js` → `compareDatasets()` | Excel Compare mode, Unified Compare mode |

### Issues with Dual Engines

| Issue | Impact |
|-------|--------|
| **Maintenance burden** | Bug fixes and features must be implemented twice |
| **Inconsistent behavior** | Subtle differences in comparison logic between modes |
| **Code duplication** | Similar logic in two different languages |
| **Testing overhead** | Need to test both engines for same scenarios |
| **Feature disparity** | JS engine has richer features (character-level diff, word diff, adaptive thresholds) |

### Proposed Solution

**Unify all comparison logic in the JavaScript diff engine.**

```
CURRENT (Dual Engine):
┌─────────────────────────────────────────────────────────────────┐
│  Schema/Table Mode     Raw SQL Mode        Unified/Excel Mode   │
│  ────────────────     ────────────        ──────────────────   │
│  Oracle ──┐           Oracle ──┐          Any Source ──┐        │
│           ├─► Rust              ├─► Rust               │        │
│  Oracle ──┘           Oracle ──┘          Any Source ──┼─► JS   │
└─────────────────────────────────────────────────────────────────┘

PROPOSED (Single Engine):
┌─────────────────────────────────────────────────────────────────┐
│  ALL MODES                                                       │
│  ─────────                                                       │
│  Any Source ──► fetch_data() ──┐                                │
│                                 ├─► JS compareDatasets()        │
│  Any Source ──► fetch_data() ──┘                                │
└─────────────────────────────────────────────────────────────────┘
```

### Implementation Plan

#### 6.1 Refactor Schema/Table Mode to Use JS Diff Engine

**File:** `frontend/tools/compare-config/main.js`

Update `executeComparison()` method:

```javascript
// BEFORE: Uses Rust compare_configurations
async executeComparison() {
  const result = await CompareConfigService.compareConfigurations(request);
  this.results["schema-table"] = result;
}

// AFTER: Uses fetch_oracle_data + JS compareDatasets
async executeComparison() {
  // Step 1: Fetch data from both environments
  const dataEnv1 = await CompareConfigService.fetchOracleData({
    connection_name: this.env1.connection.name,
    config: this.env1.connection,
    mode: 'table',
    owner: this.schema,
    table_name: this.table,
    where_clause: this.whereClause || null,
    fields: this.selectedFields,
    max_rows: this.maxRows,
  });

  const dataEnv2 = await CompareConfigService.fetchOracleData({
    connection_name: this.env2.connection.name,
    config: this.env2.connection,
    mode: 'table',
    owner: this.schema,
    table_name: this.table,
    where_clause: this.whereClause || null,
    fields: this.selectedFields,
    max_rows: this.maxRows,
  });

  // Step 2: Compare using JS diff engine
  const jsResult = compareDatasets(dataEnv1.rows, dataEnv2.rows, {
    keyColumns: this.customPrimaryKey.length > 0
      ? this.customPrimaryKey
      : this.metadata.primary_key,
    fields: this.selectedFields,
    normalize: false,
    matchMode: 'key',
  });

  // Step 3: Convert to view format
  const viewResult = convertToViewFormat(jsResult, {
    env1Name: this.env1.connection.name,
    env2Name: this.env2.connection.name,
    tableName: `${this.schema}.${this.table}`,
    keyColumns: this.customPrimaryKey,
  });

  this.results["schema-table"] = viewResult;
}
```

#### 6.2 Refactor Raw SQL Mode to Use JS Diff Engine

**File:** `frontend/tools/compare-config/main.js`

Update `executeRawSqlComparison()` method:

```javascript
// BEFORE: Uses Rust compare_raw_sql
async executeRawSqlComparison() {
  const result = await CompareConfigService.compareRawSql(request);
  this.results["raw-sql"] = result;
}

// AFTER: Uses fetch_oracle_data + JS compareDatasets
async executeRawSqlComparison() {
  // Step 1: Fetch data from both environments
  const dataEnv1 = await CompareConfigService.fetchOracleData({
    connection_name: this.rawenv1.connection.name,
    config: this.rawenv1.connection,
    mode: 'raw-sql',
    sql: this.rawSql,
    max_rows: this.rawMaxRows,
  });

  const dataEnv2 = await CompareConfigService.fetchOracleData({
    connection_name: this.rawenv2.connection.name,
    config: this.rawenv2.connection,
    mode: 'raw-sql',
    sql: this.rawSql,
    max_rows: this.rawMaxRows,
  });

  // Step 2: Determine primary key columns
  const pkColumns = this.rawPrimaryKey
    ? this.rawPrimaryKey.split(',').map(s => s.trim())
    : [dataEnv1.headers[0]]; // Default to first column

  // Step 3: Compare using JS diff engine
  const jsResult = compareDatasets(dataEnv1.rows, dataEnv2.rows, {
    keyColumns: pkColumns,
    fields: dataEnv1.headers,
    normalize: false,
    matchMode: 'key',
  });

  // Step 4: Convert to view format
  const viewResult = convertToViewFormat(jsResult, {
    env1Name: this.rawenv1.connection.name,
    env2Name: this.rawenv2.connection.name,
    tableName: 'Raw SQL Query',
    keyColumns: pkColumns,
  });

  this.results["raw-sql"] = viewResult;
}
```

#### 6.3 Deprecate Rust Comparison Commands

**File:** `tauri/src/oracle.rs`

Mark as deprecated (keep for backward compatibility initially):

```rust
/// @deprecated Use fetch_oracle_data + frontend JS comparison instead
#[tauri::command]
pub fn compare_configurations(request: CompareRequest) -> Result<CompareResult, String>

/// @deprecated Use fetch_oracle_data + frontend JS comparison instead
#[tauri::command]
pub fn compare_raw_sql(request: RawSqlRequest) -> Result<CompareResult, String>
```

#### 6.4 Remove Legacy Tabs (Optional - Future)

Once the unified mode is stable and all comparisons use JS diff engine:

1. Remove "Schema/Table" and "Raw SQL" tabs from UI
2. Keep only "Unified" tab (covers all use cases)
3. Remove deprecated Rust comparison commands
4. Clean up legacy state management code

### Files to Modify

| File | Changes |
|------|---------|
| `main.js` | Refactor `executeComparison()` and `executeRawSqlComparison()` |
| `service.js` | Ensure `fetchOracleData()` is available (already exists for unified mode) |
| `lib/diff-adapter.js` | Add `convertToViewFormat()` if not already present |
| `tauri/src/oracle.rs` | Mark `compare_configurations` and `compare_raw_sql` as deprecated |

### Benefits After Refactoring

| Benefit | Description |
|---------|-------------|
| **Single source of truth** | All comparison logic in `diff-engine.js` |
| **Richer features everywhere** | Character-level diff, word diff available in all modes |
| **Easier maintenance** | One place to fix bugs or add features |
| **Consistent behavior** | Same comparison logic across all source combinations |
| **Smaller Rust binary** | Remove comparison logic from backend |

### Migration Strategy

1. **Phase 6.1-6.2**: Refactor existing modes to use JS engine (non-breaking, feature flag)
2. **Testing**: Verify parity with Rust engine results
3. **Phase 6.3**: Mark Rust commands as deprecated
4. **Phase 6.4**: Remove legacy code in future release

### Testing Checklist

#### Unit Tests
- [ ] `convertToViewFormat()` correctly maps JS diff result to view format
- [ ] Key-based matching produces same results as Rust engine
- [ ] Character-level diff works on Schema/Table mode results
- [ ] Character-level diff works on Raw SQL mode results

#### Integration Tests
- [ ] Schema/Table comparison with JS engine matches Rust results
- [ ] Raw SQL comparison with JS engine matches Rust results
- [ ] Progress overlay shows correct steps for legacy modes
- [ ] Error handling works correctly for Oracle errors

#### Regression Tests
- [ ] Existing Unified mode still works
- [ ] Existing Excel Compare mode still works
- [ ] View switching (Grid, Cards, Detail) works with all modes
- [ ] Export (JSON, CSV) works with all modes

---

## Updated Progress Summary

| Phase | Status | Completion Date |
|-------|--------|-----------------|
| Phase 1: Oracle vs Oracle | ✅ COMPLETED | 2026-01-24 |
| Phase 2: Mixed Mode | ✅ COMPLETED | 2026-01-24 |
| Phase 3: Excel vs Excel | ✅ COMPLETED | 2026-01-24 |
| Phase 4: Reset Behavior | ✅ COMPLETED | 2026-01-24 |
| Phase 5.1: Visual Feedback | ✅ COMPLETED | 2026-01-24 |
| Phase 5.2: Loading States | ✅ COMPLETED | 2026-01-24 |
| Phase 5.3: Error Handling | ✅ COMPLETED | 2026-01-24 |
| Phase 6.1: Schema/Table JS Engine | ⬚ TODO | - |
| Phase 6.2: Raw SQL JS Engine | ⬚ TODO | - |
| Phase 6.3: Deprecate Rust Commands | ⬚ TODO | - |
| Phase 6.4: Remove Legacy Tabs | ⬚ FUTURE | - |

**Overall Progress**: 7/11 sub-phases completed (64%)
