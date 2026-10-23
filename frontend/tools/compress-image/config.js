// Oxipng level is compression effort, not quality. On the benchmark set, level 4 saved
// 0.17 points more than level 2 at three times the time, so every preset uses 2.
const PNG_LEVEL = 2;

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
