# Compress Image verification

Verified locally on 2026-10-21.

## Repeat the browser checks

1. Run `npm run dev -- --host 127.0.0.1` from the repository root.
2. Open http://127.0.0.1:1234/tools/compress-image/tests/browser.html.
3. Wait for **PASS: 21 browser checks** above the tool.

The page creates deterministic PNG fixtures locally, selects six files through
the multiple-file input, and exercises the real module worker, browser decoder,
preview controls, diagnostics and ZIP generation. No images are uploaded.

Verified outcomes:

- A 410.06 KB transparent PNG becomes 1.23 KB with unchanged rendered RGBA.
- A small PNG, including its text comment, remains byte-identical.
- An incompressible PNG remains blocked; invalid PNG and incorrect MIME inputs
  fail independently of other files.
- An 800 × 500 PNG with a 343,421-byte `tEXt` chunk becomes 3,787 bytes after
  metadata removal, with identical browser-rendered RGBA and its sRGB chunk intact.
- The status reports removed text bytes. Logs stream each candidate size and
  timing, verification, and the exact size-limit decision.
- Preview images decode, overlay mode and its slider respond, and ZIP generation
  includes only the three eligible files.
- Copy log exports structured JSON without image payloads or metadata contents.

The harness intercepts final clipboard and download callbacks to inspect payloads
and ZIP contents. System clipboard permissions and files written to Downloads are
not tested.

Screenshots: [metadata-result.png](./metadata-result.png),
[logging-result.png](./logging-result.png), [browser-result.png](./browser-result.png).
The latter two screenshots document earlier iterations.

## Automated checks

```sh
./node_modules/.bin/vitest run frontend/tools/compress-image/tests/service.test.js
./node_modules/.bin/eslint frontend/tools/compress-image
./node_modules/.bin/vite build
```

Latest results: **11 service tests and 21 browser checks pass**. ESLint and the
production Vite build pass, including the compression worker. The build reports
existing large-chunk and mixed-import warnings. This is not the full repository
test suite or `npm run build` prebuild checks.

Both diagnostic logging and text removal were covered with failing regression
tests before implementing their fixes. Service checks also verify byte-identical
retained chunks, decoded RGBA, unchanged original input, corruption/APNG rejection,
the exact 300,000-byte boundary and preservation of unknown ancillary chunks.

Earlier integration checks passed for tool-use coverage, sidebar and router:

```sh
./node_modules/.bin/vitest run frontend/core/tests/tool-usage-coverage.test.js frontend/components/tests/sidebar.test.js frontend/core/tests/router.test.js
```

## Implementation boundaries

This standalone **General → Compress Image** tool produces local PNG or ZIP
downloads. Existing backend upload flows are unchanged.

The optimizer uses the installed Pako 1.0.11 dependency. Files already below
300,000 bytes are returned unchanged after validation. For larger files, it
removes only `tEXt` comments, then tries three DEFLATE strategies over the existing
filtered scanlines. A metadata-only candidate ensures that recompression never
undoes savings from removed comments. Every retained non-IDAT chunk and all
inflated scanlines must compare byte-identically before enabling downloads.
The original source file is never mutated.

`tEXt` stores textual information, separately from PNG rendering information:
https://www.w3.org/TR/png-3/#11tEXt.

Color profiles, palette, transparency, EXIF, other text formats (`zTXt`, `iTXt`)
and unknown ancillary chunks remain intact. No resizing, quantization, canvas
re-encoding or PNG filter changes occur. This can achieve less reduction than a
full PNG optimizer. A browser decode and dimension check must also succeed.

The strict limit is **less than 300,000 bytes**. Files that cannot meet it remain
unavailable for successful PNG/ZIP download. Per-image Processing log and Copy log
controls and `[Compress Image]` console events expose validation, chunk byte
counts, metadata removal, DEFLATE candidates, integrity checks, browser decoding,
timeout/cancellation/failure and the final decision. Logs omit filenames, image
buffers, metadata contents and Base64 payloads, and are not sent to a logging service.

Input limits: 20 files, 32 MiB per file, 128 MiB per batch, 16 megapixels and
16,384 pixels per dimension, 64 MiB inflated scanline data, and a 60-second worker
timeout. Clearing/unmounting cancels the worker and releases object URLs. APNG is
rejected. Safari/Firefox, interlaced, 16-bit and ICC-profile fixture coverage have
not been independently exercised in this verification run.

## Reported 400 KB image

The supplied log identifies 343,421 bytes of `tEXt` metadata and 56,534 bytes of
IDAT data. The earlier implementation preserved the text and returned 399,514
bytes. Removing that chunk from the same best candidate predicts **56,093 bytes**.
The original file has not been attached, so this exact output size is inferred
from the log. Browser verification uses a separate 800 × 500 fixture with the
same text overhead and verifies identical rendered pixels after removal.
