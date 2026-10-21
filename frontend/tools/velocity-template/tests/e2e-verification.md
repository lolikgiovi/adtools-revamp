# Velocity Template E2E Verification

## Latest verification — result trust and recovery

- Date: 2026-10-20
- Environment: Vite at `http://localhost:1234/`, headless Chrome 155 driven over CDP
- Result: **PASS** (24/24 assertions, no console errors)

### Journey

1. Start the application with `npm run dev`.
2. Open `http://localhost:1234/` and select **Velocity Template** from the **Template** sidebar group. (A direct `#velocity-template` load resets to `#home`, so navigate from the app.)
3. Set the template to `#set($a = 1)\n$a` and Context Data to `{}`.

### Verified results

1. **Create query** is hidden in the web build; **Copy output** is the primary action and is enabled once a valid render exists.
2. The result header shows `Valid · HH:MM:SS · N B`; a one-byte render reads `Valid · … · 1 B`.
3. Editing Context Data to `{` surfaces `Invalid JSON: …` within ~200 ms without leaving the editor, marks the result `Stale · last valid …`, dims the preview, and disables **Copy output**.
4. The JSON error is announced once (Context Data alert only); the result pane no longer duplicates the same alert.
5. Restoring `{}` returns the result to `Valid`, re-enables **Copy output**, and announces `Result updated at …` once.
6. **Clear template** empties the editor, shows `Template cleared · Undo`, and **Undo** restores the exact template.
7. **Add missing fields…** opens a review dialog listing `newName` → `"sample-newname"`; **Add fields** inserts it, and the undo toast restores the previous context.
8. An unclosed `#if` keeps the last valid result visible with `Stale · last valid …`, shows the syntax error with line/column, and keeps **Copy output** disabled.
9. No console errors were recorded.
10. At 390×844 the tool has no horizontal overflow and the provenance strip truncates inside the pane.

### Regression

`./node_modules/.bin/vitest run frontend/tools/velocity-template/tests/` → 3 files, 22 tests passed.

### Known unrelated failure

`frontend/tools/kafka/tests/analytics.test.js:51` fails deterministically when `localStorage.setItem` is forced to throw. It does not exercise Velocity or `BaseTool.copyToClipboard` and was not modified by this pass.

---

## Previous verification — 2026-10-16
- Environment: Vite 7.1.12 at `http://localhost:1234/`, Codex in-app Chromium browser
- Result: **PASS**

### Journey

1. Start the application with `npm run dev`.
2. Open `http://localhost:1234/#home`.
3. Dismiss the What's New dialog.
4. Select **Velocity Template** from the **Template** sidebar group.

### Verified results

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
17. JSON results used distinct Monaco token colors for keys, strings, booleans, numbers, and brackets; **Copy** returned clean JSON and **Wrap** still toggled correctly.
18. Both JSON and Text modes displayed Monaco line numbers with a standard editor gutter; JSON additionally enabled structured folding.

### Focused verification

The browser run revealed that generic template formatting changes Velocity's whitespace-sensitive
output. Format and Minify were intentionally removed from this first common-VTL release so editing
controls cannot silently change rendered content.

Run the focused service verification as well:

```bash
./node_modules/.bin/vitest run frontend/tools/velocity-template/tests/service.test.js
```

Expected result: `1 passed`, `9 passed`.
