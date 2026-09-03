# Plan 005: Clean up shell pages and global listeners

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Drift check (run first)**: `git diff --stat b856304..HEAD -- frontend/App.js frontend/pages/about/main.js frontend/pages/analytics-dashboard/main.js frontend/tools/run-query/main.js frontend/core/tests/shell-page-lifecycle.test.js frontend/tools/run-query/tests/lifecycle-listener-cleanup.test.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/001-guard-async-navigation-commits.md
- **Category**: perf
- **Planned at**: commit `b856304`, 2026-09-03

## Why this matters

Every shell-page visit creates a new page instance, but the App has no current
page reference and no shell-page teardown path. About and Analytics Dashboard
attach listeners directly to `document`, so repeated visits retain old page
instances and run their handlers forever. Run Query already has a hard-unmount
hook but leaves its document-level suggestion listener behind, which causes
duplicates after an explicit teardown. A small idempotent lifecycle contract
releases listeners and references without changing the intentional warm-tool
behavior or any visible interaction.

## Current state

Relevant files:

- `frontend/App.js` - mounts shell pages but only tracks the current tool; it
  does not retain or dispose the active page instance.
- `frontend/pages/about/main.js` - adds a document click listener with an
  anonymous closure and exposes only `deactivate()`.
- `frontend/pages/analytics-dashboard/main.js` - adds a document keydown
  listener with an anonymous closure and exposes only `deactivate()`.
- `frontend/tools/run-query/main.js` - adds a document click listener during
  mount; `onUnmount()` cleans editors and split work but not that listener.
- `frontend/core/BaseTool.js` - existing tool unmount contract; heavy tools
  must continue honoring soft deactivation and delayed disposal.
- `frontend/core/tests/tool-lifecycle.test.js` and
  `frontend/core/tests/heavy-tool-cleanup.test.js` - existing lifecycle test
  patterns to extend.
- `frontend/core/tests/shell-page-lifecycle.test.js` - new App shell-page
  ownership tests.
- `frontend/tools/run-query/tests/lifecycle-listener-cleanup.test.js` - new
  Run Query listener test.

`showShellPage()` creates and mounts a page without retaining it:

```js
// frontend/App.js:498-519
const PageClass = await this.loadWithAssetRecovery(() => this.loadPageComponent(pageId, loader), ...);
if (this.mainContent) {
  const page = new PageClass(createOptions?.() || {});
  page.mount(this.mainContent);
}
```

About binds an anonymous document listener:

```js
// frontend/pages/about/main.js:222-230
document.addEventListener("click", (e) => {
  if (!e.target.closest(".tutorial-tab-dropdown")) this.closeAllDropdowns();
  if (!e.target.closest(".tutorial-search-wrapper")) this.closeSearchResults();
});
```

Analytics Dashboard does the same for Escape:

```js
// frontend/pages/analytics-dashboard/main.js:82-85
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") this.closeRowDetail();
});
```

Run Query binds a document click listener at
`frontend/tools/run-query/main.js:2066-2081`, but its hard-unmount code at
`main.js:2904-2946` only removes split/sidebar/editor resources. The existing
BaseTool contract calls `onUnmount()` before clearing the container
(`frontend/core/BaseTool.js:113-127`).

The documented policy must remain unchanged:

- Heavy tools stay warm for 90 seconds and at most two idle heavy tools remain
  cached (`docs/PERFORMANCE-IMPROVEMENT.md:7-11`).
- `onSoftDeactivate()` pauses hidden work; `onUnmount()` and
  `disposeHeavyResources()` are separate stages (`docs/PERFORMANCE-IMPROVEMENT.md:15-23`).

## Commands you will need

| Purpose                  | Command                                                                                                                                                                                                                                                                        | Expected on success                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Drift check              | `git diff --stat b856304..HEAD -- frontend/App.js frontend/pages/about/main.js frontend/pages/analytics-dashboard/main.js frontend/tools/run-query/main.js frontend/core/tests/shell-page-lifecycle.test.js frontend/tools/run-query/tests/lifecycle-listener-cleanup.test.js` | Empty output before implementation, unless drift is being reviewed |
| Shell lifecycle tests    | `npx vitest run frontend/core/tests/shell-page-lifecycle.test.js`                                                                                                                                                                                                              | All focused tests pass in one Vitest process                       |
| Run Query cleanup tests  | `npx vitest run frontend/tools/run-query/tests/lifecycle-listener-cleanup.test.js frontend/core/tests/heavy-tool-cleanup.test.js`                                                                                                                                              | All focused tests pass in one Vitest process                       |
| Lint                     | `npm run lint`                                                                                                                                                                                                                                                                 | Exit 0; no lint errors (pre-existing warnings may remain)          |
| Browser build smoke test | `npx vite build --outDir /tmp/adtools-plan-005 --emptyOutDir true`                                                                                                                                                                                                             | Exit 0 and produces a build outside the repository                 |
| Diff whitespace          | `git diff --check`                                                                                                                                                                                                                                                             | Empty output                                                       |

## Scope

**In scope** (the only files to modify):

- `frontend/App.js`
- `frontend/pages/about/main.js`
- `frontend/pages/analytics-dashboard/main.js`
- `frontend/tools/run-query/main.js`
- `frontend/core/tests/shell-page-lifecycle.test.js` (create)
- `frontend/tools/run-query/tests/lifecycle-listener-cleanup.test.js` (create)

**Out of scope** (do not touch):

- `frontend/components/Sidebar.js`, `Router.js`, `UsageTracker.js`, and other
  App-singleton listeners; those are initialized once per application and need
  a separate ownership audit
- Any soft-deactivation, warm-cache limit, idle timeout, editor disposal, or
  active-background-work behavior
- Page UI markup, styles, interaction semantics, or route URL behavior
- Backend requests and dashboard query behavior
- Shell page caching; shell pages should be disposed, not warmed

## Git workflow

- Branch, if one is used: `advisor/005-clean-shell-page-and-global-listeners`.
- Match the repository's concise imperative or `perf:` commit style if the
  operator asks for commits. Do not push or open a PR unless instructed.

## Steps

### Step 1: Add App ownership for the active shell page

Add a `currentShellPage` field to App and a small idempotent disposal method.
When leaving home, a tool, or a shell page, call the method before replacing
the main content. It should call `deactivate?.()` and `unmount?.()` at most once
for the stored page, clear the App reference, and tolerate page cleanup errors.

In `showShellPage()`, retain the newly created page only after its mount has
started or completed according to the existing page API. If a page load becomes
stale under plan 001, clean up an instance that was created but is no longer
current rather than storing it. Do not warm shell pages.

Preserve tool ownership: `clearCurrentTool()` remains responsible for tools,
including the documented warm heavy-tool path. App shell-page disposal must not
call tool `disposeHeavyResources()`.

**Verify**: `npx vitest run frontend/core/tests/shell-page-lifecycle.test.js` -> leaving a shell page calls its cleanup once, replacing a page disposes the previous instance, and current-tool warm lifecycle calls remain untouched.

### Step 2: Make About and Analytics Dashboard listener cleanup idempotent

Store each document-level callback on the page instance before registering it.
Add `unmount()` methods that remove the exact callback, invalidate any pending
page work, clear page references, and can safely be called twice. Keep the
existing `deactivate()` behavior for closing open menus/modals or clearing
hidden state, and have cleanup preserve the current visible behavior while the
page is active.

Do not use a new anonymous function in `removeEventListener`; the same function
object must be passed to add and remove. Keep all container-bound listeners on
the page DOM; removing the root remains sufficient for those listeners.

**Verify**: `npx vitest run frontend/core/tests/shell-page-lifecycle.test.js` -> mounting and unmounting each page leaves no document listener, repeated unmount is harmless, and active-page Escape/outside-click behavior still invokes the page action.

### Step 3: Remove Run Query's document listener on hard unmount

Store the suggestion-dismissal callback currently added at
`frontend/tools/run-query/main.js:2067` on the instance and remove it in
`onUnmount()` before nulling editor/container resources. Do not remove it from
`onSoftDeactivate()`; a warm Run Query instance is intentionally kept alive for
fast return, and the listener must remain valid while its DOM root is detached
but warm.

Ensure repeated mount/unmount cycles register at most one current callback and
do not remove a callback belonging to a different Run Query instance.

**Verify**: `npx vitest run frontend/tools/run-query/tests/lifecycle-listener-cleanup.test.js frontend/core/tests/heavy-tool-cleanup.test.js` -> the exact document callback is removed on hard unmount, existing editor/split cleanup still runs, and warm cleanup behavior remains green.

### Step 4: Exercise navigation and hard-disposal sequences

Add tests for About -> Home -> About, Analytics Dashboard -> tool -> Analytics
Dashboard, and repeated Run Query mount/unmount. Assert that one document event
causes one active-page response, not one response per historical instance.
Include a test that a stale page instance cannot clean up a newer instance's
callback.

**Verify**: `npx vitest run frontend/core/tests/shell-page-lifecycle.test.js frontend/tools/run-query/tests/lifecycle-listener-cleanup.test.js frontend/core/tests/tool-lifecycle.test.js` -> all lifecycle and listener tests pass.

### Step 5: Run build and quality checks

Run focused tests, `npm run lint`, the temporary-output build, and
`git diff --check`. Review the diff for preserved warm-tool behavior, active
background work, menu/modal behavior, Escape handling, outside-click behavior,
and no changes to visible markup.

**Verify**: `npm run lint` -> exit 0 with no errors; `npx vite build --outDir /tmp/adtools-plan-005 --emptyOutDir true` -> exit 0; `git diff --check` -> empty output.

## Test plan

- Create `frontend/core/tests/shell-page-lifecycle.test.js` with jsdom and the
  App prototype harness style used in
  `frontend/core/tests/tool-lifecycle.test.js:6-23`.
- Test App page ownership with fake page objects exposing `deactivate` and
  `unmount`; assert idempotence and replacement order.
- For About and Analytics, use listener spies or dispatch real jsdom events to
  verify active behavior and removal after unmount.
- Create `frontend/tools/run-query/tests/lifecycle-listener-cleanup.test.js`
  and model its cleanup assertions after
  `frontend/core/tests/heavy-tool-cleanup.test.js:45-57`.
- Cover repeated mount/unmount, hard unmount while split work is inactive, and
  the existing active split-work protection.
- Verification: `npx vitest run frontend/core/tests/shell-page-lifecycle.test.js frontend/tools/run-query/tests/lifecycle-listener-cleanup.test.js frontend/core/tests/tool-lifecycle.test.js frontend/core/tests/heavy-tool-cleanup.test.js` -> all tests pass in one Vitest process.

## Done criteria

- [ ] App retains exactly one active shell-page instance and disposes it before replacing shell content.
- [ ] About's document click listener is removed on page cleanup.
- [ ] Analytics Dashboard's document keydown listener is removed on page cleanup.
- [ ] Run Query's document click listener is removed on hard unmount but remains valid during intentional warm deactivation.
- [ ] Cleanup is idempotent and cannot remove another page/tool instance's listener.
- [ ] Existing shell interactions and warm heavy-tool behavior are unchanged.
- [ ] New lifecycle/listener tests pass.
- [ ] `npm run lint` exits 0 with no errors.
- [ ] `npx vite build --outDir /tmp/adtools-plan-005 --emptyOutDir true` exits 0.
- [ ] No files outside the Scope list are modified; verify with `git status --short`.
- [ ] `plans/README.md` status row is updated.

## STOP conditions

Stop and report back if:

- The page classes no longer match the mount/deactivate/listener excerpts.
- A page requires a new shared base class or changes to unrelated shell
  components beyond this scope.
- Removing a listener during soft deactivation breaks warm-tool state or an
  active Run Query split execution.
- A pending page request needs backend cancellation or a route contract change;
  plan 001 owns stale commit guards.
- Existing lifecycle tests fail because cleanup changes the documented 90-second
  warm-cache behavior.
- Any verification command fails twice after a reasonable fix attempt.

## Maintenance notes

- Every page-level `document` or `window` listener must store its callback and
  remove it in an idempotent cleanup method.
- Reviewers should inspect new timers, event listeners, subscriptions, and
  asynchronous callbacks in shell pages for ownership by `currentShellPage`.
- Tool listeners attached to detached warm roots are intentional until hard
  disposal; global listeners must still be removed at `onUnmount()`.
- A future shared `BasePage` is deferred; keep this contract explicit and
  minimal until more pages need the same lifecycle implementation.
