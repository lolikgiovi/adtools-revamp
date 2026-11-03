# Analytics coverage expansion

The shared capability catalogue now contains 97 capabilities across 22 registered tools, Monitoring Query and Settings. The existing **Analytics → Reports → Usage & Adoption → Capability Adoption / Capability by User** queries consume it directly; no migration is required.

| Workflow          | New evidence                                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Projects          | Create/rename opened, blocked validation, local save success, publication success/failure, switch success/blocked/failure                                                                  |
| Saved schemas     | Manager opened; import/export/copy/move/delete success/failure; imported or transferred table counts                                                                                       |
| PlantUML          | Workspace creation, formatting outcomes, render errors, cancelled/failed imports, editor theme configuration, palette and preview exploration; render duration on existing successful uses |
| Saved batches     | Existing save/update completions and load exploration now feed capability adoption                                                                                                         |
| Splunk            | Context field synchronization success or blocked invalid JSON                                                                                                                              |
| Character counter | Existing per-row configuration signal, excluding a return to Summary                                                                                                                       |

Settings now participates in capability visits and exposure scanning. Project publication retries with an unchanged name do not record another creation or a rename. Schema transfer/deletion success is measured at the storage boundary; a later UI refresh failure does not reverse that result. Completion events remain separate from the durable completed-tool ledger. PlantUML retains its existing successful-render counting boundary.

New project/schema outcome events contain no project names, IDs, schema names, file names, credentials, diagram source or error messages. New failure reasons are static categories. Existing analytics opt-out applies; development sessions default to disabled, so the browser fixture explicitly enables analytics in its disposable context. No packages were installed.

## Reproduce

With Vite running:

```sh
npm run dev -- --host 127.0.0.1
PLAYWRIGHT_MODULE=/path/to/already-installed/playwright/index.mjs node frontend/core/tests/analytics-coverage-browser.mjs
```

The fixture blocks external requests and returns offline responses for API requests. It exercises the real app, IndexedDB schema operations, project form and switch guards, PlantUML rendering and character mode controls. It captures sanitized `usage:event` signals, verifies that project/schema actions do not increment successful-tool totals, and rejects private fixture identifiers in telemetry. Reload is suppressed to preserve the inspection context. Background work is represented by a tool implementing the real background-work interface.

Evidence is saved in [analytics-coverage/result.json](analytics-coverage/result.json) and [analytics-coverage/plantuml-error.png](analytics-coverage/plantuml-error.png). These are local browser checks; they do not establish native service access or deployed ingestion. Publication failure is exercised locally; deployed successful publication is not exercised.

Verification on 2026-11-03:

- Full root suite: 181 files, 1,855 tests passed.
- Final focused regression after retry and storage-boundary refinements: 20 files, 92 tests passed.
- Vite production build passed. ESLint on changed JavaScript reported zero errors and existing warnings.
- Browser results and reproduction command are recorded in the JSON artifact. Seven browser check groups passed, including Splunk outcomes and opt-out.
- The browser artifact separately records an existing Monaco `Canceled` rejection from delayed-highlight disposal when switching editor models. Unexpected page errors fail the fixture.
