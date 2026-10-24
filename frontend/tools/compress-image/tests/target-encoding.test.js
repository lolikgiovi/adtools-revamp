// Failure cases: target disabled, exact-boundary output, unreachable targets,
// quality dropping below the floor, null PNG candidates, and non-monotonic sizes.
import { encodeForTarget } from "../target-encoding.js";

describe("target encoding", () => {
  it("keeps the selected quality when no target is requested", async () => {
    const encode = vi.fn(async (quality) => ({ bytes: new Uint8Array(quality), quality }));
    expect((await encodeForTarget(encode, 85)).quality).toBe(85);
    expect(encode).toHaveBeenCalledTimes(1);
  });
  it("finds the highest fitting quality without going below the floor", async () => {
    const calls = [];
    const result = await encodeForTarget(
      async (quality) => {
        calls.push(quality);
        return { bytes: new Uint8Array(quality * 100), quality };
      },
      65,
      8500,
    );
    expect(result.quality).toBe(84);
    expect(calls.every((quality) => quality >= 65 && quality <= 100)).toBe(true);
    expect(calls.length).toBeLessThanOrEqual(9);
  });
  it("returns the smallest allowed candidate when the target is unreachable", async () => {
    const result = await encodeForTarget(async (quality) => ({ bytes: new Uint8Array(quality * 100), quality }), 85, 100);
    expect(result.quality).toBe(85);
  });
  it("handles a PNG quality fallback without accepting a lower floor", async () => {
    expect(await encodeForTarget(async () => null, 80, 1000, 95)).toBeNull();
  });
  it("keeps the best observed candidate even when sizes are not monotonic", async () => {
    const result = await encodeForTarget(
      async (quality) => ({
        bytes: new Uint8Array(quality === 100 ? 1000 : 2000),
        quality,
      }),
      85,
      500,
    );
    expect(result.quality).toBe(100);
  });
});
