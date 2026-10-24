# Compression settings, PNG choices, and target fitting

Verified locally on 2026-10-24. Browser proof covers real codecs, Workers, image decoding, preview selection, individual downloads, and ZIP contents. It does not cover packaged Tauri or deployed production.

## Behavior

- Wide settings share one control row; narrower layouts wrap. Max dimensions uses the Quick Query toggle treatment and preserves aspect ratio without cropping or upscaling.
- Target size is optional and uses decimal KB. Success means the downloaded file is strictly below `KB × 1000` bytes.
- JPEG/WebP quality is a number. With a target, it is the quality floor. PNG presets retain their quantization quality floors.
- PNG starts on lossless with no mode setting. PNG Lossy Quality controls the precomputed lossy result. Both PNG encodings are prepared, including lossy results that are larger than lossless output. An unavailable lossy result reports its quality/codec reason.
- Result cells show Queued, Loading with a spinner, completed sizes, or N/A/Failed. JPEG lossless is muted and unavailable immediately on upload. Loading exposes aria-busy and respects reduced motion.
- The table shows file name, dimensions, original size, lossless size, and lossy size, plus the download action. Info icons explain the difference. Each size is a per-image selection; previews, individual downloads, and ZIP use the chosen bytes.
- A missed target offers **Fit to target** when no existing lossy result meets it. Clicking is the explicit authorization to reduce dimensions for that image.
- Dimension fitting searches the longest edge at the selected quality floor, compares permitted encodings, then re-encodes/verifies the final result within the quality limit. Aspect ratio is preserved. The search keeps the largest verified fit found by a bounded binary search; codec size is not mathematically monotonic across every dimension.
- Other rows remain unchanged. Existing variants and original downloads stay available. Failed fitting preserves the previous result. Stale settings require recompression first.
- JPEG does not have a lossless re-encoding path; its lossless column is unavailable. Lossless WebP inputs remain lossless during ordinary compression.

## Repeat

Run the existing local tools (no dependency installation):

```sh
./node_modules/.bin/vitest run frontend/tools/compress-image/tests
npm run dev
```

Open these local browser pages:

- `/tools/compress-image/tests/png-choices-check.html`: PNG choices, missed-target fitting, next larger dimension boundary, per-row independence, selected individual/ZIP bytes, stale settings, and JPEG fitting.
- `/tools/compress-image/tests/png-choices-check.html?decoder=main`: same checks with main-thread decoding.
- `/tools/compress-image/tests/target-settings-check.html` and `?decoder=main`: three formats, invalid/blank targets, format/ratio preservation, quality floors, reachable and unreachable targets, lossless PNG/WebP preservation.
- `/tools/compress-image/tests/stable-settings-check.html`: settings at 390, 768, 1024, 1440, and 2390 pixels, including switch/mode changes.
- `/tools/compress-image/tests/browser.html`: existing codec, integrity, metadata, orientation, queue, failure, preview, and ZIP regression coverage, updated for per-image choices.
- `/tools/compress-image/tests/target-settings-review.html` and `?mobile`: rendered review with real processed sample files.

The pages print PASS/FAIL and every assertion. Evidence is saved alongside this file in `png-choices-*-evidence.txt` and `target-settings-*-evidence.txt`; screenshots are `target-settings-desktop.png` and `target-settings-mobile.png`.

Production compilation can be repeated with `./node_modules/.bin/vite build`. This directly checks the production bundle; it does not run unrelated repository-wide test scripts or change release version metadata.
