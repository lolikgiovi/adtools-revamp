# Behavior tracking

Named capability adoption, requested Excel filenames and Oracle source identifiers are described in [capability-adoption.md](capability-adoption.md).

Shared behavior events complement the existing successful Tool Use ledger. They do not increment completed-use totals.

| Area                                 | Events                                                                                            | Metadata                                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Every rendered tool/page             | `page_view`, `page_leave`                                                                         | Previous feature, visible duration, navigation/hidden/pagehide reason                                                        |
| Tool/page buttons, tabs, disclosures | `control_click`                                                                                   | Static `btn…` ID when available, otherwise tag; control type; pointer/keyboard                                               |
| Committed form changes               | `control_change`                                                                                  | Control tag/type; no values                                                                                                  |
| Command search                       | `search_open`, `search_select`, `search_close`                                                    | Shortcut/header/mobile source; scope; query length; visible result count; result type/route/rank; dismissal reason; duration |
| Sidebar navigation                   | `sidebar_navigate`                                                                                | Pinned state and pointer/keyboard                                                                                            |
| Pinning                              | `sidebar_pin`, `sidebar_unpin`                                                                    | Tool ID, resulting pin count, whether storage persisted                                                                      |
| Velocity                             | `render_result`, `validate_result`, `copy_result`, `copy_output_result`                           | Input/output sizes and line counts; render outcome; validator HTTP status and elapsed time                                   |
| Velocity workspace                   | `document_create_result`, `document_switch_result`, `document_close_result`, `result_type_result` | Document count or Text/JSON mode                                                                                             |
| Velocity workflow                    | `import_sql_result`, `sync_context_result`, `query_handoff_result`                                | Size, field count, or destination tool                                                                                       |

Controls are collected through one delegated listener, so newly rendered and warm-cached tools are covered without per-tool listener installation. Monaco keystrokes, labels, values, selected options, dynamic document/row IDs, SQL, templates, context, output contents and search text are not collected by shared behavior tracking. Anonymous controls use their tag rather than a content-derived name. Existing analytics enable/disable and batching settings apply.

Velocity is enabled in client queues, ingestion, overview normalization and dashboard SQL. The immutable historical usage baseline is unchanged; previously discarded events cannot be recovered. No schema migration is needed.

Velocity successful uses are `copy`, `copy_output`, `render`, `validate`, `import_sql`, and `sync_context`. A render counts only after an explicit Local Render produces a valid result. Automatic previews, empty renders and errors do not count. Validation counts a received 2xx response, **not** a claim that the validator accepted the template. Non-2xx/unavailable/input errors are behavior outcomes only. Copy counts after clipboard success. QR & TLV retains embedded TLV tracking under its existing `tlv-viewer` identity.

## Reproduce

1. Run `npm run dev` using the installed dependencies.
2. Open `http://localhost:1234/core/tests/tracking-e2e.html`.
3. Click **Run local browser checks**. It exercises the real app, Cmd+K selection, pin/unpin, a temporary Velocity document, explicit/automatic/invalid/empty rendering and page duration. It restores pins and queued analytics and closes its temporary document.
4. Expect **COMPLETE 11 checks passed**. The page contains no remote service or native Oracle proof.

Recorded browser run: 2026-10-23 07:45 Jakarta, 11/11 passed. Screenshot: [tracking-e2e.png](../../frontend/core/tests/artifacts/tracking-e2e.png).

Automated checks:

```sh
./node_modules/.bin/vitest run frontend/core/tests/behavior-tracker.test.js frontend/components/tests/global-search-analytics.test.js frontend/components/tests/global-search.test.js frontend/components/tests/sidebar.test.js frontend/core/tests/usage-tracker.test.js frontend/core/tests/tool-usage-coverage.test.js frontend/tools/velocity-template/tests/ backend-workers/tests/analytics-count-integrity.test.js backend-workers/tests/analytics.test.js backend-workers/tests/lifetime-usage-baseline.test.js
./node_modules/.bin/vitest run frontend/core/tests/usage-overview-model.test.js
npm run test:ci
./node_modules/.bin/vite build
```

Results: focused suite 127/127; overview normalization 4/4 after enabling Velocity; full root suite 148 files / 1657 tests passed before that final normalization change. Root tests include SQLite-backed ingestion/count integrity and all dashboard tab SQL smoke checks. Final focused check after the last edits: 4 files / 12 tests passed. Worker-runtime analytics checks: 27/27 passed. Vite production bundle passed. ESLint reported zero errors and existing warnings. No deployment or live analytics ingestion was performed.
