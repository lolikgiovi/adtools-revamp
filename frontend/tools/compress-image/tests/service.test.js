import { fitDimensions } from "../service.js";

// Resize failures: stretched/cropped aspect ratios, upscaling small originals,
// invalid/fractional dimensions, and portrait/landscape bounds being swapped.
describe("mobile resize dimensions", () => {
  it.each([
    [4000, 3000, 1920, 1920, 1920, 1440],
    [3000, 4000, 1920, 1920, 1440, 1920],
    [800, 500, 1920, 1920, 800, 500],
    [4000, 3000, 1080, 1920, 1080, 810],
    [3000, 4000, 1920, 1080, 810, 1080],
  ])("fits %s by %s within %s by %s", (w, h, mw, mh, width, height) => {
    expect(fitDimensions(w, h, mw, mh)).toEqual({ width, height });
  });
  it.each([0, -1, NaN, Infinity, 1.5, 20000])("rejects an invalid bound: %s", (bound) => {
    expect(() => fitDimensions(800, 500, bound, 1920)).toThrow();
  });
});
