# Plan 002: Render Compare Config grid rows progressively

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Drift check (run first)**: `git diff --stat b856304..HEAD -- frontend/tools/compare-config/views/GridView.js frontend/tools/compare-config/main.js frontend/tools/compare-config/styles.css frontend/tools/compare-config/tests/grid-view.test.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plans/001-guard-async-navigation-commits.md (recommended, not a code dependency)
- **Category**: perf
- **Planned at**: commit `b856304`, 2026-09-03

## Why this matters

Compare Config's summary grid has lazy-loading state and an IntersectionObserver
implementation, but the current render path converts every comparison into HTML
before the browser can paint the result. Large Excel inputs can therefore block
the main thread and create a very large DOM. Progressive rendering keeps the
complete comparison data and existing filtering, sorting, status, and export
semantics while reducing the first render's synchronous work.

## Current state

Relevant files:

- `frontend/tools/compare-config/views/GridView.js` - summary table renderer;
  owns `BATCH_SIZE`, `renderedCount`, the observer, and row HTML generation.
- `frontend/tools/compare-config/main.js` - filters/sorts comparison data,
  replaces `#results-content`, and attaches GridView listeners.
- `frontend/tools/compare-config/styles.css` - existing Compare Config result
  table styling; change only if the sentinel needs layout styling.
- `frontend/tools/compare-config/tests/grid-view.test.js` - new focused tests
  for initial and subsequent row batches.
- `frontend/tools/compare-config/tests/diff-engine.test.js` - existing
  comparison behavior tests; use it as evidence that matching logic is outside
  this plan.

The GridView declares lazy-loading state but currently renders all rows:

```js
// frontend/tools/compare-config/views/GridView.js:15-18,41-48
this.BATCH_SIZE = 100;
this.renderedCount = 0;
this.comparisons = comparisons || [];
this.cleanupObserver();
```

The table body calls `renderInitialBatch()` without a load-more sentinel:

```js
// frontend/tools/compare-config/views/GridView.js:124-170
<tbody id="grid-tbody">${this.renderInitialBatch(comparisons, fieldsToDisplay, this.hasSourceFile, showStatus)}</tbody>
```

`renderInitialBatch()` maps the full input and marks every row as rendered:

```js
// frontend/tools/compare-config/views/GridView.js:181-184
this.renderedCount = comparisons.length;
return comparisons.map((comp, idx) => this.renderRow(comp, fields, hasSourceFile, showStatus, idx + 1)).join("");
```

The observer is already prepared to use `#grid-load-more-sentinel`, but it
returns immediately because `renderedCount` equals the full input and the
sentinel is absent:

```js
// frontend/tools/compare-config/views/GridView.js:205-228
if (this.renderedCount >= this.comparisons.length) return;
const sentinel = container.querySelector("#grid-load-more-sentinel");
if (!sentinel) return;
```

`CompareConfigTool.renderResults()` sorts or filters the full comparison array
before rendering, then attaches the GridView observer:

```js
// frontend/tools/compare-config/main.js:873-895
const sortedComparisons = this.gridView.sortComparisons(comparisons);
resultsContent.innerHTML = this.gridView.render(sortedComparisons, ...);
this.gridView.attachEventListeners(resultsContent);
```

The source state allows up to 500 Oracle rows by default (`main.js:71-72,91-93`)
but Excel data is not given the same bound. Do not introduce an arbitrary data
loss cap. The existing performance policy requires preserving fast switching
and result state; this plan keeps the entire `comparisons` array in memory.

## Commands you will need

| Purpose                       | Command                                                                                                                                                                                                                 | Expected on success                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Drift check                   | `git diff --stat b856304..HEAD -- frontend/tools/compare-config/views/GridView.js frontend/tools/compare-config/main.js frontend/tools/compare-config/styles.css frontend/tools/compare-config/tests/grid-view.test.js` | Empty output before implementation, unless drift is being reviewed        |
| Grid tests                    | `npx vitest run frontend/tools/compare-config/tests/grid-view.test.js`                                                                                                                                                  | All focused tests pass in one Vitest process                              |
| Existing Compare Config tests | `npx vitest run frontend/tools/compare-config/tests/diff-engine.test.js frontend/tools/compare-config/tests/unified-compare-utils.test.js`                                                                              | Existing comparison tests pass; run separately from other Vitest commands |
| Lint                          | `npm run lint`                                                                                                                                                                                                          | Exit 0; no lint errors (pre-existing warnings may remain)                 |
| Browser build smoke test      | `npx vite build --outDir /tmp/adtools-plan-002 --emptyOutDir true`                                                                                                                                                      | Exit 0 and produces a build outside the repository                        |
| Diff whitespace               | `git diff --check`                                                                                                                                                                                                      | Empty output                                                              |

## Scope

**In scope** (the only files to modify):

- `frontend/tools/compare-config/views/GridView.js`
- `frontend/tools/compare-config/styles.css` only if a sentinel style is required
- `frontend/tools/compare-config/tests/grid-view.test.js` (create)

**Out of scope** (do not touch):

- `frontend/tools/compare-config/main.js` unless a strictly necessary listener
  integration change is proven by the current GridView API
- `VerticalCardView.js` and `MasterDetailView.js`; their rendering strategy is
  a separate decision
- `diff-engine.js`, matching algorithms, data-fetching, sidecar behavior, and
  export behavior
- Any hard limit that discards comparison records
- The visible removal of the old result footer; the new sentinel must not add a
  persistent footer or change the summary controls

## Git workflow

- Branch, if one is used: `advisor/002-progressive-compare-grid-rendering`.
- Match the repository's concise imperative or `perf:` commit style if the
  operator asks for commits. Do not push or open a PR unless instructed.

## Steps

### Step 1: Restore an initial batch and an invisible load sentinel

Change `renderInitialBatch()` to render only the first `BATCH_SIZE` entries and
set `renderedCount` to that batch length. Have `render()` add a stable
`#grid-load-more-sentinel` after the table only when more rows remain. The
sentinel must not be a visible footer, must not change the result count text,
and must not discard or mutate the full `comparisons` array.

Keep row numbering based on the original comparison index so rows appended by
the observer continue at `BATCH_SIZE + 1`. Preserve all existing field-diff,
status, source-file, primary-key, and search-highlight output.

**Verify**: `npx vitest run frontend/tools/compare-config/tests/grid-view.test.js` -> a 250-row render contains 100 data rows, `renderedCount` is 100, and the sentinel exists; a 100-row render contains all rows and no sentinel.

### Step 2: Connect the existing observer to incremental row insertion

Update `attachEventListeners()` and `loadMoreRows()` to observe the new sentinel
inside `.table-scroll-area` and append the next batch using a
`DocumentFragment`, as the existing implementation already intends. After each
batch, leave the observer active until all rows are present; then remove the
sentinel and disconnect the observer.

Do not use `innerHTML +=` on the whole table, because that would recreate
existing rows and their layout state. Ensure `cleanupObserver()` runs before a
new render and when the last batch is reached. If the target browser support
matrix does not guarantee `IntersectionObserver`, stop and report rather than
silently reverting every render to the old all-rows path; agree on a fallback
that preserves the same no-data-loss behavior first.

**Verify**: `npx vitest run frontend/tools/compare-config/tests/grid-view.test.js` -> simulated intersections append rows in 100-row batches, preserve order and row numbers, and remove the sentinel after the final batch.

### Step 3: Prove filter, sort, and rerender behavior remains intact

Add tests that call `GridView.render()` with a filtered/sorted input array, then
simulate loading all batches. Assert that every supplied comparison appears
exactly once and in the supplied order, because `CompareConfigTool` owns sorting
and filtering before calling GridView. Assert that a second render disconnects
the first observer and starts from the new array rather than appending old rows.

Keep the current `renderResults()` integration unchanged unless the tests prove
the GridView API cannot attach the sentinel observer after `innerHTML` is set.

**Verify**: `npx vitest run frontend/tools/compare-config/tests/grid-view.test.js frontend/tools/compare-config/tests/diff-engine.test.js` -> new progressive-render tests and existing comparison tests pass.

### Step 4: Run build and quality checks

Run the focused tests, `npm run lint`, the temporary-output build, and
`git diff --check`. Inspect the diff specifically for accidental changes to
status filtering, search highlighting, field selection, row numbering, or the
other result views.

**Verify**: `npm run lint` -> exit 0 with no errors; `npx vite build --outDir /tmp/adtools-plan-002 --emptyOutDir true` -> exit 0; `git diff --check` -> empty output.

## Test plan

- Create `frontend/tools/compare-config/tests/grid-view.test.js` with jsdom or
  the repository's default test environment and a minimal comparison factory.
- Mock `IntersectionObserver` with an explicit `observe`, `disconnect`, and
  callback trigger so tests do not depend on layout.
- Cover fewer than one batch, exactly one batch, multiple batches, and a final
  partial batch.
- Assert the initial DOM row count, sentinel presence, `renderedCount`, row
  numbering, observer cleanup, and complete eventual row set.
- Cover rerender after a new filtered/sorted input and ensure no old rows or
  observer remain.
- Model assertions and import style after
  `frontend/tools/compare-config/tests/diff-engine.test.js`.
- Verification: `npx vitest run frontend/tools/compare-config/tests/grid-view.test.js frontend/tools/compare-config/tests/diff-engine.test.js` -> all tests pass.

## Done criteria

- [ ] Initial GridView render performs HTML generation for at most `BATCH_SIZE` rows when more rows remain.
- [ ] All comparison rows remain available through scrolling; no records are dropped and no arbitrary cap is introduced.
- [ ] The sentinel is removed and the observer disconnected after the final batch.
- [ ] A rerender cannot append rows from a previous comparison set.
- [ ] Existing sort, search, status filter, field selection, source-file, and row-number behavior remains unchanged.
- [ ] No persistent visible footer or new result-count behavior is introduced.
- [ ] New GridView tests and existing Compare Config tests pass.
- [ ] `npm run lint` exits 0 with no errors.
- [ ] `npx vite build --outDir /tmp/adtools-plan-002 --emptyOutDir true` exits 0.
- [ ] No files outside the Scope list are modified; verify with `git status --short`.
- [ ] `plans/README.md` status row is updated.

## STOP conditions

Stop and report back if:

- The current GridView code no longer matches the excerpts or the observer API
  has been changed since commit `b856304`.
- Preserving the current browser Find/search behavior requires keeping every
  row in the DOM synchronously; do not trade away the performance goal without
  reporting it.
- The product requires every row to be immediately present for accessibility,
  copy/paste, or automation and no acceptable progressive equivalent exists.
- IntersectionObserver is unavailable in a supported runtime and no tested
  fallback can preserve all rows without restoring the synchronous full render.
- A change would touch comparison matching, parsing, export, or an alternate
  result view.
- Any verification command fails twice after a reasonable fix attempt.

## Maintenance notes

- Keep `BATCH_SIZE` and the sentinel contract together; changes to row markup
  must work for both initial and appended batches.
- Any new result filter must pass its final ordered array to GridView and trigger
  observer cleanup before rerendering.
- Reviewers should test a large Excel comparison, rapid status/search changes,
  and switching between Grid, Vertical, and Master Detail views.
- The full comparison data remains in memory. A separate plan is required if
  memory pressure from parsed Excel data, not DOM creation, becomes the next
  bottleneck.
