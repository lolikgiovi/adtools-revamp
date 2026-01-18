# Excel Compare Flow Refactor Plan

> **Status: ✅ IMPLEMENTED** (Commit: `9d26af7`)
>
> Implementation Date: 2026-01-17
>
> **Summary:** Core refactor completed. Single-pair UX flow is working. Unit tests pending.

---

## Problem Statement

The current Excel Compare flow has significant UX ambiguity:
1. Users upload files to both Reference and Comparator zones simultaneously
2. File pairing happens automatically but isn't clear
3. Row Matching and Data Comparison settings are always visible, even before files are selected
4. The comparison is multi-file at once, which is complex
5. No clear Primary Key / Field selection UI like Schema/Table mode has

## New Flow Design

### Step-by-Step User Journey

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 1: File Upload                                                          │
│                                                                              │
│  ┌─────────────────────────┐    ┌─────────────────────────┐                  │
│  │  REFERENCE FILES        │    │  COMPARATOR FILES       │                  │
│  │  ┌───────────────────┐  │    │  ┌───────────────────┐  │                  │
│  │  │ Drop files/folder │  │    │  │ Drop files/folder │  │                  │
│  │  │ or click browse   │  │    │  │ or click browse   │  │                  │
│  │  └───────────────────┘  │    │  └───────────────────┘  │                  │
│  │  Files (3):    [Clear]  │    │  Files (2):    [Clear]  │                  │
│  │  • CONFIG.APP_CONFIG    │    │  • CONFIG.APP_CONFIG    │                  │
│  │  • CONFIG.SYS_PARAM     │    │  • CONFIG.SYS_PARAM     │                  │
│  │  • CONFIG.USER_PREF     │    │                         │                  │
│  └─────────────────────────┘    └─────────────────────────┘                  │
│                                                                              │
│  [Row Matching & Data Comparison sections HIDDEN at this stage]              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 2: File Pairing Selection                                               │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  SELECT FILE TO COMPARE                                              │    │
│  │                                                                      │    │
│  │  Reference File:   [CONFIG.APP_CONFIG              ▼] (searchable)   │    │
│  │                    ↳ Shows all reference files                       │    │
│  │                                                                      │    │
│  │  Comparator File:  [CONFIG.APP_CONFIG              ▼] (auto-matched) │    │
│  │                    ↳ Auto-selected if filename matches               │    │
│  │                    ↳ Or empty if no match, user picks manually       │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  File matching logic:                                                        │
│  • Exact match: CONFIG.APP_CONFIG == CONFIG.APP_CONFIG                       │
│  • Suffix match: CONFIG.APP_CONFIG == CONFIG.APP_CONFIG (AFTER)              │
│  • Prefix match: CONFIG.APP_CONFIG (BEFORE) == CONFIG.APP_CONFIG (AFTER)     │
│  • Prefix match: CONFIG.APP_CONFIG (BEFORE) == CONFIG.APP_CONFIG             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 3: Field Configuration (shown after both files selected)                │
│                                                                              │
│  Headers detected: ID, NAME, VALUE, CREATED_DATE, UPDATED_DATE              │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  PRIMARY KEY SELECTION           [Select All] [Clear]                │    │
│  │  ┌─────────────────────────────────────────────────────────────────┐│    │
│  │  │ [✓] ID   [ ] NAME   [ ] VALUE   [ ] CREATED_DATE   [ ] UPDATED  ││    │
│  │  └─────────────────────────────────────────────────────────────────┘│    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  FIELDS TO COMPARE               [Select All] [Clear]                │    │
│  │  ┌─────────────────────────────────────────────────────────────────┐│    │
│  │  │ [✓] ID   [✓] NAME   [✓] VALUE   [✓] CREATED_DATE   [✓] UPDATED  ││    │
│  │  └─────────────────────────────────────────────────────────────────┘│    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  COMPARISON OPTIONS                                                   │    │
│  │  Row Matching:     ○ By Primary Key  ○ By Row Position                │    │
│  │  Data Comparison:  ○ Strict (as-is)  ○ Normalized (dates/numbers)     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│                                                   [Compare] (action btn)     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 4: Results (same as current implementation)                             │
│                                                                              │
│  Summary: 100 total | 95 match | 3 differ | 1 only ref | 1 only comp        │
│                                                                              │
│  [Expandable ▼] [Grid] [Cards] [Master-Detail]                              │
│  ... results grid ...                                                        │
│                                                                              │
│  [New Comparison] - goes back to Step 2 to select another file pair          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Current vs. New Flow Comparison

| Aspect | Current Implementation | New Implementation |
|--------|----------------------|-------------------|
| **File Upload** | Two zones, always visible | Two zones with "Clear All" button |
| **Row Matching/Settings** | Always visible | Hidden until file pair selected |
| **File Pairing** | Auto-pair all, manual override via modal | Single pair selection via dropdowns |
| **Comparison Scope** | All pairs at once | One pair at a time |
| **Field Selection** | None (uses all columns) | Explicit PK and Field selection like Schema/Table |
| **Headers Detection** | Done during comparison | Done when pair is selected |

---

## File Name Matching Algorithm

The current `file-matcher.js` uses exact case-insensitive matching. We need to enhance it to support:

### Match Rules (in priority order)

1. **Exact Match**: Filenames are identical (case-insensitive)
   ```
   CONFIG.APP_CONFIG.xlsx == CONFIG.APP_CONFIG.xlsx ✓
   ```

2. **Base Name Match**: Same base name, different suffixes in parentheses
   ```
   CONFIG.APP_CONFIG.xlsx       == CONFIG.APP_CONFIG (AFTER).xlsx ✓
   CONFIG.APP_CONFIG (BEFORE).xlsx == CONFIG.APP_CONFIG (AFTER).xlsx ✓
   CONFIG.APP_CONFIG (BEFORE).xlsx == CONFIG.APP_CONFIG.xlsx ✓
   ```

3. **Similar Name Match** (existing): Using longest common substring for suggestions

### Implementation

```javascript
/**
 * Extract base filename without suffixes like (BEFORE), (AFTER), (OLD), (NEW), etc.
 * @param {string} filename - e.g., "CONFIG.APP_CONFIG (BEFORE).xlsx"
 * @returns {string} - e.g., "CONFIG.APP_CONFIG"
 */
function extractBaseName(filename) {
  // Remove extension
  const withoutExt = filename.replace(/\.(xlsx|xls|csv)$/i, '');

  // Remove common suffixes: (BEFORE), (AFTER), (OLD), (NEW), (1), (2), etc.
  const suffixPattern = /\s*\((?:BEFORE|AFTER|OLD|NEW|PROD|DEV|UAT|SIT|\d+)\)\s*$/i;
  return withoutExt.replace(suffixPattern, '').trim();
}

/**
 * Check if two filenames match (exact or base name)
 */
function filenamesMatch(name1, name2) {
  const n1 = name1.toLowerCase();
  const n2 = name2.toLowerCase();

  // Exact match
  if (n1 === n2) return { match: true, type: 'exact' };

  // Base name match
  const base1 = extractBaseName(n1);
  const base2 = extractBaseName(n2);
  if (base1 === base2) return { match: true, type: 'base' };

  return { match: false };
}
```

---

## Component Changes

### 1. Template Changes (`template.js`)

#### 1.1 Add Clear All Buttons to File Zones

```html
<!-- In file-upload-zone header -->
<div class="upload-zone-header">
    <h4>Reference Files</h4>
    <button class="btn btn-ghost btn-xs btn-clear-files" id="ref-clear-all" style="display: none;">
        Clear All
    </button>
</div>
```

#### 1.2 Add File Pairing Section (new)

```html
<!-- File Pairing Selection (shown after files uploaded) -->
<div id="excel-file-pairing" class="excel-file-pairing" style="display: none;">
    <div class="pairing-header">
        <h4>Select File to Compare</h4>
    </div>

    <div class="pairing-dropdowns">
        <div class="form-group">
            <label for="excel-ref-file-select">Reference File</label>
            <div class="searchable-select" id="excel-ref-file-wrapper">
                <input type="text" class="form-input searchable-input"
                       id="excel-ref-file-search" placeholder="Search files...">
                <div class="searchable-dropdown" id="excel-ref-file-dropdown">
                    <!-- Populated dynamically -->
                </div>
            </div>
        </div>

        <div class="form-group">
            <label for="excel-comp-file-select">Comparator File</label>
            <div class="searchable-select" id="excel-comp-file-wrapper">
                <input type="text" class="form-input searchable-input"
                       id="excel-comp-file-search" placeholder="Auto-matched or search...">
                <div class="searchable-dropdown" id="excel-comp-file-dropdown">
                    <!-- Populated dynamically -->
                </div>
            </div>
            <p class="help-text" id="comp-match-hint"></p>
        </div>
    </div>
</div>
```

#### 1.3 Add Field Selection Section for Excel (reuse existing pattern)

```html
<!-- Excel Field Selection (shown after file pair selected) -->
<div id="excel-field-selection" class="field-selection" style="display: none;">
    <div class="file-pair-info">
        <span class="file-badge ref">📄 CONFIG.APP_CONFIG.xlsx</span>
        <span class="vs-label">vs</span>
        <span class="file-badge comp">📄 CONFIG.APP_CONFIG (AFTER).xlsx</span>
    </div>

    <div class="field-header">
        <h4 class="field-title">Primary Key Selection</h4>
        <div class="field-actions">
            <button class="btn btn-ghost btn-sm" id="btn-excel-select-all-pk">Select All</button>
            <button class="btn btn-ghost btn-sm" id="btn-excel-deselect-all-pk">Clear</button>
        </div>
    </div>
    <p class="field-help">Select fields to use as primary key for comparison</p>
    <div id="excel-pk-field-list" class="field-list">
        <!-- Populated dynamically from headers -->
    </div>

    <div class="field-header" style="margin-top: 24px;">
        <h4 class="field-title">Fields to Compare</h4>
        <div class="field-actions">
            <button class="btn btn-ghost btn-sm" id="btn-excel-select-all-fields">Select All</button>
            <button class="btn btn-ghost btn-sm" id="btn-excel-deselect-all-fields">Clear</button>
        </div>
    </div>
    <p class="field-help">Select fields to include in comparison</p>
    <div id="excel-field-list" class="field-list">
        <!-- Populated dynamically from headers -->
    </div>

    <!-- Comparison Options (moved from global settings) -->
    <div class="excel-comparison-options">
        <div class="settings-row">
            <div class="setting-group">
                <label>Row Matching:</label>
                <div class="radio-group">
                    <label class="radio-label">
                        <input type="radio" name="excel-row-matching" value="key" checked>
                        <span>By Primary Key</span>
                    </label>
                    <label class="radio-label">
                        <input type="radio" name="excel-row-matching" value="position">
                        <span>By Row Position</span>
                    </label>
                </div>
            </div>

            <div class="setting-group">
                <label>Data Comparison:</label>
                <div class="radio-group">
                    <label class="radio-label">
                        <input type="radio" name="excel-data-comparison" value="strict" checked>
                        <span>Strict (as-is)</span>
                    </label>
                    <label class="radio-label">
                        <input type="radio" name="excel-data-comparison" value="normalized">
                        <span>Normalized</span>
                    </label>
                </div>
            </div>
        </div>
    </div>

    <div class="comparison-actions">
        <button class="btn btn-primary" id="btn-excel-compare">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
            </svg>
            Compare
        </button>
    </div>
</div>
```

---

### 2. State Changes (`main.js`)

#### 2.1 Update excelCompare State

```javascript
// Current state
this.excelCompare = {
  refFiles: [],
  compFiles: [],
  pairs: [],
  rowMatching: "key",
  pkColumns: "",
  dataComparison: "strict",
  selectedFileResult: "all",
};

// New state
this.excelCompare = {
  // Step 1: File upload
  refFiles: [],     // Array of { id, file }
  compFiles: [],    // Array of { id, file }

  // Step 2: File pairing
  selectedRefFile: null,    // Selected reference file { id, file }
  selectedCompFile: null,   // Selected comparator file { id, file }
  autoMatchedComp: null,    // Auto-matched comparator (for UI hint)

  // Step 3: Field configuration
  headers: [],              // Detected headers from selected files
  selectedPkFields: [],     // Selected primary key fields
  selectedFields: [],       // Selected comparison fields
  rowMatching: "key",       // "key" or "position"
  dataComparison: "strict", // "strict" or "normalized"

  // UI state
  currentStep: 1,           // 1=upload, 2=pairing, 3=config, 4=results
};
```

---

### 3. Flow Control Methods (`main.js`)

#### 3.1 File Upload Handling

```javascript
/**
 * Handle file upload (modified to show Clear All button)
 */
async handleExcelFileSelection(side, files) {
  const supportedFiles = FileParser.filterSupportedFiles(files);
  if (supportedFiles.length === 0) return;

  const listKey = side === "ref" ? "refFiles" : "compFiles";
  const filesWithIds = supportedFiles.map((file) => ({
    id: crypto.randomUUID(),
    file,
  }));

  this.excelCompare[listKey] = [...this.excelCompare[listKey], ...filesWithIds];

  // Update UI
  this.updateExcelFileList(side);
  this.updateClearAllButtonVisibility(side);

  // Check if we have files on both sides to show pairing UI
  this.checkAndShowPairingUI();
}

/**
 * Clear all files from a side
 */
clearAllExcelFiles(side) {
  const listKey = side === "ref" ? "refFiles" : "compFiles";
  this.excelCompare[listKey] = [];

  // Reset dependent state
  if (side === "ref") {
    this.excelCompare.selectedRefFile = null;
  } else {
    this.excelCompare.selectedCompFile = null;
  }

  this.updateExcelFileList(side);
  this.updateClearAllButtonVisibility(side);
  this.checkAndShowPairingUI();
}

/**
 * Show/hide Clear All button based on file count
 */
updateClearAllButtonVisibility(side) {
  const listKey = side === "ref" ? "refFiles" : "compFiles";
  const btnId = side === "ref" ? "ref-clear-all" : "comp-clear-all";
  const btn = document.getElementById(btnId);

  if (btn) {
    btn.style.display = this.excelCompare[listKey].length > 0 ? "" : "none";
  }
}
```

#### 3.2 File Pairing UI

```javascript
/**
 * Check conditions and show/hide pairing UI
 */
checkAndShowPairingUI() {
  const hasRefFiles = this.excelCompare.refFiles.length > 0;
  const hasCompFiles = this.excelCompare.compFiles.length > 0;

  const pairingSection = document.getElementById("excel-file-pairing");
  const settingsSection = document.getElementById("excel-settings");
  const fieldSection = document.getElementById("excel-field-selection");

  // Hide settings and field selection until file pair is selected
  if (settingsSection) settingsSection.style.display = "none";
  if (fieldSection) fieldSection.style.display = "none";

  if (hasRefFiles && hasCompFiles) {
    // Show pairing UI
    if (pairingSection) pairingSection.style.display = "block";
    this.populateFilePairingDropdowns();
  } else {
    // Hide pairing UI
    if (pairingSection) pairingSection.style.display = "none";
  }
}

/**
 * Populate file pairing dropdowns
 */
populateFilePairingDropdowns() {
  this.populateSearchableDropdown(
    "excel-ref-file",
    this.excelCompare.refFiles,
    this.excelCompare.selectedRefFile?.id
  );

  this.populateSearchableDropdown(
    "excel-comp-file",
    this.excelCompare.compFiles,
    this.excelCompare.selectedCompFile?.id
  );
}

/**
 * Handle reference file selection
 */
handleRefFileSelection(fileId) {
  const refFile = this.excelCompare.refFiles.find(f => f.id === fileId);
  if (!refFile) return;

  this.excelCompare.selectedRefFile = refFile;

  // Try to auto-match comparator
  const autoMatch = this.findMatchingComparatorFile(refFile.file.name);
  if (autoMatch) {
    this.excelCompare.selectedCompFile = autoMatch;
    this.excelCompare.autoMatchedComp = autoMatch;
    this.updateCompFileDropdown(autoMatch.id);
    this.showMatchHint(`Auto-matched: ${autoMatch.file.name}`);
  } else {
    this.excelCompare.selectedCompFile = null;
    this.excelCompare.autoMatchedComp = null;
    this.updateCompFileDropdown(null);
    this.showMatchHint("No matching file found. Please select manually.");
  }

  // If both selected, load headers and show field selection
  if (this.excelCompare.selectedRefFile && this.excelCompare.selectedCompFile) {
    this.loadFileHeadersAndShowFieldSelection();
  }
}

/**
 * Find matching comparator file based on filename rules
 */
findMatchingComparatorFile(refFileName) {
  const refBaseName = this.extractBaseName(refFileName);

  for (const compFile of this.excelCompare.compFiles) {
    const matchResult = this.filenamesMatch(refFileName, compFile.file.name);
    if (matchResult.match) {
      return compFile;
    }
  }

  return null;
}

/**
 * Extract base filename without suffixes
 */
extractBaseName(filename) {
  // Remove extension
  const withoutExt = filename.replace(/\.(xlsx|xls|csv)$/i, '');

  // Remove common suffixes: (BEFORE), (AFTER), (OLD), (NEW), (PROD), (DEV), (UAT), (SIT), (1), (2), etc.
  const suffixPattern = /\s*\((?:BEFORE|AFTER|OLD|NEW|PROD|DEV|UAT|SIT|QA|STAGING|\d+)\)\s*$/i;
  return withoutExt.replace(suffixPattern, '').trim().toLowerCase();
}

/**
 * Check if two filenames match
 */
filenamesMatch(name1, name2) {
  const n1 = name1.toLowerCase();
  const n2 = name2.toLowerCase();

  // Exact match (without extension)
  const base1NoExt = n1.replace(/\.(xlsx|xls|csv)$/i, '');
  const base2NoExt = n2.replace(/\.(xlsx|xls|csv)$/i, '');
  if (base1NoExt === base2NoExt) {
    return { match: true, type: 'exact' };
  }

  // Base name match (removing suffixes)
  const base1 = this.extractBaseName(n1);
  const base2 = this.extractBaseName(n2);
  if (base1 === base2) {
    return { match: true, type: 'base' };
  }

  return { match: false };
}
```

#### 3.3 Header Loading and Field Selection

```javascript
/**
 * Load headers from selected files and show field selection UI
 */
async loadFileHeadersAndShowFieldSelection() {
  const { selectedRefFile, selectedCompFile } = this.excelCompare;

  if (!selectedRefFile || !selectedCompFile) return;

  try {
    // Parse both files to get headers
    const [refData, compData] = await Promise.all([
      FileParser.parseFile(selectedRefFile.file),
      FileParser.parseFile(selectedCompFile.file)
    ]);

    // Merge headers (union of both)
    const allHeaders = new Set([...refData.headers, ...compData.headers]);
    const commonHeaders = refData.headers.filter(h => compData.headers.includes(h));
    const refOnlyHeaders = refData.headers.filter(h => !compData.headers.includes(h));
    const compOnlyHeaders = compData.headers.filter(h => !refData.headers.includes(h));

    this.excelCompare.headers = Array.from(allHeaders);
    this.excelCompare.commonHeaders = commonHeaders;
    this.excelCompare.refOnlyHeaders = refOnlyHeaders;
    this.excelCompare.compOnlyHeaders = compOnlyHeaders;

    // Default: select all common headers for comparison
    this.excelCompare.selectedFields = [...commonHeaders];

    // Default: first column as PK
    if (commonHeaders.length > 0) {
      this.excelCompare.selectedPkFields = [commonHeaders[0]];
    }

    // Cache parsed data for comparison
    this.excelCompare.refParsedData = refData;
    this.excelCompare.compParsedData = compData;

    // Show field selection UI
    this.renderExcelFieldSelection();

    // Show column mismatch warning if applicable
    if (refOnlyHeaders.length > 0 || compOnlyHeaders.length > 0) {
      this.showColumnMismatchWarning(refOnlyHeaders, compOnlyHeaders);
    }

  } catch (error) {
    console.error("Failed to parse files:", error);
    this.showNotification({ type: "error", message: `Failed to read file headers: ${error.message}` });
  }
}

/**
 * Render field selection UI for Excel
 */
renderExcelFieldSelection() {
  const fieldSection = document.getElementById("excel-field-selection");
  if (!fieldSection) return;

  // Update file pair info
  const { selectedRefFile, selectedCompFile } = this.excelCompare;
  const pairInfo = fieldSection.querySelector(".file-pair-info");
  if (pairInfo) {
    pairInfo.innerHTML = `
      <span class="file-badge ref">📄 ${selectedRefFile.file.name}</span>
      <span class="vs-label">vs</span>
      <span class="file-badge comp">📄 ${selectedCompFile.file.name}</span>
    `;
  }

  // Render PK field checkboxes
  const pkListEl = document.getElementById("excel-pk-field-list");
  if (pkListEl) {
    pkListEl.innerHTML = this.excelCompare.commonHeaders.map(header => `
      <label class="field-checkbox">
        <input type="checkbox" name="excel-pk-field" value="${header}"
               ${this.excelCompare.selectedPkFields.includes(header) ? "checked" : ""}>
        <span class="field-name">${header}</span>
      </label>
    `).join("");
  }

  // Render comparison field checkboxes
  const fieldListEl = document.getElementById("excel-field-list");
  if (fieldListEl) {
    fieldListEl.innerHTML = this.excelCompare.commonHeaders.map(header => `
      <label class="field-checkbox">
        <input type="checkbox" name="excel-compare-field" value="${header}"
               ${this.excelCompare.selectedFields.includes(header) ? "checked" : ""}>
        <span class="field-name">${header}</span>
      </label>
    `).join("");
  }

  // Show the section
  fieldSection.style.display = "block";
}
```

#### 3.4 Comparison Execution

```javascript
/**
 * Execute Excel comparison for single file pair
 */
async executeExcelComparison() {
  const {
    selectedRefFile,
    selectedCompFile,
    refParsedData,
    compParsedData,
    selectedPkFields,
    selectedFields,
    rowMatching,
    dataComparison
  } = this.excelCompare;

  if (!selectedRefFile || !selectedCompFile) {
    this.showNotification({ type: "error", message: "Please select both files to compare." });
    return;
  }

  if (rowMatching === "key" && selectedPkFields.length === 0) {
    this.showNotification({ type: "error", message: "Please select at least one primary key field." });
    return;
  }

  this.showProgress("Comparing Files");

  try {
    const jsResult = compareDatasets(refParsedData.rows, compParsedData.rows, {
      keyColumns: selectedPkFields,
      fields: selectedFields,
      normalize: dataComparison === "normalized",
      matchMode: rowMatching,
    });

    const viewResult = convertToViewFormat(jsResult, {
      env1Name: selectedRefFile.file.name,
      env2Name: selectedCompFile.file.name,
      tableName: `${selectedRefFile.file.name} vs ${selectedCompFile.file.name}`,
      keyColumns: selectedPkFields,
    });

    this.results["excel-compare"] = viewResult;
    this.excelCompare.currentStep = 4;

    this.hideProgress();
    this.displayResults();

  } catch (error) {
    console.error("Comparison failed:", error);
    this.hideProgress();
    this.showNotification({ type: "error", message: `Comparison failed: ${error.message}` });
  }
}
```

---

## Implementation Tasks

### Phase 1: Template & UI Updates ✅ COMPLETED

- [x] **1.1** Add "Clear All" buttons to file upload zones
- [x] **1.2** Add new File Pairing section with searchable dropdowns
- [x] **1.3** Add Excel Field Selection section (mirror Schema/Table UI)
- [x] **1.4** Move Row Matching and Data Comparison options into Field Selection section
- [x] **1.5** Hide global settings section (removed from template)
- [x] **1.6** Update CSS for new components (searchable dropdowns, file badges)

### Phase 2: State Management ✅ COMPLETED

- [x] **2.1** Update `excelCompare` state structure
- [x] **2.2** Add step tracking (`currentStep`)
- [x] **2.3** Add header and parsed data caching

### Phase 3: File Matching Logic ⚠️ PARTIALLY COMPLETED

- [x] **3.1** Implement `extractBaseName()` in `file-matcher.js`
- [x] **3.2** Implement `filenamesMatch()` with exact and base name matching
- [ ] **3.3** Add unit tests for new matching logic

### Phase 4: Flow Control ✅ COMPLETED

- [x] **4.1** Implement `checkAndShowPairingUI()`
- [x] **4.2** Implement searchable dropdown component (`setupSearchableDropdown()`)
- [x] **4.3** Implement `handleRefFileSelection()` with auto-match
- [x] **4.4** Implement `loadFileHeadersAndShowFieldSelection()`
- [x] **4.5** Implement `renderExcelFieldSelection()`
- [x] **4.6** Update `executeExcelComparisonNewFlow()` for single-pair flow

### Phase 5: Event Binding ✅ COMPLETED

- [x] **5.1** Bind "Clear All" button events
- [x] **5.2** Bind searchable dropdown events
- [x] **5.3** Bind PK and field checkbox events (`bindExcelFieldCheckboxEvents()`)
- [x] **5.4** Bind Row Matching and Data Comparison radio events
- [x] **5.5** Bind Compare button event

### Phase 6: Results Flow ⚠️ PARTIALLY COMPLETED

- [x] **6.1** Update "New Comparison" to go back to pairing step (via `resetForm()`)
- [ ] **6.2** Remove multi-file result selector code (legacy code still exists but unused)

---

## CSS Updates Needed

```css
/* Searchable Dropdown */
.searchable-select {
  position: relative;
}

.searchable-input {
  width: 100%;
}

.searchable-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  max-height: 200px;
  overflow-y: auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  box-shadow: var(--shadow-lg);
  z-index: 100;
  display: none;
}

.searchable-dropdown.open {
  display: block;
}

.searchable-option {
  padding: 8px 12px;
  cursor: pointer;
}

.searchable-option:hover,
.searchable-option.highlighted {
  background: var(--bg-hover);
}

.searchable-option.selected {
  background: var(--accent-blue-bg);
}

/* File Pair Info */
.file-pair-info {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--bg-secondary);
  border-radius: 8px;
  margin-bottom: 16px;
}

.file-badge {
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 500;
}

.file-badge.ref {
  background: var(--env1-bg);
  color: var(--env1-color);
}

.file-badge.comp {
  background: var(--env2-bg);
  color: var(--env2-color);
}

.vs-label {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
}

/* Clear All Button */
.btn-clear-files {
  margin-left: auto;
  color: var(--text-muted);
}

.btn-clear-files:hover {
  color: var(--accent-red);
}
```

---

## Migration Notes

### Breaking Changes

1. **State structure change**: `excelCompare.pairs` is removed in favor of single-pair selection
2. **Multi-file comparison removed**: Users must compare one pair at a time (simpler UX)
3. **Global settings moved**: Row Matching and Data Comparison now per-comparison, not global

### Backward Compatibility

- No saved state migration needed (Excel Compare doesn't persist state across sessions)
- Existing tests for `file-matcher.js` need updates for new matching logic

---

## Testing Plan

1. **Unit Tests** ❌ NOT IMPLEMENTED
   - [ ] `extractBaseName()` function
   - [ ] `filenamesMatch()` function with various patterns
   - [ ] `findMatchingFile()` function
   - [ ] Header merging logic

2. **Integration Tests** ❌ NOT IMPLEMENTED
   - [ ] File upload → Clear All → Re-upload flow
   - [ ] Auto-match detection
   - [ ] Header loading and field selection
   - [ ] Comparison execution

3. **E2E Tests** ❌ NOT IMPLEMENTED
   - [ ] Full flow: Upload → Pair → Configure → Compare → Results
   - [ ] Error handling: mismatched columns, empty files

---

## Success Criteria

- [x] Users can upload files and clear them with a single click
- [x] Row Matching / Data Comparison settings are hidden until a file pair is selected
- [x] Searchable dropdowns work for file selection
- [x] Auto-matching works for common naming patterns (BEFORE/AFTER, etc.)
- [x] Primary Key and Field selection mirrors Schema/Table mode
- [x] Single file pair comparison completes successfully
- [x] Results display correctly with selected fields only

---

## Remaining Work

### High Priority
1. **Unit Tests for File Matcher** - Add tests for `extractBaseName()`, `filenamesMatch()`, and `findMatchingFile()` functions

### Low Priority (Cleanup)
2. **Remove Legacy Code** - Clean up old multi-file comparison code that is no longer used:
   - `autoPairFiles()` method
   - `pairFiles()` method
   - `unpairFile()` method
   - `showPairingDialog()` method
   - `showPairConfig()` method
   - `updateExcelMatchInfo()` - now just hides the element
   - `executeExcelComparison()` - replaced by `executeExcelComparisonNewFlow()`
   - Old `removeExcelFile()` - replaced by `removeExcelFileSingle()`
   - Multi-file result selector rendering in `renderExcelResultSelector()`

### Optional Enhancements
3. **Keyboard Navigation** - Add keyboard support for searchable dropdowns (arrow keys, enter to select)
4. **Remember Last Selection** - Persist selected file pair across page refreshes
5. **Batch Comparison** - Future feature to compare multiple pairs sequentially
