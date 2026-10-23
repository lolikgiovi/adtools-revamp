// Failure cases: mutable presets, wrong lossy threshold, accepting bigger output,
// ignoring explicit resizing, and lossy PNG beating the original but not lossless.
import { PRESETS, selectCandidate, minimumSavings, skipsLosslessPass } from "../config.js";

describe("image optimizer policy", () => {
  it("freezes every preset and uses the agreed codec options", () => {
    expect(Object.keys(PRESETS)).toEqual(["high", "balanced", "small"]);
    expect(PRESETS.balanced).toMatchObject({
      png: { level: 2, interlace: false, optimiseAlpha: false },
      jpeg: { quality: 85, progressive: true, optimize_coding: true },
      webp: { quality: 85, method: 4, lossless: 0, alpha_quality: 100 },
      quantize: { quality: { min: 80, target: 95 }, speed: 4, maxColors: 256 },
    });
    for (const preset of Object.values(PRESETS)) {
      expect(Object.isFrozen(preset)).toBe(true);
      expect(Object.values(preset).every(Object.isFrozen)).toBe(true);
      expect(Object.isFrozen(preset.quantize.quality)).toBe(true);
      // Oxipng level is effort, not quality. Level 4 saved 0.17 points over 2 at 3x the time.
      expect(preset.png).toEqual(PRESETS.balanced.png);
    }
  });
  it("requires one percent or 1024 bytes, rounded up", () => {
    expect(minimumSavings(100)).toBe(1024);
    expect(minimumSavings(200001)).toBe(2001);
  });
  it("accepts any lossless reduction and retains equal or bigger originals", () => {
    expect(selectCandidate({ original: 500, baseline: 499 })).toBe("baseline");
    expect(selectCandidate({ original: 500, baseline: 500 })).toBe("original");
    expect(selectCandidate({ original: 500, baseline: 501 })).toBe("original");
  });
  it("requires meaningful savings for JPEG and WebP", () => {
    expect(selectCandidate({ original: 10000, candidate: 8976 })).toBe("candidate");
    expect(selectCandidate({ original: 10000, candidate: 8977 })).toBe("original");
  });
  it("compares lossy PNG against the smaller lossless baseline", () => {
    expect(selectCandidate({ original: 30000, baseline: 10000, candidate: 9500 })).toBe("baseline");
    expect(selectCandidate({ original: 30000, baseline: 10000, candidate: 8976 })).toBe("candidate");
    expect(selectCandidate({ original: 10000, baseline: 11000, candidate: 9500 })).toBe("original");
  });
  it("honors resized dimensions without falling back to the original", () => {
    expect(selectCandidate({ original: 500, candidate: 700, resized: true })).toBe("candidate");
    expect(selectCandidate({ original: 500, baseline: 800, candidate: 700, resized: true })).toBe("baseline");
    expect(selectCandidate({ original: 500, baseline: 3000, candidate: 1900, resized: true })).toBe("candidate");
  });
});

// Skip failures: skipping when lossy is not clearly smaller, missing the boundary, and
// skipping without a usable estimate.
describe("lossless pass skip", () => {
  it("skips only when the lossy result is at most half the lossless estimate", () => {
    expect(skipsLosslessPass(500, 1000)).toBe(true);
    expect(skipsLosslessPass(501, 1000)).toBe(false);
    expect(skipsLosslessPass(1, 1000)).toBe(true);
  });
  it("never skips without a usable estimate", () => {
    for (const estimate of [undefined, null, 0, NaN, -5]) expect(skipsLosslessPass(1, estimate)).toBe(false);
  });
});
