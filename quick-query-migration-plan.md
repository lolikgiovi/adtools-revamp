# AD Tools Revamp — Quick Query Migration Plan

This plan outlines the migration of the legacy Quick Query feature in `reference/quickQuery/` into the AD Tools Revamp architecture defined in `architecture.md`. It captures the current behavior, target requirements, implementation approach, migration timeline, and testing strategy with actionable steps.

---

## 1) Current System Analysis

### Overview
- The current Quick Query is a standalone UI controller (`quickQuery.js`) that bootstraps its own templates, grids, and editor using a custom `DependencyLoader`.
- It renders a dual-pane interface: schema and attachments on the left, SQL editor on the right, plus a data input section.
- It includes a tutorial guide, schema management overlay, attachments preview overlay, and file metadata display.

### UI Structure and Templates
- Templates: `templates/main.html` and `templates/htmlTemplates.js` define the layout and guide strings.
  - Left panel: query type selector, table name input, schema grid (`Handsontable`), attachments area and file list, guide container.
  - Right panel: controls (word wrap, copy, download), warning and error areas, SQL editor (`CodeMirror` target element).
  - Data input section: grid for row data with controls (add/remove/clear, add field names from schema).
  - Overlays: Saved Schemas overlay (list, import/export/clear); File Viewer overlay with Original/Processed tabs and metadata grid.

### Business Logic and Services
- `QueryGenerationService.js`
  - Generates Oracle SQL for `MERGE`, `INSERT`, and `UPDATE`.
  - Maps schema to data rows; processes per-field values; adds verification `SELECT` clause.
  - Detects duplicate primary keys and produces warnings; quotes reserved words; respects audit fields and null/update rules.
- `ValueProcessorService.js`
  - Formats values by data type (NUMBER/VARCHAR/DATE/TIMESTAMP/CHAR/CLOB/BLOB).
  - Special handling: audit fields (`created_time/updated_time` → `SYSDATE`, `created_by/updated_by` → uppercase or `'SYSTEM'`), explicit `'NULL'`, max length checks, primary key detection heuristics.
- `SchemaValidationService.js`
  - Validates required fields per row; enforces Oracle data type prefixes and nullable values (Yes/No/PK variants).
  - Ensures field names in schema match data input headers.
- `LocalStorageService.js`
  - Persists and searches saved schemas by `schema_name.table_name`; includes scoring/abbreviations for matching; import/export JSON.
- `AttachmentProcessorService.js`
  - Normalizes files; produces `processedFormats` with `original` and `base64`; infers sizes; minification helpers for text/HTML/JSON.
- `AttachmentValidationService.js`
  - Validates mapping from field value (filename) to matching file and returns appropriate string based on field type (`VARCHAR*`, `CLOB`).

### Dependencies and Loading
- Uses `DependencyLoader.load("handsontable")` and `DependencyLoader.load("codemirror")` (non-ESM loader abstraction).
- Clipboard helpers from `utils/buttons.js`.
- Styling: `styles/styles.css` (currently empty in reference) and common app styles.

### Error Handling and UX
- Central error/warning areas in the right panel.
- Per-row error context in query generation (“Row X: …”).
- Duplicate PK detection warning with row numbers.
- Word wrap toggle, copy-to-clipboard, and SQL download.

---

## 2) Feature Requirements and Specifications

### Functional Requirements
- Render Quick Query under AD Tools as a modular tool with:
  - Schema input grid: editable rows with headers [Field Name, Data Type, Nullable/PK, Default, Field Order, Comments].
  - Data input grid: header row for field names, subsequent rows for values; controls to add/remove/clear rows and auto-fill field names from schema.
  - Table name input (`schema.table`) and query type selector (`MERGE`, `INSERT`, `UPDATE`).
  - SQL output editor/viewer: word-wrap toggle, copy, download.
  - Attachments area: drag-drop and file picker; display processed files; preview overlay with Original/Processed tabs and metadata (type/size/dimensions/base64 size/line count/char count).
  - Saved Schemas overlay: list, search, import/export, clear all, delete by item.
  - Tutorial/Simulation guide toggle and buttons to auto-fill sample schema/data and generate a demo query.
  - Duplicate primary key detection and warning messages.

### Processing Rules and Data Contracts
- Schema row format: `[fieldName, dataType, nullable, default, order, comments]`.
- Input data format: `inputData[0]` is field names, `inputData[1..]` are data rows.
- Attachments: each file yields `{ name, type, size, processedFormats: { original, base64, sizes } }`.
- SQL generation:
  - Uses `SET DEFINE OFF;` prefix.
  - `MERGE`/`INSERT`/`UPDATE` generated per rules in `QueryGenerationService`.
  - Reserved words quoted; audit fields handled; null/update semantics respected; optional verification `SELECT` by primary keys.

### Non‑Functional Requirements
- Conform to `architecture.md`:
  - ESM modules, no globals; tool class exported from `main.js`; UI in `template.js`; business logic in `service.js` modules.
  - Integrate with `BaseTool`, `EventBus`, and `Router` (`#quick-query`).
  - Scoped styles via `styles.css`; theme-aware via `ThemeManager` CSS vars/classes.
- Performance: lazy-load heavy libs (Handsontable, Monaco) via dynamic import when the tool activates.
- Testing: Vitest unit tests for services; light integration tests for routing and activation.
- Accessibility: focus management for overlays, keyboard navigation on grids, ARIA for buttons and dialogs.

### Events and Routing
- Emit/listen:
  - `tool:registered` on registration; `tool:activate` on activation; `route:change` and `route:changed` via Router integration.
- Route ID: `quick-query`; accessible via hash (`#quick-query`).

---

## 3) Implementation Approach and Architecture

### Directory Layout
```
app/tools/quick-query/
  main.js           // Tool class (extends BaseTool) — lifecycle and UI wiring
  template.js       // HTML template string for the tool UI
  styles.css        // Scoped styles
  services/
    queryGenerationService.js
    valueProcessorService.js
    schemaValidationService.js
    localStorageService.js
    attachmentProcessorService.js
    attachmentValidationService.js
```

### Core Design
- `main.js`
  - Subclass `BaseTool` and implement `render()`, `onMount()`, `onUnmount()`.
  - Bind DOM events (buttons, inputs) and integrate with `EventBus` for notifications.
  - Lazy‑load `Handsontable` for grids, and `monaco-editor` for SQL output (language `plaintext` or basic `sql` if available).
  - Maintain internal state: table name, query type, schema data, input data, attachments, word‑wrap.
- `template.js`
  - Derive from `templates/main.html` and `htmlTemplates.js` into a single string export; keep overlay markup (Saved Schemas, File Viewer).
- `services/*`
  - Port logic from reference services with minimal changes; ensure pure functions where possible.
  - Preserve processing rules (audit fields, reserved words, primary key heuristics, attachment validation).

### Integration
- Registration in `app/App.js`: import the tool class and register with Sidebar.
- Routing: add `#quick-query` path; activation mounts the tool and sets breadcrumb.
- Theme: adopt CSS variables from `ThemeManager`; avoid hard-coded colors.

### Dependencies
- Use npm packages and dynamic imports:
  - `handsontable` (grid) — deferred load in `onMount()`.
  - `monaco-editor` (SQL view) — deferred load; workers configured via Vite `?worker` as in `json-tools`.

### Error and Warning UX
- Reuse patterns from JSON Tools: distinct error panel/class names; concise messages; show row context.
- EventBus notifications for copy success/error.

---

## 4) Migration Strategy and Timeline

### Phased Plan (1–2 weeks)

- Phase 0 — Preparation (Day 0)
  - Create `app/tools/quick-query/` scaffold with `main.js`, `template.js`, `styles.css`, `services/`.
  - Add route and registration in `App.js`; add Sidebar entry.

- Phase 1 — Services Port (Day 1)
  - Migrate `QueryGenerationService`, `ValueProcessorService`, `SchemaValidationService`, `LocalStorageService`, `AttachmentProcessorService`, `AttachmentValidationService` to ESM under `services/`.
  - Adjust imports/exports; remove non-ESM loaders; ensure functions are pure where feasible.
  - Add unit tests for each service using Vitest and sample fixtures.

- Phase 2 — Template & Styles (Day 2)
  - Convert `templates/main.html` and `htmlTemplates.js` to `template.js` (string export) and `styles.css` with scoped classes.
  - Hook up DOM binding in `main.js`; render static UI without interactive behavior.

- Phase 3 — UI Wiring & Grids (Day 3)
  - Implement event handlers in `main.js`: schema/data controls, overlays, guide, attachments.
  - Lazy‑load `Handsontable`; initialize schema and data grids using existing initial specifications.

- Phase 4 — SQL Output (Day 4)
  - Integrate Monaco Editor for SQL output; implement word wrap toggle, copy, download.
  - Wire `generateQuery()` flow end‑to‑end with services.

- Phase 5 — Attachments & Preview (Day 5)
  - Connect drag‑drop and file picker; run processing & validation; display processed files.
  - Implement File Viewer overlay with tabs and metadata.

- Phase 6 — Saved Schemas & Search (Day 6)
  - Implement overlay listing, search scoring, import/export; integrate with LocalStorage service.

- Phase 7 — Polish, Theme, Accessibility (Day 7)
  - Align styles with `ThemeManager`; add keyboard shortcuts and focus traps for overlays.

- Phase 8 — Validation & QA (Day 8)
  - End‑to‑end sanity tests; error/warning review; duplicate PK detection verification.
  - `npm run build` and `npm run preview` validation.

### Risks & Mitigations
- Heavy libraries (Monaco/Handsontable): lazy‑load on activation; defer worker init until mount.
- Oracle data/format edge cases: expand unit tests with diverse samples; keep strict error messaging.
- Attachment size constraints: display sizes and guard with max lengths; skip oversize content.
- Routing/events regression: add light integration tests around `tool:activate` and `route:changed`.

---

## 5) Testing and Validation Procedures

### Unit Tests (Vitest, JSDOM)
- `QueryGenerationService`:
  - MERGE/INSERT/UPDATE generation for simple and complex schemas.
  - Reserved words quoting; select verification; duplicate PK detection.
- `ValueProcessorService`:
  - Audit fields handling; numeric/date/timestamp formatting; explicit `NULL` and empty values.
- `SchemaValidationService`:
  - Valid/invalid data types and nullable values; schema-data field alignment errors.
- `LocalStorageService`:
  - Parse/validate identifiers; scoring and abbreviations; import/export; bounds (max rows).
- `AttachmentProcessorService` / `AttachmentValidationService`:
  - Original/base64 processing; minify behavior; data type mapping and length constraints.

### Integration Tests
- Tool mount/activate/deactivate lifecycle via `BaseTool`; route navigation (`#quick-query`).
- EventBus emits for copy/notifications; error panel updates.

### Manual QA
- Full flow: paste schema → add data → generate SQL → copy/download.
- Attachments: drop files → preview → validate usage in generated SQL.
- Overlays: Saved Schemas import/export/clear; File Viewer tabs/metadata.
- Edge cases: duplicate PKs, null handling, reserved words, date/timestamp formats.

### Success Criteria
- Tool operates within AD Tools without globals; lazy‑loaded dependencies work under Vite.
- `npm run test` passes with coverage across services.
- `npm run build` and `npm run preview` produce working output; routing and events behave per `architecture.md`.

---

## Actionable Next Steps
- Scaffold `app/tools/quick-query/` and register in `App.js` and Router.
- Port services to ESM and add unit tests with fixtures.
- Convert templates/styles; initialize grids (lazy‑load Handsontable).
- Integrate Monaco editor for SQL output; wire generation and UX controls.
- Implement attachments processing/validation and overlays.
- Add Saved Schemas overlay and LocalStorage integration.
- Finalize theme/accessibility; run build/preview; execute manual QA.

---

References: aligns with `architecture.md` — ES modules, tool lifecycle via `BaseTool`, routing with `Router`, events through `EventBus`, and testing with Vitest under JSDOM. Uses `monaco-editor` already present in `package.json`; heavy deps are lazy‑loaded to maintain performance.