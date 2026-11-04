// @vitest-environment jsdom
// Failure cases: an image that is simply not deployed to one environment is reported as a failed check;
// analytics count "missing" as a failure; the per-environment header hides which environment lacks the image;
// timeouts and request errors lose their "failed" status once missing is split out.
import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckImageTool } from "../main.js";
import { UsageTracker } from "../../../core/UsageTracker.js";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../../core/Runtime.js", () => ({ isTauri: vi.fn(() => false) }));

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  localStorage.clear();
});

function mount(results) {
  const host = document.createElement("div");
  document.body.append(host);
  const tool = new CheckImageTool();
  tool.mount(host);
  tool.getSelectedEnvironments = () => Object.keys(results).map((name) => ({ name, url: `https://${name}.cdn` }));
  tool.getSelectedOracleConnections = () => [];
  tool.imageCheckerService.checkImage = async (url) => {
    const name = new URL(url).hostname.split(".")[0];
    const outcome = results[name];
    if (outcome === "throw") throw new Error("network down");
    if (outcome === "found") return { exists: true, url, width: 10, height: 10, aspectRatio: 1, sizeBytes: 10 };
    if (outcome === "timeout") return { exists: false, url, timeout: true };
    return { exists: false, url };
  };
  return tool;
}

describe("image checker per-environment status", () => {
  it("reports missing deployments per environment instead of as failed checks", async () => {
    const toolUse = vi.spyOn(UsageTracker, "trackToolUse").mockImplementation(() => {});
    const tool = mount({ sit: "found", uat: "found", prod: "missing" });
    tool.elements.batchImagePathsInput.value = "4aeeec01-9804-4d1a-87c9-80b3e11d8192";
    await tool.checkImages();

    const summary = tool.root.querySelector("#runSummary").textContent;
    expect(summary).toContain("Missing in prod");
    expect(summary).toContain("0 failed");
    expect(summary).toContain("1 missing");
    const headers = [...tool.root.querySelectorAll(".batch-results-table > thead th")].map((th) => th.textContent);
    expect(headers).toEqual(["Image ID", "sit1/1", "uat1/1", "prod0/1"]);
    expect(tool.root.querySelector(".status-cell.missing")).not.toBeNull();
    expect(tool.root.querySelector(".status-cell.error")).toBeNull();
    expect(toolUse).toHaveBeenCalledWith("check-image", "check", expect.objectContaining({ success_count: 2, missing_count: 1, failed_count: 0 }));
    tool.unmount();
  });

  it("still counts timeouts and request errors as failed checks", async () => {
    const toolUse = vi.spyOn(UsageTracker, "trackToolUse").mockImplementation(() => {});
    const tool = mount({ sit: "timeout", uat: "throw" });
    tool.elements.batchImagePathsInput.value = "4aeeec01-9804-4d1a-87c9-80b3e11d8192";
    await tool.checkImages();
    expect(tool.root.querySelector("#runSummary").textContent).toContain("2 failed");
    expect(toolUse).toHaveBeenCalledWith("check-image", "check", expect.objectContaining({ missing_count: 0, failed_count: 1, timeout_count: 1 }));
    tool.unmount();
  });
});
