> Historical workflow report. For the current implementation, see [Batch Desk verification](./batch-desk-verification.md).

# Compress Image workflow verification — 2026-10-23

## Result

- 67 tests passed across all five compressor test files.
- Browser harness: 130 checks passed at desktop width and in the 390 px review frame.
- ESLint, Prettier, and the compressor-scoped diff whitespace check passed.
- Production Vite bundle built successfully to `/tmp/ad-tools-compress-flow-build`.
- Rendered review: 1536 px mixed-format results and 390 px queued files, including expanded PNG and resize controls.

## Reproduce

Use existing dependencies only:

```sh
npm run dev -- --host 127.0.0.1
./node_modules/.bin/vitest run frontend/tools/compress-image/tests
```

Open these routes on the local server:

- `/tools/compress-image/tests/browser.html?theme=dark` — real file input, worker codecs, pixel equality, format preservation, orientation, resize, linked comparison, slider, failure isolation, and ZIP checks. The page ends with `PASS: 130 browser checks` and expandable evidence.
- `/tools/compress-image/tests/review.html?theme=dark` — the same harness at 390 px.
- `/tools/compress-image/tests/review.html?layout&width=1536&sample&processed` — three generated PNG/JPEG/WebP files, processed by the actual workers.
- `/tools/compress-image/tests/review.html?layout&sample` — queued sample files at 390 px. Enable Lossy and Resize to inspect expanded controls.

The sample route generates its images locally and uses the real file-input change event. It does not inject compression results. `flow-wide.png` records a real JPEG comparison; `flow-mobile.png` records expanded controls.

## Behavior

Settings remain visible after upload and show only groups relevant to the batch. PNG starts lossless; its lossy toggle explains the color change. JPEG/WebP presets and quality no longer change PNG mode or quality bounds. Resize is a switch, preserves aspect ratio, never upscales, and remains opt-in.

Files show their names, dimensions, and source sizes before compression and can be selected for an original preview. The desktop file list and comparison share one workspace. On narrow screens the list is limited to 280 px, with the preview following it.

The supplied 1440 × 3200 and 2670 × 2670 bounds are configuration values, without device-model claims. Advice compares both orientations and appears when an image fits neither bound. Portrait and Square apply explicit batch resize limits; Original disables resizing. The row warning describes source dimensions, which remain oversized even after choosing a smaller output.

## Proof boundary

Browser and production-bundle verification only. No packaged Tauri runtime or deployment was tested. The build reports the existing Runtime.js mixed-import warning. Repository-wide whitespace checks also see pre-existing edits to AGENTS.md; the compressor-scoped check is clean.
