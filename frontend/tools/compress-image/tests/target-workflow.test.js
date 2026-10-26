// Failure cases: exporting before PNG offers settle; target edits ignored until blur;
// target-only edits requiring recompression; equality counted as a fit; stale non-target
// settings accepted; unfinished/error rows exported; target checks racing pending offers.
import { CompressImage } from "../main.js";

function setup() {
  const tool = new CompressImage();
  tool.container = document.createElement("div");
  tool.container.innerHTML = tool.render();
  tool.persistWorkspace = () => {};
  const settings = tool.readSettings();
  const variant = (bytes, lossy) => ({
    blob: new Blob([new Uint8Array(bytes)], { type: "image/png" }),
    result: { width: 40, height: 20, lossy },
  });
  const lossless = variant(2000, false);
  const lossy = variant(1200, true);
  const item = {
    file: new File(["png"], "test.png", { type: "image/png" }),
    status: "Ready",
    settings,
    ...lossy,
    variants: { lossless, lossy },
    selectedVariant: "lossy",
    urls: [],
  };
  tool.items.push(item);
  tool.createRow(item);
  tool.appliedSettings = JSON.stringify(settings);
  tool.updateSummary();
  return { tool, item };
}

describe("target and export workflow", () => {
  it("waits for both PNG variants before enabling exports", () => {
    const { tool, item } = setup();
    delete item.variants.lossy;
    item.variantPending = "lossy";
    tool.updateSummary();
    expect(tool.$("quick-query").disabled).toBe(true);
    expect(tool.$("zip").disabled).toBe(true);
  });
  it("checks existing bytes and offers adjustment without recompression", async () => {
    const { tool, item } = setup();
    tool.$("target-kb").value = "1";
    tool.updateSettings();
    await tool.targetCheck;
    expect(tool.isStale()).toBe(false);
    expect(item.result.targetMet).toBe(false);
    expect(item.row.querySelector(".ci-fit-target").hidden).toBe(false);
    expect(tool.$("compress").hidden).toBe(true);
    expect(tool.$("quick-query").disabled).toBe(true);
    expect(tool.$("zip").disabled).toBe(true);
    tool.$("target-kb").value = "3";
    tool.updateSettings();
    await tool.targetCheck;
    expect(item.result.targetMet).toBe(true);
    expect(tool.$("quick-query").disabled).toBe(false);
    expect(tool.$("zip").disabled).toBe(false);
    tool.$("target-kb").value = "1.2";
    tool.updateSettings();
    await tool.targetCheck;
    expect(tool.$("quick-query").disabled).toBe(true);
    tool.$("target-kb").value = "";
    tool.updateSettings();
    await tool.targetCheck;
    expect(tool.$("quick-query").disabled).toBe(false);
  });
  it("requires recompression for quality changes", async () => {
    const { tool } = setup();
    tool.$("quality").value = "40";
    tool.updateSettings();
    await tool.targetCheck;
    expect(tool.isStale()).toBe(true);
    expect(tool.$("zip").disabled).toBe(true);
  });
});
