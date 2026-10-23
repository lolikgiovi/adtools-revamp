import { optimizePng, encodePng } from "./png-codec.js";
import { PRESETS, WEBP_LOSSLESS } from "./config.js";
import { validatePng, parsePng, makeChunk } from "./service.js";
import jpegWasm from "@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm?url";
import webpWasm from "@jsquash/webp/codec/enc/webp_enc.wasm?url";
import webpSimdWasm from "@jsquash/webp/codec/enc/webp_enc_simd.wasm?url";
import quantWasm from "libimagequant-wasm/wasm/libimagequant_wasm_bg.wasm?url";

const report = (stage, details = {}) => self.postMessage({ log: { stage, details } });
let jpegReady, webpReady, quantReady;
async function jpegEncoder() {
  if (!jpegReady) {
    report("Loading optimizer", { codec: "MozJPEG" });
    jpegReady = import("@jsquash/jpeg/encode.js").then(async (module) => {
      await module.init({ locateFile: () => jpegWasm });
      return module.default;
    });
  }
  return jpegReady;
}
async function webpEncoder() {
  if (!webpReady) {
    report("Loading optimizer", { codec: "libwebp" });
    webpReady = import("@jsquash/webp/encode.js").then(async (module) => {
      await module.init({ locateFile: (path) => (path.includes("simd") ? webpSimdWasm : webpWasm) });
      return module.default;
    });
  }
  return webpReady;
}
async function quantizationEngine() {
  if (!quantReady) {
    report("Loading optimizer", { codec: "libimagequant" });
    quantReady = import("libimagequant-wasm/wasm/libimagequant_wasm.js").then(async (module) => {
      await module.default({ module_or_path: quantWasm });
      return module;
    });
  }
  return quantReady;
}
// Structure only: the bytes come from a codec, and the final Oxipng output is fully validated.
function srgbPng(bytes) {
  const parsed = parsePng(bytes);
  const parts = [bytes.subarray(0, 33), makeChunk("sRGB", new Uint8Array([0]))];
  for (const chunk of parsed.chunks.slice(1)) {
    if (!["sRGB", "gAMA", "cHRM", "iCCP"].includes(chunk.type)) parts.push(chunk.raw);
  }
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
async function quantize(image, options) {
  const engine = await quantizationEngine();
  const quantizer = new engine.ImageQuantizer();
  let quantized;
  try {
    quantizer.setMaxColors(options.maxColors);
    quantizer.setSpeed(options.speed);
    // Measure the achieved quality ourselves so a missed floor is a normal
    // fallback, while actual codec exceptions still propagate as failures.
    quantizer.setQuality(0, options.quality.target);
    report("Quantizing", { codec: "libimagequant", ...options });
    quantized = quantizer.quantizeImage(image.data, image.width, image.height);
    const quality = quantized.getQuantizationQuality() * 100;
    if (!Number.isFinite(quality) || quality < options.quality.min) {
      report("png.quality-fallback", { quality, minimum: options.quality.min });
      return null;
    }
    const indices = quantized.getPaletteIndices(image.data, image.width, image.height);
    const palette = quantized.getPalette();
    const bytes = engine.encode_palette_to_png(indices, palette, image.width, image.height);
    report("png.quantized", { quality, colors: palette.length, outputBytes: bytes.length });
    return { bytes: srgbPng(bytes), quality, colors: palette.length };
  } finally {
    quantized?.free();
    quantizer.free();
  }
}

self.onmessage = async ({ data }) => {
  try {
    const { type, image, resized, lossyPng, losslessWebp, preset, quality, pngQuality } = data;
    const options = PRESETS[preset];
    if (!options) throw new Error("Unknown compression preset.");
    const source = new Uint8Array(data.bytes);
    let result;
    if (type === "image/png") {
      const input = validatePng(source, report, "source");
      result = resized ? await encodePng(image, options.png, report) : await optimizePng(source, options.png, report, input);
      if (resized) result.bytes = srgbPng(result.bytes);
      result.lossy = false;
      result.codec = "Oxipng";
      if (lossyPng && input.chunks[0].data[8] !== 16) {
        const quantized = await quantize(image, { ...options.quantize, quality: pngQuality });
        if (quantized) {
          const lossy = await optimizePng(quantized.bytes, options.png, report, parsePng(quantized.bytes));
          report("png.candidates", { losslessBytes: result.bytes.length, lossyBytes: lossy.bytes.length, quality: quantized.quality });
          result = {
            ...result,
            bytes: lossy.bytes,
            baseline: result.bytes,
            lossy: true,
            codec: "libimagequant → Oxipng",
            quantizationQuality: quantized.quality,
          };
        } else result.fallbackReason = "PNG quality floor could not be met; lossless result used.";
      } else if (lossyPng) {
        result.fallbackReason = "16-bit PNG kept on the lossless path.";
        report("png.lossless-fallback", { reason: result.fallbackReason });
      }
    } else {
      const codec = type === "image/jpeg" ? "MozJPEG" : "libwebp";
      const encode = type === "image/jpeg" ? await jpegEncoder() : await webpEncoder();
      const lossless = type === "image/webp" && losslessWebp && !resized;
      const settings = lossless
        ? { ...options.webp, ...WEBP_LOSSLESS }
        : { ...(type === "image/jpeg" ? options.jpeg : options.webp), quality };
      report("Encoding", { codec, ...settings, width: image.width, height: image.height });
      const bytes = new Uint8Array(await encode(image, settings));
      result = { bytes, width: image.width, height: image.height, codec, lossy: !lossless, metadataRemovedBytes: 0 };
    }
    result.type = type;
    const transfers = [...new Set([result.bytes.buffer, ...(result.baseline ? [result.baseline.buffer] : [])])];
    self.postMessage({ result }, transfers);
  } catch (error) {
    self.postMessage({ error: error.message || "Unable to process this image." });
  }
};
