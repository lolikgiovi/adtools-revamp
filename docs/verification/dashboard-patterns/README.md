# Usage patterns dashboard

Implemented and verified locally on 30 October 2026. No production deployment or
production database mutation was performed for this UI change.

## Behavior

- Trends leads with hourly distinct people, with a switch to tool actions. Both the
  selected and preceding periods are plotted. Counts and differences have no
  positive/negative performance coloring.
- A day/hour heatmap and daily people chart select inspectable feature/action
  breakdowns. Detail includes distinct people and devices, department filtering,
  and links to existing person profiles.
- Departments show registered people, people with tool actions during the period,
  active devices, and actions. Unknown departments stay visible. Registered counts
  require a non-excluded registered device. Departments reflect current profiles.
- Devices show owner, department, identity, platform/version, last app check-in,
  and last directly recorded tool action separately. Owner links open People.
- Existing date presets and device exclusion policies remain in use. Multi-day
  Trends windows contain complete Jakarta days ending at midnight today. The
  previous window has the same number of complete days. Today compares the same
  elapsed hours yesterday. All time has no prior-period comparison.
- Directly recorded client-ledger actions supply pattern counts. Historical
  reconstructed rows, future/invalid times, opens, and errors cannot inflate these
  action totals. Opens and errors have their own rows in the comparison.
- Copy/download/export classification follows recorded action names, with all
  remaining actions labeled “Other tool actions.” Counts are not unique tasks,
  productivity, or time saved. A person counts once per hour/window/selection, so
  hourly people counts must not be summed.
- Coverage notes flag the September collection interruption, periods preceding
  direct recording, and unverified historical timestamps. Zero means no recorded
  activity, not established non-use.
- Detailed records are bounded to the latest 5,000 grouped records, with an
  explicit truncation notice. Period, chart, feature, and department aggregates
  use full SQL results. All-time calendar presentation has a 3,660-day limit.

The authenticated Trends response retains its legacy `data` array for older
clients and adds an `analysis` object for the new view. Frontend caching retains
that object across tab navigation. Old servers still render the previous Trends
view, avoiding a broken page during a staggered release.

## Reproduce browser verification

Use the installed Playwright module; do not install dependencies for this check.

```bash
./node_modules/.bin/vite --host 127.0.0.1 --port 1246 --strictPort
```

In another terminal:

```bash
DASHBOARD_TEST_URL=http://127.0.0.1:1246 \
PLAYWRIGHT_MODULE=/Users/lolik/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs \
node frontend/pages/dashboard/tests/trends-browser.mjs
```

The browser fixture uses migrated SQLite, real authenticated Worker handlers,
synthetic identities, and a stable-release R2 fixture. All external API requests
are intercepted; it does not send telemetry or mutate production.

`result.json` records checks and reproduction information. Screenshots cover
1440px and 390px: `*-trends.png`, `*-detail.png`, and `*-devices.png`. The last
functional run used `SKIP_SCREENSHOTS=true` to retain the visually inspected
screenshots while additionally checking cached report data and keyboard navigation.

## Other validation

- Root Vitest suite: 180 files, 1,846 tests passed.
- Worker suite: 7 files, 87 tests passed. Node/SQLite integration tests are excluded
  from workerd and execute in the root Node suite, as existing configuration does
  for other SQLite-backed report tests.
- The new authenticated API test was written first and failed before implementation.
  It covers Jakarta midnight, action/person/device separation, exclusions,
  departments, complete-period comparison, historical reconstruction exclusion,
  and all-time behavior. Browser assertions were also added before UI implementation.
- Production build passed using `vite build --outDir
  /Users/lolik/projects/ad-tools-revamp/.wrangler/verification/usage-patterns-web`.
  Existing large-chunk and mixed-import warnings remain.
- Targeted ESLint: zero errors, five existing warnings in the dashboard main file.
- Formatting and `git diff --check` passed; the design detector returned no findings.

This feature requires both frontend and Worker deployment. No new D1 migration is
needed; it uses existing department and analytics tables. Deployment must include
the timestamp parser fix already present in source so the prior regression does
not recur.
