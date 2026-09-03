# Plan 006: Keep analytics batches within ingestion limits

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Drift check (run first)**: `git diff --stat b856304..HEAD -- frontend/core/UsageTracker.js frontend/core/tests/usage-tracker.test.js backend-workers/src/routes/analytics.js backend-workers/worker.js backend-workers/tests/analytics.test.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `b856304`, 2026-09-03

## Why this matters

The browser stores up to 1,500 events, 1,500 usage-log rows, and 300 error
events, while the analytics endpoint rejects a batch when the combined item
count exceeds 500. A busy client can therefore serialize and transmit an
oversized payload, receive 413, retain the same rows, and repeat the work on
every flush opportunity. Splitting the existing absolute-count payload into
bounded, byte-aware requests removes the retry loop without losing detail rows
or changing the server's ingestion contract.

## Current state

Relevant files:

- `frontend/core/UsageTracker.js` - owns local analytics buffers, payload
  mapping, and remote batch flush/clear behavior.
- `frontend/core/AnalyticsSender.js` - sends one JSON payload and returns a
  boolean; preserve this public behavior.
- `frontend/core/tests/usage-tracker.test.js` - existing mocked batch flush
  tests; extend this file for chunking and partial-failure behavior.
- `backend-workers/src/routes/analytics.js` - rejects more than 500 combined
  array items and treats `device_usage.count` as an absolute upsert value.
- `backend-workers/worker.js` - rejects authenticated analytics bodies over
  1,000,000 bytes before route handling.

The client buffer limits are independent and can exceed the server limit:

```js
// frontend/core/UsageTracker.js:13-17
static MAX_EVENTS = 1500;
static MAX_USAGE_LOGS = 1500;
static MAX_ERROR_EVENTS = 300;
static BATCH_FLUSH_INTERVAL_MS = 60 * 60 * 1000;
```

The payload includes all four arrays:

```js
// frontend/core/UsageTracker.js:639-696
const events = ...;
const usage_log = ...;
const error_events = ...;
const device_usage = ...;
return { device_id, user_email, runtime, app_version, events, usage_log, error_events, device_usage };
```

Flush currently sends one payload and clears all detail rows only when that one
send succeeds:

```js
// frontend/core/UsageTracker.js:699-723
const payload = this._toBatchPayload();
const sent = await AnalyticsSender.sendBatch(payload);
if (sent) {
  this._state.events = [];
  this._state.usageLogs = [];
  this._state.errorEvents = [];
  this.flushSync();
}
```

The server rejects the combined item count:

```js
// backend-workers/src/routes/analytics.js:21-29
if (events.length + usageLogs.length + errorEvents.length + deviceUsage.length > 500) {
  return new Response(..., { status: 413, ... });
}
```

The Worker also has a byte guard:

```js
// backend-workers/worker.js:196-202
if (Number(request.headers.get("Content-Length") || 0) > 1_000_000) {
  return new Response(..., { status: 413, ... });
}
```

`device_usage` is not a delta stream. The backend replaces the stored absolute
count on conflict (`backend-workers/src/routes/analytics.js:138-156`), so it
may be resent safely while unsent detail rows are retried. Detail rows are not
currently assigned server IDs or idempotency keys; partial-success handling
must therefore avoid re-sending already acknowledged rows.

## Commands you will need

| Purpose                  | Command                                                                                                                                                                                                              | Expected on success                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Drift check              | `git diff --stat b856304..HEAD -- frontend/core/UsageTracker.js frontend/core/tests/usage-tracker.test.js backend-workers/src/routes/analytics.js backend-workers/worker.js backend-workers/tests/analytics.test.js` | Empty output before implementation, unless drift is being reviewed   |
| Usage tracker tests      | `npx vitest run frontend/core/tests/usage-tracker.test.js`                                                                                                                                                           | All focused tests pass in one Vitest process                         |
| Backend analytics tests  | `npx vitest run --config backend-workers/vitest.config.js backend-workers/tests/analytics.test.js`                                                                                                                   | Existing server limit and ingestion tests pass in one Vitest process |
| Lint                     | `npm run lint`                                                                                                                                                                                                       | Exit 0; no lint errors (pre-existing warnings may remain)            |
| Browser build smoke test | `npx vite build --outDir /tmp/adtools-plan-006 --emptyOutDir true`                                                                                                                                                   | Exit 0 and produces a build outside the repository                   |
| Diff whitespace          | `git diff --check`                                                                                                                                                                                                   | Empty output                                                         |

## Scope

**In scope** (the only files to modify):

- `frontend/core/UsageTracker.js`
- `frontend/core/tests/usage-tracker.test.js`
- `backend-workers/tests/analytics.test.js` only if an existing server-boundary assertion must be added or updated

**Out of scope** (do not touch):

- `frontend/core/AnalyticsSender.js` public method signatures or URL fallback behavior
- Backend item/byte limits; the client must adapt to the existing contract
- Analytics schema, database writes, event names, payload field names, or count semantics
- The local buffer limits unless a test proves the existing storage quota policy is incompatible
- Live log/error endpoints, which are separate requests

## Git workflow

- Branch, if one is used: `advisor/006-keep-analytics-batches-within-ingestion-limits`.
- Match the repository's concise imperative or `perf:` commit style if the
  operator asks for commits. Do not push or open a PR unless instructed.

## Steps

### Step 1: Build a stable, item- and byte-bounded chunker

Add a private/static helper in `UsageTracker` that partitions the mapped batch
into payload chunks. Count every element in `events`, `usage_log`,
`error_events`, and `device_usage` toward a maximum of 500. Also enforce a
conservative serialized payload budget below the Worker 1,000,000-byte guard;
use an explicit initial budget of 800,000 UTF-8 bytes to leave room for request
headers and envelope fields.

Preserve top-level metadata in every chunk. Partition arrays in a deterministic
order, preserve the order within each array, and never mutate the source state
or mapped payload. Handle empty arrays and a payload with no detail rows.

Keep `device_usage` entries as absolute values and include each entry in exactly
one chunk. Do not duplicate detail rows across chunks.

**Verify**: `npx vitest run frontend/core/tests/usage-tracker.test.js` -> chunk tests show every chunk has at most 500 total items and stays under the byte budget while concatenating chunks reproduces every original array in order.

### Step 2: Flush chunks with partial-success accounting

Change `_flushBatch()` to snapshot the current detail-row object references and
build chunks from that snapshot. Send chunks sequentially through the existing
`AnalyticsSender.sendBatch()` API. Stop after the first failed chunk; do not
send later chunks until a future flush.

After each successful chunk, record exactly which snapshot detail rows it
acknowledged. If all chunks succeed, remove only those snapshot rows from the
live state and preserve any events queued while the network requests were in
flight. If a later chunk fails, remove only rows from successful chunks and
leave failed and unsent rows for retry. Keep all `device_usage` counts in state;
they are absolute and must continue syncing on later flushes.

Preserve the existing boolean success behavior of `AnalyticsSender`. A false
return or thrown error is a failed chunk, not permission to clear rows. Keep
`flushSync()` after state changes and retain the current swallowed-error policy.

**Verify**: `npx vitest run frontend/core/tests/usage-tracker.test.js` -> all-success clears acknowledged detail rows, a first-chunk failure clears nothing, a later-chunk failure retains failed/unsent rows, and rows added during a flush are preserved.

### Step 3: Preserve existing payload and server semantics

Do not change `_toBatchPayload()` field names, normalization, metadata
sanitization, absolute counts, or local rolling-buffer limits. Confirm that
the server still receives the same item objects, only split across requests.
Add or update one backend boundary test only if needed to document that 500 is
accepted and 501 is rejected; do not relax the endpoint guard.

**Verify**: `npx vitest run --config backend-workers/vitest.config.js backend-workers/tests/analytics.test.js` -> existing ingestion, sanitization, and limit behavior passes.

### Step 4: Run build and quality checks

Run the focused client/backend tests, `npm run lint`, the temporary-output build,
and `git diff --check`. Inspect the diff for no duplicated detail rows, no
clearing of newly queued rows, no changes to event normalization, and no
changes to server limits.

**Verify**: `npm run lint` -> exit 0 with no errors; `npx vite build --outDir /tmp/adtools-plan-006 --emptyOutDir true` -> exit 0; `git diff --check` -> empty output.

## Test plan

- Extend `frontend/core/tests/usage-tracker.test.js` using its existing
  `beforeEach` state setup and mocked `AnalyticsSender.sendBatch()` pattern.
- Build a state containing more than 500 combined detail items and assert the
  sender receives multiple chunks, each within item and byte limits.
- Assert concatenated sent arrays preserve per-array order and every source
  detail object is represented once.
- Test successful multi-chunk flush, failure of the first chunk, failure of a
  later chunk, and a new event queued while a chunk is pending.
- Test that absolute `device_usage` rows can be sent again without being
  treated as detail rows to clear.
- Keep the existing tests for one-batch success/failure and public flush wrapper.
- If a backend boundary test is added, model it after
  `backend-workers/tests/analytics.test.js:131-186`.
- Verification: run client and worker Vitest commands separately, never run two
  Vitest processes concurrently.

## Done criteria

- [ ] No client analytics request exceeds 500 combined array items.
- [ ] No client analytics request exceeds the conservative serialized byte budget.
- [ ] All detail rows are sent exactly once per successful acknowledgement and remain queued after failed/unsent chunks.
- [ ] Rows added during an in-flight flush are not cleared accidentally.
- [ ] Absolute `device_usage` counts, normalization, and payload field names remain unchanged.
- [ ] Existing server limits remain enforced and tests pass.
- [ ] `npm run lint` exits 0 with no errors.
- [ ] `npx vite build --outDir /tmp/adtools-plan-006 --emptyOutDir true` exits 0.
- [ ] No files outside the Scope list are modified; verify with `git status --short`.
- [ ] `plans/README.md` status row is updated.

## STOP conditions

Stop and report back if:

- The server limit or byte guard differs from the excerpts.
- A single sanitized item can exceed the byte budget and cannot be sent under
  the existing endpoint contract; do not truncate analytics data.
- The sender or backend can partially acknowledge a request without returning
  a success value that distinguishes it; do not clear rows on guesswork.
- Existing tests or callers require one `sendBatch()` call per flush as a
  public observable contract.
- Preserving exact-once detail delivery requires adding a backend idempotency
  schema or API change; report that as a separate dependency.
- Any verification command fails twice after a reasonable fix attempt.

## Maintenance notes

- Keep the client chunk limits tied to the server's 500-item and 1 MB guards;
  update both the constants and tests if either server limit changes.
- Reviewers should inspect partial failure and concurrent enqueue behavior more
  closely than the normal success path.
- Do not lower local buffer caps merely to hide a chunking bug; those caps are a
  separate local-storage policy.
- If analytics needs stronger exactly-once guarantees in the future, add a
  server idempotency design rather than relying on client object identity.
