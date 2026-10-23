// @vitest-environment jsdom
// Failure cases: rounding masks a >300 KB payload; unknown bytes look safe;
// warnings vanish from filters; metadata is orphaned; saved-label controls remain;
// desktop opens inside the webview or browser fallback stops working.
import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckImageTool } from "../main.js";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../../core/Runtime.js";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../../core/Runtime.js", () => ({ isTauri: vi.fn() }));
afterEach(() => {
  vi.resetAllMocks();
  document.body.innerHTML = "";
  localStorage.clear();
});
function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const tool = new CheckImageTool();
  tool.mount(host);
  return tool;
}
describe("image checker presentation", () => {
  it("turns the same progress header into the report after CDN and Oracle finish", async () => {
    const tool = mount();
    const env = { name: "uat1", url: "https://cdn.example" };
    tool.getSelectedEnvironments = () => [env];
    tool.getSelectedOracleConnections = () => [{ name: "UAT" }];
    tool.elements.batchImagePathsInput.value = "4aeeec01-9804-4d1a-87c9-80b3e11d8192";
    let finishProbe;
    let finishOracle;
    tool.imageCheckerService.checkImage = () =>
      new Promise((resolve) => {
        finishProbe = resolve;
      });
    tool.fetchOracleMetadata = () =>
      new Promise((resolve) => {
        finishOracle = resolve;
      });
    const checking = tool.checkImages();
    const header = tool.root.querySelector("#runSummary");
    expect(tool.root.querySelector("#checkProgress")).toBeNull();
    expect(header.textContent).toContain("Checking images");
    expect(header.querySelector('[role="progressbar"]').getAttribute("aria-valuenow")).toBe("0");
    await vi.waitFor(() => expect(finishProbe).toBeTypeOf("function"));
    finishProbe({ exists: true, url: "https://cdn.example/image.png", width: 600, height: 377, sizeBytes: 300001 });
    await vi.waitFor(() => expect(header.querySelector('[role="progressbar"]').getAttribute("aria-valuenow")).toBe("1"));
    expect(header.textContent).toContain("Finishing checks");
    finishOracle();
    await checking;
    expect(tool.root.querySelector("#runSummary")).toBe(header);
    expect(header.textContent).toContain("1 image with issues");
    expect(header.querySelector('[role="progressbar"]')).toBeNull();
    tool.unmount();
  });

  it("warns strictly above 300,000 CDN bytes and keeps unknown size explicit", () => {
    const tool = new CheckImageTool();
    for (const sizeBytes of [299999, 300000, null]) {
      expect(tool.createImageMetrics({ width: 600, height: 377, sizeBytes }).querySelector(".image-size-warning")).toBeNull();
    }
    const metrics = tool.createImageMetrics({ width: 600, height: 377, sizeBytes: 300001 });
    expect(metrics.querySelector(".image-size-warning").textContent).toContain("Over 300 KB");
    expect(tool.formatBytes(115820)).toBe("115.82 KB");
    expect(tool.createImageMetrics({ width: 600, height: 377, sizeBytes: null }).textContent).toContain("Unavailable");
  });
  it("removes saved labels and keeps metadata attached when filtering size warnings", () => {
    const tool = mount();
    expect(tool.root.querySelector("#savedReferencesButton, #referenceEditor, #referenceLibrary")).toBeNull();
    const paths = ["large", "small"];
    const env = { name: "uat1", url: "https://cdn.example" };
    const run = tool.beginCheckRun();
    tool.renderProgressiveTable(paths, [env], run, [{ name: "UAT1 COMP" }]);
    paths.forEach((path, i) =>
      tool.updateCellWithResult(
        tool.root.querySelector(`#cell-${i}-0`),
        {
          exists: true,
          url: "https://cdn.example/image.png",
          width: 600,
          height: 377,
          sizeBytes: i ? 300000 : 300001,
        },
        path,
        env,
        i,
        0,
        run,
      ),
    );
    tool.renderRunSummary(2, 1);
    tool.setResultFilter("issues");
    const rows = tool.root.querySelectorAll(".image-result-row");
    expect([...rows].map((row) => row.hidden)).toEqual([false, true]);
    expect([...tool.root.querySelectorAll(".image-metadata-row")].map((row) => row.hidden)).toEqual([false, true]);
    expect(tool.root.querySelectorAll(".batch-results-table > thead th")).toHaveLength(2);
    expect(tool.root.textContent).not.toContain("Save as label");
  });
  it("opens the overlay source in the desktop browser using open_url", async () => {
    const tool = mount();
    isTauri.mockReturnValue(true);
    invoke.mockResolvedValue(undefined);
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    tool.showImageDetails({ url: "https://cdn.example/image.png", width: 600, height: 377, sizeBytes: 301000 }, "image");
    document.querySelector(".image-details-actions a").click();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("open_url", { url: "https://cdn.example/image.png" }));
    expect(open).not.toHaveBeenCalled();
    document.querySelector(".close-modal-button").click();
    open.mockRestore();
  });
  it("opens a browser tab on web and after native opening fails", async () => {
    const tool = mount();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    isTauri.mockReturnValue(false);
    await tool.openImageUrl("https://cdn.example/web.png");
    expect(open).toHaveBeenLastCalledWith("https://cdn.example/web.png", "_blank", "noopener,noreferrer");
    isTauri.mockReturnValue(true);
    invoke.mockRejectedValue(new Error("Unavailable"));
    await tool.openImageUrl("https://cdn.example/desktop.png");
    expect(open).toHaveBeenLastCalledWith("https://cdn.example/desktop.png", "_blank", "noopener,noreferrer");
    open.mockRestore();
  });
});
