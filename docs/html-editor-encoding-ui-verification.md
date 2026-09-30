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
6. Open Review source diff. Confirm the diff occupies the editor area and shows `&#160;` in the proposed source. Select After replacement and confirm the preview no longer displays the Windows example's `Â`.
7. Click Replace all. Confirm the editor contains `&#160;`, the report has no non-ASCII findings, and Windows example renders cleanly. Switch to Edit and confirm its controls and viewport selector return.

## Scrollbar markers

1. Use a longer HTML file with non-ASCII characters on separated lines and open Encoding.
2. Confirm amber marks appear in the source editor's right overview ruler at each risky line. Click a finding and confirm its active location gets a red mark; click again to move that mark.
3. Open Review source diff. Confirm Monaco's overview ruler marks the changed source regions. Return to Edit and confirm the encoding marks clear.

## Result

All steps passed in the browser. Focused encoding, Velocity, and minifier tests passed (29 tests); the Vite production build passed. No live Toad or mobile WebView environment was part of this check.
