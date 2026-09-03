# Plan 003: Bound Image Checker request concurrency

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Drift check (run first)**: `git diff --stat b856304..HEAD -- frontend/tools/image-checker/main.js frontend/tools/image-checker/service.js frontend/tools/image-checker/concurrency.js frontend/tools/image-checker/tests/concurrency.test.js frontend/tools/image-checker/tests/main.test.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/001-guard-async-navigation-commits.md (recommended for the same stale-work rule)
- **Category**: perf
- **Planned at**: commit `b856304`, 2026-09-03

## Why this matters

Image Checker launches one image probe for every input path and selected
environment at once. A large paste can therefore create a large table, many
simultaneous image requests, many timers and decode operations, and a second
unbounded burst when the user chooses Retry All. A bounded scheduler keeps all
rows and progressive results available while protecting browser/network
resources and preventing old runs from updating a newer result table.

## Current state

Relevant files:

- `frontend/tools/image-checker/main.js` - owns table creation, per-cell
  updates, initial batch execution, and retry-all behavior.
- `frontend/tools/image-checker/service.js` - performs one image probe with up
  to three timeout attempts and a 500 ms retry delay.
- `frontend/tools/image-checker/concurrency.js` - new small scheduler module;
  keeps concurrency logic independently testable.
- `frontend/tools/image-checker/tests/concurrency.test.js` - new scheduler
  tests.
- `frontend/tools/image-checker/tests/main.test.js` - new integration-level
  harness tests if the DOM run-generation behavior cannot be covered through
  the scheduler alone.
- `frontend/tools/image-checker/template.js` - existing controls and result
  container; do not change the visible workflow unless required for status
  feedback.

The input is split without a size or concurrency boundary, the complete table
is created immediately, and fetching starts for every cell:

```js
// frontend/tools/image-checker/main.js:155-178
const imagePaths = batchInput.split(/\r?\n/).filter((line) => line.trim().length > 0);
this.renderProgressiveTable(imagePaths, baseUrls);
this.fetchAllCellsProgressively(imagePaths, baseUrls);
```

The table has one DOM cell per path/environment pair:

```js
// frontend/tools/image-checker/main.js:220-245
imagePaths.forEach((path, rowIndex) => {
  // ...
  baseUrls.forEach((env, colIndex) => {
    td.id = `cell-${rowIndex}-${colIndex}`;
    tbody.appendChild(row);
  });
});
```

The current fetch loop starts every promise before awaiting any result:

```js
// frontend/tools/image-checker/main.js:264-295
const fetchPromises = [];
imagePaths.forEach((path, rowIndex) => {
  baseUrls.forEach((env, colIndex) => {
    fetchPromises.push(this.fetchAndUpdateCell(path, normalized, env, rowIndex, colIndex));
  });
});
await Promise.all(fetchPromises);
```

Retry All repeats the same unbounded pattern:

```js
// frontend/tools/image-checker/main.js:400-416
const cellsToRetry = Array.from(this.timeoutCells.values());
const retryPromises = cellsToRetry.map(({ originalPath, env, rowIndex, colIndex }) =>
  this.retryCell(originalPath, env, rowIndex, colIndex),
);
await Promise.all(retryPromises);
```

Each task can itself perform multiple probes:

```js
// frontend/tools/image-checker/service.js:129-147
for (let attempt = 1; attempt <= maxRetries; attempt++) {
  const result = await this.checkImageOnce(url, timeoutMs);
  if (!result.timeout) return result;
  await new Promise((resolve) => setTimeout(resolve, 500));
}
```

The existing tool exports `CheckImageTool` for the dynamic loader at
`frontend/tools/image-checker/main.js:734`. Preserve that export and the
existing progressive cell statuses, timeout map, retry buttons, and analytics.

## Commands you will need

| Purpose                  | Command                                                                                                                                                                                                                                                            | Expected on success                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Drift check              | `git diff --stat b856304..HEAD -- frontend/tools/image-checker/main.js frontend/tools/image-checker/service.js frontend/tools/image-checker/concurrency.js frontend/tools/image-checker/tests/concurrency.test.js frontend/tools/image-checker/tests/main.test.js` | Empty output before implementation, unless drift is being reviewed |
| Scheduler tests          | `npx vitest run frontend/tools/image-checker/tests/concurrency.test.js`                                                                                                                                                                                            | All focused tests pass in one Vitest process                       |
| Image tool tests         | `npx vitest run frontend/tools/image-checker/tests/concurrency.test.js frontend/tools/image-checker/tests/main.test.js`                                                                                                                                            | All focused tests pass in one Vitest process                       |
| Lint                     | `npm run lint`                                                                                                                                                                                                                                                     | Exit 0; no lint errors (pre-existing warnings may remain)          |
| Browser build smoke test | `npx vite build --outDir /tmp/adtools-plan-003 --emptyOutDir true`                                                                                                                                                                                                 | Exit 0 and produces a build outside the repository                 |
| Diff whitespace          | `git diff --check`                                                                                                                                                                                                                                                 | Empty output                                                       |

## Scope

**In scope** (the only files to modify):

- `frontend/tools/image-checker/main.js`
- `frontend/tools/image-checker/concurrency.js` (create)
- `frontend/tools/image-checker/tests/concurrency.test.js` (create)
- `frontend/tools/image-checker/tests/main.test.js` (create only if needed for run identity/DOM integration)

**Out of scope** (do not touch):

- `frontend/tools/image-checker/service.js` unless a signal/cancellation
  parameter is strictly required and covered by a focused service test
- Image URL normalization, timeout duration, retry count, cache-busting, or
  result status meanings
- Backend/CDN rate limits and configured base URLs
- A hard input cap that drops paths, silently truncates results, or changes the
  existing all-environment selection behavior
- Unrelated tool lifecycle or route changes; plan 001 owns shared navigation
  commit guards

## Git workflow

- Branch, if one is used: `advisor/003-bound-image-check-concurrency`.
- Match the repository's concise imperative or `perf:` commit style if the
  operator asks for commits. Do not push or open a PR unless instructed.

## Steps

### Step 1: Add a bounded, result-preserving task scheduler

Create `frontend/tools/image-checker/concurrency.js` with one exported helper
that accepts an array of task functions and a positive concurrency limit. The
helper must start no more than the limit at a time, resolve in input order with
each task's result, and reject only according to an explicit caller policy.
Do not use `Promise.all(tasks.map(...))` to start all tasks. The helper must not
mutate the task list and must handle an empty list and a limit larger than the
task count.

Use a named limit in `main.js`, with an initial value of 8. Keep the value easy
to tune after measuring browser and CDN behavior; do not make it user-facing.

**Verify**: `npx vitest run frontend/tools/image-checker/tests/concurrency.test.js` -> empty input, one task, task ordering, and a measured maximum of 8 active tasks all pass.

### Step 2: Use the scheduler for initial checks and Retry All

Refactor `fetchAllCellsProgressively()` to create task functions for the
existing `(path, environment, rowIndex, colIndex)` tuples and pass them through
the bounded scheduler. Preserve immediate progressive cell updates and the
existing completion analytics counts. The returned promise should represent
the full run so callers can await it, but the table must continue showing each
cell as soon as its own task completes.

Refactor `retryAllTimeouts()` to use the same scheduler. Keep the current
snapshot-and-clear behavior for `timeoutCells`; cells that time out again must
be re-added by the existing update path. Preserve the retry count and
still-timeout analytics fields.

Do not add a hard row limit. If rendering thousands of rows itself becomes the
dominant cost, use a separate progressive DOM strategy without dropping rows;
do not hide that work behind the concurrency change.

**Verify**: `npx vitest run frontend/tools/image-checker/tests/concurrency.test.js frontend/tools/image-checker/tests/main.test.js` -> initial and retry tasks never exceed the limit, all supplied cells receive a result, and retry analytics retain their existing counts.

### Step 3: Prevent stale runs from updating the current table

Add a monotonically increasing check-run identity in `CheckImageTool`. A new
batch, clear action, or unmount invalidates the previous identity. Pass the
captured identity through fetch/update paths and ignore results that belong to
an older run or a detached root. The underlying `Image` probe may finish, but
it must not replace a newer table cell or re-add stale timeout entries.

Keep the current timeout and error UI for the active run. Do not treat an
invalidated run as a user-visible error. If the check button remains enabled
during a run, a second click must make the newest table authoritative and must
not mix its row indices with the previous run.

**Verify**: `npx vitest run frontend/tools/image-checker/tests/main.test.js` -> a deferred old check cannot update a newly rendered table, while an active check still updates success, error, and timeout cells.

### Step 4: Yield large table construction without changing result access

If the integration test or a browser profile confirms that synchronous
`renderProgressiveTable()` dominates for large input, split row insertion into
small batches and yield between batches with the repository's browser-safe
scheduling approach. Start cell tasks only after their target cells exist.
All rows must remain available, stable cell IDs must be retained, and the
existing progressive status UI must remain intact. If the initial measured cost
is not material, leave table construction unchanged and record that result in
the implementation PR rather than adding complexity.

**Verify**: `npx vitest run frontend/tools/image-checker/tests/main.test.js` -> all input rows and environment cells exist after the scheduled render, and their row/column IDs remain stable.

### Step 5: Run build and quality checks

Run focused tests, `npm run lint`, the temporary-output build, and
`git diff --check`. Review the diff for unchanged service retry semantics,
success/error/timeout labels, preview details, retry buttons, and analytics
payload fields.

**Verify**: `npm run lint` -> exit 0 with no errors; `npx vite build --outDir /tmp/adtools-plan-003 --emptyOutDir true` -> exit 0; `git diff --check` -> empty output.

## Test plan

- Create `frontend/tools/image-checker/tests/concurrency.test.js` for the
  scheduler, using fake timers only where needed for task completion.
- Create `frontend/tools/image-checker/tests/main.test.js` with jsdom and a
  minimal `CheckImageTool` harness or the exported class. Mock
  `ImageCheckerService` so tests control completion order without network.
- Cover initial checks with zero, one, eight, and more than eight tasks.
- Assert the maximum active service calls never exceeds 8 and all cells still
  resolve in the original row/column mapping.
- Cover Retry All with a partial timeout map and assert the map is re-populated
  only by current-run timeout results.
- Cover a new check and unmount while previous checks are pending; old results
  must not touch the new root.
- Cover all existing result classes: success preview, not-found/error, and
  timeout with retry control.
- Follow the repository's Vitest style from
  `frontend/tools/master-lockey/tests/remote-load-performance.test.js` and
  `frontend/core/tests/tool-lifecycle.test.js`.
- Verification: `npx vitest run frontend/tools/image-checker/tests/concurrency.test.js frontend/tools/image-checker/tests/main.test.js` -> all new tests pass.

## Done criteria

- [ ] Initial image checks start no more than 8 service calls concurrently.
- [ ] Retry All uses the same bound and does not create an unbounded Promise.all burst.
- [ ] All input paths and selected environments remain represented; no silent truncation or arbitrary cap is introduced.
- [ ] Progressive cell updates, timeout tracking, retry buttons, previews, and analytics remain behaviorally compatible.
- [ ] Stale check results cannot update a newer run or detached root.
- [ ] New scheduler and integration tests pass.
- [ ] `npm run lint` exits 0 with no errors.
- [ ] `npx vite build --outDir /tmp/adtools-plan-003 --emptyOutDir true` exits 0.
- [ ] No files outside the Scope list are modified; verify with `git status --short`.
- [ ] `plans/README.md` status row is updated.

## STOP conditions

Stop and report back if:

- The current Image Checker class, export, service retry contract, or cell ID
  scheme differs from the excerpts.
- A concurrency bound causes the CDN to require a different request ordering,
  or a product requirement depends on all requests starting simultaneously.
- Preserving all results requires an input cap or a redesign of the visible
  result table; do not choose a cap without an explicit product decision.
- A stale run can only be stopped by changing `ImageCheckerService` semantics
  or browser cache-busting behavior beyond this scope.
- Any verification command fails twice after a reasonable fix attempt.

## Maintenance notes

- Keep initial and retry paths on the same scheduler so future actions cannot
  accidentally reintroduce an unbounded burst.
- If the timeout duration, retry count, or concurrency limit changes, update
  the scheduler tests and review CDN/browser behavior together.
- Reviewers should test a large paste, multiple environments, rapid repeated
  checks, Clear during a run, and Retry All after mixed outcomes.
- DOM virtualization or server-side image-check batching is intentionally
  deferred unless the measured table-render step remains a bottleneck.
