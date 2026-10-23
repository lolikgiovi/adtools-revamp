import { optimizePng, encodePng, estimateLosslessBytes } from "./png-codec.js";
import { PRESETS, WEBP_LOSSLESS, skipsLosslessPass } from "./config.js";
import { validatePng, parsePng, makeChunk, fitDimensions } from "./service.js";
import { inspectImage } from "./image-info.js";
import { canDecodeInWorker, decodeBitmap, readPixels, checkDisplayable } from "./decode.js";
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

// A job with `file` is read, inspected, decoded and resized here. Without decoding support,
// or when the main-thread decoder is forced, the worker asks for pixels instead and the main
// thread sends a job with `bytes` and `image`, as before.
async function prepare(data) {
  if (!data.file) {
    return { ...data, source: new Uint8Array(data.bytes), decodedInWorker: false };
  }
  if (data.decoder === "main" || !canDecodeInWorker()) return { needsPixels: true };
  const source = new Uint8Array(await data.file.arrayBuffer());
  report("Validating", {});
  const info = inspectImage(source);
  const decode = async () => {
    report("Decoding", { decoder: "worker", colorSpace: "sRGB", orientation: "from image" });
    return decodeBitmap(data.file);
  };
  let bitmap;
  try {
    // PNG dimensions come from its header. JPEG and WebP are decoded first because
    // orientation can change their displayed size.
    if (info.type !== "image/png") bitmap = await decode();
    const width = bitmap ? bitmap.width : info.width,
      height = bitmap ? bitmap.height : info.height;
    if (!width || !height || width > 16384 || height > 16384 || width * height > 16000000) {
      throw new Error("Choose an image under 16 megapixels and 16,384 pixels per side.");
    }
    const target = data.resize ? fitDimensions(width, height, data.width, data.height) : { width, height };
    const resized = target.width !== width || target.height !== height;
    let image;
    if (info.type !== "image/png" || resized || (data.lossyPng && info.depth !== 16)) {
      bitmap ||= await decode();
      if (resized) report("Resizing", { ...target });
      image = readPixels(bitmap, target);
    }
    return {
      ...data,
      type: info.type,
      source,
      image,
      resized,
      losslessWebp: info.type === "image/webp" && info.lossless,
      originalWidth: width,
      originalHeight: height,
      decodedInWorker: true,
    };
  } finally {
    bitmap?.close();
  }
}

self.onmessage = async ({ data }) => {
  try {
    const job = await prepare(data);
    if (job.needsPixels) {
      self.postMessage({ needsPixels: true });
      return;
    }
    const { type, image, resized, lossyPng, losslessWebp, preset, quality, pngQuality, source } = job;
    const options = PRESETS[preset];
    if (!options) throw new Error("Unknown compression preset.");
    let result;
    if (type === "image/png") {
      const input = validatePng(source, report, "source");
      const lossless = async () => {
        const encoded = resized ? await encodePng(image, options.png, report) : await optimizePng(source, options.png, report, input);
        if (resized) encoded.bytes = srgbPng(encoded.bytes);
        return { ...encoded, lossy: false, codec: "Oxipng" };
      };
      // Lossy first: when it is clearly smaller than the lossless size could be, the slow
      // lossless pass is skipped and the lossy result is compared with the original instead.
      const deep = input.chunks[0].data[8] === 16;
      const quantized = lossyPng && !deep ? await quantize(image, { ...options.quantize, quality: pngQuality }) : null;
      if (quantized) {
        const lossy = await optimizePng(quantized.bytes, options.png, report, parsePng(quantized.bytes));
        const estimate = await estimateLosslessBytes(image);
        const candidate = { ...lossy, lossy: true, codec: "libimagequant → Oxipng", quantizationQuality: quantized.quality };
        if (skipsLosslessPass(lossy.bytes.length, estimate)) {
          report("png.lossless-skipped", { lossyBytes: lossy.bytes.length, estimateBytes: estimate });
          result = { ...candidate, metadataRemovedBytes: 0 };
        } else {
          const baseline = await lossless();
          report("png.candidates", { losslessBytes: baseline.bytes.length, lossyBytes: lossy.bytes.length, estimateBytes: estimate });
          result = {
            ...baseline,
            ...candidate,
            bytes: lossy.bytes,
            baseline: baseline.bytes,
            metadataRemovedBytes: baseline.metadataRemovedBytes,
          };
        }
      } else {
        result = await lossless();
        if (lossyPng && deep) {
          result.fallbackReason = "16-bit PNG kept on the lossless path.";
          report("png.lossless-fallback", { reason: result.fallbackReason });
        } else if (lossyPng) result.fallbackReason = "PNG quality floor could not be met; lossless result used.";
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
    if (job.decodedInWorker) {
      const target = { width: result.width, height: result.height };
      await checkDisplayable(result.bytes, type, target);
      if (result.baseline) await checkDisplayable(result.baseline, type, target);
      Object.assign(result, { resized, originalWidth: job.originalWidth, originalHeight: job.originalHeight, displayChecked: true });
    }
    const transfers = [...new Set([result.bytes.buffer, ...(result.baseline ? [result.baseline.buffer] : [])])];
    self.postMessage({ result }, transfers);
  } catch (error) {
    self.postMessage({ error: error.message || "Unable to process this image." });
  }
};
