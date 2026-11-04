// Compress Image reports what a Compress click achieved and why images failed.
// Ways it could go wrong: savings are per image instead of summed for the click; formats repeat or grow unbounded;
// a failed image reports its error message or file name; one click reports a failure per image; a click with no
// failures reports one; superseded batches report anything.
import { afterEach, describe, expect, it, vi } from "vitest";
import { UsageTracker } from "../../../core/UsageTracker.js";
import { CompressImage } from "../main.js";
import { PRESETS } from "../config.js";

afterEach(() => vi.restoreAllMocks());

function batch(items) {
  const uses = [];
  const failures = [];
  vi.spyOn(UsageTracker, "trackToolUse").mockImplementation((id, action, meta) => uses.push({ id, action, meta }));
  vi.spyOn(UsageTracker, "trackFailure").mockImplementation((id, action, error, meta) => failures.push({ id, action, error, meta }));
  const tool = Object.assign(Object.create(CompressImage.prototype), {
    generation: 1,
    items: items.map((spec, index) => ({
      spec,
      file: { type: spec.type || "image/jpeg", size: spec.before, name: `secret-${index}.jpg` },
    })),
    readSettings: () => ({
      preset: Object.keys(PRESETS)[0],
      quality: 80,
      targetBytes: 0,
      resize: false,
      pngQuality: { min: 0, target: 80 },
    }),
    $: () => ({ validity: { valid: true } }),
    error: vi.fn(),
    cancelOffers: vi.fn(),
    updateRow: vi.fn(),
    updateSummary: vi.fn(),
    log: vi.fn(),
    selectItem: vi.fn(),
    persistWorkspace: vi.fn(),
    prepareOffers: vi.fn(),
    compressItem: async (item) => {
      if (item.spec.error) throw item.spec.error;
      item.blob = { size: item.spec.after, type: item.spec.out };
      item.result = { outcome: "smaller", lossy: item.spec.lossy, resized: Boolean(item.spec.resized) };
    },
  });
  return { tool, uses, failures };
}

describe("Compress Image insight", () => {
  it("sums bytes and lists output formats once on the click's single use", async () => {
    const { tool, uses } = batch([
      { before: 1000, after: 400, out: "image/webp", lossy: true },
      { before: 2000, after: 1500, out: "image/png", lossy: false, resized: true, type: "image/png" },
      { before: 500, after: 200, out: "image/webp", lossy: true },
    ]);
    await tool.processQueue();
    expect(uses).toEqual([
      {
        id: "compress-image",
        action: "compress",
        meta: {
          image_count: 3,
          bytes_before: 3500,
          bytes_after: 2100,
          bytes_saved: 1400,
          formats: "png,webp",
          lossy_count: 2,
          lossless_count: 1,
          resized: true,
        },
      },
    ]);
  });

  it("reports failed images once per click with a count, never the message or file name", async () => {
    const boom = new Error("secret-0.jpg is corrupt");
    const { tool, failures } = batch([
      { error: boom },
      { error: new Error("other") },
      { before: 10, after: 5, out: "image/webp", lossy: true },
    ]);
    await tool.processQueue();
    expect(failures).toEqual([{ id: "compress-image", action: "compress", error: boom, meta: { failed_count: 2, image_count: 3 } }]);
    expect(JSON.stringify(failures.map((item) => item.meta))).not.toContain("secret");
  });

  it("reports no failure when every image is readied", async () => {
    const { tool, failures } = batch([{ before: 10, after: 5, out: "image/webp", lossy: true }]);
    await tool.processQueue();
    expect(failures).toEqual([]);
  });
});
