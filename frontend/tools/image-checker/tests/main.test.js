// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { UsageTracker } from "../../../core/UsageTracker.js";
import { CheckImageTool } from "../main.js";

function createHarness() {
  const root = document.createElement("div");
  const resultsContainer = root;
  const tool = Object.assign(Object.create(CheckImageTool.prototype), {
    root,
    elements: {
      resultsContainer,
      retryAllTimeoutsBtn: document.createElement("button"),
    },
    checkRunId: 0,
    timeoutCells: new Map(),
  });
  return tool;
}

function result() {
  return { exists: true, timeout: false, url: "https://cdn.example/image.png", width: 10, height: 20, aspectRatio: 0.5 };
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.body.innerHTML = "";
});

describe("CheckImageTool run scheduling", () => {
  it("keeps initial image probes at the concurrency limit while updating every cell", async () => {
    const tool = createHarness();
    const paths = Array.from({ length: 10 }, (_, index) => `image-${index}`);
    const environments = [
      { name: "A", url: "https://a.example/" },
      { name: "B", url: "https://b.example/" },
    ];
    let active = 0;
    let maximumActive = 0;
    const checkImage = vi.fn(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 0));
      active -= 1;
      return result();
    });
    tool.imageCheckerService = { normalizeInput: (path) => path, checkImage };
    vi.spyOn(UsageTracker, "trackEvent").mockImplementation(() => {});

    const runId = tool.beginCheckRun();
    tool.renderProgressiveTable(paths, environments, runId);
    await tool.fetchAllCellsProgressively(paths, environments, runId);

    expect(maximumActive).toBeLessThanOrEqual(8);
    expect(checkImage).toHaveBeenCalledTimes(paths.length * environments.length);
    expect(tool.root.querySelectorAll(".status-cell.success")).toHaveLength(paths.length * environments.length);
  });

  it("bounds Retry All and re-adds only retries that still time out", async () => {
    const tool = createHarness();
    const environments = [{ name: "A", url: "https://a.example/" }];
    const paths = Array.from({ length: 12 }, (_, index) => `image-${index}`);
    const retryEntries = paths.map((originalPath, rowIndex) => ({
      originalPath,
      env: environments[0],
      rowIndex,
      colIndex: 0,
      runId: 1,
    }));
    tool.checkRunId = 1;
    tool.timeoutCells = new Map(retryEntries.map((entry) => [`cell-${entry.rowIndex}-0`, entry]));
    let active = 0;
    let maximumActive = 0;
    tool.retryCell = vi.fn(async (_path, _env, rowIndex) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 0));
      active -= 1;
      if (rowIndex % 2 === 0) tool.timeoutCells.set(`cell-${rowIndex}-0`, retryEntries[rowIndex]);
    });
    vi.spyOn(UsageTracker, "trackEvent").mockImplementation(() => {});

    tool.root.innerHTML = '<div id="results"></div>';
    tool.elements.resultsContainer = tool.root;
    await tool.retryAllTimeouts();

    expect(maximumActive).toBeLessThanOrEqual(8);
    expect(tool.retryCell).toHaveBeenCalledTimes(paths.length);
    expect(tool.timeoutCells.size).toBe(6);
    expect([...tool.timeoutCells.keys()]).toEqual(["cell-0-0", "cell-2-0", "cell-4-0", "cell-6-0", "cell-8-0", "cell-10-0"]);
  });

  it("ignores a completed probe from an invalidated run", async () => {
    const tool = createHarness();
    const oldProbe = {};
    const checkImage = vi.fn(
      () =>
        new Promise((resolve) => {
          oldProbe.resolve = resolve;
        }),
    );
    tool.imageCheckerService = { normalizeInput: (path) => path, checkImage };

    const oldRunId = tool.beginCheckRun();
    tool.renderProgressiveTable(["old-image"], [{ name: "A", url: "https://a.example/" }], oldRunId);
    const oldRequest = tool.fetchAllCellsProgressively(["old-image"], [{ name: "A", url: "https://a.example/" }], oldRunId);
    await vi.waitFor(() => expect(checkImage).toHaveBeenCalledOnce());

    const newRunId = tool.beginCheckRun();
    tool.renderProgressiveTable(["new-image"], [{ name: "A", url: "https://a.example/" }], newRunId);
    oldProbe.resolve(result());
    await oldRequest;

    expect(checkImage).toHaveBeenCalledOnce();
    expect(tool.root.querySelector("#cell-0-0").className).toContain("loading");
    expect(tool.root.querySelector("#cell-0-0").textContent).toContain("Checking");
  });
});

describe("CheckImageTool image references", () => {
  it("saves a named reference, keeps recent history, and can reuse the identifier", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const tool = new CheckImageTool();
    tool.mount(host);

    const identifier = "8f6c2f1a-4f2d-4a8f-9b1e-0fd1a75b21c4";
    tool.recordReferenceHistory([identifier, identifier]);
    tool.openReferenceEditor(identifier);
    tool.elements.referenceLabelInput.value = "Homepage hero";
    tool.elements.referenceNoteInput.value = "Approved campaign artwork";
    tool.saveReferenceFromEditor();

    expect(tool.referenceHistory).toHaveLength(1);
    expect(tool.savedReferences).toHaveLength(1);
    expect(tool.savedReferences[0]).toMatchObject({
      key: `/content/v1/image/${identifier}.png`,
      identifier,
      label: "Homepage hero",
      note: "Approved campaign artwork",
    });
    expect(JSON.parse(localStorage.getItem("image_checker_saved_references"))).toHaveLength(1);

    tool.elements.batchImagePathsInput.value = "";
    tool.appendInputValue(identifier);
    expect(tool.elements.batchImagePathsInput.value).toBe(identifier);
    expect(tool.createImagePathCell(identifier).textContent).toContain("Homepage hero");
  });

  it("deduplicates equivalent UUID and content-path entries before checking", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const tool = new CheckImageTool();
    tool.mount(host);

    const identifier = "8f6c2f1a-4f2d-4a8f-9b1e-0fd1a75b21c4";
    tool.elements.batchImagePathsInput.value = `${identifier}\n/content/v1/image/${identifier}.png`;

    expect(tool.getInputEntries()).toEqual({ imagePaths: [identifier], duplicateCount: 1 });
  });
});
