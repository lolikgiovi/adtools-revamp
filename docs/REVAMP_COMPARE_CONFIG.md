# Unified Compare Config Flow - Implementation Plan

## Overview

Implement a unified comparison flow that allows mixing Oracle database queries with Excel files as data sources, supporting all four use cases:

1. **UAT vs UAT** (Oracle vs Oracle) - Already supported
2. **UAT vs Production** (Oracle vs Excel) - NEW
3. **Production vs Backup** (Excel vs Excel) - Already supported
4. **Production vs UAT** (Excel vs Oracle) - NEW

## Current Architecture Analysis

### Existing Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CURRENT ARCHITECTURE                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Schema/Table Mode          Raw SQL Mode           Excel Compare Mode        │
│  ─────────────────         ─────────────          ──────────────────        │
│  Oracle Env1 ──┐           Oracle Env1 ──┐        Excel File1 ──┐           │
│                ├─► Rust    │              ├─► Rust              │           │
│  Oracle Env2 ──┘           Oracle Env2 ──┘        Excel File2 ──┼─► JS      │
│                                                                  │           │
│  Result Format:            Result Format:          Result Format:│           │
│  CompareResult             CompareResult           CompareResult │           │
│  (from Rust)               (from Rust)             (converted)   │           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `main.js` | `frontend/tools/compare-config/main.js` | UI state, flow orchestration |
| `service.js` | `frontend/tools/compare-config/service.js` | Tauri backend API wrapper |
| `oracle.rs` | `tauri/src/oracle.rs` | Oracle queries, comparison |
| `diff-engine.js` | `frontend/tools/compare-config/lib/diff-engine.js` | JS comparison logic |
| `diff-adapter.js` | `frontend/tools/compare-config/lib/diff-adapter.js` | Format conversion |
| `file-parser.js` | `frontend/tools/compare-config/lib/file-parser.js` | Excel/CSV parsing |
| `template.js` | `frontend/tools/compare-config/template.js` | HTML structure |

### Unified Data Model (Already Exists)

Both Oracle and Excel data converge to the same format for comparison:
```javascript
{
  headers: string[],           // Column names
  rows: Object[],              // Array of { columnName: value }
  metadata: {
    fileName?: string,         // Excel only
    rowCount: number,
    columnCount: number
  }
}
```

---

## Proposed Architecture

### New Unified Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           UNIFIED ARCHITECTURE                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  STEP 1: Source Selection (per side)                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  Source A (Reference)          │    Source B (Comparator)           │    │
│  │  ○ Oracle Database             │    ○ Oracle Database               │    │
│  │  ○ Excel/CSV File              │    ○ Excel/CSV File                │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  STEP 2: Source Configuration (dynamic per type)                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  If Oracle:                    │    If Oracle:                      │    │
│  │  - Connection dropdown         │    - Connection dropdown           │    │
│  │  - Mode: Table or Raw SQL      │    - Mode: Table or Raw SQL        │    │
│  │  - Schema/Table or SQL input   │    - Schema/Table or SQL input     │    │
│  │                                │                                    │    │
│  │  If Excel:                     │    If Excel:                       │    │
│  │  - File upload zone            │    - File upload zone              │    │
│  │  - File selection dropdown     │    - File selection dropdown       │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  STEP 3: Data Fetch & Normalization                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  Oracle → fetch_oracle_data() → NormalizedDataset                   │    │
│  │  Excel  → parse_excel_file()  → NormalizedDataset                   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  STEP 4: Field Reconciliation                                                │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  - Show common fields (can compare)                                  │    │
│  │  - Show fields only in Source A                                      │    │
│  │  - Show fields only in Source B                                      │    │
│  │  - Select primary key fields                                         │    │
│  │  - Select comparison fields                                          │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  STEP 5: Compare using diff-engine.js                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  compareDatasets(sourceAData, sourceBData, options)                  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  STEP 6: Display Results (existing views)                                    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: New Tauri Command for Oracle Data Fetch

**File:** `tauri/src/oracle.rs`

Add a new command that fetches Oracle data and returns it in the normalized format (without comparison):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchDataRequest {
    pub connection_name: String,
    pub config: ConnectionConfig,
    pub mode: String,              // "table" or "raw-sql"
    // Table mode fields
    pub owner: Option<String>,
    pub table_name: Option<String>,
    pub where_clause: Option<String>,
    // Raw SQL mode fields
    pub sql: Option<String>,
    pub max_rows: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FetchDataResult {
    pub headers: Vec<String>,
    pub rows: Vec<HashMap<String, serde_json::Value>>,
    pub row_count: usize,
    pub source_name: String,  // connection name or "table_name"
}

#[tauri::command]
pub fn fetch_oracle_data(request: FetchDataRequest) -> Result<FetchDataResult, String>
```

### Phase 2: Unified Data Service Layer

**File:** `frontend/tools/compare-config/lib/unified-data-service.js` (NEW)

```javascript
/**
 * Unified Data Service
 * Abstracts data fetching from Oracle and Excel sources
 */

export const SourceType = {
  ORACLE_TABLE: 'oracle-table',
  ORACLE_SQL: 'oracle-sql',
  EXCEL: 'excel'
};

export class UnifiedDataService {
  /**
   * Fetch data from any source type
   * @returns {Promise<NormalizedDataset>}
   */
  static async fetchData(sourceConfig) {
    switch (sourceConfig.type) {
      case SourceType.ORACLE_TABLE:
        return this.fetchOracleTableData(sourceConfig);
      case SourceType.ORACLE_SQL:
        return this.fetchOracleSqlData(sourceConfig);
      case SourceType.EXCEL:
        return this.fetchExcelData(sourceConfig);
    }
  }

  /**
   * Reconcile columns between two datasets
   */
  static reconcileColumns(datasetA, datasetB) {
    // Use existing reconcileColumns from diff-engine.js
  }
}
```

### Phase 3: UI State Restructure

**File:** `frontend/tools/compare-config/main.js`

Restructure state to support unified source selection:

```javascript
// NEW unified state structure
this.unified = {
  // Source A (Reference)
  sourceA: {
    type: null,           // 'oracle' or 'excel'
    // Oracle config
    connection: null,     // { name, connect_string }
    queryMode: 'table',   // 'table' or 'sql'
    schema: null,
    table: null,
    sql: '',
    whereClause: '',
    maxRows: 100,
    // Excel config
    files: [],            // Array of { id, file }
    selectedFile: null,   // { id, file }
    parsedData: null,     // { headers, rows, metadata }
    // Fetched data (normalized)
    data: null,           // { headers: [], rows: [], sourceName: '' }
    dataLoaded: false,
  },

  // Source B (Comparator)
  sourceB: {
    type: null,
    connection: null,
    queryMode: 'table',
    schema: null,
    table: null,
    sql: '',
    whereClause: '',
    maxRows: 100,
    files: [],
    selectedFile: null,
    parsedData: null,
    data: null,
    dataLoaded: false,
  },

  // Field reconciliation (computed when both sources have data)
  fields: {
    common: [],           // [{ normalized, sourceA, sourceB }]
    onlyInA: [],          // ['FIELD1', 'FIELD2']
    onlyInB: [],          // ['field3', 'field4']
  },

  // User selections
  selectedPkFields: [],       // Normalized field names
  selectedCompareFields: [],  // Normalized field names

  // Comparison options
  options: {
    rowMatching: 'key',       // 'key' or 'position'
    dataComparison: 'strict', // 'strict' or 'normalized'
  },

  // UI state
  currentStep: 1,  // 1=source-config, 2=field-selection, 3=results
};
```

**Key State Transitions:**

```
Step 1: Source Configuration
├─ User selects Source A type (oracle/excel)
├─ User configures Source A (connection+table/sql OR file)
├─ User selects Source B type (oracle/excel)
├─ User configures Source B
└─ When both sources configured → "Load Data" button enabled

Step 2: Field Selection (after data loaded)
├─ reconcileColumns() computes common/onlyInA/onlyInB
├─ Show field mismatch warning if applicable
├─ User selects PK fields from common fields
├─ User selects comparison fields from common fields
└─ When PK selected → "Compare" button enabled

Step 3: Results
└─ Display comparison results using existing views
```

### Phase 4: Template Updates

**File:** `frontend/tools/compare-config/template.js`

Replace the current tab-based UI with a unified source selection interface:

```html
<!-- Quick Presets -->
<div class="comparison-presets">
  <span class="preset-label">Quick Setup:</span>
  <button class="preset-btn" data-preset="oracle-oracle">Oracle vs Oracle</button>
  <button class="preset-btn" data-preset="excel-excel">Excel vs Excel</button>
  <button class="preset-btn" data-preset="oracle-excel">Oracle vs Excel</button>
</div>

<!-- Unified Source Selection -->
<div class="unified-compare-mode">
  <div class="source-panels">
    <!-- Source A (Reference) -->
    <div class="source-panel source-a">
      <h4>Source A (Reference)</h4>

      <!-- Source Type Selection -->
      <div class="source-type-selector">
        <label class="source-type-option">
          <input type="radio" name="source-a-type" value="oracle">
          <span class="option-label">Oracle Database</span>
        </label>
        <label class="source-type-option">
          <input type="radio" name="source-a-type" value="excel">
          <span class="option-label">Excel/CSV File</span>
        </label>
      </div>

      <!-- Oracle Config (shown when Oracle selected) -->
      <div class="oracle-config" id="source-a-oracle-config" style="display:none">
        <!-- Connection Selection -->
        <div class="form-group">
          <label>Connection</label>
          <select id="source-a-connection" class="form-select">
            <option value="">Select connection...</option>
          </select>
        </div>

        <!-- Query Mode Selection (Table vs Raw SQL) -->
        <div class="query-mode-selector">
          <label class="query-mode-option">
            <input type="radio" name="source-a-query-mode" value="table" checked>
            <span>Select Table</span>
          </label>
          <label class="query-mode-option">
            <input type="radio" name="source-a-query-mode" value="sql">
            <span>Raw SQL Query</span>
          </label>
        </div>

        <!-- Table Mode Config -->
        <div class="table-mode-config" id="source-a-table-config">
          <div class="form-group">
            <label>Schema</label>
            <select id="source-a-schema" class="form-select" disabled>
              <option value="">Select connection first...</option>
            </select>
          </div>
          <div class="form-group">
            <label>Table</label>
            <select id="source-a-table" class="form-select" disabled>
              <option value="">Select schema first...</option>
            </select>
          </div>
          <div class="form-group">
            <label>WHERE Clause (optional)</label>
            <input type="text" id="source-a-where" class="form-input"
                   placeholder="e.g., status = 'ACTIVE'">
          </div>
        </div>

        <!-- Raw SQL Mode Config -->
        <div class="sql-mode-config" id="source-a-sql-config" style="display:none">
          <div class="form-group">
            <label>SQL Query</label>
            <textarea id="source-a-sql" class="form-textarea"
                      placeholder="SELECT * FROM schema.table WHERE ..."></textarea>
          </div>
        </div>

        <!-- Common Oracle Options -->
        <div class="form-group">
          <label>Max Rows</label>
          <input type="number" id="source-a-max-rows" class="form-input"
                 value="100" min="1" max="10000">
        </div>
      </div>

      <!-- Excel Config (shown when Excel selected) -->
      <div class="excel-config" id="source-a-excel-config" style="display:none">
        <div class="file-upload-zone" id="source-a-upload-zone">
          <div class="upload-area">
            <p>Drop files here or <a href="#" class="browse-link">browse</a></p>
            <p class="file-types">Supports .xlsx, .xls, .csv</p>
          </div>
          <input type="file" id="source-a-file-input" accept=".xlsx,.xls,.csv" style="display:none">
        </div>
        <div class="file-list" id="source-a-file-list"></div>
        <div class="form-group" id="source-a-file-select-group" style="display:none">
          <label>Selected File</label>
          <select id="source-a-file-select" class="form-select"></select>
        </div>
      </div>

      <!-- Data Preview (shown after data loaded) -->
      <div class="data-preview" id="source-a-preview" style="display:none">
        <div class="preview-header">
          <span class="preview-label">Preview</span>
          <span class="preview-stats" id="source-a-stats"></span>
        </div>
      </div>
    </div>

    <!-- Source B (Comparator) - Same structure as Source A -->
    <div class="source-panel source-b">
      <!-- ... identical structure with "source-b-" prefix ... -->
    </div>
  </div>
</div>

<!-- Field Reconciliation (shown after both sources have data) -->
<div class="field-reconciliation" id="field-reconciliation" style="display:none">
  <!-- Column Mismatch Warning -->
  <div class="column-warning" id="column-mismatch-warning" style="display:none">
    <div class="warning-icon">⚠️</div>
    <div class="warning-content">
      <strong>Column Differences Detected</strong>
      <p>Some columns exist in only one source and will be excluded from comparison.</p>
      <details>
        <summary>Show details</summary>
        <div class="column-details">
          <div class="only-in-a" id="columns-only-in-a"></div>
          <div class="only-in-b" id="columns-only-in-b"></div>
        </div>
      </details>
    </div>
  </div>

  <!-- Primary Key Selection -->
  <div class="field-selection-section">
    <div class="field-header">
      <h4>Primary Key Selection</h4>
      <div class="field-actions">
        <button class="btn btn-ghost btn-sm" id="btn-select-all-pk">Select All</button>
        <button class="btn btn-ghost btn-sm" id="btn-deselect-all-pk">Clear</button>
      </div>
    </div>
    <p class="field-help">Select field(s) to use as primary key for matching rows</p>
    <div id="pk-field-list" class="field-list"></div>
  </div>

  <!-- Comparison Fields Selection -->
  <div class="field-selection-section">
    <div class="field-header">
      <h4>Fields to Compare</h4>
      <div class="field-actions">
        <button class="btn btn-ghost btn-sm" id="btn-select-all-fields">Select All</button>
        <button class="btn btn-ghost btn-sm" id="btn-deselect-all-fields">Clear</button>
      </div>
    </div>
    <p class="field-help">Select fields to include in comparison</p>
    <div id="compare-field-list" class="field-list"></div>
  </div>

  <!-- Comparison Options -->
  <div class="comparison-options">
    <div class="option-group">
      <label>Row Matching:</label>
      <div class="radio-group">
        <label><input type="radio" name="row-matching" value="key" checked> By Primary Key</label>
        <label><input type="radio" name="row-matching" value="position"> By Row Position</label>
      </div>
    </div>
    <div class="option-group">
      <label>Data Comparison:</label>
      <div class="radio-group">
        <label><input type="radio" name="data-comparison" value="strict" checked> Strict</label>
        <label><input type="radio" name="data-comparison" value="normalized"> Normalized</label>
      </div>
    </div>
  </div>

  <!-- Compare Button -->
  <div class="comparison-actions">
    <button class="btn btn-primary btn-lg" id="btn-compare">
      <svg>...</svg> Compare Data
    </button>
  </div>
</div>
```

### Permutation Matrix

The unified UI supports all combinations:

| Source A | Source B | Use Case |
|----------|----------|----------|
| Oracle (Table) | Oracle (Table) | UAT1 vs UAT2 config tables |
| Oracle (Raw SQL) | Oracle (Raw SQL) | Complex queries across envs |
| Oracle (Table) | Oracle (Raw SQL) | Table vs custom query |
| Oracle (Table) | Excel | UAT config vs Prod export |
| Oracle (Raw SQL) | Excel | Custom query vs Prod export |
| Excel | Oracle (Table) | Prod export vs UAT config |
| Excel | Oracle (Raw SQL) | Prod export vs custom query |
| Excel | Excel | Prod export vs Backup export |

### Phase 5: Web Mode Handling

In Web mode (non-Tauri), automatically:
1. Hide Oracle option
2. Default to Excel for both sources
3. Show helpful message that Oracle requires desktop app

```javascript
initEnvironmentVisibility() {
  if (!isTauri()) {
    // Hide Oracle options
    document.querySelectorAll('.oracle-option').forEach(el => el.style.display = 'none');
    // Pre-select Excel for both sources
    this.unified.sourceA.type = 'excel';
    this.unified.sourceB.type = 'excel';
  }
}
```

---

## Files to Modify

### Backend (Rust/Tauri)

| File | Changes |
|------|---------|
| `tauri/src/oracle.rs` | Add `fetch_oracle_data` command for data-only fetch |
| `tauri/src/lib.rs` | Export new `fetch_oracle_data` command |

### Frontend - New Files

| File | Purpose |
|------|---------|
| `frontend/tools/compare-config/lib/unified-data-service.js` | Unified data fetching abstraction layer |

### Frontend - Modified Files

| File | Changes |
|------|---------|
| `frontend/tools/compare-config/service.js` | Add `fetchOracleData()` method |
| `frontend/tools/compare-config/main.js` | Major restructure: new unified state, flow logic, event bindings |
| `frontend/tools/compare-config/template.js` | Complete UI overhaul with unified source panels |
| `frontend/tools/compare-config/styles.css` | New styles for unified UI, presets, source panels |
| `frontend/tools/compare-config/lib/diff-engine.js` | Update `reconcileColumns()` for case-insensitive matching |

### Estimated Scope

| Category | Estimate |
|----------|----------|
| New code | ~800 lines |
| Modified code | ~1500 lines |
| Removed code | ~600 lines (old tab-specific logic) |
| Net change | ~+1700 lines |

---

## Design Decisions

### UI Approach: Replace Tabs with Unified UI

Replace the tab-based UI entirely with the unified flow. Quick presets provide shortcuts:
- **Oracle vs Oracle** - Both sources set to Oracle Database
- **Excel vs Excel** - Both sources set to Excel/CSV
- **Oracle vs Excel** - Mixed comparison mode

### Quick Presets

Add preset buttons at the top of the interface for common scenarios:
```html
<div class="comparison-presets">
  <span>Quick Setup:</span>
  <button class="preset-btn" data-preset="oracle-oracle">Oracle vs Oracle</button>
  <button class="preset-btn" data-preset="excel-excel">Excel vs Excel</button>
  <button class="preset-btn" data-preset="oracle-excel">Oracle vs Excel</button>
</div>
```

### Field Name Matching: Case-Insensitive

Use case-insensitive field name matching between sources:

```javascript
// Field reconciliation with case-insensitive matching
export function reconcileColumns(headersA, headersB) {
  const normalizedA = new Map(headersA.map(h => [h.toLowerCase(), h]));
  const normalizedB = new Map(headersB.map(h => [h.toLowerCase(), h]));

  const common = [];
  const onlyInA = [];
  const onlyInB = [];

  for (const [lower, original] of normalizedA) {
    if (normalizedB.has(lower)) {
      common.push({
        normalized: lower,
        sourceA: original,           // e.g., "TYPE" (from Oracle)
        sourceB: normalizedB.get(lower)  // e.g., "type" (from Excel)
      });
    } else {
      onlyInA.push(original);
    }
  }

  for (const [lower, original] of normalizedB) {
    if (!normalizedA.has(lower)) {
      onlyInB.push(original);
    }
  }

  return { common, onlyInA, onlyInB };
}
```

**Note on Oracle Reserved Keywords:**
- Oracle returns column names like `TYPE`, `SEQUENCE` in uppercase
- When querying Oracle, these are automatically quoted by the backend
- For comparison purposes, we match case-insensitively
- Results display original names from each source (helpful for debugging)

---

## Verification Plan

1. **Unit Tests:**
   - Test `UnifiedDataService.fetchData()` for each source type
   - Test field reconciliation with mismatched columns
   - Test data normalization consistency

2. **Integration Tests:**
   - Oracle Table vs Excel file comparison
   - Excel vs Oracle Raw SQL comparison
   - Web mode (Excel only) functionality

3. **Manual Testing Scenarios:**
   - UAT1 (Oracle Table) vs UAT2 (Oracle Table)
   - UAT (Oracle Table) vs Production (Excel export)
   - Production (Excel) vs Backup (Excel)
   - Production (Excel) vs UAT (Oracle Raw SQL)
   - Oracle (Raw SQL) vs Oracle (Raw SQL) - complex queries
   - Oracle (Table) vs Oracle (Raw SQL) - mixed query modes

4. **Regression Tests:**
   - Existing Excel vs Excel comparison still works
   - Existing Oracle vs Oracle comparison (via table) still works
   - View switching (Grid, Cards, Detail) works with mixed sources
   - Export (JSON, CSV) works with mixed sources

---

## Implementation Order

1. **Phase 1**: Add `fetch_oracle_data` Tauri command (backend) ✅
2. **Phase 2**: Create `unified-data-service.js` (frontend) ✅
3. **Phase 3**: Update `diff-engine.js` reconcileColumns for case-insensitive matching ✅
4. **Phase 4**: Create new template structure in `template.js` ✅
5. **Phase 5**: Restructure state and flow logic in `main.js` ✅
6. **Phase 6**: Add CSS styles for new UI components ✅
7. **Phase 7**: Testing and refinement

---

## Diff Engine Unification

> **Note:** The diff engine unification plan has been moved to **Phase 6** of the [Unified Compare Revamp Plan](./plan-unified-compare-revamp.md#phase-6-unify-diff-engine-refactoring).
>
> See `docs/plan-unified-compare-revamp.md` for the current implementation plan.
