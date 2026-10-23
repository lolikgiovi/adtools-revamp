# Compress Image Batch Desk verification

Verified 2026-10-23. This records the implemented feature, not the earlier design proposals.

## Implemented

- One settings container above the workspace, with subtle separators for All, PNG Only, and JPEG & WebP Only. Absent-format groups remain visible and disabled. PNG mode uses explicit Lossless/Lossy choices. No tool title is rendered inside this feature.
- Two bordered panes separated by a Kafka-style draggable divider. Pointer resizing, keyboard arrows (Shift for larger steps), Home/End bounds, responsive width changes, and a project-specific saved split ratio are supported. The divider disappears when panes stack below 960 px.
- A real file table: filename, original dimensions in pixels, original size, compressed size and reduction, actual result method, resize suggestion, and individual download. The table scrolls inside its pane when all columns cannot fit.
- One desktop preview header row with filename and metadata, zoom/reset controls, and comparison mode buttons. At narrow pane widths the controls wrap. Queued files show their original preview; before/after comparison becomes available when a result exists.
- Side-by-side images use a 44 px linked ring cursor and suppress the native hand cursor. Zoomed images pan together. Touch pointer pinch and Ctrl-wheel trackpad pinch zoom around the gesture position. Gesture events are also handled for browsers that emit them.
- Slider mode has a directly draggable on-image divider, a synchronized range input, and keyboard alternatives. Images can still be panned and zoomed.
- Format preservation, lossless PNG defaults, optional resize, failure isolation, downloads, and ZIP handling retain the existing codec pipeline.

## Results

| Verification                                                         | Result                                                          |
| -------------------------------------------------------------------- | --------------------------------------------------------------- |
| Existing compressor Vitest suite                                     | 67 tests passed across five files                               |
| Real browser harness, desktop                                        | 138 checks passed                                               |
| Same harness in 390 px frame                                         | 137 checks passed; desktop-only pane-resize check skipped       |
| ESLint and Prettier on changed production JS/CSS and browser harness | Passed                                                          |
| Compressor-scoped diff whitespace check                              | Passed                                                          |
| Production Vite bundle                                               | Built successfully to `/tmp/ad-tools-compress-batch-desk-build` |

The build reports the existing Runtime.js mixed-import warning. No dependencies were installed.

### Direct browser interaction evidence

Native browser pointer drags moved the workspace separator from 618 px to 683 px. Columns then measured `683px 4px 521px`, with document and viewport widths both 1280 px. The desktop preview header measured 66 px high and its controls remained inside the resized pane.

A physical browser drag on the image divider moved the split from 50% to 64%, updating both the on-image control and its range input. A browser drag after zooming to 1.5× produced identical transforms on both images: `translate(12.22%, 5.47445%) scale(1.5)`. Computed native cursor was `none`; the linked ring measured 44 px.

The automated gesture checks dispatch two touch pointers, Ctrl-wheel, pan, cancellation, and divider events against the rendered DOM. Synthetic pointer tests replace only `setPointerCapture`, since dispatched events do not create operating-system pointers. Actual pane resize, divider drag, and mouse pan were additionally tested through browser input. Physical touch-device and trackpad pinch were not tested.

## Reproduce

Using existing dependencies:

```sh
npm run dev -- --host 127.0.0.1
./node_modules/.bin/vitest run frontend/tools/compress-image/tests
```

Open:

- `/tools/compress-image/tests/browser.html?theme=dark` — desktop harness; final status should read `PASS: 138 browser checks`.
- `/tools/compress-image/tests/review.html?theme=dark` — same harness at 390 px; final status should read `PASS: 137 browser checks`.
- `/tools/compress-image/tests/layout.html?sample&processed` — real component, generated local PNG/JPEG/WebP inputs, and actual worker processing.
- `/tools/compress-image/tests/review.html?layout&sample&processed` — phone-width rendered review. Scroll inside the frame to inspect the comparison and bottom spacing.

`batch-desk-browser-evidence.txt` contains the desktop check list. Screenshots: `batch-desk-wide.jpg`, `batch-desk-mobile-settings.jpg`, and `batch-desk-mobile-preview.jpg`. These are native browser captures; sample images are locally generated fixtures, not compression-result mocks.

## Proof boundary

Browser component, worker codec, and production-bundle verification only. Packaged Tauri, physical multi-touch devices, physical trackpad pinch, and deployed behavior were not tested. The earlier standalone proposals are retained as design history and are not the implementation.
