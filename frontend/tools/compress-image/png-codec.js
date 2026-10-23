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
