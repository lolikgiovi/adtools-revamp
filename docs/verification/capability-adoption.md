# Capability adoption and import sources

This extends shared click tracking into named product capabilities. The catalogue in `frontend/config/capabilities.js` covers 79 capabilities across 22 registered tools, including Quick Query and Velocity Template. A capability can have exposure, exploration and/or completion signals; `completion_measured` in the reports states whether completion is instrumented.

## Source identifiers

| Workflow                      | Recorded identifiers and facts                                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Quick Query: Excel rows       | File basename, row count, column count, success/failure/cancellation                                                                          |
| Quick Query: Oracle rows      | Primary `SCHEMA.TABLE`, supported joined source tables, join flag, selected column count, loaded row count, duration, blocked/failure/success |
| Quick Query: Oracle schemas   | Imported table identifiers and table count, success/failure                                                                                   |
| Quick Query: schema file      | File basename, imported table count, outcome                                                                                                  |
| Velocity: SQL template import | The imported document's primary table identity, outcome and size summary                                                                      |
| SQL generation                | Target table, query type, row count, data source (Excel, Oracle, clipboard, manual, mixed, saved, or unknown)                                 |

These identifiers were explicitly requested for behavior analysis. Paths, workbook cell contents, returned Oracle rows, SQL text and predicate literals are excluded from the new import events. Basenames preserve dates/numbers, are stripped of control characters and are bounded to 255 characters; source table lists are bounded to 1,000 characters in the client queue. Velocity reports its existing primary source identity, rather than claiming exhaustive lineage for arbitrary SQL.

Ingestion attaches the authenticated session email to the new capability/import event properties. Reports prefer this frozen ingestion identity over a device's current user mapping. Dev User and unattributed events remain distinct by device. Existing analytics opt-out applies. Production capability events use the existing short batch-flush schedule; Vite development captures events locally without that short remote flush.

## Reports

Open **Analytics → Reports**:

- **Usage & Adoption → Capability Adoption**: unique tool users, available exposures, exploration, successful users, blocked/failed users and users without recorded exposure.
- **Usage & Adoption → Capability by User**: each user's observed capability signals in the selected date range.
- **Quick Query → Query Import Sources**: user, Excel basename or Oracle table identifiers, outcome, event frequency, row counts and last-seen time. Velocity SQL-template imports also appear here.

All three use the dashboard's date range and cache separately by range. The source view returns up to 2,000 grouped records; the per-user view returns up to 5,000 capability records. Source-event frequencies are best-effort diagnostic counts; the separate durable Tool Use ledger remains the authoritative completed-use counter.

## Interpret the signals

Exposure means an instrumented affordance intersected at least half of the viewport for one second while the document was visible. It is not proof of attention. Disabled/native-unavailable controls are marked unavailable. Exposure is deduplicated by capability/availability within a tool visit.

- `used`: a recorded completion in this window.
- `failed_or_blocked`: an unsuccessful outcome, with no recorded completion in this window.
- `explored_without_success`: opened/started/configured, completion is measured, and no completion was recorded in this window.
- `explored`: an interaction was observed, but completion is not instrumented for that capability.
- `exposed_unused`: available exposure without exploration/completion.
- `unavailable_when_exposed`: visible controls were unavailable, without an available exposure or interaction.
- `no_recorded_exposure`: instrumented tool activity exists, but no capability exposure or interaction was recorded.

Only new instrumented visits/outcomes establish the audience. Historic missing events do not imply a user ignored a feature. Desktop-only capabilities are excluded from a web-only audience unless explicitly encountered. Automatic schema restoration does not count as deliberate saved-schema discovery. These signals support future guidance; no recommendation popups or automated targeting were added.

## Reproduce and evidence

1. Run `npm run dev` with the installed dependencies.
2. Open `http://localhost:1234/core/tests/capabilities-e2e.html` and choose **Run capability checks**.
3. Expect **9 checks passed**, including sustained exposure, exploration without false success, an actual Excel-worker import with `rates-202610.xlsx`, row counts, absence of cell contents, and empty-workbook failure. The fixture restores the previous analytics queue and Excel service state.
4. Open `http://localhost:1234/pages/analytics-dashboard/tests/capabilities-preview.html` to inspect report navigation, source rows and row details using clearly labelled fixture data. The source-report preview is saved as [import-sources-preview.png](../../frontend/core/tests/artifacts/import-sources-preview.png).

Browser run: 2026-10-23 08:12 Jakarta, **9/9 passed**. Screenshot: [capabilities-e2e.png](../../frontend/core/tests/artifacts/capabilities-e2e.png). Rendered report navigation, date-range visibility, filenames/table names and row-detail interaction were inspected separately in the fixture preview.

```sh
./node_modules/.bin/vitest run frontend/core/tests/capability-tracker.test.js frontend/core/tests/usage-tracker.test.js frontend/tools/quick-query/tests/import-analytics.test.js frontend/tools/velocity-template/tests/analytics.test.js backend-workers/tests/capability-adoption.test.js backend-workers/tests/analytics.test.js backend-workers/tests/dashboard-tabs-smoke.test.js frontend/pages/analytics-dashboard/tests/
npm run test:ci
./node_modules/.bin/vite build
```

The full root suite passed 151 files / 1,678 tests before the final runtime/report refinements. Subsequent relevant checks passed 37 files / 429 tests, dashboard/report checks passed 12 files / 87 tests, and adoption edge checks passed 4 files / 13 tests. The final catalogue/navigation check passed 4 files / 14 tests. Worker-config analytics checks passed 28 tests. Production Vite bundling passed. ESLint has zero errors and existing warnings. The browser exercised the real Excel worker; Oracle outcome tests use a substituted fetch boundary and real parsing. No native Oracle connection, deployed analytics ingestion, deployment, or historical backfill was performed.
