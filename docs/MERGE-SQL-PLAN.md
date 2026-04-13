# Merge SQL UI Revamp Plan

## Goal

Revamp the Merge SQL tool with a cleaner two-panel mental model:

- **Left panel** = Input (two modes: Files, Modified Merged SQL)
- **Right panel** = Output (tabs vary by input mode)

---

## Mental Model

### Mode 1: Files → Generated SQL

User uploads `.sql` files → system generates Merged SQL, Select SQL, and Validation SQL.

| Left (Input) | Right (Output) |
|---|---|
| File list with add/sort/clear controls | **Report** tab + **Generated SQL** tab |
| | Report: summary, table detail, squad detail (same as today) |
| | Generated SQL: three sub-tabs — Merged SQL, Select SQL, Validation SQL |

### Mode 2: Modified Merged SQL → Validation

User pastes or edits a Merged SQL → system re-derives a report and Validation SQL.

| Left (Input) | Right (Output) |
|---|---|
| Monaco editor (editable Merged SQL) | **Report** tab + **Validation SQL** tab |
| | Report: table-level summary derived from the merged SQL |
| | Validation SQL: Monaco editor (read-only, refreshable) |

---

## Current vs. New Layout

### Current layout

```
[Left]                     [Right]
File list + controls       4 tabs: Merged SQL | Select SQL | Validation SQL | Report
                           Action bar: Refresh Validation | Copy | Download | Download All
                           Insights banner
```

### New layout

```
[Left]                     [Right]
Mode toggle: Files | SQL   (tabs depend on mode)
─────────────────────────────────────────────────
Mode = Files:
  Add Files / Add Folder   Tabs: Report | Generated SQL
  Output name input              Report → (same sub-tabs as today)
  Sort controls                  Generated SQL → sub-tabs: Merged SQL | Select SQL | Validation SQL
  File list                      Action bar: Copy (active sub-tab) | Download (active) | Download All
  [MERGE SQLs] button
  Clear Files | Clear All

Mode = SQL:
  Monaco editor            Tabs: Report | Validation SQL
  (editable merged SQL)         Report → table summary only (derived from merged SQL)
  [Refresh] button              Validation SQL → Monaco editor (read-only, refreshable)
  Clear button
```

---

## Structural Changes

### `template.js`

1. **Add mode toggle** at the top of the left panel: two buttons (`Files` | `Modified Merged SQL`) that switch input mode.

2. **Left panel: two sub-sections** (only one shown at a time):
   - `#merge-sql-input-files` — existing file list UI (no changes to internals)
   - `#merge-sql-input-sql` — Monaco editor (`#merge-sql-input-editor`) + Refresh button + Clear button

3. **Right panel: output tabs change by mode**:
   - Files mode: `Report` tab + `Generated SQL` tab
     - `Generated SQL` tab contains its own sub-tab bar: `Merged SQL` | `Select SQL` | `Validation SQL`
   - SQL mode: `Report` tab + `Validation SQL` tab
   - The report HTML structure stays the same; just remove the now-separate report tab from the old 4-tab layout.

4. **Action bar** moves inside the Generated SQL / Validation SQL tab areas (or stays at top of right panel, filtered by active tab).

5. **Insights banner** stays at the top of the right panel (visible in both modes when there are warnings).

6. **Duplicates modal** — unchanged.

---

## Logic / Service Changes

### `service.js` — No changes needed

All existing methods cover both use cases:
- `mergeFiles(parsedFiles)` → for Files mode
- `buildValidationSqlFromMergedSql(mergedSql)` → for SQL mode (already exists)

The report for SQL mode can be derived by re-parsing the merged SQL. Add one new method:

```js
// Parses a merged SQL string back into a lightweight report (table/squad/feature counts)
// Used in Mode 2 (Modified Merged SQL) to populate the Report tab
static buildReportFromMergedSql(mergedSql) { ... }
```

This parses the `--====` banner headers and sub-headers (`-- SquadName - FeatureName`) to reconstruct `statementCounts`, `squadCounts`, `featureCounts`, `dangerousStatements`, and `nonSystemAuthors` — enough to populate a useful (though not exhaustive) report.

---

### `main.js` — Significant restructuring

#### New state

```js
this.inputMode = 'files' | 'sql'   // currently active input mode
```

#### New/renamed methods

| Old method | New method / notes |
|---|---|
| `handleMerge()` | Unchanged — fires when in Files mode |
| `handleRefreshValidation()` | Now also serves as the SQL mode "Refresh" trigger |
| `renderReport()` | Accepts a `report` object regardless of source mode |
| _(new)_ | `switchInputMode(mode)` — toggles left panel sections, updates right-panel tab bar |
| _(new)_ | `handleSqlModeRefresh()` — reads input editor, calls `buildValidationSqlFromMergedSql` + `buildReportFromMergedSql`, populates right panel |

#### Tab management

Currently tabs are flat (4 tabs). New structure is nested:
- Right panel has 2 top-level tabs: `Report` | `Generated SQL` (Files mode) or `Report` | `Validation SQL` (SQL mode)
- `Generated SQL` tab has 3 sub-tabs: `Merged SQL` | `Select SQL` | `Validation SQL`

The existing `switchTab(tabName)` logic should be extended to `switchTab(tabName, subtabName?)`.

#### IndexedDB persistence

Add `inputMode` to the `state` store. Add `inputSql` (the raw merged SQL text in SQL mode) to the `results` store.

---

### `indexeddb-manager.js` — Minor additions

- Add `inputMode` field to state store schema
- Add `inputSql` field to results store schema

---

### `styles.css` — Layout adjustments

- Add styles for mode toggle buttons (active/inactive state)
- Add styles for nested sub-tab bar inside `Generated SQL` tab
- Adjust right panel flex layout so sub-tabs + editors fill the available height correctly
- No major layout overhaul needed — existing two-panel split stays

---

## Detailed Component Map (New)

```
MergeSqlTool
├── Left panel
│   ├── Mode toggle bar         [Files] [Modified Merged SQL]
│   ├── #merge-sql-input-files  (shown when mode = files)
│   │   ├── Add Files / Add Folder buttons
│   │   ├── Output name input
│   │   ├── Sort buttons
│   │   ├── File list
│   │   ├── [MERGE SQLs] button
│   │   └── Clear Files / Clear All buttons
│   └── #merge-sql-input-sql    (shown when mode = sql)
│       ├── Monaco editor (#merge-sql-input-editor)
│       ├── [Refresh] button
│       └── [Clear] button
│
└── Right panel
    ├── Insights banner (#merge-sql-insights)  [always visible if warnings]
    ├── Tabs (dynamic by mode)
    │   ├── Mode = files:
    │   │   ├── [Report] tab → existing report HTML
    │   │   └── [Generated SQL] tab
    │   │       ├── Sub-tab bar: [Merged SQL] [Select SQL] [Validation SQL]
    │   │       ├── Monaco editor (merged/select/validation, swapped by sub-tab)
    │   │       └── Action bar: Copy | Download | Download All
    │   └── Mode = sql:
    │       ├── [Report] tab → lightweight report from merged SQL
    │       └── [Validation SQL] tab
    │           ├── Monaco editor (#merge-sql-validation-editor)
    │           └── Action bar: Copy | Download
    └── Duplicates modal (unchanged)
```

---

## Implementation Steps

1. **`service.js`**: Add `buildReportFromMergedSql(mergedSql)` — parse merged SQL headers to reconstruct a lightweight report object.

2. **`template.js`**: Restructure HTML:
   - Add mode toggle
   - Split left panel into two sections (`input-files`, `input-sql`)
   - Restructure right panel tabs to be dynamic (use `data-mode` attributes)
   - Add nested sub-tab bar inside `Generated SQL` tab
   - Adjust action bar placement

3. **`indexeddb-manager.js`**: Add `inputMode` to state and `inputSql` to results store.

4. **`main.js`**: Refactor:
   - Add `inputMode` state + `switchInputMode()`
   - Wire mode toggle buttons
   - Initialize input Monaco editor for SQL mode
   - Add `handleSqlModeRefresh()` handler
   - Extend tab switching for nested sub-tabs
   - Update `loadFromIndexedDB()` to restore input mode and SQL content

5. **`styles.css`**: Add styles for mode toggle and nested sub-tabs.

---

## Files Changed

| File | Type of change |
|---|---|
| `frontend/tools/merge-sql/template.js` | Major restructure |
| `frontend/tools/merge-sql/main.js` | Major refactor |
| `frontend/tools/merge-sql/service.js` | Additive (1 new method) |
| `frontend/tools/merge-sql/indexeddb-manager.js` | Minor additions |
| `frontend/tools/merge-sql/styles.css` | Additive |
| `frontend/tools/merge-sql/tests/service.test.js` | Add tests for new service method |

No changes needed to: `icon.js`, `toolDefinitions.js`, `iconRegistry.js`, or settings config.

---

## Out of Scope

- No changes to SQL parsing or generation logic
- No changes to the report's sub-tab structure (Summary / Table Detail / Squad Detail)
- No changes to settings or squad name configuration
- No changes to Monaco editor configuration
