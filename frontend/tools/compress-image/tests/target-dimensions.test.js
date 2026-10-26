// Failure cases: exact byte boundary, no fitting dimensions, aspect distortion,
// upscaling, an unbounded search, and codec failures erasing the current result.
import { findLargestFit } from "../target-dimensions.js";

describe("largest dimensions for a target", () => {
  it("finds the largest fitting dimensions and preserves aspect ratio", async () => {
    const calls = [];
    const best = await findLargestFit({
      width: 3000,
      height: 1500,
      targetBytes: 2000000,
      encode: async (width, height) => {
        calls.push([width, height]);
        return { size: width * height };
      },
    });
    expect(best.width).toBe(1999);
    expect(best.height).toBe(1000);
    expect(best.value.size).toBeLessThan(2000000);
    expect(calls.length).toBeLessThanOrEqual(12);
    expect(calls.every(([w, h]) => w <= 3000 && h <= 1500 && Math.abs(w / 2 - h) <= 0.5)).toBe(true);
  });
  it("reports when even the smallest image cannot fit", async () => {
    expect(await findLargestFit({ width: 10, height: 10, targetBytes: 100, encode: async () => ({ size: 100 }) })).toBeNull();
  });
  it("propagates failures so callers can preserve previous results", async () => {
    await expect(
      findLargestFit({
        width: 10,
        height: 10,
        targetBytes: 100,
        encode: async () => {
          throw new Error("codec");
        },
      }),
    ).rejects.toThrow("codec");
  });
});

// Failure cases: probes accidentally serialized, skipping the largest fit, and
// excessive speculative work when only one worker is available.
it("searches bounded parallel probes while preserving the largest fit", async () => {
  let active = 0;
  let peak = 0;
  const best = await findLargestFit({
    width: 3000,
    height: 1500,
    targetBytes: 2000000,
    concurrency: 3,
    encode: async (width, height) => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 0));
      active--;
      return { size: width * height };
    },
  });
  expect(peak).toBe(3);
  expect(best.width).toBe(1999);
});
