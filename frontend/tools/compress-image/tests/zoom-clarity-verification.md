# Zoom clarity regression verification

Verified 2026-10-24 using the installed dependencies and local Vite server.

## Reproduction and fix

A generated 1024 × 1024 PNG alternates black and white pixels. It is processed through the real lossless worker, decoded from both preview URLs, and checked for exact source/output pixel equality. Each preview pane is 256 × 256; 8× Fit zoom therefore displays the source at twice its native size.

The old preview fitted an image to its viewport and magnified that fitted layer with CSS scale. Browser interpolation blurred the pixel pattern despite the source and compressed pixels being identical. Fractional placement also made sampling depend on the pane's position.

The preview now sets the image's displayed dimensions directly from its decoded dimensions, viewport fit, and zoom. Position is aligned to device pixels. Magnification uses pixel-preserving rendering. A ResizeObserver recalculates sizing after pane changes, and cleanup disconnects it when the preview changes or clears. Zoom, pan, pinch, and slider controls retain their behavior.

No codec or output-byte behavior changed. Magnification reveals source pixels and genuine compression artifacts; it does not invent detail or sharpen either side independently.

## Evidence

- `zoom-clarity-before.jpg` and `.json`: baseline rendering and geometry; source and compressed pixels match exactly. Both 64 × 64 screenshot samples contained interpolated midtones throughout.
- `zoom-clarity-after.jpg` and `.json`: corrected rendering and geometry; source and compressed pixels still match exactly. Both samples retain black/white contrast with no sampled midtones.
- `zoom-clarity-pixel-evidence.txt`: repeatable screenshot-analysis output.
- `zoom-photo-result.jpg`: original and lossy JPEG at 8× Fit zoom, showing actual pixel edges and codec differences.
- `zoom-clarity-browser-evidence.txt` and `zoom-clarity-mobile-evidence.txt`: browser regression checks.

The screenshot API emits JPEG at CSS-pixel resolution. The fixture aligns its panes to that screenshot grid; image placement itself aligns to physical device pixels. The checker tolerates JPEG ringing near black/white (0–20 and 235–255) and rejects samples with more than 1% intermediate values. It measures screenshot contrast, while the fixture separately verifies decoded pixel equality.

## Reproduce

```sh
npm run dev
```

Open `/tools/compress-image/tests/zoom-clarity-check.html` on port 1234 in a desktop browser. The hidden `#result` contains pixel equality and pane coordinates. Capture a screenshot at CSS-pixel resolution, save it with that JSON, and run the checker. For the saved artifacts on macOS:

```sh
sips -s format png frontend/tools/compress-image/tests/zoom-clarity-after.jpg --out /tmp/ad-tools-zoom-after.png
node frontend/tools/compress-image/tests/check-zoom-clarity.mjs /tmp/ad-tools-zoom-after.png frontend/tools/compress-image/tests/zoom-clarity-after.json
```

The corresponding baseline command using `zoom-clarity-before.jpg` and `.json` should fail. `sips` is used only to convert the screenshot for the existing PNG reader; no packages were installed.

Other verification:

- Existing compressor Vitest suite: 67 tests passed.
- Full browser harness: 148 checks on desktop and 147 at 390 px passed, including linked zoom/pan, pinch events, divider interaction, codecs, and downloads. Gesture checks now assert displayed image geometry instead of a particular CSS transform string.
- Focused ESLint, Prettier, diff whitespace, and production Vite build passed. Existing mixed-import and bundle-size warnings remain.

Proof covers the local browser and real worker/codecs. Packaged Tauri and physical touch/trackpad pinch were not exercised.
