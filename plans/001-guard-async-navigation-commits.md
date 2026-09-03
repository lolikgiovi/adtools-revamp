# Plan 001: Make asynchronous navigation commits route-scoped

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Drift check (run first)**: `git diff --stat b856304..HEAD -- frontend/App.js frontend/core/Router.js frontend/pages/analytics-dashboard/main.js frontend/core/tests/router.test.js frontend/core/tests/navigation-race.test.js frontend/pages/analytics-dashboard/tests/request-race.test.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `b856304`, 2026-09-03

## Why this matters

Route handlers start asynchronous module loads and fetches, but the code does
not identify which navigation is allowed to commit to the shell. A slower
request from an earlier route can therefore replace the current page, activate
the wrong tool, or render stale dashboard data. Guarding commits removes the
wrong-content failure and avoids unnecessary DOM work without changing the
route names, tool state model, warm-cache policy, or visible loading design.

## Current state

Relevant files:

- `frontend/core/Router.js` - hash router; invokes registered handlers and does
  not await or identify a route invocation.
- `frontend/App.js` - registers route handlers and commits tool/page DOM after
  asynchronous loads.
- `frontend/pages/analytics-dashboard/main.js` - fetches tab data and renders
  it into the single dashboard panel.
- `frontend/core/tests/router.test.js` - existing jsdom router test; use its
  import style and event-bus stubs as the baseline.
- `docs/PERFORMANCE-IMPROVEMENT.md` - lifecycle contract to preserve: warm
  tools remain reusable and active background work must not be interrupted.

The current router invokes a handler without a navigation token:

```js
// frontend/core/Router.js:51-67
this.currentRoute = path;
const handler = this.routes.get(path);
handler({ path, params, query: this.parseQuery() });
this.eventBus.emit("route:changed", { path, params, previous: this.currentRoute });
```

Tool loading commits after an awaited dynamic load:

```js
// frontend/App.js:249-262,409-445
this.showTool(toolId, data).catch((error) => {
  // ...notify and navigate home on failure...
});

const tool = await this.loadWithAssetRecovery(() => this.ensureToolLoaded(toolId), ...);
this.currentTool = tool;
this.mainContent.innerHTML = "";
this.mainContent.appendChild(toolRoot);
tool.mount(toolRoot);
tool.activate();
```

Shell pages have the same commit gap:

```js
// frontend/App.js:498-519
const PageClass = await this.loadWithAssetRecovery(() => this.loadPageComponent(pageId, loader), ...);
const page = new PageClass(createOptions?.() || {});
page.mount(this.mainContent);
```

The dashboard has an equivalent fetch race. `currentTab` can change while the
request is pending, but the response still writes the shared panel:

```js
// frontend/pages/analytics-dashboard/main.js:216-263
const data = await res.json();
if (data.ok && Array.isArray(data.data)) {
  this.cache[cacheKey] = data.data;
  this.renderTable(content, data.data);
}
```

Match the existing lifecycle conventions in `frontend/core/BaseTool.js:37-43`
and `frontend/core/tests/tool-lifecycle.test.js`: cancel or ignore stale UI
commits, but do not hard-dispose a warm tool that has active background work.

## Commands you will need

| Purpose                  | Command                                                                                                                                                                                                                                                            | Expected on success                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Drift check              | `git diff --stat b856304..HEAD -- frontend/App.js frontend/core/Router.js frontend/pages/analytics-dashboard/main.js frontend/core/tests/router.test.js frontend/core/tests/navigation-race.test.js frontend/pages/analytics-dashboard/tests/request-race.test.js` | Empty output before implementation, unless drift is being reviewed                   |
| Router tests             | `npx vitest run frontend/core/tests/router.test.js frontend/core/tests/navigation-race.test.js`                                                                                                                                                                    | All listed tests pass; run as one Vitest process                                     |
| Dashboard race tests     | `npx vitest run frontend/pages/analytics-dashboard/tests/request-race.test.js`                                                                                                                                                                                     | All listed tests pass; run separately, never in parallel with another Vitest process |
| Lint                     | `npm run lint`                                                                                                                                                                                                                                                     | Exit 0; no lint errors (pre-existing warnings may remain)                            |
| Browser build smoke test | `npx vite build --outDir /tmp/adtools-plan-001 --emptyOutDir true`                                                                                                                                                                                                 | Exit 0 and produces a build outside the repository                                   |
| Diff whitespace          | `git diff --check`                                                                                                                                                                                                                                                 | Empty output                                                                         |

## Scope

**In scope** (the only files to modify):

- `frontend/core/Router.js`
- `frontend/App.js`
- `frontend/pages/analytics-dashboard/main.js`
- `frontend/core/tests/router.test.js` if the existing assertion must expand
- `frontend/core/tests/navigation-race.test.js` (create)
- `frontend/pages/analytics-dashboard/tests/request-race.test.js` (create)

**Out of scope** (do not touch):

- `frontend/core/BaseTool.js` and the documented warm-cache policy
- Any tool implementation, tool-specific background task, or backend API
- Route names, hash URL format, response shapes, or dashboard table semantics
- `docs/PERFORMANCE-IMPROVEMENT.md`; it records the behavior this plan must preserve

## Git workflow

- Branch, if one is used: `advisor/001-guard-async-navigation-commits`.
- Match the repository's concise imperative or `perf:` commit style if the
  operator asks for commits. Do not push or open a PR unless instructed.

## Steps

### Step 1: Add a navigation identity without changing route behavior

Add a monotonically increasing navigation identifier in `Router`. Increment it
for every `handleRouteChange()` invocation, including same-hash navigation, and
pass it to the registered handler context. Expose a small read method only if
`App` needs it. Keep the existing `route:change` and `route:changed` events and
their route payloads compatible; do not repair unrelated `previous` field
behavior in this plan.

Update the route registrations in `App.setupRoutes()` to pass the identifier to
`showTool`, `showShellPage`, and any delayed `showHome()` retry. Route error
handlers must only show an error or redirect to home when their captured
navigation is still current.

**Verify**: `npx vitest run frontend/core/tests/router.test.js frontend/core/tests/navigation-race.test.js` -> the existing route-data test and new navigation-identity tests pass.

### Step 2: Guard every asynchronous App commit

Add one App-local predicate that returns true only when both the captured
navigation identifier and the expected route still match the Router state.
Capture the identity at the start of `showTool()` and `showShellPage()`.

Check the predicate after `loadWithAssetRecovery()` returns and before each
side effect that can affect the current screen: retry/loading-state updates,
breadcrumb updates, `currentTool` assignment, DOM replacement, mount/activate,
route-data delivery, page-change events, and error redirects. If the request is
stale, return without mounting or notifying. Dynamic module loading may finish
and remain in the normal tool/page component cache; it must not activate or
render the stale instance.

Make the asset-recovery retry path accept or otherwise honor the same predicate
so a stale retry cannot overwrite the current route's loading message. Guard the
delayed runtime retry in `showHome()` with the route identity as well.

Do not call `unmount()` or `disposeHeavyResources()` on a tool solely because a
stale load completed. Those operations remain owned by the existing warm-tool
lifecycle.

**Verify**: `npx vitest run frontend/core/tests/navigation-race.test.js frontend/core/tests/tool-lifecycle.test.js` -> stale tool/page completions produce no DOM or activation calls, while the current completion still mounts and warm lifecycle tests remain green.

### Step 3: Make dashboard fetches request-scoped

In `AnalyticsDashboardPage`, track a request generation or AbortController for
the current tab load. Increment it when switching tabs, changing range,
refreshing, logging out, or otherwise starting a replacement request.

Capture `tabId`, `cacheKey`, and request identity before `fetch()`. On response,
cache and render only if the request is still current, the page still owns the
container, and `this.currentTab` still equals the captured tab. A stale response
may be ignored; it must not call `logout()`, replace panel HTML, or toggle the
current request's loading state. If AbortController is used, treat an abort as a
normal stale-request outcome rather than a user-visible error.

Preserve the existing 401 logout behavior for the current request and preserve
the existing tab cache keys and response data shape.

**Verify**: `npx vitest run frontend/pages/analytics-dashboard/tests/request-race.test.js` -> an older tab response is ignored after a tab switch, a current 401 still logs out, and the current tab renders normally.

### Step 4: Run the full non-mutating checks and inspect the diff

Run the focused tests from Steps 1-3, then `npm run lint`, the browser build
smoke test, and `git diff --check`. Review the diff for unchanged route event
payloads, preserved warm-tool calls, and no accidental changes to tool modules.

**Verify**: `npm run lint` -> exit 0 with no errors; `npx vite build --outDir /tmp/adtools-plan-001 --emptyOutDir true` -> exit 0; `git diff --check` -> empty output.

## Test plan

- Extend `frontend/core/tests/router.test.js` only if needed to assert the new
  handler context while retaining its current route-data assertion.
- Create `frontend/core/tests/navigation-race.test.js` using the deferred
  promise and jsdom harness style from `frontend/core/tests/tool-lifecycle.test.js`.
- Cover two tool navigations resolving in reverse order; only the latest route
  may set `currentTool`, mount a root, activate a tool, or emit its page-change
  result.
- Cover two shell-page loads resolving in reverse order; only the latest page
  may mount.
- Cover a stale load failure; it must not redirect the current route to home or
  show a stale error notification.
- Create `frontend/pages/analytics-dashboard/tests/request-race.test.js` and
  cover tab switch, refresh/range replacement, stale 401, and current success.
- Model the existing test convention of using Vitest mocks and explicit fake
  event buses; do not add a browser automation dependency.
- Verification: `npx vitest run frontend/core/tests/router.test.js frontend/core/tests/navigation-race.test.js frontend/core/tests/tool-lifecycle.test.js frontend/pages/analytics-dashboard/tests/request-race.test.js` -> all tests pass in one Vitest process.

## Done criteria

- [ ] Router gives each route invocation a unique identity without changing URL or event payload compatibility.
- [ ] Stale App tool/page loads cannot mutate the shell, activate a tool, emit a stale page change, notify, or redirect.
- [ ] Stale dashboard tab responses cannot render into the current tab or alter its loading/error state.
- [ ] Current route and current dashboard request behavior remains unchanged.
- [ ] Warm tools, active background work, `onWarmResume()`, and delayed disposal behavior remain unchanged.
- [ ] New race tests cover reverse completion order and pass.
- [ ] `npm run lint` exits 0 with no errors.
- [ ] `npx vite build --outDir /tmp/adtools-plan-001 --emptyOutDir true` exits 0.
- [ ] No files outside the Scope list are modified; verify with `git status --short`.
- [ ] `plans/README.md` status row is updated.

## STOP conditions

Stop and report back if:

- `Router.handleRouteChange()` or the App route registration shape differs from
  the excerpts, or an in-scope file has drifted since `b856304`.
- Preventing a stale commit requires changing a public route event payload,
  URL format, or backend response shape.
- A stale tool load needs to be forcibly disposed to avoid a leak; do not alter
  warm-cache ownership without a separate plan.
- The dashboard requires a server-side API change to distinguish current and
  stale requests; report the required endpoint change instead of expanding scope.
- Existing lifecycle tests fail because the guard suppresses a current warm
  resume or active background task.
- Any verification command fails twice after a reasonable fix attempt.

## Maintenance notes

- Any new async route handler must capture and validate the navigation identity
  before committing DOM, state, notifications, or redirects.
- Any new dashboard fetch must include its tab/request identity in the same
  stale-response guard; client cache writes must remain keyed by tab and range.
- Reviewers should inspect every `await` in `showTool()`, `showShellPage()`, and
  dashboard loading for a post-await currentness check.
- This plan deliberately does not cancel dynamic imports or change tool
  disposal; those are separate resource-lifecycle decisions.
