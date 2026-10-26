# Compression target workflow verification

Verified on 2026-10-26.

## Repeat the browser check

1. Run `npm run dev`.
2. Open `http://localhost:1234/tools/compress-image/tests/target-workflow-check.html`.
3. Wait for `PASS: 18 checks`. The page generates a deterministic PNG, runs the real WASM codecs through the worker pool,
   types targets via input events while retaining field focus, fits the image below 1,000 bytes, and submits the Base64 format segment.
4. Add `?workers=3&preview` to exercise three workers even in a narrow browser panel and leave the download dialog open for inspection.

The harness clears its own cached image batch and resets the target before running. Use the test page's development origin;
this check must not be run against production storage.

## Results

- Default narrow-panel pool: PASS, 18 checks, peak worker concurrency 1.
- Explicit parallel pool: PASS, 18 checks, peak worker concurrency 3.
- Screenshot: `target-workflow-download.png`.
- `./node_modules/.bin/vitest run frontend/tools/compress-image/tests`: 9 files, 81 tests passed.
- `npm run test:ci`: 1,825 passed, 2 failed. Failures are in unchanged analytics tab ordering
  (`backend-workers/tests/analytics.test.js:900`) and publication rollback (`frontend/core/tests/published-settings.test.js:47`).
- `./node_modules/.bin/vite build`: passed. This runs bundling directly without the version-mutating prebuild hook.
- UI detector reported only incumbent preview image templates whose blob sources are assigned after rendering.

The browser checks cover: waiting for PNG's second encoding, temporary loading states, input-before-blur handling,
existing output fitting a larger target, oversized output blocking exports, direct adjustment without recompression,
real target encoding, aspect ratio, re-enabling exports, both format segments, Base64 submission, and page overflow.

## Fitting method

The API was already asynchronous: codecs execute in Web Workers, while the dimension search awaited each probe sequentially.
The search now uses binary search for a one-worker pool and evenly spaced parallel probes for larger pools (up to three).
Each result narrows the interval; all actual encoding jobs still use the existing memory-budgeted pool. The final output is
encoded and verified against the strict byte target at the configured quality floor.

Parallel probes reduce dependent search rounds but do more encodes. They are not guaranteed to improve elapsed time for small
images or cold workers. The tiny fixture took 206 ms with one worker and 268 ms with three in separate runs; these are
functional smoke timings, not a controlled performance benchmark. Larger-image speedups require representative benchmarks.

As with the prior binary search, this method assumes encoded size broadly increases with dimensions. Codec output can be
non-monotonic: the search keeps the largest verified fitting probe it finds, rather than exhaustively encoding every pixel size.
