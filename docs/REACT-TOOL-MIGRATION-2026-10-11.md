# React tool migration assessment: common tools

Assessment date: 2026-10-11. Scope: `json-tools`, `base64-tools`, `char-counter`, `tlv-viewer`, and `qr-tools`.
The migration target and architecture remain defined by [REACT-MIGRATION.md](REACT-MIGRATION.md). This assessment records the
vanilla source behavior before adding the React routes.

## Route and integration baseline

- The route IDs and names are already in `frontend/config/tools.json` and `frontend/src/app/routes.ts`; preserve those IDs and legacy
  `#<tool-id>` deep links.
- `frontend/src/app/App.tsx` currently mounts only UUID Generator as a React tool. These five IDs fall through to `PendingPage`.
- The behavior reference remains in `frontend/tools/<tool-id>/`. Keep those modules available during this migration; the React pages own
  their UI and lifecycle, while existing processing services remain the source for established transformations and formats.
- No target tool makes a Worker request, invokes a Tauri command, or runs a background job. Base64 has a Tauri-specific native file
  picker and filesystem read path; preserve its browser file-input fallback.

## Per-tool compatibility checklist

| Tool           | Current workflow and behavior to preserve                                                                                                                                                                                                                                                                                                                                                                              | Data and lifecycle contract                                                                                                                                                                                                                                                                                                                                         | Layout and output contract                                                                                                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `json-tools`   | Eight actions: Beautify, Minify, Stringify, Unstringify, Escape, Unescape, Extract Keys, and To Table. Monaco input and editable output; JSON completion support; validate/action errors with source positions; copy/paste/clear; extract simple keys or paths in natural/A-Z/Z-A order; table view with nested values, transpose, sortable keys, expand, search/navigation, Excel export, and HTML/TSV copy fallback. | Input key `tool:json-tools:editor`, saved after 300 ms; selected operation key `json-tools-tab`; output/table are session-only. Preserve analytics event names and source-vs-restored input metadata. Dispose both Monaco editors, completion providers, markers, and pending persistence on unmount. No focused JSON service test exists.                          | Keep both editor areas bounded and reachable; retain table-only controls in To Table mode and existing nested-table output/copy semantics. Large JSON/table output must scroll inside the output area.                          |
| `base64-tools` | Encode/decode tabs; text input plus multi-file selection; per-file remove and image preview; encode to Base64/data URI; decode text or binary files with MIME detection, preview cards, and individual downloads; clipboard paste/copy; input/output clear; single output download and multi-file ZIP download. Keep duplicate ZIP download coalescing and lazy JSZip loading.                                         | Text keys `tool:base64-tools:encode-input` and `tool:base64-tools:decode-input`, saved after 250 ms. Selected `File` objects and processed output are in-memory only. Web uses file inputs; Tauri uses `plugin-dialog` and `plugin-fs`. Revoke preview object URLs and clear generated decode previews when leaving the route. Preserve analytics names and counts. | Keep controls available at roughly 820 px; file lists and large Base64 text stay in bounded scrollable regions. Preserve decoded binary vs text distinction and zip naming/contents.                                            |
| `char-counter` | Live counts for grapheme characters, characters without spaces, words, lines, and UTF-8 bytes; Summary and Per row modes; Paste, Copy, Clear. Rows preserve empty lines and show per-row grapheme length.                                                                                                                                                                                                              | Text key `tool:char-counter:text` and mode key `tool:char-counter:mode`; text is saved after 250 ms and on unmount. Restore focus to the text input on entry. Preserve count analytics.                                                                                                                                                                             | Input and summary remain visible together on desktop; Per row data has an independently scrollable pane and remains usable at half desktop width.                                                                               |
| `tlv-viewer`   | Auto-detect, QRIS/EMV QR, BER-TLV Hex, and BER-TLV Base64 formats; Parse and Ctrl/Cmd+Enter; Paste, QRIS sample, BER sample, Clear; Tree, Table, JSON views; CRC/validation statuses; Copy for the selected view. Preserve QRIS tag labels/annotations and BER class, offset, depth, and value preview.                                                                                                                | Keys `tool:tlv-viewer:input`, `tool:tlv-viewer:format`, and `tool:tlv-viewer:view`; input debounce is 250 ms. Restore saved view/format and immediately parse non-empty restored input. Cancel persistence on unmount.                                                                                                                                              | Input and output panels share the available desktop height; tree, table, and JSON output scroll within the output panel. Long BER hex values stay truncated in tree/table previews while full data remains in JSON/copy output. |
| `qr-tools`     | Text/URL content type; URL guidance; debounced live QR preview; foreground/background colors; low-contrast warning; PNG/SVG downloads; Reset; success/error feedback. Preserve the QRCode library and the established 256 px, black-on-white initial render.                                                                                                                                                           | No persisted draft, native operation, or background job. Cancel the 200 ms preview timer and ignore late renders after unmount or a newer render. Preserve analytics event names.                                                                                                                                                                                   | Keep controls and preview usable side by side at desktop width and stacked at narrower tool widths. Keep the QR square and preview contained.                                                                                   |

## Initial verification evidence

Environment: local macOS checkout, Node/Vitest project binaries; React routes were placeholders at the time of this assessment.

- Source assessment: the existing vanilla controllers, templates, services, styles, and relevant tests were inspected. This is source-level
  behavior evidence; it is not a browser comparison against the vanilla UI.
- Focused existing tests before the React port: `./node_modules/.bin/vitest run
frontend/tools/base64-tools/tests/lazy-dependencies.test.js frontend/tools/char-counter/tests/service.test.js
frontend/tools/tlv-viewer/tests/service.test.js frontend/tools/qr-tools/tests/service.test.js` — 4 files passed, 71 tests passed.
- JSON Tools has no focused test file. Its service and controller remain in place as the behavior reference.
- The old implementations remain available until the full frontend migration cleanup; no legacy tool source was removed for this port.

## React port verification

The five tools are now lazy React routes in `frontend/src/app/App.tsx`; the existing vanilla implementations and processing services remain
available as the behavior reference. The React pages use the foundation's shadcn/Base UI components and own route state, persistence,
cleanup, and platform-specific browser behavior. JSON Tools loads Monaco's editor API and JSON language contribution only, keeping the
other bundled basic language modes off this route.

### Verification commands

Environment: macOS development checkout with Vite 7.1.12 and the Codex in-app browser. Port 1234 was occupied, so the local Vite server
ran at `http://127.0.0.1:1235` with `npm run dev -- --host 127.0.0.1 --port 1235`. No packages were installed.

- `npm run typecheck` — passed.
- `npm run lint:react` — passed.
- `./node_modules/.bin/vitest run frontend/tools/base64-tools/tests/lazy-dependencies.test.js frontend/tools/char-counter/tests/service.test.js frontend/tools/tlv-viewer/tests/service.test.js frontend/tools/qr-tools/tests/service.test.js` — 4 files and 71 tests passed. These are existing processing/lazy-dependency tests; they do not render the React routes. JSON Tools has no focused test file.
- `./node_modules/.bin/vite build` — passed. Vite reports the JSON Tools lazy chunk at about 2.56 MB and emits its non-failing large-chunk warning. Narrowing the Monaco imports reduced that chunk from about 3.70 MB; editor core remains a large lazy-route payload.

### Browser journeys

The routes were checked in the web runtime at `#/json-tools`, `#/base64-tools`, `#/char-counter`, `#/tlv-viewer`, and `#/qr-tools`. This is
manual browser evidence for the React pages, separate from the vanilla service tests above.

- **JSON Tools:** entered `{"name":"Ada","active":true}`, converted it to a table, and searched for `Ada` (1/1 match). A second stress
  check pasted 180 objects with four fields each; conversion produced the wide result inside its scroll pane. At 820 × 900, the pane's
  client size was 492 × 380 px and its content width was 80,859 px, while the document remained 820 px wide.
- **Base64 Tools:** encoded `Hello` as `SGVsbG8=`, decoded it back to `Hello`, loaded a generated `.base64` file and confirmed its decoded
  text preview opened and closed. The browser picker accepts `.base64` in addition to `.txt`, matching the existing input accept list and
  Tauri filter; this corrects the old browser handler's narrower extension check.
- **Char Counter:** for `ab\nx`, the UI showed 4 grapheme characters, 3 without spaces, 2 words, 2 lines, and 4 UTF-8 bytes. Per row showed
  `ab` = 2 and `x` = 1.
- **TLV Viewer:** parsed the bundled QRIS sample as 181 characters, 19 fields, depth 1; CRC `49B5` was valid and mandatory tags were
  present. Table view displayed the parsed fields.
- **QR Tools:** entered `https://example.com` and observed a generated QR preview.

### Visual parity follow-up

On 2026-10-11, I compared the React pages with the vanilla app in the clean reference checkout at the normal 1280 × 720 browser size, then
rechecked the React pages after correcting the layout. The first pass had carried the UUID-era generic card and pill-tab styling into tools
whose old screens were flat, full-height workspaces. That reduced editor space in JSON Tools, moved Base64 actions off center, changed
Char Counter's summary layout, and shifted TLV's panel balance. The corrected pages now use the original tool-specific structure: underline
operation tabs and two full-height editors for JSON, flat full-width encode/decode sections for Base64, a full-height Char Counter workspace
with its count strip at the bottom, the TLV input/output split at the vanilla ratio, and QR's compact centered two-panel layout.

The visual comparison is qualitative rather than a pixel-diff. It covers the tools within the React Foundation shell; its wider sidebar and
breadcrumb remain the shell used by UUID Generator. After the layout correction, I verified the empty and representative screen states at
1280 × 720. I did not repeat the complete 820 × 900 route sweep after this visual correction, so the earlier half-width evidence above is
not a claim about the post-correction rendering.

### Layout and limitations

At 1280 × 900, all five pages had a 1280 px document width and 900 px page height. At 820 × 900, all five had an 820 px document width
with no horizontal page overflow. JSON Tools and TLV Viewer used document heights of 989 and 1071 px respectively; their long results
remain in bounded output panes. Base64 Tools, Char Counter, and QR Tools remained 900 px high. The viewport override and browser test
inputs were reset after the checks.

The browser checks did not exercise native Tauri file picking, actual file/ZIP downloads, or verify clipboard contents through an external
clipboard read. No Worker, Oracle, production, or packaged Desktop integration was involved. Existing vanilla sources remain available;
the browser checks validate the React interaction paths but are not a pixel-for-pixel comparison against the old running vanilla UI. The
large JSON result was checked at half width, not at a larger maximum-size fixture.
