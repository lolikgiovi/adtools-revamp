# Velocity Template E2E Verification

- Date: 2026-10-16
- Environment: Vite 7.1.12 at `http://localhost:1234/`, Codex in-app Chromium browser
- Result: **PASS**

## Journey

1. Start the application with `npm run dev`.
2. Open `http://localhost:1234/#home`.
3. Dismiss the What's New dialog.
4. Select **Velocity Template** from the **Template** sidebar group.

## Verified results

1. The default template rendered `Hello, Maya!` and both sample items.
2. Replacing Context Data with Rina, Alpha, and Beta immediately updated the preview.
3. `#set`, `#if`, and `#foreach` rendered correctly.
4. A normal missing reference remained `$missing`; the quiet reference `$!missing` rendered empty.
5. Invalid Context Data paused the preview and displayed `Invalid JSON: Unexpected end of JSON input`.
6. Restoring valid JSON resumed the preview.
7. **Copy** placed the original, whitespace-preserving template on the clipboard.
8. **Wrap** toggled `aria-pressed` and the preview's `is-nowrap` class.
9. **Sync fields** added missing external references while preserving the supplied customer and item values.
10. Leaving and reopening Velocity Template restored the saved template and context with the same rendered result.
11. No application errors were recorded in the browser console during the successful journey.
12. An unmatched `#else` displayed a wrapping `Velocity syntax error` alert with its line and column, and Monaco marked the offending directive.
13. Correcting the directive structure cleared both the alert and Monaco marker and resumed the live preview.
14. Selecting **JSON** pretty-printed valid rendered JSON.
15. Invalid rendered JSON displayed a `Rendered JSON error` while keeping the raw rendered output visible for diagnosis.
16. Switching back to **Text** preserved the rendered output exactly and cleared the JSON error.

## Focused verification

The browser run revealed that generic template formatting changes Velocity's whitespace-sensitive
output. Format and Minify were intentionally removed from this first common-VTL release so editing
controls cannot silently change rendered content.

Run the focused service verification as well:

```bash
./node_modules/.bin/vitest run frontend/tools/velocity-template/tests/service.test.js
```

Expected result: `1 passed`, `9 passed`.
