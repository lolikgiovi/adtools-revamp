# Excel Compare Config - Development Plan

## Overview

This document outlines the development plan for adding Excel/CSV comparison capabilities to the Compare Config tool, along with upgrading the diff algorithm to Myers/Patience for improved character-level diff visualization.

---

## Requirements Summary

| Requirement           | Decision                                                                          |
| --------------------- | --------------------------------------------------------------------------------- |
| **File Formats**      | .xlsx, .xls, and .csv                                                             |
| **Row Matching**      | Both options: Primary key OR row position (user choice)                           |
| **Diff Granularity**  | Adaptive: 50% threshold (cell-level if >50% different, character-level otherwise) |
| **UI Integration**    | New separate tab within Compare Config                                            |
| **Folder Input**      | Recursive scanning                                                                |
| **File Matching**     | Manual pairing UI for mismatched filenames                                        |
| **Diff Engine**       | JavaScript with Web Workers (async/non-blocking)                                  |
| **Multi-version**     | Two versions only (Reference vs Comparator)                                       |
| **Export**            | View only (no export needed)                                                      |
| **Large Files**       | Virtual scrolling                                                                 |
| **DB Diff Upgrade**   | Yes, upgrade both DB and Excel to Myers/Patience                                  |
| **Typical File Size** | Medium (1,000-10,000 rows)                                                        |

---

## Architecture Overview

### Current State

```
┌─────────────────────────────────────────────────────────────┐
│                     Compare Config Tool                      │
├─────────────────────────────────────────────────────────────┤
│  Frontend (JS)              │  Backend (Rust/Tauri)         │
│  - main.js (2,666 lines)    │  - oracle.rs (1,603 lines)    │
│  - service.js               │  - Connection pooling         │
│  - template.js              │  - Query execution            │
│  - views/*.js               │  - Diff comparison            │
│                             │  - Export (JSON/CSV)          │
└─────────────────────────────────────────────────────────────┘
```

### Proposed State

```
┌─────────────────────────────────────────────────────────────┐
│                     Compare Config Tool                      │
├──────────────┬──────────────┬───────────────────────────────┤
│  DB Compare  │ Excel Compare│      Shared Components        │
│  (Tab 1)     │  (Tab 2)     │                               │
├──────────────┴──────────────┼───────────────────────────────┤
│  Frontend (JS)              │  Backend (Rust/Tauri)         │
│  - main.js                  │  - oracle.rs (DB only)        │
│  - excel-compare.js [NEW]   │                               │
│  - diff-engine.js [NEW]     │                               │
│  - diff-worker.js [NEW]     │                               │
│  - file-parser.js [NEW]     │                               │
│  - views/*.js (shared)      │                               │
└─────────────────────────────┴───────────────────────────────┘
```

---

## Phase 1: Diff Engine Migration & Enhancement ✅ COMPLETED

> **Completed:** 2026-01-17  
> **Commit:** `a32256a` - feat(compare-config): Add JavaScript diff engine for Excel comparison

### 1.1 Create JavaScript Diff Engine ✅

**Files created:**

- `frontend/tools/compare-config/lib/diff-engine.js` - Main diff logic (662 lines)
- `frontend/tools/compare-config/lib/diff-worker.js` - Web Worker (168 lines)
- `frontend/tools/compare-config/lib/diff-worker-manager.js` - Manager (347 lines)
- `frontend/tools/compare-config/tests/diff-engine.test.js` - Unit tests (447 lines)

**Implementation Details:**

- Uses `diff` (jsdiff) npm package for Myers algorithm
- Adaptive threshold logic (50% rule) implemented
- Web Worker wrapper for non-blocking execution
- Comprehensive test suite for diff engine

### 1.2 Dependencies Added ✅

```json
{
  "dependencies": {
    "diff": "^7.x.x"
  }
}
```

---

## Phase 2: Integrate JS Diff with DB Compare ✅ COMPLETED

> **Completed:** 2026-01-17  
> **Commit:** `cb9c398` - feat(compare-config): Integrate JS diff engine with DB comparison

### 2.1 Integration Components ✅

**Files created/modified:**

- `frontend/tools/compare-config/lib/diff-adapter.js` - Adapter layer (237 lines)
- `frontend/tools/compare-config/lib/feature-flags.js` - Feature flag system (113 lines)
- `frontend/tools/compare-config/main.js` - Modified (20 line changes)
- `frontend/tools/compare-config/styles.css` - Added diff styles (30 lines)
- `frontend/tools/compare-config/views/GridView.js` - Updated for new diff format (55 line changes)

### 2.2 Feature Flag System ✅

```javascript
// Feature flags implemented
const FEATURE_FLAGS = {
  USE_JS_DIFF_ENGINE: true, // Toggle for JS vs Rust diff
  JS_DIFF_DEBUG_MODE: false, // Run both engines and compare results
};
```

---

## Phase 3: Excel File Handling

### 3.1 File Parser Module

**Files to create:**

- `frontend/tools/compare-config/lib/file-parser.js`

**Dependencies:**

- `xlsx` (SheetJS) - For .xlsx and .xls parsing
- Native `FileReader` API for CSV

```javascript
class FileParser {
  // Parse any supported format
  static async parseFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();

    switch (ext) {
      case 'xlsx':
      case 'xls':
        return this.parseExcel(file);
      case 'csv':
        return this.parseCSV(file);
      default:
        throw new Error(`Unsupported format: ${ext}`);
    }
  }

  // Returns: { headers: string[], rows: any[][], metadata: {...} }
  static async parseExcel(file) { ... }
  static async parseCSV(file) { ... }
}
```

### 2.2 File/Folder Input Component

**Features:**

- Multi-file selection via `<input type="file" multiple>`
- Folder selection via `<input type="file" webkitdirectory>` (recursive by default)
- Drag-and-drop zone
- File list display with remove option

**File Matching Logic:**

```javascript
class FileMatcher {
  // Auto-match by filename
  static autoMatch(referenceFiles, comparatorFiles) {
    const matches = [];
    const unmatchedRef = [];
    const unmatchedComp = [];

    for (const ref of referenceFiles) {
      const match = comparatorFiles.find((c) => c.name === ref.name);
      if (match) {
        matches.push({ reference: ref, comparator: match });
      } else {
        unmatchedRef.push(ref);
      }
    }

    // Remaining comparator files
    unmatchedComp = comparatorFiles.filter((c) => !matches.some((m) => m.comparator.name === c.name));

    return { matches, unmatchedRef, unmatchedComp };
  }
}
```

### 2.3 Manual Pairing UI

When files don't auto-match, show pairing interface:

```
┌──────────────────────────────────────────────────────────┐
│  File Pairing Required                                   │
├────────────────────────┬─────────────────────────────────┤
│  Reference Files       │  Comparator Files               │
├────────────────────────┼─────────────────────────────────┤
│  ☑ SCHEMA1.TABLE_A.xlsx│  [Select match ▼]              │
│  ☑ SCHEMA2.TABLE_B.csv │  [Select match ▼]              │
│  ☐ SCHEMA3.TABLE_C.xlsx│  (no match available)          │
├────────────────────────┴─────────────────────────────────┤
│  Unmatched Comparator Files:                             │
│  • TABLE_A_PROD.xlsx                                     │
│  • TABLE_B_NEW.csv                                       │
└──────────────────────────────────────────────────────────┘
```

---

## Phase 4: Excel Compare Tab UI

### 4.1 Tab Structure

**Environment-Based Tab Visibility:**

- **Schema/Table** and **Raw SQL**: Tauri-only (requires Oracle client)
- **Excel Compare**: Available everywhere (web + Tauri)

```html
<!-- tabs-left with conditional visibility -->
<div class="tabs-container">
  <div class="tabs-left">
    <!-- Tauri-only tabs (hidden in web) -->
    <button class="tab-button tauri-only active" data-tab="schema-table">Schema/Table</button>
    <button class="tab-button tauri-only" data-tab="raw-sql">Raw SQL</button>

    <!-- Excel Compare - shown everywhere -->
    <button class="tab-button" data-tab="excel-compare">Excel Compare</button>
  </div>
  <div class="tabs-right">
    <!-- Connection Status Indicator (Tauri modes only) -->
    <div id="connection-status" class="connection-status" style="display: none;">...</div>
  </div>
</div>
```

**Tauri v2 Detection (using existing Runtime.js pattern):**

```javascript
// Detect Tauri v2 environment
const isTauri = !!(window.__TAURI__ || window.__TAURI_IPC__ || window.__TAURI_METADATA__ || window.__TAURI_INTERNALS__);

// Hide Tauri-only tabs in web mode
if (!isTauri) {
  document.querySelectorAll(".tab-button.tauri-only").forEach((tab) => {
    tab.style.display = "none";
  });
  // Auto-select Excel Compare tab in web mode
  selectTab("excel-compare");
}
```

**Key Points:**

- Reuse existing `tabs-left` styling - no new CSS classes needed except `.tauri-only`
- In web mode: only "Excel Compare" tab visible, auto-selected
- In Tauri mode: all three tabs visible, "Schema/Table" is default
- Connection status indicator hidden when Excel Compare tab is active

### 4.2 Excel Compare Layout

```
┌──────────────────────────────────────────────────────────────┐
│  Excel Compare                                                │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────────────────┐  ┌─────────────────────────┐    │
│  │  REFERENCE              │  │  COMPARATOR             │    │
│  │  ┌───────────────────┐  │  │  ┌───────────────────┐  │    │
│  │  │ Drop files here   │  │  │  │ Drop files here   │  │    │
│  │  │ or click to browse│  │  │  │ or click to browse│  │    │
│  │  └───────────────────┘  │  │  └───────────────────┘  │    │
│  │  📁 Select Folder       │  │  📁 Select Folder       │    │
│  │                         │  │                         │    │
│  │  Files (3):             │  │  Files (3):             │    │
│  │  • SCHEMA.TABLE1.xlsx ✕ │  │  • SCHEMA.TABLE1.xlsx ✕ │    │
│  │  • SCHEMA.TABLE2.csv  ✕ │  │  • SCHEMA.TABLE2.csv  ✕ │    │
│  │  • SCHEMA.TABLE3.xlsx ✕ │  │  • SCHEMA.TABLE3.xlsx ✕ │    │
│  └─────────────────────────┘  └─────────────────────────┘    │
│                                                               │
├──────────────────────────────────────────────────────────────┤
│  Comparison Settings                                          │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Row Matching: ○ By Primary Key  ○ By Row Position     │  │
│  │  Primary Key Column(s): [Select columns ▼] (if PK mode)│  │
│  │                                                        │  │
│  │  Data Comparison: ○ Strict (as-is)  ○ Normalized       │  │
│  │  (Normalized attempts to match dates/numbers formats)  │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
│  [Compare Files]                                              │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### 3.3 Results Display

Reuse existing view components with modifications:

- **GridView.js** - Adapt for Excel data (already table-based)
- **VerticalCardView.js** - Per-row card view
- **MasterDetailView.js** - File list + row details

**Multi-file Results Navigation:**

```
┌──────────────────────────────────────────────────────────────┐
│  Results: 3 files compared                                    │
├──────────────────────────────────────────────────────────────┤
│  📄 SCHEMA.TABLE1.xlsx  [12 matches, 3 differs, 1 only ref]  │
│  📄 SCHEMA.TABLE2.csv   [45 matches, 0 differs, 2 only comp] │
│  📄 SCHEMA.TABLE3.xlsx  [ERROR: Column mismatch]             │
├──────────────────────────────────────────────────────────────┤
│  Currently viewing: SCHEMA.TABLE1.xlsx                        │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  [Summary] [Grid View] [Card View] [Master-Detail]     │  │
│  │  ... comparison results ...                             │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## Phase 4: Virtual Scrolling Implementation

### 4.1 Virtual List Component

**File to create:**

- `frontend/tools/compare-config/lib/virtual-list.js`

```javascript
class VirtualList {
  constructor(options) {
    this.container = options.container;
    this.rowHeight = options.rowHeight || 40;
    this.buffer = options.buffer || 5; // Extra rows above/below viewport
    this.data = [];
    this.visibleRange = { start: 0, end: 0 };
  }

  setData(data) {
    this.data = data;
    this.totalHeight = data.length * this.rowHeight;
    this.render();
  }

  onScroll() {
    const scrollTop = this.container.scrollTop;
    const viewportHeight = this.container.clientHeight;

    const start = Math.max(0, Math.floor(scrollTop / this.rowHeight) - this.buffer);
    const end = Math.min(this.data.length, Math.ceil((scrollTop + viewportHeight) / this.rowHeight) + this.buffer);

    if (start !== this.visibleRange.start || end !== this.visibleRange.end) {
      this.visibleRange = { start, end };
      this.renderVisibleRows();
    }
  }

  renderVisibleRows() {
    // Only render rows in visible range
    // Use absolute positioning with transform: translateY()
  }
}
```

### 4.2 Integration with Views

Modify existing views to use VirtualList for large datasets:

```javascript
// In GridView.js
render(results) {
  if (results.rows.length > 500) {
    return this.renderVirtualized(results);
  }
  return this.renderStandard(results);
}
```

---

## Phase 5: Character-Level Diff Visualization

### 5.1 Diff Segment Rendering

```javascript
// Render character-level diff with highlighting
function renderCharDiff(segments) {
  return segments
    .map((seg) => {
      switch (seg.type) {
        case "equal":
          return `<span class="diff-equal">${escapeHtml(seg.text)}</span>`;
        case "insert":
          return `<span class="diff-insert">${escapeHtml(seg.text)}</span>`;
        case "delete":
          return `<span class="diff-delete">${escapeHtml(seg.text)}</span>`;
      }
    })
    .join("");
}
```

### 5.2 CSS Styling

```css
/* Character-level diff highlighting */
.diff-equal {
  color: inherit;
}

.diff-insert {
  background-color: #d4edda;
  color: #155724;
}

.diff-delete {
  background-color: #f8d7da;
  color: #721c24;
  text-decoration: line-through;
}

/* Dark mode */
.dark-mode .diff-insert {
  background-color: #1e4620;
  color: #75b798;
}

.dark-mode .diff-delete {
  background-color: #4a1f1f;
  color: #ea868f;
}
```

---

## Implementation Phases & Order

### Phase 1: Diff Engine (Foundation) ✅ COMPLETED

1. ~~Implement Myers diff algorithm in JS~~ ✅ Using `diff` (jsdiff) package
2. ~~Add Patience enhancement for semantic grouping~~ ✅
3. ~~Create Web Worker wrapper~~ ✅ `diff-worker.js` + `diff-worker-manager.js`
4. ~~Add adaptive threshold logic (50% rule)~~ ✅
5. ~~Unit tests for diff engine~~ ✅ `diff-engine.test.js`

### Phase 2: Integrate JS Diff with DB Compare ✅ COMPLETED

1. ~~Add feature flag for JS diff engine~~ ✅ `feature-flags.js`
2. ~~Modify comparison flow to use JS diff~~ ✅ `diff-adapter.js`
3. ~~Update views for new diff format~~ ✅ `GridView.js`
4. ~~Validate results against Rust implementation~~ ✅
5. Remove Rust diff code (keep data fetching) — _Deferred to Phase 7_

### Phase 3: File Handling Infrastructure ✅ COMPLETED

> **Completed:** 2026-01-17

1. ~~Add xlsx library dependency~~ ✅ Already in project (`xlsx@0.18.5`)
2. ~~Implement FileParser for xlsx/xls/csv~~ ✅ `lib/file-parser.js`
3. ~~Create file input components~~ ✅ Utility functions ready
4. ~~Implement FileMatcher with auto-matching~~ ✅ `lib/file-matcher.js`
5. ~~Build manual pairing UI~~ ✅ `suggestMatches()` + helpers ready

### Phase 4: Excel Compare Tab

1. Add "Excel Compare" tab to existing `tabs-left` (same level as Schema/Table, Raw SQL)
2. Create excel-compare.js controller
3. Implement file upload workflow
4. Add comparison settings (row matching mode)
5. Wire up to diff engine

### Phase 5: Results & Virtual Scrolling

1. Implement VirtualList component
2. Adapt existing views for Excel data
3. Add multi-file results navigation
4. Implement character-level diff rendering
5. Performance testing with large files

### Phase 6: Polish & Testing

1. Progress overlay for Excel comparison
2. Error handling (malformed files, encoding issues)
3. Edge cases (empty files, single row, huge cells)
4. Cross-browser testing
5. Documentation

### Phase 7: Cleanup & Rust Removal

1. Remove Rust diff code from `oracle.rs`
2. Remove feature flags (set JS as only engine)
3. Final performance validation

---

## File Structure After Implementation

```
frontend/tools/compare-config/
├── main.js                      (existing, minor modifications)
├── excel-compare.js             [NEW] Excel compare controller
├── service.js                   (existing)
├── template.js                  (modified - add tabs)
├── styles.css                   (modified - add Excel styles)
├── icon.js                      (existing)
├── lib/                         [NEW DIRECTORY]
│   ├── diff-engine.js           [NEW] Myers/Patience diff
│   ├── diff-worker.js           [NEW] Web Worker
│   ├── file-parser.js           [NEW] xlsx/csv parsing
│   ├── file-matcher.js          [NEW] File pairing logic
│   └── virtual-list.js          [NEW] Virtual scrolling
└── views/
    ├── VerticalCardView.js      (modified - diff format)
    ├── GridView.js              (modified - diff format + virtual)
    └── MasterDetailView.js      (modified - diff format)
```

---

## Dependencies

**Already in project:**

```json
{
  "dependencies": {
    "xlsx": "^0.18.5"
  }
}
```

**Added for Phase 1:**

```json
{
  "dependencies": {
    "diff": "^7.x.x"
  }
}
```

**Note:**

- SheetJS (xlsx) is ~500KB minified. Consider lazy-loading only when Excel tab is accessed.
- `diff` (jsdiff) implements Myers algorithm and is battle-tested (~5M weekly downloads). We use it instead of implementing the algorithm from scratch.

---

## Risk Assessment

| Risk                                        | Likelihood | Impact | Mitigation                           |
| ------------------------------------------- | ---------- | ------ | ------------------------------------ |
| JS diff slower than Rust for large datasets | Medium     | Medium | Web Workers + chunked processing     |
| xlsx library size impacts load time         | Low        | Low    | Lazy load on tab activation          |
| Virtual scrolling complexity                | Medium     | Medium | Start with simple impl, iterate      |
| Browser memory with 10K+ rows               | Low        | High   | Streaming parse, don't hold all data |
| File encoding issues (non-UTF8)             | Medium     | Low    | Detect encoding, provide fallback    |

---

## Design Decisions

| Question                 | Decision                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| **Sheet Selection**      | First sheet only (simplifies UX)                                                              |
| **Header Row**           | First row is always treated as column headers                                                 |
| **Data Format Handling** | User configurable - option for strict string compare OR normalized comparison (dates/numbers) |
| **Empty Cell Handling**  | Treat empty string and null as equivalent                                                     |

---

## Detailed Edge Case Specifications

### 1. Composite Primary Key Handling

**Key Concatenation:**

```javascript
// Composite keys are joined with a delimiter unlikely to appear in data
const KEY_DELIMITER = "\x00|\x00"; // null-pipe-null

function buildCompositeKey(row, keyColumns) {
  return keyColumns.map((col) => String(row[col] ?? "")).join(KEY_DELIMITER);
}

// Example: columns ['SCHEMA', 'TABLE_NAME'] with values ['HR', 'EMPLOYEES']
// Result: "HR\x00|\x00EMPLOYEES"
```

**Duplicate Key Handling (Compare all with suffix):**

```javascript
function buildKeyMaps(rows, keyColumns) {
  const keyMap = new Map(); // key -> [{ row, occurrence }]

  for (const row of rows) {
    const baseKey = buildCompositeKey(row, keyColumns);

    if (!keyMap.has(baseKey)) {
      keyMap.set(baseKey, []);
    }

    const occurrences = keyMap.get(baseKey);
    const occurrence = occurrences.length + 1;
    occurrences.push({ row, occurrence });
  }

  // Flatten to final map with suffixed keys
  const finalMap = new Map();
  for (const [baseKey, occurrences] of keyMap) {
    if (occurrences.length === 1) {
      finalMap.set(baseKey, occurrences[0].row);
    } else {
      // Add suffix for duplicates: KEY#1, KEY#2, etc.
      for (const { row, occurrence } of occurrences) {
        finalMap.set(`${baseKey}#${occurrence}`, row);
      }
    }
  }

  return finalMap;
}
```

**Null/Empty Values in Key Columns:**

- Null and empty string are treated as equivalent (empty string)
- Rows with all-null composite keys are grouped together
- Warning shown in UI: "X rows have empty primary key values"

**UI Indication:**

```
⚠ Duplicate keys detected:
  • "HR|EMPLOYEES" appears 3 times in Reference, 2 times in Comparator
  Keys will be compared with occurrence suffix (#1, #2, #3)
```

---

### 2. File Matching Logic (Folder Input)

**Matching Strategy: Relative Path Based**

```javascript
class FileMatcher {
  static autoMatch(referenceFiles, comparatorFiles, refBaseDir, compBaseDir) {
    const matches = [];
    const unmatchedRef = [];
    const unmatchedComp = new Set(comparatorFiles);

    for (const ref of referenceFiles) {
      // Get path relative to selected folder root
      const refRelativePath = this.getRelativePath(ref, refBaseDir);

      const match = comparatorFiles.find((comp) => {
        const compRelativePath = this.getRelativePath(comp, compBaseDir);
        return this.pathsMatch(refRelativePath, compRelativePath);
      });

      if (match) {
        matches.push({ reference: ref, comparator: match });
        unmatchedComp.delete(match);
      } else {
        unmatchedRef.push(ref);
      }
    }

    return {
      matches,
      unmatchedRef,
      unmatchedComp: [...unmatchedComp],
    };
  }

  static pathsMatch(path1, path2) {
    // Case-insensitive comparison for cross-platform compatibility
    return path1.toLowerCase() === path2.toLowerCase();
  }

  static getRelativePath(file, baseDir) {
    // file.webkitRelativePath gives full path from folder root
    // e.g., "selected-folder/UAT/config.xlsx" -> "UAT/config.xlsx"
    return file.webkitRelativePath.substring(baseDir.length + 1);
  }
}
```

**Extension Handling:**

- Files with same path but different extensions are NOT auto-matched
- Example: `config.xlsx` and `config.csv` are considered different files
- User can manually pair them in the pairing UI if desired

**Case Sensitivity:**

- All path comparisons are **case-insensitive**
- Handles Windows (case-insensitive) vs macOS/Linux (case-sensitive) scenarios

**UI Display:**

```
Reference Folder: /Users/dev/before-deploy/
├── UAT/SCHEMA.USERS.xlsx
├── UAT/SCHEMA.ROLES.csv
└── PROD/SCHEMA.USERS.xlsx

Comparator Folder: /Users/dev/after-deploy/
├── UAT/SCHEMA.USERS.xlsx     ✓ Matched
├── UAT/SCHEMA.ROLES.xlsx     ⚠ Extension differs (.csv vs .xlsx)
└── PROD/SCHEMA.USERS.xlsx    ✓ Matched
```

---

### 3. Multi-Sheet Handling

**Sheet Selection: First sheet by index (index 0)**

```javascript
async function parseExcel(file) {
  const workbook = XLSX.read(await file.arrayBuffer());

  // Always use first sheet by index
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];

  const metadata = {
    fileName: file.name,
    sheetName: firstSheetName,
    totalSheets: workbook.SheetNames.length,
    allSheetNames: workbook.SheetNames,
  };

  // Parse sheet to JSON
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  return { data, metadata };
}
```

**Multi-Sheet Warning:**

- If file has more than one sheet, show info banner (not blocking):

```
ℹ This file has 3 sheets: ["Config", "Lookup", "Archive"]
  Only the first sheet "Config" will be compared.
```

**Different Sheet Names Between Files:**

- Sheet names don't need to match
- Comparison is data-based, not name-based
- Metadata shows which sheet was used from each file

---

### 4. Column Mismatch Handling

**Strategy: Compare common columns, report differences**

```javascript
function reconcileColumns(refHeaders, compHeaders) {
  const refSet = new Set(refHeaders.map((h) => h.toLowerCase()));
  const compSet = new Set(compHeaders.map((h) => h.toLowerCase()));

  const common = refHeaders.filter((h) => compSet.has(h.toLowerCase()));
  const onlyInRef = refHeaders.filter((h) => !compSet.has(h.toLowerCase()));
  const onlyInComp = compHeaders.filter((h) => !refSet.has(h.toLowerCase()));

  return {
    common, // Columns to compare
    onlyInRef, // Extra columns in Reference
    onlyInComp, // Extra columns in Comparator
    isExactMatch: onlyInRef.length === 0 && onlyInComp.length === 0,
  };
}
```

**Column Order:**

- Column order differences are **ignored**
- Matching is by column name (case-insensitive)
- Original order preserved in output for each file

**UI Display for Column Differences:**

```
┌──────────────────────────────────────────────────────────────┐
│  ⚠ Column Structure Differences                              │
├──────────────────────────────────────────────────────────────┤
│  Comparing 8 common columns                                  │
│                                                              │
│  Columns only in Reference (2):                              │
│    • CREATED_DATE                                            │
│    • LEGACY_FLAG                                             │
│                                                              │
│  Columns only in Comparator (1):                             │
│    • UPDATED_TIMESTAMP                                       │
└──────────────────────────────────────────────────────────────┘
```

**Edge Cases:**

- If **zero** common columns: Show error, cannot compare
- If only primary key columns are common: Warning, but allow comparison
- Empty column names: Assigned placeholder names (`Column_A`, `Column_B`, etc.)

---

### 5. Web Worker Error Handling

**Worker Architecture:**

```javascript
// diff-worker-manager.js - Main thread manager
class DiffWorkerManager {
  constructor() {
    this.worker = null;
    this.pendingTasks = new Map(); // taskId -> { resolve, reject, timeout }
    this.TIMEOUT_MS = 120000; // 2 minutes
  }

  async initialize() {
    this.worker = new Worker("./lib/diff-worker.js");

    this.worker.onmessage = (event) => this.handleMessage(event);
    this.worker.onerror = (event) => this.handleError(event);
  }

  async compare(data, options) {
    const taskId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      // Set timeout
      const timeoutId = setTimeout(() => {
        this.pendingTasks.delete(taskId);
        reject(new Error("Comparison timed out after 2 minutes"));
        this.restartWorker(); // Recover by restarting worker
      }, this.TIMEOUT_MS);

      this.pendingTasks.set(taskId, { resolve, reject, timeoutId });

      this.worker.postMessage({ taskId, type: "compare", data, options });
    });
  }

  handleMessage(event) {
    const { taskId, result, error, progress } = event.data;

    if (progress) {
      // Progress update, emit to UI
      this.onProgress?.(progress);
      return;
    }

    const task = this.pendingTasks.get(taskId);
    if (!task) return;

    clearTimeout(task.timeoutId);
    this.pendingTasks.delete(taskId);

    if (error) {
      task.reject(new Error(error));
    } else {
      task.resolve(result);
    }
  }

  handleError(event) {
    // Worker crashed - reject all pending tasks and restart
    console.error("Worker crashed:", event);

    for (const [taskId, task] of this.pendingTasks) {
      clearTimeout(task.timeoutId);
      task.reject(new Error("Worker crashed unexpectedly"));
    }
    this.pendingTasks.clear();

    this.restartWorker();
  }

  restartWorker() {
    this.worker?.terminate();
    this.initialize();
  }
}
```

**Progress Reporting:**

```javascript
// Inside diff-worker.js
function compareWithProgress(refData, compData, options) {
  const totalRows = refData.length + compData.length;
  let processed = 0;

  // Report progress every 100 rows or 5%
  const reportInterval = Math.max(100, Math.floor(totalRows * 0.05));

  for (const row of refData) {
    // ... comparison logic ...

    processed++;
    if (processed % reportInterval === 0) {
      self.postMessage({
        progress: {
          phase: "comparing",
          processed,
          total: totalRows,
          percent: Math.round((processed / totalRows) * 100),
        },
      });
    }
  }
}
```

**UI Progress Display:**

```
┌────────────────────────────────────────────────┐
│  Comparing files...                            │
│  ████████████░░░░░░░░  62%                     │
│  Processing row 6,200 of 10,000                │
└────────────────────────────────────────────────┘
```

---

### 6. Normalized Comparison Mode Specification

**Supported Formats:**

**Date Recognition (parsed via Date.parse and patterns):**

```javascript
const DATE_PATTERNS = [
  // ISO 8601
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/, // 2024-01-15, 2024-01-15T10:30:00
  // US format
  /^\d{1,2}\/\d{1,2}\/\d{2,4}$/, // 01/15/2024, 1/15/24
  // European format
  /^\d{1,2}-\d{1,2}-\d{2,4}$/, // 15-01-2024
  // Text month
  /^\d{1,2}-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2,4}$/i, // 15-Jan-2024
  // Excel serial number (days since 1900-01-01)
  /^\d{5}$/, // 45306 = 2024-01-15
];

function normalizeDate(value) {
  // Convert to ISO date string (YYYY-MM-DD) for comparison
  const date = parseDate(value);
  if (date && !isNaN(date.getTime())) {
    return date.toISOString().split("T")[0]; // "2024-01-15"
  }
  return null; // Not a recognized date
}
```

**Number Normalization:**

```javascript
function normalizeNumber(value) {
  if (typeof value === "number") return value;

  const str = String(value).trim();

  // Handle locale-specific formats
  // European: 1.234,56 -> 1234.56
  // US: 1,234.56 -> 1234.56

  // Detect format by last separator
  const lastComma = str.lastIndexOf(",");
  const lastDot = str.lastIndexOf(".");

  let normalized;
  if (lastComma > lastDot) {
    // European format: comma is decimal separator
    normalized = str.replace(/\./g, "").replace(",", ".");
  } else {
    // US format: dot is decimal separator
    normalized = str.replace(/,/g, "");
  }

  const num = parseFloat(normalized);

  // Precision: round to 10 decimal places to avoid floating point issues
  return isNaN(num) ? null : Math.round(num * 1e10) / 1e10;
}
```

**Comparison Logic:**

```javascript
function compareValues(val1, val2, normalize = false) {
  if (!normalize) {
    // Strict: compare as strings
    return String(val1 ?? "") === String(val2 ?? "");
  }

  // Normalized comparison
  // Try date first
  const date1 = normalizeDate(val1);
  const date2 = normalizeDate(val2);
  if (date1 && date2) {
    return date1 === date2;
  }

  // Try number
  const num1 = normalizeNumber(val1);
  const num2 = normalizeNumber(val2);
  if (num1 !== null && num2 !== null) {
    return num1 === num2;
  }

  // Fall back to string comparison
  return String(val1 ?? "").trim() === String(val2 ?? "").trim();
}
```

**Locale Handling:**

- Detection is automatic based on separator positions
- No explicit locale configuration required
- If ambiguous (e.g., `1,234`), treated as thousand-separated integer

---

### 7. Progressive Loading & Streaming Results UX

**Core Principle:** Users should see results as soon as they're ready, not wait for all files to complete.

**Architecture Overview:**

```
┌─────────────────────────────────────────────────────────────────┐
│                    Main Thread (UI)                              │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  FileComparisonQueue                                     │    │
│  │  - Manages file pairs                                    │    │
│  │  - Tracks per-file status                                │    │
│  │  - Emits events for UI updates                           │    │
│  └─────────────────────────────────────────────────────────┘    │
│                           │                                      │
│                           ▼                                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Results Panel (reactive)                                │    │
│  │  - Shows completed diffs immediately                     │    │
│  │  - Pending files show skeleton/spinner                   │    │
│  │  - User can browse completed while others process        │    │
│  └─────────────────────────────────────────────────────────┘    │
│                           │                                      │
└───────────────────────────│──────────────────────────────────────┘
                            │ postMessage
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Web Worker Thread                             │
│  - Processes one file pair at a time                            │
│  - Reports progress per file                                    │
│  - Sends completed results back immediately                     │
└─────────────────────────────────────────────────────────────────┘
```

**File Queue State Machine:**

```javascript
const FileStatus = {
  QUEUED: "queued", // Waiting to be processed
  PARSING: "parsing", // Reading Excel/CSV file
  COMPARING: "comparing", // Running diff algorithm
  COMPLETED: "completed", // Done, results available
  ERROR: "error", // Failed with error
};

class FileComparisonQueue extends EventTarget {
  constructor(workerManager) {
    super();
    this.workerManager = workerManager;
    this.files = new Map(); // fileId -> { status, progress, result, error }
    this.processingOrder = [];
  }

  addFilePair(reference, comparator, options) {
    const fileId = crypto.randomUUID();

    this.files.set(fileId, {
      id: fileId,
      reference: reference.name,
      comparator: comparator.name,
      status: FileStatus.QUEUED,
      progress: 0,
      result: null,
      error: null,
      startTime: null,
      endTime: null,
    });

    this.processingOrder.push(fileId);
    this.emit("file-added", { fileId });

    return fileId;
  }

  async processAll() {
    // Process files sequentially (or parallel with concurrency limit)
    for (const fileId of this.processingOrder) {
      await this.processFile(fileId);
    }
  }

  async processFile(fileId) {
    const file = this.files.get(fileId);
    file.startTime = Date.now();

    try {
      // Phase 1: Parsing
      this.updateStatus(fileId, FileStatus.PARSING, 0);
      const [refData, compData] = await Promise.all([this.parseFile(file.reference), this.parseFile(file.comparator)]);

      // Phase 2: Comparing
      this.updateStatus(fileId, FileStatus.COMPARING, 0);

      const result = await this.workerManager.compare(refData, compData, {
        onProgress: (progress) => {
          this.updateProgress(fileId, progress.percent);
        },
      });

      // Phase 3: Complete - result immediately available!
      file.result = result;
      file.endTime = Date.now();
      this.updateStatus(fileId, FileStatus.COMPLETED, 100);
    } catch (error) {
      file.error = error.message;
      file.endTime = Date.now();
      this.updateStatus(fileId, FileStatus.ERROR, 0);
    }
  }

  updateStatus(fileId, status, progress) {
    const file = this.files.get(fileId);
    file.status = status;
    file.progress = progress;

    // Emit event for UI to react
    this.emit("file-status-changed", {
      fileId,
      status,
      progress,
      result: file.result,
    });
  }

  emit(eventName, detail) {
    this.dispatchEvent(new CustomEvent(eventName, { detail }));
  }

  // Get all files with their current status
  getStatus() {
    return Array.from(this.files.values());
  }

  // Get only completed results
  getCompletedResults() {
    return Array.from(this.files.values())
      .filter((f) => f.status === FileStatus.COMPLETED)
      .map((f) => ({ id: f.id, name: f.reference, result: f.result }));
  }
}
```

**UI Layout - Progressive Results:**

```
┌──────────────────────────────────────────────────────────────────┐
│  Comparing 5 files...                                   [Cancel] │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  File Status                                                     │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ ✓ SCHEMA.USERS.xlsx      Done (1.2s)         [View Results]│ │
│  │ ✓ SCHEMA.ROLES.xlsx      Done (0.8s)         [View Results]│ │
│  │ ◉ SCHEMA.PERMISSIONS.csv Comparing... 67%    ████████░░░░  │ │
│  │ ○ SCHEMA.CONFIG.xlsx     Queued                            │ │
│  │ ○ SCHEMA.SETTINGS.xlsx   Queued                            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Overall: 2/5 complete                    ████████░░░░░░░ 40%   │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  Currently Viewing: SCHEMA.USERS.xlsx                            │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Summary: 145 rows | 142 match | 2 differ | 1 only in ref  │ │
│  │                                                            │ │
│  │  [Expandable] [Grid] [Cards] [Master-Detail]               │ │
│  │                                                            │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │ STATUS │ KEY        │ FIELD_A      │ FIELD_B        │ │ │
│  │  ├────────┼────────────┼──────────────┼────────────────┤ │ │
│  │  │ DIFFER │ USER_001   │ John → Johan │ Active         │ │ │
│  │  │ DIFFER │ USER_042   │ Admin        │ true → false   │ │ │
│  │  │ ONLY_1 │ USER_099   │ Legacy       │ Disabled       │ │ │
│  │  │ MATCH  │ USER_002   │ Jane         │ Active         │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

**Skeleton Loading State for Pending Files:**

```html
<!-- When user clicks on a file still being processed -->
<div class="comparison-result skeleton">
  <div class="summary-skeleton">
    <div class="skeleton-bar" style="width: 60%"></div>
    <div class="skeleton-badges">
      <span class="skeleton-badge"></span>
      <span class="skeleton-badge"></span>
      <span class="skeleton-badge"></span>
    </div>
  </div>

  <div class="progress-overlay">
    <div class="spinner"></div>
    <p>Comparing SCHEMA.PERMISSIONS.csv...</p>
    <div class="progress-bar">
      <div class="progress-fill" style="width: 67%"></div>
    </div>
    <p class="progress-detail">Processing row 6,700 of 10,000</p>
  </div>
</div>
```

**CSS for Skeleton & Progress:**

```css
/* Skeleton loading animation */
.skeleton-bar,
.skeleton-badge {
  background: linear-gradient(90deg, var(--skeleton-base) 25%, var(--skeleton-highlight) 50%, var(--skeleton-base) 75%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s infinite;
  border-radius: 4px;
}

@keyframes skeleton-shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

/* File status indicators */
.file-status-item {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border-radius: 6px;
  transition: background-color 0.2s;
}

.file-status-item.completed {
  cursor: pointer;
}

.file-status-item.completed:hover {
  background-color: var(--hover-bg);
}

.file-status-item.processing {
  background-color: var(--processing-bg);
}

.status-icon {
  width: 20px;
  margin-right: 12px;
}

.status-icon.queued {
  color: var(--text-muted);
}
.status-icon.processing {
  color: var(--accent-blue);
}
.status-icon.completed {
  color: var(--accent-green);
}
.status-icon.error {
  color: var(--accent-red);
}

/* Inline progress bar */
.inline-progress {
  flex: 1;
  height: 4px;
  background: var(--progress-track);
  border-radius: 2px;
  margin-left: 12px;
  overflow: hidden;
}

.inline-progress-fill {
  height: 100%;
  background: var(--accent-blue);
  transition: width 0.3s ease-out;
}

/* Dark mode */
.dark-mode {
  --skeleton-base: #2a2a2a;
  --skeleton-highlight: #3a3a3a;
  --processing-bg: rgba(59, 130, 246, 0.1);
}
```

**Reactive UI Binding:**

```javascript
class ExcelCompareUI {
  constructor() {
    this.queue = null;
    this.selectedFileId = null;
  }

  startComparison(filePairs, options) {
    this.queue = new FileComparisonQueue(diffWorkerManager);

    // Add all file pairs to queue
    for (const pair of filePairs) {
      this.queue.addFilePair(pair.reference, pair.comparator, options);
    }

    // Listen for status changes
    this.queue.addEventListener("file-status-changed", (e) => {
      this.renderFileList();

      // Auto-select first completed file if nothing selected
      if (e.detail.status === FileStatus.COMPLETED && !this.selectedFileId) {
        this.selectFile(e.detail.fileId);
      }

      // If currently viewing this file, update the result panel
      if (e.detail.fileId === this.selectedFileId) {
        this.renderResultPanel(e.detail);
      }
    });

    // Start processing (non-blocking)
    this.queue.processAll();

    // Immediately show the file list with queued status
    this.renderFileList();
  }

  selectFile(fileId) {
    this.selectedFileId = fileId;
    const file = this.queue.files.get(fileId);

    this.renderFileList(); // Update selection highlight
    this.renderResultPanel(file);
  }

  renderFileList() {
    const files = this.queue.getStatus();
    const container = this.$(".file-status-list");

    container.innerHTML = files
      .map(
        (file) => `
      <div class="file-status-item ${file.status} ${file.id === this.selectedFileId ? "selected" : ""}"
           data-file-id="${file.id}"
           ${file.status === FileStatus.COMPLETED ? "onclick=\"excelCompare.selectFile('" + file.id + "')\"" : ""}>

        <span class="status-icon">${this.getStatusIcon(file.status)}</span>
        <span class="file-name">${file.reference}</span>

        ${
          file.status === FileStatus.COMPLETED
            ? `
          <span class="duration">(${((file.endTime - file.startTime) / 1000).toFixed(1)}s)</span>
          <button class="view-btn">View Results</button>
        `
            : ""
        }

        ${
          file.status === FileStatus.COMPARING
            ? `
          <span class="progress-text">${file.progress}%</span>
          <div class="inline-progress">
            <div class="inline-progress-fill" style="width: ${file.progress}%"></div>
          </div>
        `
            : ""
        }

        ${
          file.status === FileStatus.PARSING
            ? `
          <span class="progress-text">Parsing...</span>
        `
            : ""
        }

        ${
          file.status === FileStatus.QUEUED
            ? `
          <span class="progress-text queued">Queued</span>
        `
            : ""
        }

        ${
          file.status === FileStatus.ERROR
            ? `
          <span class="error-text" title="${file.error}">Error</span>
        `
            : ""
        }
      </div>
    `,
      )
      .join("");
  }

  renderResultPanel(file) {
    const panel = this.$(".result-panel");

    if (file.status === FileStatus.COMPLETED) {
      // Show full results
      panel.innerHTML = this.renderCompletedResult(file.result);
    } else if (file.status === FileStatus.COMPARING || file.status === FileStatus.PARSING) {
      // Show skeleton with progress
      panel.innerHTML = this.renderProgressSkeleton(file);
    } else if (file.status === FileStatus.ERROR) {
      // Show error state
      panel.innerHTML = this.renderErrorState(file);
    } else {
      // Queued - show waiting state
      panel.innerHTML = this.renderQueuedState(file);
    }
  }

  getStatusIcon(status) {
    const icons = {
      [FileStatus.QUEUED]: "○",
      [FileStatus.PARSING]: "◐",
      [FileStatus.COMPARING]: "◉",
      [FileStatus.COMPLETED]: "✓",
      [FileStatus.ERROR]: "✕",
    };
    return icons[status];
  }
}
```

**Parallel Processing Option (Advanced):**

```javascript
class FileComparisonQueue {
  constructor(workerManager, options = {}) {
    this.concurrency = options.concurrency || 1; // Process N files at once
    this.activeCount = 0;
  }

  async processAll() {
    const pending = [...this.processingOrder];

    const processNext = async () => {
      if (pending.length === 0) return;
      if (this.activeCount >= this.concurrency) return;

      this.activeCount++;
      const fileId = pending.shift();

      await this.processFile(fileId);

      this.activeCount--;
      processNext(); // Start next file
    };

    // Start up to `concurrency` files at once
    const starters = [];
    for (let i = 0; i < this.concurrency; i++) {
      starters.push(processNext());
    }

    await Promise.all(starters);
  }
}

// Usage: Process 2 files in parallel
const queue = new FileComparisonQueue(workerManager, { concurrency: 2 });
```

**User Experience Flow:**

1. **User uploads 5 files** → All appear in list as "Queued"
2. **Processing starts** → First file shows "Parsing..." then "Comparing 23%"
3. **First file completes** → Status changes to ✓, "View Results" button appears
4. **User clicks completed file** → Full diff results shown immediately
5. **User continues browsing** → Background files keep processing
6. **Second file completes** → Notification appears, list updates
7. **All files complete** → Overall progress shows 100%, processing time summary

**Cancel/Abort Support:**

```javascript
class FileComparisonQueue {
  constructor() {
    this.abortController = new AbortController();
  }

  cancel() {
    this.abortController.abort();

    // Mark all non-completed files as cancelled
    for (const file of this.files.values()) {
      if (file.status !== FileStatus.COMPLETED) {
        file.status = FileStatus.CANCELLED;
        file.error = "Cancelled by user";
      }
    }

    this.emit("cancelled");
  }
}
```

---

### 8. Migration & Feature Flag Strategy

**Flag Storage:**

```javascript
// In frontend/tools/compare-config/main.js
const FEATURE_FLAGS = {
  USE_JS_DIFF_ENGINE: true, // Toggle for JS vs Rust diff
  JS_DIFF_DEBUG_MODE: false, // Run both engines and compare results
};

// Could also be stored in localStorage for testing
function getFeatureFlag(name) {
  const override = localStorage.getItem(`compare-config:flag:${name}`);
  if (override !== null) {
    return override === "true";
  }
  return FEATURE_FLAGS[name] ?? false;
}
```

**Debug Mode (Parallel Execution):**

```javascript
async function compareWithValidation(data, options) {
  if (getFeatureFlag("JS_DIFF_DEBUG_MODE")) {
    // Run both engines
    const [jsResult, rustResult] = await Promise.all([
      diffWorkerManager.compare(data, options),
      CompareConfigService.compareConfigurations(data, options), // Rust
    ]);

    // Validate results match
    const mismatches = validateResults(jsResult, rustResult);
    if (mismatches.length > 0) {
      console.error("Diff engine mismatch:", mismatches);
      // Log to analytics/monitoring
      reportDiffEngineMismatch(mismatches);
    }

    // Return JS result (primary)
    return jsResult;
  }

  // Normal mode: JS only
  return diffWorkerManager.compare(data, options);
}
```

**Rollback Plan:**

```javascript
async function compareData(data, options) {
  if (!getFeatureFlag("USE_JS_DIFF_ENGINE")) {
    // Fallback to Rust (rollback mode)
    return CompareConfigService.compareConfigurations(data, options);
  }

  try {
    return await diffWorkerManager.compare(data, options);
  } catch (error) {
    console.error("JS diff engine failed, falling back to Rust:", error);

    // Auto-fallback on failure
    return CompareConfigService.compareConfigurations(data, options);
  }
}
```

**Migration Timeline:**

| Phase                       | Flag State                  | Behavior                              |
| --------------------------- | --------------------------- | ------------------------------------- |
| **Phase 1: Development**    | `USE_JS_DIFF_ENGINE: false` | Rust only, JS in development          |
| **Phase 2: Validation**     | `JS_DIFF_DEBUG_MODE: true`  | Both engines, compare results         |
| **Phase 3: Soft Launch**    | `USE_JS_DIFF_ENGINE: true`  | JS primary, Rust fallback on error    |
| **Phase 4: Full Migration** | Remove fallback code        | JS only, Rust diff code removed       |
| **Phase 5: Cleanup**        | Remove flags                | Delete Rust `compare_data()` function |

**Rust Code Removal Criteria:**

1. JS engine running in production for 2+ weeks
2. Zero fallback invocations logged
3. Performance metrics acceptable (< 2x slower than Rust for same data)
4. All edge cases validated (null handling, Unicode, large datasets)

**Code to Remove from `oracle.rs`:**

- `compare_data()` function (lines 825-947)
- `CompareResult`, `CompareRow`, `CompareSummary` structs
- Keep: `execute_select()`, connection pooling, credential management

---

## Success Criteria

- [ ] Excel files (.xlsx, .xls, .csv) can be loaded and compared
- [ ] Folder upload works with recursive scanning
- [ ] Manual file pairing UI functional for mismatched names
- [ ] Both row matching modes work (PK and position)
- [ ] Adaptive diff shows cell-level or char-level appropriately
- [ ] Virtual scrolling handles 10K rows smoothly
- [ ] DB Compare also uses new diff engine
- [ ] UI remains responsive during comparison (Web Worker)
- [ ] Dark mode fully supported
