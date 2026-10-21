# Compress Image verification

Verified locally on 2026-10-21. The UI is implemented; the stronger OxiPNG
optimizer remains a dependency handoff described below.

## Reproduce

1. Run `npm run dev -- --host 127.0.0.1` from the repository root, or reuse the
   existing server on that address.
2. Open [browser.html](http://127.0.0.1:1234/tools/compress-image/tests/browser.html).
3. Wait for **PASS: 26 browser checks**. Expand Verification evidence to see
   each assertion. The page leaves three synthetic results for manual inspection.
4. Open [review.html](http://127.0.0.1:1234/tools/compress-image/tests/review.html)
   to repeat the checks inside a real 390px iframe viewport.

The harness uses real file inputs/drop events, module workers, browser decoding,
canvas encoders, and ZIP generation. It stubs usage tracking. Final clipboard
and download callbacks are intercepted; system clipboard permissions and files
written to Downloads are not verified.

Checks cover lossless defaults; explicit batch compression; identical decoded
RGBA including transparency; text metadata removal; independently failing
inputs; downloads above 300 KB; real byte totals; linked zoom and keyboard pan;
matching cursor positions; overlay clipping/divider position; opt-in WebP;
JPEG drop input; resizing with aspect ratio preserved; invalid resize bounds;
unsupported WebP encoding preserving the previous result; cancellation;
individual PNG output; duplicate ZIP filenames; and horizontal viewport fit.
Synthetic color-study fixtures are test data, not representative compression
benchmarks. Current sample: 1.02 MB becomes 120.21 KB (88.3% smaller); observed
savings vary with encoding and image content.

## Automated checks

```sh
./node_modules/.bin/vitest run frontend/tools/compress-image/tests/service.test.js
./node_modules/.bin/vitest run frontend/core/tests/tool-usage-coverage.test.js frontend/components/tests/sidebar.test.js frontend/core/tests/router.test.js
./node_modules/.bin/eslint frontend/tools/compress-image frontend/config/toolDefinitions.js
./node_modules/.bin/vite build
```

Results: 22 service tests, 6 integration tests, 26 browser checks pass. ESLint
and production Vite build pass. Vite reports existing mixed-import and large
chunk warnings. This is not the full suite or `npm run build` prebuild checks.
The changed size-limit expectations were written and observed failing before
implementation. E2E behavior scenarios were authored before the UI rewrite.

The full app route was opened through General → Compress Image and its empty
state inspected. Batch behavior was verified in the harness, not the full app
shell. A later full-app OS file chooser attempt was interrupted by dev-server
reload and timed out; it does not count as file-picker integration proof.
Packaged Tauri, Safari, Firefox, real touch devices, interlaced/16-bit/profile
fixtures, and animation rejection in WebP have not been exercised here.

## Design evidence

Desktop and 390px iframe screenshots were inspected together. Mobile results
show Before, After and Saved in a compact grid. Side by side opens first;
zoom/pan and cursor positions are linked. An independent finish reviewer gave
**ship** for the inspected UI/source scope, with no material fixes. Its captures
showed one successful PNG; expanded three-file cases were exercised afterward.
See [design-review.md](./design-review.md) for inherited design conventions and
[comparison-result.png](./comparison-result.png) for the final browser artifact.

Impeccable's detector ran once. Its only warnings were image templates without
static `src`; every source is assigned synchronously from validated object URLs
before paint. The checkerboard is functional transparency visualization.

## Compression contract

- Lossless PNG uses installed Pako 1.0.11, three DEFLATE strategies, and existing
  filtered scanlines. Original dimensions and all rendering/profile chunks are
  retained byte-for-byte; inflated scanlines are compared byte-for-byte.
  Only `tEXt` comments may be removed. Output is never larger than the input.
- Already optimized files may show no savings and retain their original bytes.
  There is no arbitrary 300,000-byte download restriction.
- Lossy uses the browser's WebP encoder with explicit quality. Actual MIME and
  decoded dimensions must match; silent PNG fallback is rejected. Full-size
  outputs that are larger retain the source instead. JPEG and still WebP are
  accepted here; strict lossless mode is PNG-only.
- Resize is opt-in, fits maximum width/height, preserves aspect ratio to integer
  pixel precision, and never upscales. Canvas converts to sRGB and changes
  pixels. The UI does not claim equivalence to original pixels after resizing.
- Failed reprocessing keeps the previous successful downloadable result and
  states that it was kept. Clear cancels the worker and releases object URLs.

Input bounds: 20 files, 32 MiB each, 128 MiB total; 16 megapixels and 16,384 px
per side; 64 MiB inflated PNG data; 60-second worker timeout. All image processing
stays on-device. No server upload or backend change is required.

## Library research and dependency handoff

[OxiPNG](https://github.com/oxipng/oxipng) is a dedicated lossless PNG optimizer
with filter/encoding optimization beyond the current Pako path.
[@jsquash/oxipng](https://github.com/jamsinclair/jSquash/tree/main/packages/oxipng)
provides its browser WebAssembly integration, derived from Squoosh. Its
`optimiseAlpha` option must be false for an exact-pixel contract. Integration
must also verify sample values and rendering/profile preservation rather than
assuming every optimization preserves source metadata.

The package is not installed. AGENTS.md prohibits agent dependency installation;
no package, binary or WASM was downloaded. For this next optimization upgrade,
the user must run:

```sh
npm install --save-exact @jsquash/oxipng
```

Installation alone does not enable OxiPNG: worker integration, WASM bundling and
preservation verification remain necessary afterward. No placeholder OxiPNG
integration is shipped.

[WebP compression](https://developers.google.com/speed/webp/docs/compression)
and [canvas toBlob](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob)
document the lossy encoder and browser-dependent encoding behavior.
UI review used the current
[Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md).
