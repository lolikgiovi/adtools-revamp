# Daily trends and device health verification

Verified 2026-10-26. All screenshots and browser records use synthetic data.

## Delivered behavior

- Analytics has primary Trends and Devices views. Existing Activity and detailed reports remain available.
- Trends uses the canonical successful-use ledger, fills zero-use calendar days, compares each day with the previous day, and compares any two selected dates for uses, active people, and active devices.
- Days use Asia/Jakarta. Today is explicitly incomplete. Percent changes from zero are omitted. Calendar windows include today; Last 7 days means today plus six previous calendar days, with the prior day included internally for the first comparison.
- Devices lists owner email, full device ID, platform, last reported version, update status, last seen, and inactivity status. Search combines with activity and version filters.
- The stable release comes from the same R2 object used by the stable updater (`update/stable.json`). Missing release metadata or unrecognized versions produce Unknown, rather than an invented update result. Versions newer than stable are identified separately.
- Last seen takes the latest device check-in, successful use, or usage-log record. Active means under 7 elapsed days, Quiet means 7–29, and Inactive means 30+. These are inactivity indicators, not proof of abandonment.
- Configured and development device exclusions apply to both new reports. No migrations are required.

## Repeatable checks

Use the existing project dependencies. Do not install dependencies automatically.

```sh
./node_modules/.bin/vite --port 1246
```

In another terminal, with an existing Playwright installation:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node frontend/pages/dashboard/tests/trends-browser.mjs
```

The browser test loads the full application, invokes the actual authenticated Worker handlers against a migrated in-memory SQLite database, and supplies a synthetic stable-release manifest. It exercises 1440px and 390px layouts, range changes, chart selection, two-date comparisons, version and inactivity filters, search, empty results, device exclusions, and document overflow. It saves screenshots and `result.json` in this directory. No production database or R2 writes occur.

```sh
./node_modules/.bin/vitest run frontend/pages/analytics-dashboard/tests frontend/pages/dashboard/tests/navigation.test.js backend-workers/tests/dashboard-trends.test.js backend-workers/tests/dashboard-tabs-smoke.test.js backend-workers/tests/dashboard-device-exclusions.test.js backend-workers/tests/dashboard-performance.test.js backend-workers/tests/dashboard-ordering.test.js
./node_modules/.bin/vite build --outDir /tmp/adtools-dashboard-trends-build
```

43 tests passed across 13 files. Production bundling passed with the existing large-chunk warning. ESLint found no errors and five existing warnings in the analytics page. The mechanical design detector returned no findings. `git diff --check` passed.

## Deployment

Frontend and Worker changes have been verified locally, not deployed. Both must be deployed to expose the new reports against live data. No historical version-installation timeline is available; update status describes the latest reported version, not when an upgrade occurred.

## Finish review

Final disposition: **Pass.**

| Finding | Status | Evidence |
| --- | --- | --- |
| Focus lost after chart/comparison/filter changes | Resolved | Active controls are captured, replacement selects are enhanced synchronously, and focus returns to the matching trigger or chart button. Browser assertions verify date and device-filter focus. |
| Overflow tables inaccessible to keyboard scrolling | Resolved | Wrappers have keyboard focus, named region semantics, and a visible focus ring. |

The reviewer inspected final source and all four desktop/mobile screenshots. Safari and screen-reader behavior were not independently exercised.
