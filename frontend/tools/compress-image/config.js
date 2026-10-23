// Oxipng level is compression effort, not quality. On the benchmark set, level 4 saved
// 0.17 points more than level 2 at three times the time, so every preset uses 2.
const PNG_LEVEL = 2;

// Lossless WebP input stays lossless. Here quality is effort, so it ignores the slider:
// on the benchmark pixels, q90/m5 was 1.8% smaller than libwebp's default q75/m4 at 1.8× the
// time; q100/m6 saved another 1.3% but took 11× longer, up to 30 s for one image.
export const WEBP_LOSSLESS = Object.freeze({ lossless: 1, exact: 1, quality: 90, method: 5 });

// The UI keeps PNG mode and quality independent from JPEG/WebP presets.
function preset(quality, method, min, target) {
  return Object.freeze({
    png: Object.freeze({ level: PNG_LEVEL, interlace: false, optimiseAlpha: false }),
    jpeg: Object.freeze({ quality, progressive: true, optimize_coding: true }),
    webp: Object.freeze({ quality, method, lossless: 0, alpha_quality: 100 }),
    quantize: Object.freeze({
      quality: Object.freeze({ min, target }),
      speed: 4,
      maxColors: 256,
    }),
  });
}

export const PRESETS = Object.freeze({
  high: preset(92, 4, 90, 100),
  balanced: preset(85, 4, 80, 95),
  small: preset(75, 5, 65, 85),
});

// With lossy PNG on, the lossless Oxipng pass is skipped when the lossy result is at most
// this fraction of an estimate of the lossless size (adaptive PNG filter + zlib on the same
// pixels). On the benchmark set Oxipng level 2 never came in more than 30% under the estimate,
// and lossy results were at most 35% of it.
export const LOSSLESS_SKIP_RATIO = 0.5;

export function skipsLosslessPass(lossyBytes, estimateBytes) {
  return Number.isFinite(estimateBytes) && estimateBytes > 0 && lossyBytes <= estimateBytes * LOSSLESS_SKIP_RATIO;
}

// User-supplied phone bounds, independent of device model names.
export const PHONE_SIZES = Object.freeze({
  full: Object.freeze({ width: 1440, height: 3200 }),
  square: Object.freeze({ width: 2670, height: 2670 }),
});

export function largerThan(dimensions, bounds) {
  if (!dimensions) return false;
  return (
    Math.min(dimensions.width, dimensions.height) > Math.min(bounds.width, bounds.height) ||
    Math.max(dimensions.width, dimensions.height) > Math.max(bounds.width, bounds.height)
  );
}

// Worker pool: cores minus one (the main thread keeps one), at most three, and one on narrow
// screens. Each job's peak memory is estimated as 16 bytes per pixel (bitmap, canvas, ImageData
// and codec buffers) plus the file; unknown dimensions count as the 16 MP maximum.
const UNKNOWN_PIXELS = 16000000;
export const MEMORY_BUDGET = Object.freeze({ desktop: 768 * 1024 * 1024, narrow: 256 * 1024 * 1024 });

export function poolSize(cores, narrow) {
  if (narrow || !Number.isFinite(cores)) return 1;
  return Math.min(3, Math.max(1, cores - 1));
}

export function jobMemoryBytes(width, height, fileSize) {
  return (width && height ? width * height : UNKNOWN_PIXELS) * 16 + fileSize;
}

export function jobTimeoutMs(megapixels) {
  return Math.min(120000, 15000 + 3000 * (Number.isFinite(megapixels) ? megapixels : UNKNOWN_PIXELS / 1e6));
}

export function minimumSavings(bytes) {
  return Math.max(Math.ceil(bytes * 0.01), 1024);
}

// A resized baseline always has the requested dimensions. The original does not.
// Lossy PNG must justify its pixel changes against the best lossless alternative.
export function selectCandidate({ original, baseline, candidate, resized = false }) {
  const baselineSelected = baseline !== undefined && (resized || baseline < original);
  const reference = baselineSelected ? baseline : original;
  if (candidate !== undefined) {
    if (resized && baseline === undefined) return "candidate";
    if (reference - candidate >= minimumSavings(reference)) return "candidate";
  }
  return baselineSelected ? "baseline" : "original";
}
