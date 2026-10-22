# QR & TLV browser verification

Verified locally on 2026-10-22 in the in-app browser against the Vite development app.

## Repeat

1. Run `npm run dev` and open `http://localhost:1234` in a registered development browser profile.
2. Select **QR & TLV**. Confirm a single sidebar entry and two underline-style tabs: **QR Generator** and **TLV Viewer**.
3. Enter `QR & TLV verification` in QR Content. Confirm a QR preview and enabled PNG/SVG download controls.
4. Switch to TLV Viewer, select **QRIS Sample**, then **JSON**. Confirm `181 chars`, `19 fields`, valid CRC `49B5`, and merchant `TOKO BUDI`.
5. Switch back to QR Generator. Confirm the content and preview remain. With its tab focused, press Right Arrow; confirm TLV Viewer becomes selected and focused, retaining JSON output.
6. Navigate to `#tlv-viewer`. Confirm redirection to `#qr-tools` with TLV Viewer selected.
7. At a 768 x 820 viewport, confirm both tools stack their panels without horizontal page overflow. Confirm Tree/Table/JSON remain in one row.
8. Select **BER-TLV Sample**, then **Table**. Confirm `16 bytes`, `4 nodes`, `depth 2`, and four result rows. Restore the normal viewport and select **Tree**.

All steps passed. Screenshots:

- [Desktop: BER-TLV tree](artifacts/qr-tlv-desktop.png) — 1280 x 720.
- [Narrow: BER-TLV table](artifacts/qr-tlv-narrow.png) — 768 x 820, full-page capture.

Additional checks:

- Local Vitest: QR and TLV service suites, 62 tests passed.
- Local ESLint on the changed QR/config/guide JS: no errors; two existing empty-catch warnings in the extracted QR generator.
- `./node_modules/.bin/vite build`: passed, with shared-runtime import and chunk-size warnings.
- `git diff --check`: passed.

This verifies the local browser interface and frontend bundle. Native Tauri and deployed builds were not exercised. PNG/SVG controls were checked for enabled state; actual downloaded files were not checked.

## Bottom spacing follow-up

Added 1rem bottom padding to the combined tool and subtracted the native window title-bar height from the desktop TLV viewport calculation. Browser recheck at 1280 x 720: panels end 34.5px above the viewport bottom; wrapper bottom padding is 16px. At 768 x 820, the stacked layout retains 16px padding with no horizontal overflow. Native title-bar sizing is accounted for in CSS but was not exercised in packaged Tauri.

Screenshot: [Bottom spacing](artifacts/qr-tlv-bottom-spacing.png).

## Header divider alignment follow-up

Both TLV panel headers now share padding, a 4rem minimum height, and no flex shrinking. Browser recheck at 1280 x 720 with QRIS Sample: both header heights are 64px and both bottom borders sit at y=190.5px. At 768 x 820, both remain 64px high with no horizontal page overflow. Reproduce by opening TLV Viewer, selecting QRIS Sample, and comparing the two header dividers. Screenshot: [Aligned headers](artifacts/qr-tlv-aligned-headers.png).
