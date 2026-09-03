# Plan 007: Offload large Compare Config file parsing

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Drift check (run first)**: `git diff --stat b856304..HEAD -- frontend/tools/compare-config/lib/file-parser.js frontend/tools/compare-config/lib/file-parser-core.js frontend/tools/compare-config/lib/file-parser.worker.js frontend/tools/compare-config/lib/unified-data-service.js frontend/tools/compare-config/tests/file-parser.test.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans/001-guard-async-navigation-commits.md (recommended for invalidating a parse result after navigation)
- **Category**: perf
- **Planned at**: commit `b856304`, 2026-09-03

## Why this matters

Compare Config parses Excel input on the main thread, creating an ArrayBuffer,
SheetJS workbook, raw array-of-arrays, and a second array of row objects before
the comparison can continue. Large workbooks can freeze typing, scrolling, and
navigation even though the UI is showing a loading state. Moving parsing to a
module worker preserves the existing normalized dataset, first-sheet behavior,
CSV/Excel support, and full-row semantics while keeping the main thread
responsive.

## Current state

Relevant files:

- `frontend/tools/compare-config/lib/file-parser.js` - public parser API for
  Excel, CSV, extension checks, and normalized output.
- `frontend/tools/compare-config/lib/unified-data-service.js` - calls
  `FileParser.parseFile()` and returns the normalized dataset.
- `frontend/tools/compare-config/main.js` - calls the parser for selected Excel
  files at `main.js:3544-3573`; do not duplicate parsing there.
- `frontend/tools/compare-config/lib/file-parser-core.js` - new worker-safe
  parsing implementation with no DOM access.
- `frontend/tools/compare-config/lib/file-parser.worker.js` - new module worker
  entry point.
- `frontend/tools/compare-config/tests/file-parser.test.js` - existing parser
  tests; extend with output-equivalence and worker/fallback cases.

The parser statically imports SheetJS and performs all Excel work synchronously
after the asynchronous file read:

```js
// frontend/tools/compare-config/lib/file-parser.js:1-7,37-80
import * as XLSX from "xlsx";

export async function parseExcel(file) {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { header: 1, defval: "" });
  const headers = rawData[0].map((h, i) => normalizeHeader(h, i));
  const dataRows = rawData.slice(1);
  const rows = dataRows.map((row) => {
    const obj = {};
    headers.forEach((header, i) => (obj[header] = row[i] ?? ""));
    return obj;
  });
  return { headers, rows, metadata: { ... } };
}
```

CSV also parses and maps the complete text on the main thread
(`file-parser.js:88-121,129-180`). `UnifiedDataService` consumes the parsed
data without another required file parse when `parsedData` is supplied
(`unified-data-service.js:183-215`). The existing parser chooses the first
sheet and returns all rows; this plan must not add a row or file-size cap.

Compare Config already gives the user a loading/status path around source loads,
and Oracle data has a separate `maxRows` control (`main.js:71-72,91-93`); do
not change Oracle fetching as part of this plan.

## Commands you will need

| Purpose                  | Command                                                                                                                                                                                                                                                                                                             | Expected on success                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Drift check              | `git diff --stat b856304..HEAD -- frontend/tools/compare-config/lib/file-parser.js frontend/tools/compare-config/lib/file-parser-core.js frontend/tools/compare-config/lib/file-parser.worker.js frontend/tools/compare-config/lib/unified-data-service.js frontend/tools/compare-config/tests/file-parser.test.js` | Empty output before implementation, unless drift is being reviewed |
| Parser tests             | `npx vitest run frontend/tools/compare-config/tests/file-parser.test.js`                                                                                                                                                                                                                                            | All parser and worker/fallback tests pass in one Vitest process    |
| Compare Config tests     | `npx vitest run frontend/tools/compare-config/tests/file-parser.test.js frontend/tools/compare-config/tests/unified-compare-utils.test.js`                                                                                                                                                                          | Focused tests pass; run separately from other Vitest commands      |
| Lint                     | `npm run lint`                                                                                                                                                                                                                                                                                                      | Exit 0; no lint errors (pre-existing warnings may remain)          |
| Browser build smoke test | `npx vite build --outDir /tmp/adtools-plan-007 --emptyOutDir true`                                                                                                                                                                                                                                                  | Exit 0 and produces a build outside the repository                 |
| Diff whitespace          | `git diff --check`                                                                                                                                                                                                                                                                                                  | Empty output                                                       |

## Scope

**In scope** (the only files to modify):

- `frontend/tools/compare-config/lib/file-parser.js`
- `frontend/tools/compare-config/lib/file-parser-core.js` (create)
- `frontend/tools/compare-config/lib/file-parser.worker.js` (create)
- `frontend/tools/compare-config/tests/file-parser.test.js`

**Out of scope** (do not touch):

- `frontend/tools/compare-config/main.js` and
  `frontend/tools/compare-config/lib/unified-data-service.js` unless a parser
  API call-site correction is strictly required
- Oracle sidecar/Tauri data fetching, row limits, diff computation, result
  rendering, and GridView behavior
- File contents, selected-sheet behavior, header normalization, row object
  shape, supported extensions, and error messages
- Hard input caps or truncation
- A new third-party worker library

## Git workflow

- Branch, if one is used: `advisor/007-offload-compare-file-parsing`.
- Match the repository's concise imperative or `perf:` commit style if the
  operator asks for commits. Do not push or open a PR unless instructed.

## Steps

### Step 1: Extract worker-safe parsing without changing output

Move the SheetJS-dependent Excel buffer conversion and any shared header/result
helpers into `file-parser-core.js`. Keep the same `XLSX.read` options, first
sheet selection, `defval`, header normalization, row mapping, metadata fields,
and empty-sheet behavior. Keep CSV parsing behavior byte-for-byte equivalent;
the core module must not access `window`, `document`, or tool state.

Keep `file-parser.js` as the public module exporting `parseFile`, `parseExcel`,
`parseCSV`, `parseCSVText`, extension helpers, and supported-extension
constants. Do not make existing named exports disappear.

**Verify**: `npx vitest run frontend/tools/compare-config/tests/file-parser.test.js` -> all existing extension and CSV behavior passes, and new direct core-output tests match the current normalized shape.

### Step 2: Add a module worker with transferable Excel input

Create `file-parser.worker.js` as a module worker. It must accept a message
containing an operation, file name, and either an Excel ArrayBuffer or CSV text;
call the worker-safe parser; and post `{ ok: true, result }` or a bounded error
message. Do not post the raw workbook or intermediate arrays back to the main
thread.

For Excel, transfer the ArrayBuffer when posting so the browser does not clone
the input bytes. Terminate the worker after a successful result, parse error, or
worker error. Do not keep a worker alive in a module-level singleton.

**Verify**: `npx vitest run frontend/tools/compare-config/tests/file-parser.test.js` -> the fake-worker test receives the correct operation and transferable input, resolves the normalized result, and terminates after completion/error.

### Step 3: Route file parsing through the worker with a safe fallback

Update `parseExcel()` and `parseCSV()` to use the worker. Use a Vite-compatible
module-worker construction such as `new Worker(new URL("./file-parser.worker.js", import.meta.url), { type: "module" })`.
If `Worker` is unavailable or cannot be constructed before the input is
transferred, fall back to the extracted core parser on the main thread so
Tauri/WebView or constrained test environments retain functionality. A parser
error from the worker must remain a parser error; do not silently return an
empty dataset.

Use the existing async parser API and preserve the same rejection behavior for
unsupported files, missing sheets, empty files, and malformed data. A worker
completion must include the original file name in metadata. Do not add a
visible progress bar unless the existing UI requires one; the current loading
state remains the user feedback.

The worker should be created per parse and always terminated. If both sources
are parsed concurrently, each source may have its own short-lived worker; do
not serialize two independent source loads merely to reuse a worker.

**Verify**: `npx vitest run frontend/tools/compare-config/tests/file-parser.test.js` -> Excel and CSV worker results are equivalent to the pre-worker fixtures, fallback parsing works when Worker is unavailable, and all error cases retain their existing errors.

### Step 4: Confirm navigation and memory behavior

Ensure the worker result is ignored by the caller if the Compare Config tool
has been unmounted or a newer source selection has replaced the parse request,
using the request/lifecycle guard from plan 001 where applicable. Terminating a
worker must not clear a newer source's parsed data. Do not retain the original
ArrayBuffer after the worker handoff beyond what the current parse API requires.

**Verify**: `npx vitest run frontend/tools/compare-config/tests/file-parser.test.js` -> a stale/deferred parse cannot overwrite the current source result, and worker termination is asserted for success, error, and invalidation paths.

### Step 5: Run build and quality checks

Run parser and Compare Config tests, `npm run lint`, the temporary-output build,
and `git diff --check`. Inspect the diff for no static main-thread SheetJS
import, preserved named exports, no row truncation, and no changes to Oracle
fetching or normalized result fields.

**Verify**: `npm run lint` -> exit 0 with no errors; `npx vite build --outDir /tmp/adtools-plan-007 --emptyOutDir true` -> exit 0; `git diff --check` -> empty output.

## Test plan

- Extend `frontend/tools/compare-config/tests/file-parser.test.js` using its
  current Vitest style and file-like objects.
- Add representative Excel fixtures created in memory or through a minimal
  fake file: headers, empty cells, multiple sheets, and a large row set.
- Assert worker and fallback results have identical headers, rows, metadata,
  first-sheet selection, and row counts.
- Mock/stub `Worker` to control `postMessage`, transfer-list observation,
  `onmessage`, `onerror`, and `terminate` calls.
- Cover Worker unavailable, construction failure, worker parse failure,
  malformed/empty input, and stale result invalidation.
- Retain every existing extension/CSV test, especially quoted fields and
  embedded newlines.
- Model large-input timing assertions after
  `frontend/tools/master-lockey/tests/remote-load-performance.test.js:4-23`,
  but do not use a brittle absolute timing threshold for worker startup.
- Verification: `npx vitest run frontend/tools/compare-config/tests/file-parser.test.js` -> all existing and new tests pass.

## Done criteria

- [ ] Excel parsing work runs in a module worker in supported browser/Tauri runtimes.
- [ ] CSV parsing uses the worker path without changing its parser output or edge-case behavior.
- [ ] Worker input/result lifecycle terminates workers on success, error, and invalidation.
- [ ] Excel ArrayBuffer transfer avoids an unnecessary input clone where supported.
- [ ] Fallback parsing preserves functionality when Worker is unavailable.
- [ ] No input rows are dropped, capped, or silently changed.
- [ ] Existing named parser exports and normalized dataset metadata remain compatible.
- [ ] `npm run lint` exits 0 with no errors.
- [ ] `npx vite build --outDir /tmp/adtools-plan-007 --emptyOutDir true` exits 0.
- [ ] No files outside the Scope list are modified; verify with `git status --short`.
- [ ] `plans/README.md` status row is updated.

## STOP conditions

Stop and report back if:

- The current parser exports, SheetJS options, metadata shape, or call sites
  differ from the excerpts.
- Worker structured cloning changes values, dates, empty cells, error messages,
  or header normalization compared with the current parser.
- A transferable buffer cannot safely fall back after worker creation, or the
  supported Tauri WebView lacks module-worker support; do not silently use a
  slower or incompatible construction.
- Preserving all rows requires a new memory policy or input cap.
- A worker result can only be invalidated by changing Compare Config lifecycle
  or route behavior beyond this scope.
- Any verification command fails twice after a reasonable fix attempt.

## Maintenance notes

- Keep worker and fallback parsing implementations covered by output-equivalence
  tests; changing one without the other is a likely regression.
- Any new supported file format must define both worker and fallback behavior.
- Reviewers should inspect transfer/termination paths and test a large workbook
  while switching tools or replacing a selected file.
- This plan intentionally does not virtualize result rendering; plan 002 owns
  the GridView DOM cost after parsing completes.
