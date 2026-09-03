# Plan 008: Defer action-only tool dependencies

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Drift check (run first)**: `git diff --stat b856304..HEAD -- frontend/tools/base64-tools/main.js frontend/tools/quick-query/main.js frontend/tools/merge-sql/main.js frontend/tools/compare-config/lib/file-parser.js frontend/tools/base64-tools/tests/lazy-dependencies.test.js frontend/tools/quick-query/tests/lazy-dependencies.test.js frontend/tools/merge-sql/tests/lazy-dependencies.test.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/007-offload-compare-file-parsing.md
- **Category**: perf
- **Planned at**: commit `b856304`, 2026-09-03

## Why this matters

Tool routes are already lazy-loaded, but several tool modules still import
large libraries needed only after a user clicks a specific export or processing
action. The first visit to those tools therefore downloads and evaluates code
that is not needed to render or use the primary workflow. Deferring these
dependencies preserves the existing tool routes and first-action behavior while
reducing the cost of opening Base64, Quick Query, Merge SQL, and Compare Config.

## Current state

Relevant files:

- `frontend/config/toolDefinitions.js` - existing per-tool dynamic import
  registry; broad route lazy loading is already in place.
- `frontend/tools/base64-tools/main.js` - statically imports JSZip and uses it
  only when downloading encoded/decoded files as a ZIP.
- `frontend/tools/quick-query/main.js` - statically imports JSZip and the
  minification worker; both are used only in action handlers.
- `frontend/tools/merge-sql/main.js` - statically imports html2canvas and uses
  it only for report image copy/download.
- `frontend/tools/compare-config/lib/file-parser.js` - statically imports
  SheetJS for file parsing; plan 007 owns moving this dependency behind the
  parser worker and this plan must not duplicate that work.
- `frontend/tools/json-tools/main.js` - existing lazy SheetJS export at
  `main.js:961`; use its module interop and error-handling shape as a local
  exemplar.
- `frontend/tools/base64-tools/tests/lazy-dependencies.test.js`,
  `frontend/tools/quick-query/tests/lazy-dependencies.test.js`, and
  `frontend/tools/merge-sql/tests/lazy-dependencies.test.js` - new focused
  action-boundary tests.
- `vite.config.mjs` and `docs/PERFORMANCE.md` - build output and measurement
  conventions.

The application already lazy-loads each tool route:

```js
// frontend/config/toolDefinitions.js:22-36,62-64
"quick-query": {
  load: () => import("../tools/quick-query/main.js").then((module) => ({ ToolClass: module.QuickQuery })),
},
"compare-config": {
  load: () => import("../tools/compare-config/main.js").then((module) => ({ ToolClass: module.CompareConfigTool })),
},
```

Base64 imports JSZip at module evaluation but uses it only inside download
actions:

```js
// frontend/tools/base64-tools/main.js:9,1196-1213,1248-1258
import JSZip from "jszip";
// ...
const zip = new JSZip();
```

Quick Query has two action-only static imports:

```js
// frontend/tools/quick-query/main.js:28-29,1801-1842,2503-2506
import JSZip from "jszip";
import MinifyWorker from "../html-editor/minify.worker.js?worker";
// ... new MinifyWorker();
// ... new JSZip();
```

Merge SQL imports html2canvas before any report image action:

```js
// frontend/tools/merge-sql/main.js:14-16,2083-2108
import html2canvas from "html2canvas";
// ...
const canvas = await html2canvas(reportContent, { ... });
```

Compare Config's parser currently imports SheetJS statically
(`frontend/tools/compare-config/lib/file-parser.js:6`) but its export path in
`main.js:1120-1156` is already dynamic. Plan 007 must land first so file input
parsing and export do not fight over ownership of the dependency boundary.

## Commands you will need

| Purpose                  | Command                                                                                                                                                                                                                                                                                                                                                                     | Expected on success                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Drift check              | `git diff --stat b856304..HEAD -- frontend/tools/base64-tools/main.js frontend/tools/quick-query/main.js frontend/tools/merge-sql/main.js frontend/tools/compare-config/lib/file-parser.js frontend/tools/base64-tools/tests/lazy-dependencies.test.js frontend/tools/quick-query/tests/lazy-dependencies.test.js frontend/tools/merge-sql/tests/lazy-dependencies.test.js` | Empty output before implementation, unless drift is being reviewed                |
| Base64 tests             | `npx vitest run frontend/tools/base64-tools/tests/lazy-dependencies.test.js`                                                                                                                                                                                                                                                                                                | All focused tests pass in one Vitest process                                      |
| Quick Query tests        | `npx vitest run frontend/tools/quick-query/tests/lazy-dependencies.test.js`                                                                                                                                                                                                                                                                                                 | All focused tests pass in one Vitest process                                      |
| Merge SQL tests          | `npx vitest run frontend/tools/merge-sql/tests/lazy-dependencies.test.js`                                                                                                                                                                                                                                                                                                   | All focused tests pass in one Vitest process                                      |
| Existing tool tests      | `npx vitest run frontend/tools/base64-tools/tests/service.test.js frontend/tools/quick-query/tests/query-generation.test.js frontend/tools/merge-sql/tests/service.test.js`                                                                                                                                                                                                 | Existing service/generation tests pass; run separately from other Vitest commands |
| Lint                     | `npm run lint`                                                                                                                                                                                                                                                                                                                                                              | Exit 0; no lint errors (pre-existing warnings may remain)                         |
| Browser build smoke test | `npx vite build --outDir /tmp/adtools-plan-008 --emptyOutDir true`                                                                                                                                                                                                                                                                                                          | Exit 0 and produces a build outside the repository                                |
| Diff whitespace          | `git diff --check`                                                                                                                                                                                                                                                                                                                                                          | Empty output                                                                      |

## Scope

**In scope** (the only files to modify):

- `frontend/tools/base64-tools/main.js`
- `frontend/tools/quick-query/main.js`
- `frontend/tools/merge-sql/main.js`
- `frontend/tools/base64-tools/tests/lazy-dependencies.test.js` (create)
- `frontend/tools/quick-query/tests/lazy-dependencies.test.js` (create)
- `frontend/tools/merge-sql/tests/lazy-dependencies.test.js` (create)

**Out of scope** (do not touch):

- `frontend/config/toolDefinitions.js`; route-level lazy loading already works
- `frontend/tools/compare-config/lib/file-parser.js`; plan 007 owns its SheetJS
  worker boundary
- Handsontable or Monaco imports required to render the primary tool UI
- Dependency versions, Vite manual chunk policy, package installation, or
  generated `dist/` files
- Any visible redesign, export format, minification algorithm, or report image
  behavior

## Git workflow

- Branch, if one is used: `advisor/008-defer-action-only-tool-dependencies`.
- Match the repository's concise imperative or `perf:` commit style if the
  operator asks for commits. Do not push or open a PR unless instructed.

## Steps

### Step 1: Add cached lazy loaders for JSZip and html2canvas

Remove the top-level JSZip imports from Base64 and Quick Query and the top-level
html2canvas import from Merge SQL. Load each module at the first action that
needs it, cache the in-flight/resolved module promise, and reset a rejected
loader so a later user action can retry. Normalize the module namespace to the
constructor/function expected by the current code (`module.default` when
present, otherwise the namespace where the package interop requires it).

Do not start these imports in a constructor, `render()`, `onMount()`, or route
registration. Repeated actions after the first must reuse the resolved module
and must not trigger another network import.

**Verify**: `npx vitest run frontend/tools/base64-tools/tests/lazy-dependencies.test.js frontend/tools/merge-sql/tests/lazy-dependencies.test.js` -> module loaders are not called during tool construction/mount, first matching action loads once, and repeated actions reuse the cached promise.

### Step 2: Defer the Quick Query minification worker

Remove the static `MinifyWorker` import and dynamically load the worker
constructor inside `_minifyHtmlWithWorker()` immediately before constructing a
worker. Preserve the existing message protocol, cleanup/termination on success
and error, and failure warning behavior. Cache only the worker constructor
module, not a live worker instance; each minification operation must continue to
own and terminate its own worker.

If Vite's worker-query dynamic import syntax differs from the current build
configuration, use the supported equivalent and keep the worker out of the
initial Quick Query tool chunk. Do not replace the worker with main-thread HTML
minification.

**Verify**: `npx vitest run frontend/tools/quick-query/tests/lazy-dependencies.test.js frontend/tools/quick-query/tests/split.test.js` -> the worker module is loaded only when minification is requested, worker messages and termination remain intact, and split behavior passes.

### Step 3: Preserve first-action feedback and error behavior

Make the three tool actions tolerate the first-use import delay. Reuse the
existing button/status elements and notifications: disable the initiating
button or show its existing busy state while the dependency is loading and
processing, restore it in `finally`, and surface the same existing error text
when loading fails. Prevent duplicate clicks from starting duplicate downloads,
captures, or minification operations while one is active.

Do not change generated filenames, ZIP contents, image capture options, report
styles, download/copy destinations, or minification output. If the current
handler has no suitable status element, keep the delay non-blocking and use the
existing error notification rather than inventing a new visual pattern.

**Verify**: `npx vitest run frontend/tools/base64-tools/tests/lazy-dependencies.test.js frontend/tools/quick-query/tests/lazy-dependencies.test.js frontend/tools/merge-sql/tests/lazy-dependencies.test.js` -> first-use success, import failure, duplicate-click prevention, and existing success/error notifications behave as specified.

### Step 4: Confirm Compare Config's parser boundary from plan 007

After plan 007 is complete, inspect the built module graph and confirm the
Compare Config route no longer statically evaluates SheetJS before a file parse.
Do not modify its parser in this plan. If plan 007 has not landed, leave the
Compare Config dependency check pending rather than creating two competing
implementations.

**Verify**: `npx vite build --outDir /tmp/adtools-plan-008 --emptyOutDir true` -> exit 0; generated tool chunks show action-only packages in deferred chunks and the Compare Config parser follows plan 007's worker boundary.

### Step 5: Measure the route chunks and run quality checks

Build to a temporary directory and record the total size and largest assets
using the baseline procedure from `docs/PERFORMANCE.md:3-13`. Compare the
Base64, Quick Query, Merge SQL, and Compare Config route chunks before/after;
do not require an arbitrary byte threshold. Confirm that deferred chunks still
load successfully during the first action.

Run focused tests, existing service/generation tests, `npm run lint`, the
temporary-output build, and `git diff --check`.

**Verify**: `npm run lint` -> exit 0 with no errors; `npx vite build --outDir /tmp/adtools-plan-008 --emptyOutDir true` -> exit 0; `git diff --check` -> empty output; route measurements show the initial tool chunks no longer contain the action-only implementations.

## Test plan

- Create one focused test file per affected tool so mocks remain local to the
  tool's dependency and existing test imports stay stable.
- Mock JSZip/html2canvas/worker module loading and assert no lazy dependency is
  evaluated during module import or tool mount.
- Cover successful first-use loading and repeated action reuse.
- Cover loader rejection and a subsequent retry after the cached promise is
  reset.
- Cover ZIP generation, report image capture options, and minify worker
  message/termination behavior through the existing method contracts.
- Cover duplicate action clicks while the first dependency is pending.
- Keep existing service/generation tests and model test setup after
  `frontend/tools/quick-query/tests/split.test.js` and
  `frontend/tools/merge-sql/tests/service.test.js`.
- Verification: run the three new test files and existing focused tests
  separately, never run two Vitest processes concurrently.

## Done criteria

- [ ] Base64 does not load JSZip until a ZIP download action.
- [ ] Quick Query does not load JSZip or the minification worker until their respective actions.
- [ ] Merge SQL does not load html2canvas until report image copy/download.
- [ ] Compare Config's SheetJS boundary is owned by plan 007 and is not reintroduced here.
- [ ] First-use loading, errors, generated outputs, worker termination, and button behavior remain compatible.
- [ ] Repeated actions reuse successful lazy module promises and can retry after a load failure.
- [ ] Existing tool tests and new lazy-boundary tests pass.
- [ ] `npm run lint` exits 0 with no errors.
- [ ] `npx vite build --outDir /tmp/adtools-plan-008 --emptyOutDir true` exits 0.
- [ ] No files outside the Scope list are modified; verify with `git status --short`.
- [ ] `plans/README.md` status row is updated.

## STOP conditions

Stop and report back if:

- A listed package is required during tool mount for a visible primary feature,
  rather than only the cited action.
- Dynamic worker imports are unsupported by the configured Vite/Tauri build and
  no equivalent preserves worker execution.
- Package interop returns a different constructor shape than expected, or a
  lazy import changes ZIP/image/minification output.
- The action-only dependency remains in the initial route chunk after a clean
  temporary build; do not claim a bundle improvement without evidence.
- Preserving first-action UX requires a visible design change beyond existing
  button/status patterns.
- Plan 007 has not established the Compare Config parser boundary.
- Any verification command fails twice after a reasonable fix attempt.

## Maintenance notes

- Keep lazy loaders module-scoped and cache only module promises, not live tool
  resources or worker instances.
- Any new export/processing action must be checked for accidental top-level
  imports of large packages.
- Reviewers should inspect both the initial route chunk and the first-action
  network waterfall, not just total build size.
- The remaining Monaco, Handsontable, and editor worker cost is intentional for
  primary tool interfaces and is outside this plan.
