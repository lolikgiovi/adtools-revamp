# Dashboard refinement verification

Verified on 2026-10-25 against the existing AD Tools browser tab at `http://localhost:1234/#dashboard`.

## Browser checks

- Analytics opens on Summary, with no Usage & Adoption heading or subtitle.
- Refresh and Logout appear beside the Dashboard navigation tabs.
- Summary shows usage concentration, a top-five tool comparison, and links to people, activity, errors and detailed reports.
- Selecting Quick Query in the summary opens its usage detail with report links.
- View activity selects Activity and searches for `quick-query`.
- Approvals shows its status tabs and search without the old page heading; Refresh and Logout are in the Dashboard navigation.
- Publish Settings has no Lock button or repeated page title; Refresh is in the Dashboard navigation.
- No document overflow at the browser's 652px default width or its 433px minimum effective width (390px requested).
- The temporary browser viewport override was reset. The user tab was left on Analytics Summary.

Screenshots: [Summary](summary.png), [narrow summary](summary-narrow.png). Values are a live snapshot, not fixtures.

## Automated checks

40 tests passed across 12 relevant files:

```sh
./node_modules/.bin/vitest run frontend/pages/analytics-dashboard/tests frontend/pages/dashboard/tests/navigation.test.js backend-workers/tests/dashboard-ordering.test.js backend-workers/tests/dashboard-tabs-smoke.test.js backend-workers/tests/dashboard-device-exclusions.test.js backend-workers/tests/dashboard-performance.test.js
```

The new database-backed regression reproduces mixed ISO, offset and offset-free Jakarta timestamps across separate activity pages. It failed before the ordering fix and passes afterward. Existing database smoke coverage executes every built-in report against the migrated schema.

Production frontend bundling:

```sh
./node_modules/.bin/vite build --outDir /tmp/adtools-dashboard-build
```

Build log: `/tmp/adtools-dashboard-build.log`. ESLint reported no errors and five existing warnings in the analytics page. `git diff --check` passed.

## Deployment boundary

The open browser uses the deployed Worker. The new backend chronological ordering, stable pagination sorting, and complete Jakarta date-time formatting were verified locally against SQLite through the Worker request handler. They have not been deployed; live activity still uses the previous Worker behavior. No publication, account approval or logout was submitted during browser verification.
