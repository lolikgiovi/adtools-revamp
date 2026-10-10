# React foundation status and migration inventory

Status as of 2026-10-11. This records implementation and verification in the `ad-tools-revamp-react` checkout, starting from `27dedeb8`.
The target and completion criteria remain in [REACT-MIGRATION.md](REACT-MIGRATION.md).

Product layout context: AD Tools is used at normal desktop width and in a roughly half-width desktop window. Mobile interaction is not
required. The generated sidebar's mobile Sheet is incidental behavior, not a product acceptance target.

## Implemented foundation

- `frontend/index.html` now mounts a React 19 and strict TypeScript entry. Vite retains `frontend/` as root, `dist/` output, relative asset paths, existing API proxy and Tauri Worker base configuration.
- React Router owns hash navigation. The entry normalizes existing `#<tool-id>` links to `#/<tool-id>` on load and subsequent hash changes. The existing `tools.json` remains the route label and platform visibility registry.
- shadcn preset `b1Zzq9tHk` was initialized with Base UI. Tailwind semantic tokens, Inter, Hugeicons, and generated Button, Card, Field, Input, Textarea, and Toast components live under `frontend/src/`.
- The React shell uses shadcn Sidebar and Collapsible components. `tools.json` supplies category and tool ordering, category sections start expanded, active routes are marked in the menu, and native-only entries remain hidden on web. The sidebar closes to an offcanvas state on desktop and uses a Sheet on mobile; selecting a mobile route closes it. The generated mobile breakpoint hook uses `useSyncExternalStore` to satisfy the React Hooks lint rule.
- TanStack Query is provided with automatic retry and focus refetch off by default. Each future remote read must set its own query key, freshness, cancellation, and invalidation policy. Execution side effects must be explicit operations.
- `platform/` owns runtime, registration, and initial theme checks. The registration predicate still uses the legacy storage contract. Unregistered users see a gate until registration itself is migrated.
- UUID Generator is a lazy React route. It retains UUID v4 generation on entry, quantity parsing and 10,000 cap, bulk auto copy, clear, success/error feedback, and existing usage event names. Its bulk output stays at a 120px minimum, remains vertically resizable, and scrolls internally as in the vanilla version. The shell breadcrumb uses the compact `text-sm` scale to align with card titles. It has no stored draft, Worker request, Tauri command, or background job. Route unmount discards its generated values, as the vanilla page did.
- TypeScript typecheck and React Hooks linting run in `verify:web`. Existing JavaScript is excluded from typecheck except for imports used by migrated code; this is a temporary boundary.

## Baseline inventory and next owners

The route IDs and names below come from `frontend/config/tools.json`. `frontend/config/toolDefinitions.js` still owns the old implementation. All unported routes currently show an explicit migration placeholder. Before replacing each route, record the seven compatibility areas in section 4 of the migration plan and run its existing focused tests plus a browser journey.

| Route ID          | Current owner                             | Main contract to capture before porting                                   |
| ----------------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| `uuid-generator`  | React `frontend/src/tools/uuid-generator` | Clipboard, analytics, quantity edge cases; migrated                       |
| `json-tools`      | Vanilla `frontend/tools/json-tools`       | JSON transformations and file input                                       |
| `base64-tools`    | Vanilla `frontend/tools/base64-tools`     | Text/file encoding and lazy dependencies                                  |
| `char-counter`    | Vanilla `frontend/tools/char-counter`     | Counting rules and live input                                             |
| `tlv-viewer`      | Vanilla `frontend/tools/tlv-viewer`       | TLV parsing and tree display                                              |
| `qr-tools`        | Vanilla `frontend/tools/qr-tools`         | QR output and downloads                                                   |
| `quick-query`     | Vanilla `frontend/tools/quick-query`      | IndexedDB, SQL generation, Handsontable, Oracle import, Run Query handoff |
| `querify`         | Vanilla `frontend/tools/querify`          | Quick Query schema sharing and Excel processing                           |
| `redis-cache`     | Vanilla `frontend/tools/redis-cache`      | Tauri credentials, Redis operations, result state                         |
| `kafka`           | Vanilla `frontend/tools/kafka`            | Broker settings, native streams, publishing and cleanup                   |
| `compare-config`  | Vanilla `frontend/tools/compare-config`   | Oracle/file sources, workers, matching, table selection and export        |
| `run-query`       | Vanilla `frontend/tools/run-query`        | SQL handoff, saved queries, Jenkins execution and streaming               |
| `run-batch`       | Vanilla `frontend/tools/run-batch`        | Jenkins parameters and execution lifecycle                                |
| `html-template`   | Vanilla `frontend/tools/html-editor`      | Monaco models, encoding, preview sandbox and documents                    |
| `splunk-template` | Vanilla `frontend/tools/splunk-template`  | VTL, Monaco, formatting and preview behavior                              |
| `sql-in-clause`   | Vanilla `frontend/tools/sql-in-clause`    | Quoting and generated SQL                                                 |
| `merge-sql`       | Vanilla `frontend/tools/merge-sql`        | File processing, persisted state and downloads                            |
| `check-image`     | Vanilla `frontend/tools/image-checker`    | Oracle lookup, CDN sizing, concurrency and table export                   |
| `master-lockey`   | Vanilla `frontend/tools/master-lockey`    | Parsing, lookup, virtual rows and native/web behavior                     |

Shell workflows in `frontend/App.js` and `frontend/pages/` still need React owners: registration, settings, approval, feedback, analytics dashboard, sign out, search, connection indicators, theme selection, release tour, updates, and global usage/error tracking. The present shell only covers navigation, a registration gate, initial theme application, and notifications. Native route visibility is kept; deep links to unported routes remain placeholders.

## Verification evidence

Environment: macOS development checkout, Vite 7.1.12, local in-app browser at `127.0.0.1:1234`; no live Worker, Oracle, or packaged desktop application was used.

- `npm run typecheck` and `npm run lint:react`: passed.
- `./node_modules/.bin/vitest run frontend/tools/uuid-generator/tests/main.test.js`: 1 passed. This tests the old UUID implementation, not the new React route.
- `npm run build`: passed, including 100 frontend/general test files (1,181 tests), 5 Worker test files (58 tests), release metadata validation, and the production Vite build.
- `./node_modules/.bin/vite build --mode tauri`: passed as an asset build. `tauri dev` first failed because this checkout has no configured root `oracle-sidecar-aarch64-apple-darwin` binary. A local command override of `bundle.externalBin: []` compiled and started `target/debug/adtools`, but the desktop window was not exposed to the available UI inspection surface. No packaged or visible Tauri UI smoke is claimed.
- Browser smoke: opened `#uuid-generator`, observed normalization to `#/uuid-generator` and a UUID v4 value; Generate changed it; quantity 3 produced three UUIDs, enabled Copy and showed the copy success toast; Clear emptied quantity/output and disabled Copy; `#/compare-config` showed its migration placeholder; returning to UUID Generator created a new value; navigating to legacy `#compare-config` after load normalized correctly. Browser console reported no errors or warnings. Clipboard contents were not independently confirmed by the in-app browser clipboard API.
- Sidebar browser check on 2026-10-11: at the normal desktop viewport, Config collapsed and expanded, Compare Config navigated to its placeholder, and the shell sidebar closed and reopened. Execute and other native-only entries were absent in the web runtime. A 390 × 844 mobile Sheet check also passed, but mobile interaction is outside the product scope and was not used as half-width desktop evidence. The browser reported no errors or warnings; the temporary viewport override was reset after testing.
- Half-width desktop browser check on 2026-10-11: at a representative 820 × 900 viewport, the expanded sidebar and UUID Generator controls remained usable with no horizontal overflow (`documentElement.scrollWidth` was 820 px). The sidebar closed to give the tool full width and reopened. This verifies the current shell and UUID route at that width; other tool layouts still need their own checks as they migrate. The viewport override was reset after testing.
- UUID large-output browser check on 2026-10-11: at 820 × 900, generating 10,000 UUIDs produced 10,000 lines; the textarea stayed 120px tall (`field-sizing: fixed`, `scrollHeight: 175,405px`) and scrolled to its final line. The document remained 820 × 900, Copy was enabled, and the copied-success toast appeared. Before the fix, the same output expanded the textarea to 175,407px and the main area to 175,832px in a 720px viewport.
- Shell typography check on 2026-10-11: the breadcrumb inherited 14.4px body text while card titles used the compact 12.6px `text-sm` scale. The shell breadcrumb now uses `text-sm` to match the surrounding compact component typography.
- UUID large-output regression on 2026-10-11: before the fix, generating 10,000 UUIDs set the shared textarea's `field-sizing-content`; its height reached 175,407px and the main area reached 175,832px in a 720px viewport. The UUID output now uses fixed field sizing, a 120px minimum, and vertical resize. The same 10,000-line generation keeps the textarea bounded and scrollable while preserving auto-copy and its success toast. React porting guidance now requires recording and comparing old/new empty, typical, and large-result layout behavior at normal and half-width desktop sizes.
- After the sidebar change, `npm run typecheck`, `npm run lint:react`, and `npm run build` passed. The build includes the frontend/general and Worker Vitest suites and release-content validation; it reported a non-failing chunk-size warning for the shared application bundle.

Reproduce the browser journey with `npm run dev -- --host 127.0.0.1`, then open `http://127.0.0.1:1234/#uuid-generator` and perform the actions above. The local development registration identity is initialized by the app. Repeat packaged desktop smoke before treating the foundation as verified in Tauri.

## Remaining migration work

- Complete registration and the remaining shell workflows before using this branch as a full replacement for the vanilla app.
- Port Compare Config as the first substantial route, with its own behavior inventory, TanStack Table composition, worker lifecycle, persisted sessions, and Oracle boundary checks.
- Establish Handsontable and Monaco React wrappers when the first spreadsheet and editor workflows migrate.
- Remove old `App.js`, `BaseTool`, router, templates, and CSS only after their remaining consumers have moved.
