import init, { optimise, optimise_raw } from "@jsquash/oxipng/codec/pkg/squoosh_oxipng.js";
import wasmUrl from "@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm?url";
import { PRESETS } from "./config.js";
import { validatePng, removePngText, verifyPngMetadata } from "./service.js";

let ready;
async function load(report) {
  if (!ready) {
    report("Loading optimizer", { codec: "Oxipng", threads: 1 });
    ready = init(wasmUrl);
  }
  await ready;
}

// Pass `source` when the caller already parsed or validated `bytes`.
export async function optimizePng(bytes, options = PRESETS.balanced.png, report = () => {}, source = validatePng(bytes, report, "source")) {
  const cleaned = removePngText(bytes, source);
  await load(report);
  report("Optimizing", { codec: "Oxipng", ...options, inputBytes: bytes.length });
  const candidate = optimise(cleaned.bytes, options.level, options.interlace, false);
  report("Verifying", { codec: "Oxipng", outputBytes: candidate.length });
  const output = validatePng(candidate, report, "output");
  if (output.width !== source.width || output.height !== source.height) throw new Error("PNG dimensions changed during optimization.");
  verifyPngMetadata(source, output);
  const best = candidate.length < cleaned.bytes.length ? candidate : cleaned.bytes;
  report("png.verified", { outputBytes: best.length, removedTextBytes: cleaned.removedBytes, width: source.width, height: source.height });
  return { bytes: best, width: source.width, height: source.height, metadataRemovedBytes: cleaned.removedBytes };
}

export async function encodePng(image, options, report) {
  await load(report);
  report("Encoding", { codec: "Oxipng", ...options, resized: true });
  const bytes = optimise_raw(image.data, image.width, image.height, options.level, options.interlace, false);
  validatePng(bytes, report, "output");
  return { bytes, width: image.width, height: image.height, metadataRemovedBytes: 0 };
}

// Oxipng stores images with at most 256 colors as a palette and gray images as grayscale,
// far below what an RGBA estimate predicts. Stops scanning once neither can apply.
function reducibleByOxipng(data) {
  const colors = new Set();
  let gray = true;
  for (let i = 0; i < data.length && (gray || colors.size <= 256); i += 4) {
    if (gray && (data[i] !== data[i + 1] || data[i] !== data[i + 2])) gray = false;
    if (colors.size <= 256) colors.add(((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]) >>> 0);
  }
  return gray || colors.size <= 256;
}

// Estimates the lossless PNG size of RGBA pixels: per-row adaptive filtering (smallest sum of
// absolute values, as libpng does) and the browser's native deflate. Returns null without
// CompressionStream, or for palette and gray images, so callers run the full Oxipng pass.
export async function estimateLosslessBytes(image) {
  if (typeof CompressionStream !== "function") return null;
  const { data, width, height } = image;
  if (reducibleByOxipng(data)) return null;
  const stride = width * 4;
  const filtered = new Uint8Array((stride + 1) * height);
  const candidates = Array.from({ length: 5 }, () => new Uint8Array(stride));
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? data[row + x - 4] : 0;
      const b = y ? data[row - stride + x] : 0;
      const c = y && x >= 4 ? data[row - stride + x - 4] : 0;
      const value = data[row + x];
      const p = a + b - c;
      const pa = Math.abs(p - a),
        pb = Math.abs(p - b),
        pc = Math.abs(p - c);
      candidates[0][x] = value;
      candidates[1][x] = value - a;
      candidates[2][x] = value - b;
      candidates[3][x] = value - ((a + b) >> 1);
      candidates[4][x] = value - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
    }
    let best = 0,
      bestSum = Infinity;
    for (let filter = 0; filter < 5; filter++) {
      let sum = 0;
      const candidate = candidates[filter];
      for (let x = 0; x < stride; x++) sum += candidate[x] < 128 ? candidate[x] : 256 - candidate[x];
      if (sum < bestSum) {
        bestSum = sum;
        best = filter;
      }
    }
    filtered[y * (stride + 1)] = best;
    filtered.set(candidates[best], y * (stride + 1) + 1);
  }
  const stream = new CompressionStream("deflate");
  const writer = stream.writable.getWriter();
  const written = writer.write(filtered).then(() => writer.close());
  const reader = stream.readable.getReader();
  let bytes = 0;
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) bytes += chunk.value.byteLength;
  await written;
  return bytes;
}
