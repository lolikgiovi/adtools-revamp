# Compress Image verification

Updated 2026-10-22. This supersedes the earlier Pako/browser-WebP contract.

## Implemented contract

| Input | Pipeline | Output |
| --- | --- | --- |
| PNG, default | Oxipng | PNG, lossless |
| PNG, optional color reduction | libimagequant → Oxipng, compared with a separate lossless Oxipng result | PNG |
| JPG/JPEG | Browser orientation/color decoding → MozJPEG | JPG/JPEG, original extension retained |
| WebP | Browser color decoding → libwebp | WebP |

Images stay on-device. All WASM assets are bundled locally. Processing is
sequential in a reusable module worker; single-thread Oxipng does not require
cross-origin isolation headers. Clear/unmount terminates the worker and revokes
object URLs. A codec error preserves any previous successful result.

Balanced is the default. High Quality/Balanced/Smaller File use Oxipng levels
2/3/4, JPEG and WebP quality 92/85/75, WebP method 4/4/5, and PNG quantization
minimum–target values 90–100/80–95/65–85. All presets keep PNG alpha optimization
off. Quantization uses up to 256 colors at speed 4. JPEG/WebP quality and PNG
minimum/target quality can be adjusted separately from the preset. These scores
are codec-specific starting values; compare the actual result visually.

PNG remains lossless unless explicitly enabled. Sixteen-bit PNG stays on the
lossless path. Lossless PNG consumes original bytes directly, removes only
`tEXt` comments, validates PNG structure/CRC/zlib/filter data, and checks that
non-image metadata survives. Oxipng may refilter, change palettes/bit depth, or
deinterlace. Real-WASM tests compare decoded samples including transparent RGB
and full 16-bit precision; identical compressed scanlines are not required.

JPEG/WebP, lossy PNG, and resized images use browser-managed orientation and
sRGB rendering before encoding. These paths do not copy original metadata.
Quantized/resized PNG is explicitly tagged sRGB. Lossy WebP is re-encoded lossy
with alpha quality 100. Lossless (VP8L) WebP stays lossless unless resized
(libwebp lossless, exact, quality 90, method 5), is lossless relative to the
browser-decoded pixels, and is kept only when smaller. Animated PNG/WebP is
rejected. Before/after views and direct original downloads remain available.

Resize is independent and happens before quantization/encoding. It preserves
aspect ratio to integer-pixel precision and never upscales or crops. A requested
resize retains its target dimensions even if its output is larger. PNG encoding
after resize is lossless relative to the resized pixels, not the original.

Every candidate is checked for expected format and dimensions and decoded in
the browser before size acceptance. PNG candidates also undergo strict stream
validation: WebKit may accept a corrupt zlib stream during image decoding, so
browser decode success alone is insufficient. The larger-corrupt-candidate
regression was observed failing before this boundary check was added.

Acceptance:

- Lossless PNG must be strictly smaller than the original; otherwise original
  bytes are retained.
- JPEG/WebP must save at least `max(ceil(originalBytes * 0.01), 1024)` bytes unless
  resizing was explicitly requested.
- Lossy PNG must meet its quality floor and save the same threshold relative to
  the best lossless alternative at the same dimensions. Otherwise that lossless
  result or the original is selected.
- A quality floor that cannot be met is a normal lossless fallback. Actual codec
  or verification errors are reported as failures, never as successful fallback.

Progress uses named stages, not fabricated percentages. Logs record actual
codec/options, quality/fallback decisions, candidate sizes, selected outcome,
and timing, without image payloads. Outcomes distinguish Optimized, Lossy PNG
accepted, Lossless result used, Original kept, and Failed. Unchanged output says
“No worthwhile reduction found. Original kept.”

Input bounds remain 20 files, 32 MiB each, 128 MiB total; 16 megapixels and
16,384 pixels per side; 64 MiB inflated PNG data; 60-second worker timeout.

## Automated checks

Run from the repository root:

```sh
./node_modules/.bin/vitest run frontend/tools/compress-image/tests
npm run test:ci
./node_modules/.bin/eslint frontend/tools/compress-image vite.config.mjs
./node_modules/.bin/prettier --check frontend/tools/compress-image/*.js frontend/tools/compress-image/tests/*.js frontend/tools/compress-image/tests/*.mjs vite.config.mjs
./node_modules/.bin/vite build
./node_modules/.bin/vite build --mode tauri
```

Observed: 31 focused tests pass; the full suite passes 1,545 tests in 131 files.
ESLint, formatting, and production/Tauri-mode Vite builds pass. Vite retains
existing mixed-import/large-chunk warnings. The build emits separate WASM files
for Oxipng, MozJPEG, libwebp (standard/SIMD), and libimagequant. Existing generated
worker constructors, including split/Monaco workers, use module workers under
the shared ES worker configuration.

The new isolated tests were designed and observed failing before implementation.
They cover immutable preset contracts, candidate thresholds/resize behavior,
header preflight, corrupt PNG data, real WASM sample equivalence, metadata/text
handling, and repeated optimization without inflation. Earlier diagnostics tests
for Pako strategy counts were replaced by actual Oxipng behavior checks.

## Browser verification

```sh
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:1234/tools/compress-image/tests/browser.html` and wait for
**PASS: 39 browser checks**. Expand Verification evidence to inspect each result.
For the same checks at a real 390px iframe viewport, open
`http://127.0.0.1:1234/tools/compress-image/tests/review.html`.

Both passed in the in-app WebKit browser. Current production screenshot:
[codec-result.png](./codec-result.png). The harness uses real WASM codecs,
file input/drop events, worker messages, browser decoding, resizing, comparison,
and ZIP generation. Only analytics and final download callbacks are intercepted;
OS file-picker, clipboard permissions and actual files written to Downloads are
not established by this harness.

Checks include lossless defaults, corrupt-input isolation, original downloads,
JPEG extension preservation, both PNG candidates, useful lossy PNG acceptance,
quality-floor fallback, warm-worker reuse, rejection of invalid candidates before
size fallback, EXIF-rotated JPEG, semi-transparent WebP, Adam7 pixel equivalence,
16-bit lossless fallback, aspect-ratio resize, invalid controls, cancellation,
linked zoom/pan/cursors, slider clipping, ZIP collisions, and horizontal fit.
Fixtures are synthetic correctness data, not representative compression benchmarks.

## Production asset verification

```sh
./node_modules/.bin/vite build --mode tauri --config frontend/tools/compress-image/tests/vite.config.mjs
./node_modules/.bin/vite preview --host 127.0.0.1 --port 1235 --strictPort --outDir "$PWD/tauri/target/image-optimizer-verification"
```

Open `http://127.0.0.1:1235/tools/compress-image/tests/browser.html`.
Observed **PASS: 39 browser checks** against production worker/chunk/WASM URLs.
The normal application build does not include the verification HTML entry.

## Packaged desktop verification

Build a dedicated verification application using the same Rust application,
CSP and production frontend assets, with a different bundle identifier and the
verification page as its initial window:

```sh
node frontend/tools/compress-image/tests/build-desktop-verification.mjs
```

The script uses installed tools and offline Cargo mode; it neither installs nor
downloads dependencies. It omits the Oracle sidecar and skips signing. The result
is an unsigned debug `.app`, not a signed/notarized release or installer test.
The verification identifier keeps its browser storage separate from normal AD
Tools. The reused native shutdown handler still cleans up the Oracle sidecar
port, so run this check when no Oracle sidecar is active. Launch the `.app` from `tauri/target/debug/bundle/macos/` and inspect the
same PASS/FAIL result.

Observed: the offline native build succeeded and produced
`tauri/target/debug/bundle/macos/AD Tools Image Optimizer Verification.app`.
The running page was observed at `tauri://localhost/tools/compress-image/tests/browser.html`
and processed real PNG/Oxipng/libimagequant results. The native window initially
rendered blank to the automation interface; opening/closing its inspector made
window targeting unreliable. A clean relaunch also did not yield a conclusive
final PASS/FAIL observation. Therefore native runtime verification remains
inconclusive: the native build and partial native codec execution are not a
claim that the full packaged harness passed. No CSP/security weakening or
application window-behavior changes were made to work around this.

For a manual native check, launch that `.app`, keep its main window in the
foreground, and wait for the same **PASS: 39 browser checks**. This app contains
its assets and needs no development/preview server. This is the remaining
verification boundary; the web/development/mobile harnesses did pass.

## Licensing and release boundary

Application metadata now declares GPL-3.0-or-later, following the user's stated
GPL licensing intent. Root LICENSE includes the GPLv3 terms. Bundled library
notices are under `frontend/public/licenses/image-optimizer/` and accessible from
Processing details. Third-party terms remain separate: jSquash wrappers are
Apache-2.0; codec notices are retained; the libimagequant WASM wrapper is MIT and
its underlying engine is GPL. Installed versions are documented in NOTICE.txt.

No package/WASM/source archive was downloaded by the agent. The user installed
the four dependencies. Before publishing binaries/WASM, prepare corresponding
source and build materials for the exact shipped versions alongside the release;
upstream links alone are not the release source artifact. This task does not
publish a release, sign/notarize an app, or change deployed services.

## UI refinement verification — 2026-10-22

Observed PASS: 44 browser checks at desktop, 768px and 390px in dark mode.
The five new checks cover accessible file-input naming, results/ZIP grouping,
selected-image state, invalid height focus/association and ZIP busy labeling.
All 31 focused Vitest tests, ESLint, formatting and Vite production build pass.
Existing mixed-import and chunk-size build warnings remain.

Reproduce using the existing dev server and these routes:

- `/tools/compress-image/tests/browser.html?theme=dark`
- `/tools/compress-image/tests/review.html?theme=dark`
- `/tools/compress-image/tests/review.html?width=768&theme=dark`

The default routes exercise the light theme. Screenshots from this UI pass:
[dark diagnostics](./ui-refinement-dark.png) and
[390px comparison](./ui-refinement-mobile.png).
Visual inspection included setup, results, comparison and expanded diagnostics.
The detector reported only the same three dynamic-image false positives:
preview sources and dimensions are assigned synchronously after template creation.
This pass establishes browser evidence, not packaged native behavior.

### Setup structure follow-up

After the setup regrouping, desktop and 390px browser harnesses again passed
all 44 checks. ESLint, Prettier, diff whitespace and production Vite build pass.
The layout detector reports zero findings. The empty setup was inspected at
2394px (scaled iframe), native 1280px and 390px. Both optional groups were
expanded at desktop and phone widths. Reproduce the empty state using
`/tools/compress-image/tests/layout.html` and
`/tools/compress-image/tests/review.html?layout&width=2394`.
Screenshot: [corrected setup](./setup-layout-dark.png).
