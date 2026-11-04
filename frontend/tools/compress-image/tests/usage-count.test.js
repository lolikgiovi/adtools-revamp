// Compress Image counts one Tool Use per Compress click that readies at least one image.
// Ways it could go wrong: a batch counts once per image (overcount); a batch where every image fails counts
// (overcount); a batch with some failures never counts (undercount).
import { afterEach, describe, expect, it, vi } from "vitest";
import { UsageTracker } from "../../../core/UsageTracker.js";
import { CompressImage } from "../main.js";
import { PRESETS } from "../config.js";

afterEach(() => vi.restoreAllMocks());

function batch(outcomes) {
  const uses = [];
  vi.spyOn(UsageTracker, "trackToolUse").mockImplementation((id, action, meta) => uses.push({ use: `${id}:${action}`, ...meta }));
  const tool = Object.assign(Object.create(CompressImage.prototype), {
    generation: 1,
    items: outcomes.map((ok, index) => ({ ok, file: { type: "image/jpeg", name: `${index}.jpg` } })),
    readSettings: () => ({ preset: Object.keys(PRESETS)[0], quality: 80, targetBytes: 0, resize: false, pngQuality: {} }),
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
      if (!item.ok) throw new Error("bad image");
      item.result = { outcome: "smaller" };
    },
  });
  return { tool, uses };
}

describe("Compress Image usage counting", () => {
  it("counts a batch of several images once, with the number readied", async () => {
    const { tool, uses } = batch([true, true, false, true]);
    await tool.processQueue();
    expect(uses).toHaveLength(1);
    expect(uses[0]).toMatchObject({ use: "compress-image:compress", image_count: 3 });
  });

  it("does not count a batch where every image fails", async () => {
    const { tool, uses } = batch([false, false]);
    await tool.processQueue();
    expect(uses).toEqual([]);
  });
});
