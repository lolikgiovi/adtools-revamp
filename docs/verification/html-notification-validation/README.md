# HTML notification Velocity validation

Verified locally on 2026-10-26.

HTML Template and Velocity Context are separate bordered panels. Each header has a collapse/expand button matching Velocity Template. Collapsing one panel expands the other, and the preference is stored under `tool:html-template:pane-state`. Encoding mode keeps the template accessible. Validate Velocity sends the unmodified source and parsed context to `config.velocityValidator.notificationUrl` as a JSON POST with `isAddFunction: true`. The endpoint is configured through Notification Template Endpoint in Settings. Existing Velocity Template requests retain their original JSON payload without the notification flag.

Successful HTML responses (including a JSON string containing HTML) appear in the existing preview. Successful responses render directly in the preview with no raw source panel. Non-2xx responses show their HTTP status and open API response diagnostics without treating them as valid HTML. Context drafts persist in document records, including unfinished JSON, and copy with duplicate tabs. Changes invalidate pending requests and results.

## Repeatable browser check

1. Run the already-installed Vite server with `npm run dev`.
2. Open <http://localhost:1234/tools/html-editor/tests/notification-check.html>.
3. Wait for the title `PASS: HTML notification validation`.
4. Expand Browser verification results to review all 34 checks.

The fixture mounts the actual editor with Monaco and the real JSON transport. It intercepts only its fixture endpoint with synthetic responses and uses an in-memory document store. It restores the previous notification endpoint setting after running. It does not call the corporate sandbox or use the pasted transaction data.

Passing browser checks:

- Context appears below HTML Template.
- Template and context have separate panel containers.
- Collapsing template gives context the space.
- Collapsing context expands template.
- Collapsed pane preference restores.
- Expanding restores both panels.
- Encoding mode keeps the template accessible.
- Invalid JSON stays local.
- Duplicate preserves unfinished context.
- Switching tabs restores unfinished context.
- Document saves retain the raw context draft.
- Format JSON works.
- Notification request includes the exact source, parsed context, and `isAddFunction: true`.
- API output previews without replacing source.
- HTTP 503 retains the API diagnostic.
- Repeated clicks submit once while pending.
- Edited inputs reject a late API response.

Screenshots: [panels.png](panels.png) shows the separate panels; [editor.png](editor.png) records the initial API integration. Captured at the narrow layout with White BG enabled so the returned HTML is readable.

## Automated checks

```sh
./node_modules/.bin/vitest run frontend/tools/html-editor/tests frontend/tools/velocity-template/tests/validator.test.js frontend/tools/velocity-template/tests/validator-ui.test.js
```

Initial API integration: 8 files, 72 tests passed. Panel follow-up: all 6 HTML editor test files, 51 tests passed; the extended browser fixture passed all 34 checks. ESLint reported no errors for the changed JavaScript.

Production bundle: `./node_modules/.bin/vite build --outDir /tmp/adtools-html-notification-validation-build` passed (2,496 modules). Existing import/chunk-size warnings remain.

## Limits

The sandbox API was not called. Live endpoint response envelopes and native desktop networking remain unverified. Responses containing a JSON object remain visible in API response; only raw HTML or JSON string responses are decoded for HTML preview. Browser calls require the endpoint's existing CORS/HTTP permissions. Desktop uses the existing native Velocity HTTP command.

## Viewport regression

The HTML tool used `100vh - 90px`, so its height could exceed the space remaining below the application header. The original fixture also forced its own tool height, hiding this problem. The tool now uses the same shrinking flex-container chain as Velocity Template and fills the available `.main-content` / `.tool-root` area. The document bar keeps its height and scrolling stays within the editor and preview.

The browser fixture now includes the application container structure and header without overriding tool height. Before the fix it failed the long-template/collapsed-context viewport assertion. After the fix it verifies a 400-line template with both expanded and collapsed context, including a 420px application area. Screenshot: [viewport.png](viewport.png).

## Toolbar and context refinement

The source toolbar now orders Import (File / SQL), Edit / Encoding, Export, Create Query, and More. Formatting, copy, paste, and clear remain under More. Export uses a native save dialog with HTML and All Files choices, browser file picking when available, and a filename prompt for the download fallback.

Velocity Context now uses a per-document Monaco JSON model, Format JSON, and the same missing-field review as Velocity Template. Context drafts and undo history stay with their document. The render toolbar orders Validate, environment, viewport, VTL mode, White BG, and reload. Settings has been removed.

Both template tools now share SQL query fetching, result row/field selection, query history, import dialog markup, and styling. HTML SQL import creates a document with persisted row identity; Create Query opens an update draft in Quick Query. It does not execute an update. SQL import uses the existing desktop Oracle connection flow.

Verification: 14 test files / 115 tests pass across HTML editor, Velocity Template, and Quick Query handoff. The production bundle passes. All 33 browser checks pass, covering toolbar order, custom-extension export, Monaco JSON, SQL import, saved identity, Quick Query handoff, missing-field review, and document-scoped undo using mocked API/Oracle/file-picker responses. Native Oracle queries and native save dialogs were not exercised.

Latest UI screenshot: [toolbar.png](toolbar.png).

Successful API response follow-up: an expanded diagnostics panel from a previous request is hidden and closed on success, and its raw text is cleared. The rendered HTML receives the preview area. The focused 13-test suite passes.

## Compact styling parity

HTML panel headers now use Velocity Template's 38px minimum height, 0.35rem / 0.55rem padding, 0.5rem header gaps, and 0.86rem headings. Header buttons use the same 28px minimum height, 0.28rem / 0.55rem padding, 0.8rem type, and 1.2 line height. Utility actions use secondary styling. Dropdowns align with the compact buttons; narrow screens retain 40px controls. The former unscoped HTML `.pane-header` rule is now scoped to HTML Template.

The browser fixture loads Velocity Template CSS and compares computed header spacing, button density/colors/radius, and heading typography against a reference header. These three checks pass alongside the existing journeys (37 checks total). Screenshot: [compact-styling.png](compact-styling.png).
