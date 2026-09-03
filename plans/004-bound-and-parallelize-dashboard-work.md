# Plan 004: Bound and parallelize dashboard data work

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Drift check (run first)**: `git diff --stat b856304..HEAD -- backend-workers/src/routes/dashboard.js frontend/pages/analytics-dashboard/main.js frontend/pages/analytics-dashboard/template.js frontend/pages/analytics-dashboard/styles.css backend-workers/tests/dashboard-performance.test.js frontend/pages/analytics-dashboard/tests/pagination.test.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans/001-guard-async-navigation-commits.md
- **Category**: perf
- **Planned at**: commit `b856304`, 2026-09-03

## Why this matters

The dashboard overview waits for eight independent D1 scalar queries one after
another, so the first load accumulates every database round trip. Other default
tabs return all Recent Activity and Events rows, then the browser creates one
DOM row per result. The plan keeps the existing metric labels, fallbacks,
authentication, row details, and search behavior while parallelizing independent
work, coalescing duplicate requests, and making large activity views explicitly
pageable instead of allowing an unbounded response.

## Current state

Relevant files:

- `backend-workers/src/routes/dashboard.js` - dashboard tab definitions,
  overview metric queries, result cache, and generic query endpoint.
- `frontend/pages/analytics-dashboard/main.js` - tab fetch/cache logic, row
  filtering, table rendering, and row-detail behavior.
- `frontend/pages/analytics-dashboard/template.js` - dashboard controls and
  panel shell; extend only if pagination controls cannot be injected into the
  existing panel safely.
- `frontend/pages/analytics-dashboard/styles.css` - existing dashboard visual
  language; reuse existing button/table styles.
- `backend-workers/tests/dashboard-performance.test.js` - new backend query,
  cache, and pagination tests.
- `frontend/pages/analytics-dashboard/tests/pagination.test.js` - new client
  pagination and stale/current render tests.
- `backend-workers/tests/analytics.test.js` - existing endpoint assertions for
  authentication, safe fallbacks, and normalized dashboard queries.

The server cache is a TTL map with no maximum size or in-flight request map:

```js
// backend-workers/src/routes/dashboard.js:1121-1125,1382-1397
const CACHE_TTL_MS = 60 * 1000;
const dashboardQueryCache = new Map();

function getCachedDashboardQueryBody(cacheKey) {
  const cached = dashboardQueryCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    dashboardQueryCache.delete(cacheKey);
    return null;
  }
  return cached.body;
}
```

Overview discovers tables and then awaits eight scalar values serially:

```js
// backend-workers/src/routes/dashboard.js:1419-1426,1438-1444,1452-1458
const tables = await getDashboardTables(env);
const normalizedUsage7d = buildNormalizedUsageLogQuery(...);
const normalizedUsage30d = buildNormalizedUsageLogQuery(...);
const data = [
  { metric: "Active users today", value: await safeDashboardScalar(...) },
  { metric: "Active users 7d", value: await safeDashboardScalar(...) },
  { metric: "Tool opens 7d", value: await safeDashboardScalar(...) },
  // five more independent awaited metrics
];
```

The default Recent Activity and Events queries have ordering but no limit:

```js
// backend-workers/src/routes/dashboard.js:172-210
id: "daily",
query: `SELECT ... FROM usage_log ... ORDER BY u.created_time DESC`,
// ...
id: "events",
query: `SELECT ... FROM events ... ORDER BY e.created_time DESC`,
```

The generic endpoint executes the configured SQL with `.all()` and returns all
rows:

```js
// backend-workers/src/routes/dashboard.js:2020-2040
const result = await env.DB.prepare(query).all();
const body = JSON.stringify({ ok: true, data: result.results || [] });
setCachedDashboardQueryBody(cacheKey, body);
```

The client caches and renders every returned row:

```js
// frontend/pages/analytics-dashboard/main.js:252-323
this.cache[cacheKey] = data.data;
this.renderTable(content, data.data);
// renderTable maps data into <tbody> rows and binds one click listener per row
```

The dashboard already has a search control (`template.js:42-45`) and a range
control currently used only for the Who tab (`main.js:668-675`). Existing
dashboard tests assert safe missing-table fallbacks and normalized usage SQL;
those behaviors must remain intact.

## Commands you will need

| Purpose                  | Command                                                                                                                                                                                                                                                                                                                            | Expected on success                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Drift check              | `git diff --stat b856304..HEAD -- backend-workers/src/routes/dashboard.js frontend/pages/analytics-dashboard/main.js frontend/pages/analytics-dashboard/template.js frontend/pages/analytics-dashboard/styles.css backend-workers/tests/dashboard-performance.test.js frontend/pages/analytics-dashboard/tests/pagination.test.js` | Empty output before implementation, unless drift is being reviewed |
| Backend focused tests    | `npx vitest run --config backend-workers/vitest.config.js backend-workers/tests/dashboard-performance.test.js`                                                                                                                                                                                                                     | All focused dashboard tests pass in one Vitest process             |
| Existing backend tests   | `npm run test:worker`                                                                                                                                                                                                                                                                                                              | All worker tests pass; run separately from client Vitest commands  |
| Client focused tests     | `npx vitest run frontend/pages/analytics-dashboard/tests/pagination.test.js`                                                                                                                                                                                                                                                       | All focused client tests pass in one Vitest process                |
| Lint                     | `npm run lint`                                                                                                                                                                                                                                                                                                                     | Exit 0; no lint errors (pre-existing warnings may remain)          |
| Browser build smoke test | `npx vite build --outDir /tmp/adtools-plan-004 --emptyOutDir true`                                                                                                                                                                                                                                                                 | Exit 0 and produces a build outside the repository                 |
| Diff whitespace          | `git diff --check`                                                                                                                                                                                                                                                                                                                 | Empty output                                                       |

## Scope

**In scope** (the only files to modify):

- `backend-workers/src/routes/dashboard.js`
- `frontend/pages/analytics-dashboard/main.js`
- `frontend/pages/analytics-dashboard/template.js` only if needed for stable pagination markup
- `frontend/pages/analytics-dashboard/styles.css` only for a small pagination style using existing tokens
- `backend-workers/tests/dashboard-performance.test.js` (create)
- `frontend/pages/analytics-dashboard/tests/pagination.test.js` (create)
- `backend-workers/tests/analytics.test.js` only if an existing assertion must be updated for an additive response field

**Out of scope** (do not touch):

- Dashboard authentication, token generation, authorization, or password handling
- The `Who`, `Tools`, `Tool Adoption`, or feature-specific query SQL except for
  shared cache helpers
- The correlated `NOT EXISTS` usage-log normalization query; it needs separate
  query-plan evidence before changing its semantics
- Database migrations or index changes
- Public non-dashboard API response shapes
- Any user-facing credential or owner configuration

## Git workflow

- Branch, if one is used: `advisor/004-bound-and-parallelize-dashboard-work`.
- Match the repository's concise imperative or `perf:` commit style if the
  operator asks for commits. Do not push or open a PR unless instructed.

## Steps

### Step 1: Coalesce and bound dashboard result caching

Refactor the dashboard cache helpers so successful response bodies retain the
existing 60-second TTL but also have a fixed maximum entry count, initially 32.
Use an explicit eviction policy such as oldest insertion/LRU and ensure expired
entries are removed without requiring the exact key to be requested. Keep cache
keys stable for existing non-paginated tabs.

Add an in-flight promise map keyed by the same cache key. A concurrent request
for a missing key must await the existing computation instead of starting a
second D1 query. Remove an in-flight entry on both success and failure; do not
cache failed responses. Preserve the current JSON body and CORS headers.

Apply the helper to overview and generic query execution without changing
authentication or fallback behavior.

**Verify**: `npx vitest run --config backend-workers/vitest.config.js backend-workers/tests/dashboard-performance.test.js` -> concurrent identical requests execute one underlying query computation, expired/over-limit entries are evicted, and successful response bodies remain unchanged.

### Step 2: Parallelize independent overview metrics

After `getDashboardTables()` and normalized query-string construction complete,
represent the eight metric definitions as promise-producing values and resolve
them with `Promise.all`. Preserve their current array order, metric names,
contexts, fallback values, required-table checks, and SQL text. Do not parallelize
schema discovery with queries that depend on its table set.

If the target D1 runtime does not safely support concurrent `prepare().first()`
calls, stop and report the runtime limitation; use a supported D1 batch API only
if it preserves per-metric fallback behavior and the existing response order.

**Verify**: `npx vitest run --config backend-workers/vitest.config.js backend-workers/tests/dashboard-performance.test.js backend-workers/tests/analytics.test.js` -> the overview returns the same eight ordered metrics, missing tables still produce safe fallback values, and the test double observes overlapping independent scalar calls.

### Step 3: Add a bounded page contract for Recent Activity and Events

Add validated `page` and `pageSize` request fields for the built-in `daily` and
`events` tabs. Use 1-based pages, default `pageSize` 100, and maximum `pageSize` 200. Query one extra row to calculate `pagination.hasMore`, return only the
requested page in `data`, and include an additive response field:

```json
{
  "pagination": { "page": 1, "pageSize": 100, "hasMore": true }
}
```

Use dedicated safe query builders for these two built-in tabs or an equivalent
bound-parameter wrapper. Preserve their selected columns, joins, exclusion
rules, and descending timestamp order. Bind search text and numeric pagination
values; never interpolate raw user text into SQL. The cache key must include
tab, page, page size, and search value.

The existing `Search rows` control must continue searching the full matching
dataset for these tabs, not merely the currently loaded page. Send a normalized
bounded search term to the endpoint and apply it to the displayed columns on
the server. Keep client-side filtering for all other tabs unchanged. If a KV
override replaces either built-in query with a shape that cannot support the
same columns/search contract, stop and report instead of silently changing its
meaning.

**Verify**: `npx vitest run --config backend-workers/vitest.config.js backend-workers/tests/dashboard-performance.test.js` -> daily and events requests return at most 100 rows by default, expose `hasMore`, honor validated page/search inputs, preserve ordering, and reject/normalize invalid pagination without SQL injection.

### Step 4: Render pages without losing access to rows

Update `AnalyticsDashboardPage` to track page/search state for daily and events,
request the first page on tab entry or search change, and append subsequent
pages through a small existing-style button or pager inside the panel. Keep
already loaded rows so row-detail clicks continue to work. Disable the control
while a page request is pending, hide it when `hasMore` is false, and show a
non-blocking loading state consistent with the existing panel.

Use the request identity/cancellation guard from plan 001. A stale page response
must not append to a new search or tab. Keep `lastRenderedData` and the current
row detail behavior consistent with the loaded result set. Do not add a visible
control to tabs that are not paginated.

**Verify**: `npx vitest run frontend/pages/analytics-dashboard/tests/pagination.test.js` -> first-page rendering, Load More append, end-of-results state, full-dataset search requests, tab changes, and stale responses all behave as specified.

### Step 5: Run build and quality checks

Run the new backend/client tests, existing dashboard/analytics tests,
`npm run lint`, the temporary-output build, and `git diff --check`. Inspect the
diff for unchanged authentication, tab ordering, metric labels, safe fallbacks,
search semantics, row-detail behavior, and CORS headers.

**Verify**: `npm run test:worker` -> all worker tests pass; `npm run lint` -> exit 0 with no errors; `npx vite build --outDir /tmp/adtools-plan-004 --emptyOutDir true` -> exit 0; `git diff --check` -> empty output.

## Test plan

- Create `backend-workers/tests/dashboard-performance.test.js` using the mock
  D1 setup style in `backend-workers/tests/analytics.test.js:10-49` and the
  dashboard authentication/request patterns in that file.
- Test eight overview metrics for ordered output, missing-table fallbacks, and
  overlapping independent scalar calls.
- Test concurrent identical dashboard requests and cache eviction/coalescing.
- Test daily/events default page size, a later page, `hasMore`, stable order,
  bounded search, invalid page values, and a page size above the maximum.
- Create `frontend/pages/analytics-dashboard/tests/pagination.test.js` with
  jsdom and mocked `fetch`; cover first page, append, search reset, tab switch,
  current 401, and stale response suppression.
- Model response and fallback assertions after
  `backend-workers/tests/analytics.test.js:437-508`.
- Verification: run backend and client test commands separately, never run two
  Vitest processes concurrently.

## Done criteria

- [ ] Overview metrics resolve concurrently after schema discovery while preserving order, labels, contexts, and fallbacks.
- [ ] Identical concurrent dashboard requests share one in-flight computation.
- [ ] Dashboard result cache has a fixed maximum and retains the 60-second TTL.
- [ ] Daily and Events responses are bounded by validated pagination without dropping access to older rows.
- [ ] Search for Daily and Events covers the full matching dataset server-side.
- [ ] Pagination controls use existing dashboard visual patterns and preserve row details.
- [ ] Stale tab/page responses cannot mutate current dashboard state.
- [ ] Existing dashboard authentication and analytics tests pass.
- [ ] `npm run test:worker` exits 0.
- [ ] `npm run lint` exits 0 with no errors.
- [ ] `npx vite build --outDir /tmp/adtools-plan-004 --emptyOutDir true` exits 0.
- [ ] No files outside the Scope list are modified; verify with `git status --short`.
- [ ] `plans/README.md` status row is updated.

## STOP conditions

Stop and report back if:

- The dashboard queries, tab IDs, cache helpers, or response shape differ from
  the excerpts.
- D1 does not support the proposed concurrent or bound-parameter execution
  safely; do not substitute unverified database behavior.
- KV contains a custom `daily` or `events` query whose selected columns or
  semantics cannot support the same pagination/search contract.
- A bounded page requires silently removing the current all-history access or
  changing row-detail/search behavior without an explicit replacement.
- The cache can contain sensitive dashboard data beyond the current response
  lifetime and the proposed eviction policy is insufficient; report before
  expanding retention.
- Any verification command fails twice after a reasonable fix attempt.

## Maintenance notes

- Any new dashboard query must use a bounded cache key and must not bypass the
  in-flight coalescing/eviction helper.
- If a tab becomes large, decide its page/search contract before adding it to
  the generic endpoint; do not return unbounded `.all()` results by default.
- Reviewers should compare first-load D1 query count/timing, response bytes,
  table row count, search across page boundaries, and row-detail clicks.
- Indexing or rewriting the correlated usage-log normalization query is a
  separate follow-up requiring `EXPLAIN QUERY PLAN` and representative data.
