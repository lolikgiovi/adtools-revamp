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

### Phase 2: Mixed Mode (Oracle vs Excel / Excel vs Oracle)

The enhanced Excel config applies to **any source set to Excel**, whether Source A or Source B. This phase covers both:
- **Oracle vs Excel**: Source A = Oracle, Source B = Excel
- **Excel vs Oracle**: Source A = Excel, Source B = Oracle

| Mode | Source A | Source B |
|------|----------|----------|
| Oracle vs Oracle | Full Oracle config | Connection only (follows A) |
| Oracle vs Excel | Full Oracle config | Enhanced Excel upload |
| Excel vs Oracle | Enhanced Excel upload | Full Oracle config |
| Excel vs Excel | Enhanced Excel upload | Enhanced Excel upload |

#### 2.1 Enhanced Excel Config (for Any Source)
**Files**: `template.js`, `main.js`, `styles.css`

**Template Changes** - Replace simple upload with full Excel selection UI for both sources.

The same template structure applies to both Source A and Source B (with different IDs):
```html
<!-- Excel Config Enhanced (for Source A or B) -->
<!-- IDs use pattern: source-{a|b}-* -->
<div class="excel-config-enhanced" id="source-{x}-excel-config-enhanced" style="display: none;">
    <!-- Upload Area (same as Excel Compare) -->
    <div class="file-upload-zone compact" id="source-{x}-upload-zone-enhanced">
        <div class="upload-zone-header">
            <span class="zone-label">Excel Files</span>
            <button class="btn btn-ghost btn-xs btn-clear-files" id="source-{x}-clear-all" style="display: none;">
                Clear All
            </button>
        </div>
        <div class="upload-area">
            <p>Click to <a href="#" class="browse-link" id="source-{x}-browse-files">browse files</a>
               or <a href="#" class="browse-link" id="source-{x}-browse-folder">select folder</a></p>
            <p class="file-types">Supports .xlsx, .xls, .csv</p>
        </div>
        <input type="file" id="source-{x}-file-input-multi" multiple accept=".xlsx,.xls,.csv" style="display: none;">
        <input type="file" id="source-{x}-folder-input" webkitdirectory style="display: none;">
        <div class="file-list" id="source-{x}-file-list"></div>
    </div>

    <!-- File Selection Dropdown (shown when multiple files uploaded) -->
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

This will be implemented for both `source-a` and `source-b`, replacing the current simple file upload.

#### 2.2 Multi-File Upload Support (Symmetric for Both Sources)
**Files**: `main.js`

**Changes**:
1. Add state for Excel files in both sources:
   ```javascript
   // Source A (when Excel selected)
   this.unified.sourceA.excelFiles = []; // Array of {id, file}
   this.unified.sourceA.selectedExcelFile = null; // Selected file for comparison

   // Source B (when Excel selected)
   this.unified.sourceB.excelFiles = []; // Array of {id, file}
   this.unified.sourceB.selectedExcelFile = null; // Selected file for comparison
   ```

2. Implement **generic** file upload handlers that work for either source:
   - `handleUnifiedExcelFileSelection(sourceKey, files)` - sourceKey is 'sourceA' or 'sourceB'
   - `handleUnifiedExcelFolderSelection(sourceKey)` (Tauri + Web)
   - `clearUnifiedExcelFiles(sourceKey)`
   - `removeUnifiedExcelFile(sourceKey, fileId)`

3. Implement searchable dropdown for file selection (for each source):
   - Reuse `setupSearchableDropdown()` pattern from Excel Compare
   - Auto-select if only 1 file uploaded
   - `setupUnifiedExcelFileDropdown(sourceKey)`

4. Cache files in IndexedDB under new store key:
   - Store: `UNIFIED_EXCEL_FILES` with `source` field: `'sourceA'` or `'sourceB'`

#### 2.3 Pre-Load Validation for Mixed Mode (Oracle + Excel)
**Files**: `main.js`

**Changes**:
1. Validate Excel file has columns matching Oracle query result (works for both directions):
   ```javascript
   async validateMixedModeFields() {
     // Determine which source is Oracle and which is Excel
     const oracleSource = this.unified.sourceA.type === 'oracle' ? 'sourceA' : 'sourceB';
     const excelSource = this.unified.sourceA.type === 'excel' ? 'sourceA' : 'sourceB';

     // Load Oracle headers
     const oracleHeaders = await this.fetchOracleHeaders(this.unified[oracleSource]);

     // Parse selected Excel file headers
     const excelFile = this.unified[excelSource].selectedExcelFile;
     const excelData = await FileParser.parseFile(excelFile.file);
     const excelHeaders = excelData.headers;

     // Reconcile columns (case-insensitive)
     const reconciled = reconcileColumns(oracleHeaders, excelHeaders);

     if (reconciled.common.length === 0) {
       this.showError('No common fields found between Oracle and Excel sources');
       return false;
     }

     // Proceed with showing column warning if there are mismatches
     return true;
   }
   ```

This handles both:
- **Oracle vs Excel**: Source A (Oracle) validated against Source B (Excel)
- **Excel vs Oracle**: Source A (Excel) validated against Source B (Oracle)

---

### Phase 3: Excel vs Excel Mode (Leverages Phase 2)

Since Phase 2 implements **symmetric** Excel upload for both Source A and Source B, the Excel vs Excel mode is automatically supported. This phase focuses on any Excel-vs-Excel-specific behavior.

#### 3.1 Excel vs Excel Specific Behavior
**Files**: `main.js`

**Changes**:
1. When both sources are Excel, no special "follow" mode is needed (unlike Oracle vs Oracle)
2. Both sources independently select their files
3. Validation ensures at least some common fields exist between the two Excel files

#### 3.2 IndexedDB Store Configuration
**Files**: `lib/indexed-db-manager.js`

**Changes**:
1. Add new store for unified Excel files:
   ```javascript
   const STORES = {
     // ... existing stores
     UNIFIED_EXCEL_FILES: 'unifiedExcelFiles',  // NEW
   };
   ```

2. Store structure:
   ```javascript
   {
     id: string,           // Unique file ID
     name: string,         // File name
     content: ArrayBuffer, // File content
     source: 'sourceA' | 'sourceB',  // Which source panel
     uploadedAt: timestamp
   }
   ```

3. Helper methods:
   - `saveUnifiedExcelFile(fileData)`
   - `getUnifiedExcelFiles(source)` - get files for specific source
   - `removeUnifiedExcelFile(id)`
   - `clearUnifiedExcelFiles(source)` - clear all files for a source

---

### Phase 4: New Comparison Reset Behavior

#### 4.1 Reset Logic Based on Source Types
**Files**: `main.js`

**Changes**:
1. Update `handleNewComparison()` (or create `handleUnifiedNewComparison()`):
   ```javascript
   handleUnifiedNewComparison() {
     // Always clear results
     this.hideResults();
     this.unified.results = null;

     // Always hide field reconciliation
     this.hideUnifiedFieldReconciliation();

     // Reset data loaded flags
     this.unified.sourceA.dataLoaded = false;
     this.unified.sourceA.data = null;
     this.unified.sourceB.dataLoaded = false;
     this.unified.sourceB.data = null;

     // Reset field selections
     this.unified.selectedPkFields = [];
     this.unified.selectedCompareFields = [];

     // Source-specific resets
     if (this.unified.sourceA.type === 'oracle') {
       this.resetOracleSourceConfig('sourceA');
     }
     // Note: Source A Excel files remain cached

     if (this.unified.sourceB.type === 'oracle') {
       this.resetOracleSourceConfig('sourceB');
     }
     // Note: Source B Excel files remain cached (unless Clear All clicked)

     // Reset UI state
     this.updateUnifiedSourcePreview('sourceA', null);
     this.updateUnifiedSourcePreview('sourceB', null);
     this.updateUnifiedLoadButtonState();
   }
   ```

2. For Excel sources:
   - Keep cached files in IndexedDB
   - Keep file list visible in UI
   - Only clear `selectedExcelFile` and data preview
   - User must click "Clear All" to remove cached files

3. For Oracle sources:
   - Reset connection, schema, table selections
   - Clear all form fields to initial state

---

### Phase 5: UI/UX Polish

#### 5.1 Visual Feedback for Mode Detection
**Files**: `styles.css`, `main.js`

**Changes**:
1. Add visual indicator when Oracle-Oracle mode detected:
   - Subtle connection line or badge showing "Following Source A"
   - Dimmed/disabled appearance for hidden Source B fields

2. Add animation for field auto-selection (PK → Compare Fields)

#### 5.2 Loading States
**Files**: `template.js`, `main.js`, `styles.css`

**Changes**:
1. Show loading spinner when:
   - Uploading files (especially folders with many files)
   - Validating table existence in Source B
   - Fetching schemas/tables

2. Update progress overlay for unified mode:
   - Step 1: "Loading Source A data"
   - Step 2: "Validating Source B" (for Oracle-Oracle)
   - Step 3: "Loading Source B data"
   - Step 4: "Reconciling fields"

#### 5.3 Error Handling Improvements
**Files**: `main.js`

**Changes**:
1. Clear error messages with actionable guidance:
   - "Table X.Y not found in Source B. Please verify the table exists or select a different connection."
   - "No common fields between sources. Ensure both sources have matching column names."

2. Inline validation feedback (not just toast messages)

---

## File Changes Summary

| File | Changes |
|------|---------|
| `template.js` | Enhanced Excel config sections, helper text, new IDs for enhanced elements |
| `main.js` | New handlers for Oracle-Oracle sync, Excel multi-file, validation, reset logic, PK auto-select |
| `styles.css` | Styles for enhanced Excel upload, disabled states, visual feedback |
| `lib/indexed-db-manager.js` | New store for unified Excel files |
| `service.js` | New method `validateTableExists()` for Oracle-Oracle validation |

---

## Implementation Order

1. ~~**Phase 1.3** - PK auto-select for comparison fields (quick win, isolated change)~~ ✅ DONE
2. **Phase 4.1** - New Comparison reset logic (foundation for all modes)
3. ~~**Phase 1.1 & 1.2** - Oracle vs Oracle improvements (Source B follows A)~~ ✅ DONE
4. **Phase 2.1 & 2.2** - Enhanced Excel upload (symmetric for both sources - covers Oracle vs Excel AND Excel vs Oracle)
5. **Phase 2.3** - Mixed mode validation (Oracle + Excel field matching)
6. **Phase 3.2** - IndexedDB store for unified Excel files
7. **Phase 5** - UI/UX polish

---

## Testing Checklist

### Unit Tests (Phase 1) ✅
- [x] `getComparisonMode()` - 7 tests
- [x] `isSourceBFollowMode()` - 6 tests
- [x] `syncPkFieldsToCompareFields()` - 9 tests
- [x] `validateOracleToOracleConfig()` - 10 tests
- [x] `createSourceBConfigFromSourceA()` - 3 tests
- [x] `getSourceBDisabledFieldsForFollowMode()` - 2 tests
- [x] `validateFieldSelection()` - 7 tests

**Total: 44 unit tests passing**

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
- [ ] Validation warns if no common fields
- [ ] Files persist in IndexedDB across sessions
- [ ] New Comparison keeps cached files, clears selection

### Excel vs Oracle (Source A = Excel, Source B = Oracle)
- [ ] Source A shows enhanced Excel upload
- [ ] Source B shows full Oracle config
- [ ] Can upload single/multiple files to Source A
- [ ] Can select folder for Source A
- [ ] File selection dropdown works for Source A
- [ ] Auto-selects when only 1 file uploaded
- [ ] Validation warns if no common fields
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
