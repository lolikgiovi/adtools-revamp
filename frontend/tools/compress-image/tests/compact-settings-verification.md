# Compact settings verification

Verified 2026-10-23 in the local in-app browser.

- Existing browser harness: **138 checks passed**. Raw results: `compact-settings-browser-evidence.txt`.
- Rendered expanded resize and lossy PNG settings inspected at 1280 and 390 px.
- No visible All label. Resize, PNG, and JPEG/WebP groups have vertical separators on desktop and horizontal separators when stacked.
- Group headings share a row; each group's controls sit beneath its heading, with paired numeric fields.
- The panel has bounded, unequal columns rather than stretching controls across the workspace.
- Labels use Compare Config's 13 px semibold size, field text uses 14 px, and mode descriptions use 12 px.
- Before and after visiting QR Generator, computed compressor label size/weight remained 13 px/600 and field text remained 14 px.
- QR Generator's formerly global label rule is scoped to its tool; its own label appearance is preserved.
- Lossless and Lossy explanations are visible beneath each option again.
- Resize and lossless WebP explanations remain available as hover titles and accessible descriptions.
- ESLint, Prettier, and `git diff --check` passed.

Reproduce with `npm run dev`, then open:

- `http://127.0.0.1:1234/tools/compress-image/tests/browser.html` for the automated browser checks.
- `http://127.0.0.1:1234/tools/compress-image/tests/layout.html?sample` for desktop review.
- `http://127.0.0.1:1234/tools/compress-image/tests/review.html?layout&sample&width=2394` for wide review.
- `http://127.0.0.1:1234/tools/compress-image/tests/review.html?layout&sample&width=768` for intermediate review.
- `http://127.0.0.1:1234/tools/compress-image/tests/review.html?layout&sample` for 390 px review.

In each layout, turn on Resize and select Lossy to reveal both optional groups.
Screenshots: `compact-settings-desktop.png` and `compact-settings-mobile.png`.

Open `http://127.0.0.1:1234/tools/compress-image/tests/settings-layout-check.html` for the repeatable mobile layout check.
It waits for the sample PNG, enables resize and lossy PNG, and verifies that fields fit without page overflow and labels sit above inputs.
The page reports the measured bounds. Results are also recorded in `settings-layout-evidence.txt`.

For typography regression verification, open Compress Image in the actual app, visit QR & TLV, then return to Compress Image.
Compare computed styles for `.ci-toggle` and `[data-ci=preset]` before/after; expect 13 px/weight 600 and 14 px respectively.

This verifies the local browser surface; packaged Tauri and deployed behavior were not tested.
