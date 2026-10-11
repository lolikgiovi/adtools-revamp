# React tools UI review and verification

Date: 2026-10-11. Scope: all six pages in `frontend/src/tools/`, plus the shell's workspace sizing boundary.
Source: `7a2f8ed4` with the uncommitted changes delivered by this review. This is local web evidence; it does not establish production or packaged Tauri readiness.

## Requirements and assessment

Read `AGENTS.md` and `docs/REACT-MIGRATION.md` before editing. Preserve the Mira neutral theme, Inter, Base UI primitives, existing shadcn
compositions, lazy feature routes, processing services, and storage keys. Normal and roughly half-width desktop windows are the acceptance
scope. Keep input → action → output readable, retain visible keyboard focus, and bound large results within their workspaces.

The initial source pass and default-width browser inspection found the following issues. The table records the final changes, rather than
claiming that every possible UI issue has been eliminated.

| Surface                            | Observed gap                                                                                                                                                                                      | Change                                                                                                                                                                                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared workspace                   | Breakpoints depended on the entire window even with the sidebar open; editor heights assumed a fixed 90 px offset.                                                                                | Container queries use actual content width. The shell provides available workspace height with dynamic viewport units and its existing padding.                                                                                                                                                      |
| UUID Generator                     | Negative/fractional quantities could produce misleading results; Enter did not generate; bulk output had little space.                                                                            | Inline quantity validation, consistent numeric conversion including exponent notation, keyboard generation, taller output, disabled empty Clear, and content-width columns. Empty quantity retains the existing default of one.                                                                      |
| Char Counter                       | `char-count-summary` did not match the summary stylesheet; narrow controls and input focus needed refinement.                                                                                     | Correct summary grid, wrapping toolbar, visible inset focus, smaller shared toggle controls, and a live summary. Keep latest draft on route exit without writing the previous value on every keystroke.                                                                                              |
| JSON Tools                         | Extract options scheduled processing with stale closures; output could carry the previous operation's label; old table data survived input replacement; valid `null` could not export.            | Pass selected options directly to processing; clear stale results when changing operation/input; use processed-data state to permit `null` export.                                                                                                                                                   |
| JSON Tools accessibility/lifecycle | Both editors had the same accessible name; owned Monaco models were not explicitly disposed; table sorting required a pointer; zero-match navigation stayed enabled.                              | Distinct editor names, explicit model/subscription/observer cleanup, theme updates, native sort button with `aria-sort` and focus restoration, search autofocus/Enter/Shift+Enter/Escape, restored focus after closing search, and appropriate disabled controls.                                    |
| Base64 Tools                       | Downloads recomputed from current input files instead of downloading the displayed processed results; one decoded text file offered no Copy action; processing feedback omitted some async paths. | Download processed artifacts, offer per-file text Copy in either mode, guard all processing with busy state, disable input mutations while processing, label file inputs, flush drafts on route exit, and close previews on mode change. Download one result directly and multiple results as a ZIP. |
| TLV Viewer                         | Narrow layout used unbounded stacked panels; input errors were not associated with the textarea; recent input could miss debounced persistence on navigation.                                     | Bound stacked panes, keep overflow in the result pane, align/wrap headers, use correct tab slots, associate errors, disable empty Parse/Clear, and flush the latest input on route exit.                                                                                                             |
| QR Tools                           | Downloads could become available during debounce or after rendering failure; Reset silently changed margin from 2 to 16; duplicate outer padding narrowed the form.                               | Gate downloads on the current successfully rendered configuration, keep the last preview visible while updating, announce progress, show a recoverable error, restore margin 2, associate URL validation, and align the form/preview with the workspace.                                             |

The legacy JSON table renderer remains in place to preserve its nested rendering/copy/export behavior. This review adds an accessible
sort control at the React rendering boundary; it does not claim a TanStack Table migration.

## Skill application

- **frontend-design:** retain the established neutral developer-tool identity; align input/action/output groups and use the available content width.
- **shadcn:** inspect `components.json`, local Base UI components, CLI component documentation, and the official Field/Tabs guidance; compose existing Fields, Buttons, Selects, Tabs, Alerts, and Dialogs.
- **impeccable:** inspect incumbent UI, fix operational states and hierarchy, review screenshots at both supported widths, and run its detector once.
- **vercel-react-best-practices:** derive QR readiness from the current configuration; process extraction choices in their event handlers; use effect events for latest-draft cleanup; retain lazy heavy routes and dispose Monaco resources.
- **vercel-composition-patterns:** retain focused editor/preview/summary compositions and child-owned shared primitives. Avoid a new tool framework or boolean-driven generic page abstraction.
- **web-design-guidelines:** audit keyboard access, focus, accessible names, validation associations, content overflow, and state feedback against the fetched guidelines.

An independent read-only DeepSeek audit supported the source review. Its claims were checked against the changing working tree before use.

## Reproduction and automated evidence

Environment: macOS, Node/npm from the existing local environment, Vite 7.1.12, Playwright Test 1.64.0, installed Google Chrome via
`channel: "chrome"`. No browser binary was downloaded. Playwright Test was added under the migration-specific dependency authorization.
The runner uses fresh browser contexts and synthetic fixtures, with development registration enabled by the existing localhost behavior.

```sh
npm run typecheck
npm run lint:react
./node_modules/.bin/vitest run frontend/tools/char-counter/tests/service.test.js frontend/tools/tlv-viewer/tests/service.test.js frontend/tools/qr-tools/tests/service.test.js frontend/tools/base64-tools/tests/lazy-dependencies.test.js
npm run e2e
./node_modules/.bin/vite build
```

`playwright.config.ts` starts Vite on localhost port 1234, or reuses an existing server outside CI. It requires an installed Chrome browser.
The declared `npm run e2e`, `npm run e2e:ui`, and `npm run e2e:debug` commands now exist; the original AGENTS setup-unavailable note predates
this configuration. UI/debug modes are for debugging, not acceptance checks.

The E2E suite runs the following at **1280 × 900 dark** and **820 × 900 light with reduced motion**:

- UUID invalid quantity, Enter generation, exact result count/uniqueness, automatic clipboard contents, exponent notation, and Clear.
- Character summary, per-row counts, and navigation immediately after typing.
- Base64 Hello round trip, invalid-input recovery, disabled actions, ZIP contents after clearing selected inputs, decoded-file clipboard contents, preview dismissal by Escape, and focus restoration.
- JSON extraction paths/sort, stale-output reset, native keyboard table sorting and focus, zero-match search, search dismissal/focus, and Excel download of valid `null`.
- TLV bundled BER/QRIS samples, Table view, parse shortcut, invalid input, recovery, and Clear.
- QR initial disabled downloads, preview generation, identical rendering after Reset, actual PNG download, invalid URL, oversized-content render failure, and disabled downloads after failure.
- Every route: no horizontal document overflow. JSON, Char Counter, and TLV also have no vertical document overflow at these test sizes. Each route is captured for visual inspection. Uncaught browser errors fail tests.

Initial E2E runs exposed test-helper issues: Monaco's hidden EditContext surface cannot be pointer-clicked, and a toast also has a dialog
role. The helper now focuses the editor for keyboard entry; the preview locator uses the dialog's accessible filename. Neither failure was
removed or hidden. Targeted reruns passed after those corrections.

Final result: **30 Playwright checks passed in 42.7 seconds**, across the two projects. TypeScript, React lint, formatting, and
`git diff --check` passed. The focused Vitest run passed **4 files / 71 tests**. The direct Vite bundle build passed in 9.00 seconds with
the existing non-failing chunk-size warning. See [E2E log](evidence/react-tools-ui-2026-10-11/e2e.log),
[build log](evidence/react-tools-ui-2026-10-11/build.log), and [source hashes](evidence/react-tools-ui-2026-10-11/sources.sha256).
A final targeted JSON search/sort rerun additionally verifies Escape returns keyboard focus to Search.

## Visual evidence

All twelve screenshots were inspected. Toolbars fit their pane, primary actions remain accessible, editor/table results scroll within their
panes, and narrow windows stack input/output without widening the document. These are visual inspections, not pixel-diff baselines or a
full WCAG conformance audit.

| Tool           | Normal desktop                                                             | Half-width desktop                                                                |
| -------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| UUID Generator | [Dark](evidence/react-tools-ui-2026-10-11/uuid-generator-desktop-dark.png) | [Light](evidence/react-tools-ui-2026-10-11/uuid-generator-half-desktop-light.png) |
| Char Counter   | [Dark](evidence/react-tools-ui-2026-10-11/char-counter-desktop-dark.png)   | [Light](evidence/react-tools-ui-2026-10-11/char-counter-half-desktop-light.png)   |
| JSON Tools     | [Dark](evidence/react-tools-ui-2026-10-11/json-tools-desktop-dark.png)     | [Light](evidence/react-tools-ui-2026-10-11/json-tools-half-desktop-light.png)     |
| Base64 Tools   | [Dark](evidence/react-tools-ui-2026-10-11/base64-tools-desktop-dark.png)   | [Light](evidence/react-tools-ui-2026-10-11/base64-tools-half-desktop-light.png)   |
| TLV Viewer     | [Dark](evidence/react-tools-ui-2026-10-11/tlv-viewer-desktop-dark.png)     | [Light](evidence/react-tools-ui-2026-10-11/tlv-viewer-half-desktop-light.png)     |
| QR Tools       | [Dark](evidence/react-tools-ui-2026-10-11/qr-tools-desktop-dark.png)       | [Light](evidence/react-tools-ui-2026-10-11/qr-tools-half-desktop-light.png)       |

The Impeccable detector reported three missing-src warnings for Base64 image elements. Source inspection confirms that their effects assign
owned Blob URLs and revoke them during cleanup; the detector does not follow that lifecycle. These warnings are not a claim of broken
images or a blanket detector pass. Image/PDF decoding and native previews were not exercised by this focused suite.

## Limits

- The direct Vite bundle build does not run the `npm run build` prebuild verification pipeline.
- Vite retains the existing large-chunk warning for the lazy Monaco/JSON route (about 2.56 MB uncompressed) and the shell chunk.
- The focused service tests are separate from React E2E. Worker/Oracle/live APIs and packaged Desktop were not tested.
- Clipboard, text-file/ZIP/Excel/PNG downloads and a text preview were tested. Native Tauri file pickers, PDF/image preview, SVG download, browser permission denial, every theme-width combination, and exhaustive assistive-technology behavior remain outside this evidence.
- Editor minimum heights intentionally allow document scrolling in unusually short windows so controls do not become inaccessible.
