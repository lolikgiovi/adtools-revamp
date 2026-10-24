# Compress Image viewport and gesture verification

Verified 2026-10-24 with installed dependencies and the local Vite server.

## Behavior

- Desktop panes fill the actual app content area, accounting for header, padding, and native title-bar space. The workspace grid has a bounded row, and long batches scroll within the file list.
- The preview header follows the file header's height, including wrapped batch actions. The selected file's dimensions and encoding moved into the scrollable preview body.
- Preview content, downloads, and expanded diagnostics scroll inside the right pane. On narrow screens the panes stack and each stays within a viewport-sized height cap.
- Zoom supports Fit through 32×. Touch-pointer pinch and Ctrl-wheel trackpad pinch zoom; drag and ordinary horizontal/vertical wheel input pan linked images. Keyboard pan/zoom, reset, and the comparison divider remain available.

## Results

- Reproduced the old header mismatch with a failing browser assertion before implementation.
- Real-worker browser harness: 148 desktop checks and 147 checks at 390 px passed.
- Viewport fixture using the production shell CSS and simulated native title-bar attribute: six geometry checks passed with 20 files. Both panes ended at y=704 in a 720 px viewport, leaving the 16 px content inset. Long-list scrolling preserved those bounds.
- Native browser input at 16×: wheel scrolling changed the image transform from `translate(0%, 0%) scale(16)` to `translate(0%, -100%) scale(16)`. Mouse dragging then changed it to `translate(9.67742%, -91.4163%) scale(16)`.
- Inspected processed desktop and 390 px layouts, including the phone comparison and downloads.
- Existing compressor tests: 67 passed across five files.
- Focused ESLint, Prettier, diff whitespace, and production Vite build passed. The build retains existing Runtime.js mixed-import and chunk-size warnings.

## Reproduce

```sh
npm run dev
./node_modules/.bin/vitest run frontend/tools/compress-image/tests
./node_modules/.bin/eslint frontend/tools/compress-image/main.js frontend/tools/compress-image/preview-controls.js frontend/tools/compress-image/tests/browser.js
./node_modules/.bin/vite build --outDir /tmp/ad-tools-compress-viewport-build
```

Open on port 1234:

- `/tools/compress-image/tests/browser.html?theme=dark` for full desktop behavior checks.
- `/tools/compress-image/tests/review.html?theme=dark` for the 390 px harness.
- `/tools/compress-image/tests/layout.html?shell&native&sample&processed&many&verify` for real processing, a long batch, and viewport checks with the production shell CSS. Read the hidden `#geometry-evidence` text for six checks and recorded bounds. Omitting `native` exercises the web shell. Keep this geometry fixture wider than 960 px.
- `/tools/compress-image/tests/layout.html?sample&processed` for visual desktop review.
- `/tools/compress-image/tests/review.html?layout&sample&processed` for visual phone review. Scroll outside the image to move the page and inside the image to pan.

Evidence files: `viewport-browser-evidence.txt`, `viewport-mobile-evidence.txt`, `viewport-geometry-evidence.txt`, `viewport-desktop.png`, and `viewport-mobile.png`.

Proof covers local browser behavior, real workers/codecs, native mouse/wheel browser input, synthetic pinch events, production CSS with simulated desktop title-bar space, and a production bundle build. Packaged Tauri, physical trackpad pinch, physical touch devices, and deployed behavior were not tested.
