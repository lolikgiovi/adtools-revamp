# Compress Image: compression and performance plan

Status: proposed, 2026-10-23. Nothing here is implemented yet.

Scope: `frontend/tools/compress-image/`. This plan covers five quick wins, moving decoding off the main thread, and
running images in a worker pool. It does not add dependencies. A lossless JPEG step (jpegtran-style) and a
perceptual quality search are out of scope and listed at the end.

## Goals and success criteria

All numbers are measured with the benchmark harness from phase 0, on the same machine, before and after.

| Area                                                         | Today                                                  | Target                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------- |
| Lossless PNG, all presets                                    | Levels 2/3/4: 31 s / 73 s / 94 s for the benchmark set | Level 2 everywhere: about 31 s, within 0.2 points of today's best size |
| PNGs with an ICC profile                                     | Fail with an error                                     | Compress like any other PNG                                            |
| PNG decompressions per image, lossless path                  | 4 (2 on the main thread)                               | 2, none on the main thread                                             |
| PNG decompressions per image, lossy path                     | 8 (2 on the main thread)                               | 3, none on the main thread                                             |
| Longest main-thread stall during a batch of 10 × 12 MP JPEGs | Not measured (expected several hundred ms per image)   | Under 100 ms                                                           |
| Wall time, mixed batch of 10 images, 4+ core Mac             | Baseline                                               | At least 40% faster                                                    |
| Lossless WebP input, no resize                               | Re-encoded lossy                                       | Stays lossless                                                         |

"Decompressions" means full `pako` inflates through `validatePng`. Current count for lossless PNG: worker source
check, `optimizePng` source check, Oxipng output check, then main-thread `validatePng` on the result. With lossy
PNG on, add the `srgbPng` check, two more inside the second `optimizePng`, and the main-thread check on the
baseline.

## Ground rules

These come from `AGENTS.md` and the existing verification contract in `tests/verification.md`.

- **Tests first.** For each phase, write down the failure modes, add the browser checks to `tests/browser.js` and
  watch them fail, then implement. Unit tests only where the browser harness can't reach (`config.js` policy).
- **The browser harness is the end-to-end test.** `tests/browser.html` must keep showing `PASS: N browser checks`
  in the dev server, the production-asset preview, and the 390px review page.
- **Keep every existing safety guarantee.** That means: strict PNG stream validation (WebKit accepts corrupt zlib),
  dimension and format checks on every candidate, the input limits, the acceptance thresholds in `selectCandidate`,
  and "a failure keeps the previous result".
- **One phase per commit.** Each phase leaves the tool shippable. Phase 2 changes the worker message format, and
  phase 3 builds on it, so the order is fixed: 0 → 1 → 2 → 3.
- **Update `tests/verification.md`** at the end of each phase with what was run and observed.

## Phase 0: Baseline benchmark

The existing fixtures are synthetic correctness data and say so. Size and speed claims need real images.

1. **Get real images.** The user puts 10–20 representative ad images in
   `frontend/tools/compress-image/tests/bench-images/` (gitignored). The set should include large photographic
   JPEGs, flat-color PNG banners, PNGs with transparency, at least one 12+ MP image, and one lossless WebP. The
   agent cannot download images.
2. **Add `tests/benchmark.html` and `tests/benchmark.js`.** The page mounts `CompressImage`, loads every file from
   `bench-images/` (through a Vite `import.meta.glob` with `?url`), and runs each preset with lossy PNG off and on.
3. **Record per image:** input and output bytes, outcome, total time, time per stage (from the existing `item.logs`
   elapsed times), and the number of `validatePng` calls (phase 1 adds a log stage for this).
4. **Measure main-thread stalls** with a `requestAnimationFrame` loop that records the largest gap between frames
   while the batch runs. WebKit has no Long Tasks API, so this is the portable measure.
5. **Write the output** as JSON to the page and offer a "Copy results" button. Commit the baseline run as
   `docs/evidence/compress-image-benchmark-baseline.json`, with the machine, browser and commit hash in it.

Phase 0 changes no product code.

### Baseline result (2026-10-23)

Evidence: `docs/evidence/compress-image-benchmark-baseline.json`. 16 RGBA PNG card designs, 34.5 MB, up to 3.7 MP.
Headless Chrome for Testing 153, 8 cores. No JPEG, WebP or 12+ MP inputs, so those targets are still unmeasured.

| Scenario                          | Wall time | Saved  | Slowest image | Longest main-thread stall |
| --------------------------------- | --------- | ------ | ------------- | ------------------------- |
| High, lossless (Oxipng 2)         | 31 s      | 9.42%  | 7.9 s         | 267–409 ms                |
| Balanced, lossless (Oxipng 3)     | 73 s      | 9.54%  | 17.2 s        | 150 ms                    |
| Smaller File, lossless (Oxipng 4) | 94 s      | 9.59%  | 23.2 s        | 150 ms                    |
| High, lossy PNG                   | 45 s      | 63.48% | 10.4 s        | 150 ms                    |
| Balanced, lossy PNG               | 106 s     | 70.78% | 25.5 s        | 150 ms                    |
| Smaller File, lossy PNG           | 130 s     | 75.56% | 32.8 s        | 150 ms                    |

What it changes:

- **Oxipng level: use 2, not 4.** Level 4 saves 0.17 points more than level 2 and takes three times as long.
  On a 3.7 MP image, level 4 plus lossy already takes 33 s, so a 16 MP image would hit the 60 s timeout.
- **Lossy PNG is where the savings are:** 63–76% against 9–10% lossless. In Balanced it beat the lossless
  result on 15 of 15 images. This supports 1.6.
- **Main-thread work for lossless PNG** averages 120 ms of unneeded decoding plus 110 ms of verification per image
  (1.4 and 1.5).
- **New bug, fixed first (1.0):** the one input with an `iCCP` color profile fails in every scenario.

## Phase 1: Quick wins

### 1.0 PNGs with an ICC profile fail instead of compressing

**Problem.** `virtual-serentaun.png`, the only benchmark input with an `iCCP` chunk, ends in Error in all six
scenarios: "PNG metadata changed during lossless optimization." Likely cause, still to be confirmed: Oxipng
recompresses or rewrites the `iCCP` chunk, and `verifyPngMetadata` compares metadata byte for byte. The whole
image then fails, even though the color profile is unchanged.

**Change.** Confirm the cause with a failing test first. Then compare `iCCP` by profile name and _decompressed_
profile bytes instead of raw chunk bytes. If Oxipng turns an sRGB profile into an `sRGB` chunk, accept that only
when the profile really is sRGB. Otherwise disable that conversion.

**Tests first.** Browser check: a PNG with an embedded `iCCP` profile compresses without error, keeps an equivalent
profile, and decodes to the same pixels.

### 1.1 One Oxipng level for every preset

**Problem.** `PRESETS` maps High Quality / Balanced / Smaller File to Oxipng levels 2 / 3 / 4 (`config.js:16`). The
level only sets compression effort. Every level is lossless, so the presets differ only in how long they take.

**Change.** Give `preset()` a fixed PNG level instead of taking it as a parameter. Presets then differ only in
JPEG/WebP quality, WebP method and quantization bounds. The baseline picked level 2: level 4 saved 9.59% against
9.42% and took 94 s against 31 s.

**Tests first.** Update `optimizer-policy.test.js` so it expects the same `png.level` in all three presets, and
watch it fail. Add a browser check: the same lossless PNG fixture through High Quality and Smaller File gives
byte-identical output.

### 1.2 Alpha optimization on the lossy PNG path: dropped

**Measured, not implemented (2026-10-23).** Alpha optimization saved 0 bytes on the lossy path for all 16 benchmark
images. The lossy candidate is a palette image, and the browser canvas already reads fully transparent pixels as
`0,0,0,0`, so Oxipng has nothing to rewrite. On the lossless path it ranged from −0.03% to +0.21%, and that path
must keep transparent RGB unchanged anyway. `optimiseAlpha` stays `false` everywhere.

Evidence: `docs/evidence/compress-image-alpha-optimization-probe.txt`. Reproduce with
`node frontend/tools/compress-image/tests/alpha-optimization-probe.mjs`.

### 1.3 Lossless WebP stays lossless: done

**Problem.** `inspectWebp` returned `lossless: true` for VP8L input (`image-info.js:61`), but nothing used it. Every
WebP was re-encoded with `lossless: 0`.

**Change (implemented 2026-10-23).**

- If the source is lossless and not resized, the worker uses `WEBP_LOSSLESS` from `config.js`: `lossless: 1`,
  `exact: 1`, `quality: 90`, `method: 5`. The result counts as lossless, so it is kept only if it is smaller than
  the original.
- The JPEG/WebP quality slider does not apply. The detail text says "Lossless WebP kept lossless, relative to the
  browser-decoded pixels."
- Resizing still uses the lossy path, because the pixels change anyway.

**Effort setting.** No WebP files are in the benchmark set, so the 16 benchmark PNGs were encoded as lossless WebP
from their decoded pixels. q90/m5 was 1.8% smaller than libwebp's default q75/m4 at 1.8× the time (26.9 s against
14.9 s for the set). q100/m6 saved another 1.3% but took 11× longer (294 s), with one image at 30 s. Evidence:
`docs/evidence/compress-image-webp-lossless-effort.txt`.

**Caveat.** Pixels come from the browser decoder, which uses premultiplied alpha. Semi-transparent pixels can shift
by one step, and an embedded ICC profile is converted to sRGB. The output is "lossless relative to decoded pixels".

**Browser checks added (written first; the harness failed at "Lossless WebP input stays lossless WebP"):** VP8L in,
VP8L out; identical decoded pixels; libwebp lossless in the log; detail text says lossless; the quality slider
doesn't change the output; never larger than the original; resize switches to lossy at the target size.

### 1.4 No main-thread decode for lossless PNG

**Problem.** `compressItem` always runs `new Image()` and `image.decode()` (`main.js:260-262`) just to read width
and height. `inspectImage` already returned them. For lossless PNG without resize, the pixels are never used.

**Change.** When `info.type === "image/png"`, resize is off and lossy PNG is off, take `width` and `height` from
`info` and skip the `<img>` decode. Phase 2 replaces this path entirely, but this fix is small and lands first.

**Tests first.** Browser check: wrap `HTMLImageElement.prototype.decode` and count calls during a lossless PNG
batch. Expected: zero calls before the result preview is shown.

### 1.5 Validate each PNG once

**Problem.** The same data is decompressed many times (see the table above). Two of those runs are on the main
thread, so the page freezes. `crc32` also loops with `for...of` over a `Uint8Array`, which is slow.

**Change.**

1. **Validate the worker's input once.** The worker calls `validatePng(source)` once and passes the parsed result
   down. `optimizePng(bytes, options, report, parsed)` uses `parsed` when it's given, so it skips its own source
   check.
2. **Reuse that parse in `removePngText`.** It takes the parsed chunks instead of parsing again.
3. **Make `srgbPng` parse only.** Use `parsePng` (structure and checksums, no decompression). Its output goes
   straight into `optimizePng`, whose Oxipng output is fully validated anyway.
4. **Validate each codec output exactly once, in the worker,** right after Oxipng returns. This is the guard
   against corrupt output that WebKit would still display, and it stays.
5. **Main thread: structure check only.** Replace `validatePng(candidate)` (`main.js:299`) with `inspectImage`,
   which parses the structure without decompressing. Phase 2 moves this check into the worker.
6. **Speed up `crc32`** with an indexed `for` loop.
7. **Log the count.** `validatePng` takes an optional `report` and logs a `png.validated` stage, so tests and the
   benchmark can count calls.

**Tests first.**

- Browser check: count `png.validated` log entries. Expected: 2 for lossless and 3 for lossy.
- **Re-target the existing check** "Invalid candidates preserve prior results and cannot hide behind size
  fallback". Today it stubs `tool.runWorker` to return a PNG whose zlib data is corrupt (its checksums are valid),
  and it relies on the main thread decompressing that data. After this change the guard lives in the worker. The
  harness will instead import `png-codec.js` and call the worker's output gate with the same corrupt bytes. It
  checks two things: the gate throws, and the item ends in `Error` with its previous result kept.
- Vitest (`png-codec.test.js`): `crc32` results are unchanged on the existing fixtures.

### 1.6 Make lossy PNG easier to find (decision needed)

Most of the savings people expect from PNG come from color reduction, and it's currently behind an unchecked box.
**Recommended:** the Smaller File preset turns on "Allow lossy PNG" when selected. The other presets leave it as
the user set it. The safety net stays: quality floor, comparison against the lossless result, and the visual
comparison. Other options are to turn it on by default, or to only make the toggle more visible.

**Tests first.** Browser check: choosing Smaller File checks the lossy PNG toggle and shows the PNG quality fields.
Choosing Balanced afterwards does not uncheck it.

### Not changing in phase 1: lossless-before-lossy order

The worker always runs lossless Oxipng before the lossy pass, even though the lossy result usually wins. Skipping
it would change the acceptance policy ("lossy must beat the best lossless result"), so it stays. Phase 3 makes
running both candidates at once possible.

## Phase 2: Decoding and resizing in the worker

### Target flow

1. **Main thread:** `worker.postMessage({ file, settings })`. A `File` is structured-cloned by reference, so the
   main thread no longer reads the bytes.
2. **Worker, preflight:** `bytes = await file.arrayBuffer()`, then `inspectImage(bytes)` before any large
   allocation.
3. **Worker, decode:** only when pixels are needed (JPEG/WebP, resize, or lossy PNG):
   `bitmap = await createImageBitmap(file, { imageOrientation: "from-image", premultiplyAlpha: "none",
colorSpaceConversion: "default" })`.
4. **Worker, resize and read pixels:** draw into an `OffscreenCanvas` at the target size with
   `getContext("2d", { colorSpace: "srgb" })`, `imageSmoothingQuality = "high"`, then `getImageData`. This matches
   today's resampling.
5. **Worker, encode and validate** as in phase 1.
6. **Worker, check that the output displays:** `createImageBitmap(new Blob([output]))` must succeed with the target
   dimensions. This replaces the second `<img>` decode on the main thread (`main.js:307-312`).
7. **Main thread:** receives the result bytes and creates the object URLs for the previews. The `<img>` elements
   in the comparison view decode on their own, asynchronously.

### Module changes

- **New `decode.js`** with `decodePixels(file, target)` and `checkDisplayable(bytes, type, target)`. The worker
  uses it, and the main thread can use the same file for the fallback.
- **`worker.js` takes a new message format.** It receives `{ file, preset, quality, lossyPng, pngQuality, resize,
width, height }`. The worker computes `fitDimensions`, `resized` and the pixels itself. It returns
  `{ result: { bytes, baseline?, width, height, originalWidth, originalHeight, resized, type, ... } }`.
- **`main.js`, `compressItem`, shrinks to:** start the job, then run `selectCandidate` and update the UI from the
  sizes the worker reports. The canvas, `Image` decode and `getImageData` move out. `before` still points to the
  `File`'s object URL.

### Fallback

The app ships in desktop WebKit (Tauri) as well as browsers, so the worker can't assume decoding works there. At
worker start it checks for `createImageBitmap`, `OffscreenCanvas`, and a 2D context on a 1×1 canvas. If the check
fails, it replies `{ needsPixels: true }`. The main thread then uses the current `<img>`-plus-canvas path (moved
into `decode.js`) and sends `image` the way it does today. The log records `decoder: "worker"` or
`decoder: "main-thread fallback"`.

### Risks to check explicitly

- **EXIF orientation.** `imageOrientation: "from-image"` has to match what the `<img>` path does. The existing
  "EXIF-rotated JPEG" check covers this.
- **Color management.** `colorSpaceConversion: "default"` should convert an ICC-tagged (for example Display P3)
  source to sRGB, the same way the canvas path does today. Add a check with a P3 fixture. If it can't be generated
  in the browser, ask the user for one.
- **Semi-transparent pixels.** `premultiplyAlpha: "none"` with a 2D canvas still goes through premultiplied
  storage in WebKit. The existing semi-transparent WebP check guards against regressions. The result is
  "no worse than today", not lossless.
- **Memory.** Bitmap, canvas and `ImageData` are now in the worker. Call `bitmap.close()` and set the canvas to 1×1
  in a `finally`, mirroring `main.js:372`.

### Tests first

Failure modes to cover with browser checks before changing code:

1. A batch runs with zero `HTMLImageElement.decode` calls and zero `getImageData` calls on the main thread, until
   the preview is shown.
2. EXIF-rotated JPEG, P3-tagged image, semi-transparent WebP and Adam7 PNG give the same dimensions and pixels
   (within today's tolerance) as on the current path.
3. Forced fallback: the harness starts the worker with a flag that makes the capability check fail. It checks that
   results are identical and that the log says `main-thread fallback`.
4. A corrupt JPEG that fails `createImageBitmap` ends as `Error` with the previous result kept, and the worker
   still works for the next file.
5. Main-thread stall: a `requestAnimationFrame` gap check during a 12 MP JPEG compress stays under 100 ms (at a
   size the harness can generate).

## Phase 3: Worker pool

### Design

New module `worker-pool.js`, owned by `CompressImage`:

```js
const pool = new WorkerPool({ size, memoryBudget, timeoutFor });
const result = await pool.run(job, { onLog, signal });
pool.terminate();
```

- **Size:** `clamp(navigator.hardwareConcurrency - 1, 1, 3)`, or 1 when the viewport is under 768 px (phones).
  Workers start only when there's a job for them.
- **Memory budget:** each job's estimated peak is `width × height × 4 × 4` (bitmap, canvas, `ImageData` and codec
  buffers) plus the file size. Use dimensions from a header-only preflight on the main thread (`inspectImage` on
  the first 64 KB is enough for JPEG/WebP; PNG's IHDR is at a fixed offset). A job starts only if the running total
  stays under the budget: 768 MB on desktop, 256 MB on phones. If nothing else is running, a job always starts, so
  one large image can't get stuck.
- **Per-worker state:** each worker keeps its own codecs cached. WebAssembly memory never shrinks, so after a job
  over 8 MP the worker is replaced. That stops one large image from holding memory for the rest of the batch.
- **Timeout per job:** `15 s + 3 s per megapixel`, capped at 120 s. The clock starts when the worker begins the job,
  not while it's waiting or loading codecs. A timed-out worker is terminated and replaced lazily; the other jobs
  keep running.
- **Cancellation:** `signal` (an `AbortController`) per batch. `clear()` aborts it, which terminates every busy
  worker. This replaces `this.worker` and `this.cancelWorker`.
- **Order:** jobs start in queue order and finish in any order. Each item's row already updates on its own.
  `selectItem` keeps today's rule: show the first finished item unless the user already picked one.

### `main.js` changes

- **`processQueue`** sends every item to the pool and awaits `Promise.allSettled`. Each item still goes Queued →
  Compressing… → Ready or Error. The generation checks stay.
- **`runWorker`** goes away. Its timeout, message and error handling move into `WorkerPool`.
- **Progress:** the summary shows "Compressing 3 of 12…" instead of only "Compressing…".

### Deliberately left out

- **Running the lossless and lossy PNG candidates of one image on two workers at once.** Possible later, but it
  doubles the codec memory for one image.
- **Multithreaded Oxipng.** This needs a threaded WebAssembly build and cross-origin isolation (COOP/COEP headers)
  in Vite, Cloudflare and Tauri. That's a separate project.

### Tests first

Failure modes, as browser checks:

1. **Pool size:** a batch of 6 images uses at most `size` workers, and more than one job runs at the same time on
   a multi-core machine. Measure overlap from the start and end times in the logs.
2. **Warm reuse:** a second batch reuses the same workers. This replaces "A warm worker is reused across files and
   runs".
3. **Budget:** with the budget forced small, two 16 MP jobs never run together, and a single over-budget job still
   finishes.
4. **Isolation:** one corrupt file and one forced timeout in a batch of 5. Only those two fail, and the others
   finish with results identical to sequential runs.
5. **Cancel:** "Clear all" during a batch terminates every worker, leaves no URLs unrevoked, and a new batch then
   works.
6. **Determinism:** output bytes for each fixture are identical between pool size 1 and pool size 3.
7. **ZIP and summary:** totals and ZIP contents are correct when jobs finish out of order.

## Phase 4: Final verification

1. Run `./node_modules/.bin/vitest run frontend/tools/compress-image/tests`, then `npm run test:ci`.
2. Browser harness: dev server, production-asset preview, and `review.html` at 390 px and 768 px, light and dark.
3. Benchmark: run it again and commit `docs/evidence/compress-image-benchmark-after.json`. Write the comparison
   against the goals table into `tests/verification.md`.
4. Tauri: `node frontend/tools/compress-image/tests/build-desktop-verification.mjs`, then open the `.app` and look
   for PASS. The fallback path in phase 2 exists for this environment. If the native result is again inconclusive,
   say so, as the current doc does.
5. Update the "Implemented contract" section of `tests/verification.md` and the Processing details text in
   `main.js` (it currently says processing is sequential, among other things).

## Decisions needed before starting

| Decision                      | Recommendation                                                        |
| ----------------------------- | --------------------------------------------------------------------- |
| Benchmark images (phase 0)    | The user supplies 10–20 real ad images; the agent can't download them |
| Fixed Oxipng level (1.1)      | Level 2. The baseline showed level 4 gains 0.17 points at 3× the time |
| Alpha optimization (1.2)      | Dropped: it saved 0 bytes on the lossy path                           |
| Lossy PNG visibility (1.6)    | Smaller File turns it on; defaults otherwise unchanged                |
| Lossless WebP semantics (1.3) | Done: kept lossless at q90/m5, labeled relative to decoded pixels     |

## Later, not in this plan

- **Lossless JPEG optimization** (strip metadata, rebuild Huffman tables, progressive scan) before or instead of
  re-encoding. Needs a jpegtran WebAssembly build, which is a new dependency for the user to install.
- **Choosing quality per image** (binary search on JPEG/WebP quality against an SSIM or butteraugli target).
  Possible with the existing codecs plus a small JS SSIM, but it multiplies encode time; do it only once the pool
  is in place.
- **Running the lossy PNG pass first** and skipping the lossless pass when it can't win. Needs a change to the
  acceptance policy.
