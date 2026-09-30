# HTML editor encoding phase verification

Verified in a local Vite browser session on 2026-09-30.

## Repeat

1. Run `npm run dev` and open `/#html-template`.
2. In Edit, confirm Import, Save As, Format, Velocity, More, and the viewport selector are visible. Format offers Format HTML and Minify HTML; More offers Copy, Paste, and Clear.
3. Paste this HTML into Monaco:

   ```html
   <!doctype html>
   <html><head><meta charset="utf-8"></head><body>
   <p>First break</p>
   <p>Second break</p>
   </body></html>
   ```

   The spaces before `break` are literal U+00A0 nonbreaking spaces.

4. Open Encoding. Confirm Format, Velocity, More, and viewport size are hidden, while Render VTL remains. The report shows two nonbreaking spaces.
5. Click the finding twice. Confirm the indicator advances from `1 / 2 · line 3` to `2 / 2 · line 4`, Monaco selects each character, and the rendered preview follows it.
6. Click Compare previews. Confirm the rendered preview shows Windows example (`Â`) and After replacement (the intended space) in a vertical split with separate labels. Scroll either pane and confirm the other follows. Click the finding again and confirm both panes scroll to the same occurrence and highlight it.
7. Open Review fix diff. Confirm the source diff occupies the editor area while the rendered comparison stays visible, and the proposed source shows `&#160;`.
8. Click Replace all. Confirm the editor contains `&#160;`, the report has no non-ASCII findings, and Windows example renders cleanly. Switch to Edit and confirm its controls and viewport selector return.

## Scrollbar markers

1. Use a longer HTML file with non-ASCII characters on separated lines and open Encoding.
2. Confirm amber marks appear in the source editor's right overview ruler at each risky line. Click a finding and confirm its active location gets a red mark; click again to move that mark.
3. Open Review fix diff. Confirm Monaco's overview ruler marks the changed source regions. Return to Edit and confirm the encoding marks clear.

## Rendered comparison check

1. Paste a longer HTML document containing two visible U+00A0 spaces several paragraphs apart, with enough vertical spacing to require preview scrolling.
2. Open Encoding and click Compare previews. Confirm both iframes render side by side at the normal right-pane width (Windows example contains `Â`; After replacement does not).
3. Focus the Windows pane and press Page Down. Confirm both panes move to the same paragraph. Focus the After replacement pane and press Page Down; confirm both move together again.
4. Click the nonbreaking-space finding twice. Confirm the counter advances from `1 / 2` to `2 / 2`, Monaco follows each source line, and both rendered panes scroll to the selected paragraph with a yellow marker.
5. Keep the comparison open and click Review fix diff. Confirm the code diff and both rendered results can be inspected together.
6. Click Replace all. Confirm the resulting source contains `&#160;`, no findings remain, and the Windows example renders without `Â`.

## Result

All steps passed in the browser. The rendered comparison check used a 30-paragraph HTML sample with U+00A0 on paragraphs 2 and 25. After one Page Down in the Windows pane, scroll offsets were 448 and 445.5 pixels; after one Page Down in the replacement pane they were 898.5 and 893.5 pixels. The small offset difference matches the documents' different scroll heights. The focused encoding suite passed (15 tests), ESLint reported no errors, and the Vite production build passed. No live Toad or mobile WebView environment was part of this check.

## Release regression check (2026-09-30)

The earlier browser check ran without the desktop CSP, which blocks inline scripts in the released app. Repeat with this short document; the spaces before `section` on the second and third lines are literal U+00A0:

```html
<!doctype html><html><body>
<div style="height:1000px">First&nbsp; section</div><p>Second  section</p>
<div style="height:1000px"></div><p>Third  section</p>
</body></html>
```

Open Encoding and click Nonbreaking space twice. The counter must change from `1 / 2` to `2 / 2`, with the yellow marker and preview scroll moving from Second to Third. Open Compare previews and repeat; both rendered panes must follow the selected occurrence. Open Review fix diff; the original and replacement source must appear in adjacent columns, with the changed lines aligned horizontally.

Observed in the local browser: both preview positions advanced, both comparison panes followed the selected occurrence, and the source diff used adjacent columns. `vitest run frontend/tools/html-editor/tests/previewBridge.test.js frontend/tools/html-editor/tests/encoding.test.js` passed 17 tests, and `vite build --mode tauri` passed. The regression test checks that the desktop CSP contains the exact SHA-256 hash of the fixed preview script. A newly packaged Tauri app was not launched in this check.
