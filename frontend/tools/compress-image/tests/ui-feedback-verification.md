# Compress Image UI feedback verification

Verified 2026-10-24 using the existing Vite server and installed dependencies.

Changes:

- Removed batch image counts, ready/done counts, and aggregate size/savings labels.
- Kept per-file processing stages and added a concise Compressed completion state. Original kept, errors, and actual resize outcomes remain explicit.
- Removed the Resize table column. Oversized originals show Resize suggestion below their filename; resized results hide that suggestion.
- Colored both output size and percentage green when output bytes are smaller than input bytes.
- Moved the precomputed lossy PNG offer from settings to a bordered batch action beside Download ZIP, with Undo lossy PNG. The explicit Mode selector remains in settings.
- The lossy action reads `Use Lossy PNG, reduce up to X.X% size` on one line, with the reduction phrase in the theme success color. The percentage measures additional savings against current PNG output. Both the prepared alternative and click-selected PNG quality use Balanced, even if High quality was previously selected.
- Removed the color-reduction report and result copy. The method column still identifies Lossy or Lossless.

Results:

- Existing compressor Vitest suite: 67 tests passed across five files.
- Real browser harness: 142 checks passed at desktop width and 141 at 390 px.
- Visually inspected processed PNG/JPEG/WebP rows at desktop and 390 px, including the lossy offer and resize suggestion. Narrow tables retain internal horizontal scrolling.
- Focused ESLint, Prettier, and git diff whitespace checks passed.
- Production Vite bundle built successfully. Existing Runtime.js mixed-import and bundle-size warnings remain.

Reproduce with the existing local dependencies:

```sh
npm run dev
./node_modules/.bin/vitest run frontend/tools/compress-image/tests
./node_modules/.bin/eslint frontend/tools/compress-image/main.js frontend/tools/compress-image/tests/browser.js
./node_modules/.bin/prettier --check frontend/tools/compress-image/main.js frontend/tools/compress-image/styles.css frontend/tools/compress-image/tests/browser.js
./node_modules/.bin/vite build --outDir /tmp/ad-tools-compress-ui-feedback-build
```

Open these local URLs on port 1234:

- `/tools/compress-image/tests/browser.html?theme=dark` for desktop checks.
- `/tools/compress-image/tests/review.html?theme=dark` for the same checks in a 390 px frame.
- `/tools/compress-image/tests/layout.html?sample&processed` for the desktop rendering.
- `/tools/compress-image/tests/review.html?layout&sample&processed` for the mobile rendering.

Saved evidence: `ui-feedback-desktop-evidence.txt`, `ui-feedback-mobile-evidence.txt`, `ui-feedback-desktop.png`, and `ui-feedback-mobile.png`.

Proof covers the local browser component, real workers/codecs, and a production bundle build. Packaged Tauri, physical touch devices, and deployed production were not tested.

Final copy-only refinement: inspected the single-line green reduction phrase in the local browser; focused ESLint, Prettier, and diff checks passed. The full browser counts above were recorded before this wording refinement.
