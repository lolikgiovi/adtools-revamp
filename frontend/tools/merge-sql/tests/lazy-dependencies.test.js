// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

const canvasState = vi.hoisted(() => ({ moduleEvaluations: 0, calls: 0 }));

vi.mock("html2canvas", () => {
  canvasState.moduleEvaluations += 1;
  return {
    default: vi.fn(async () => {
      canvasState.calls += 1;
      return { toBlob: vi.fn() };
    }),
  };
});

import { MergeSqlTool } from "../main.js";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Merge SQL lazy dependencies", () => {
  it("loads html2canvas only when a report image is captured", async () => {
    const tool = new MergeSqlTool();
    const report = document.createElement("div");
    report.className = "report-content";
    document.body.appendChild(report);
    tool.getActiveReportElement = () => report;

    expect(canvasState.moduleEvaluations).toBe(0);

    await tool.captureReportImage();
    expect(canvasState.moduleEvaluations).toBe(1);
    expect(canvasState.calls).toBe(1);

    await tool.captureReportImage();
    expect(canvasState.moduleEvaluations).toBe(1);
    expect(canvasState.calls).toBe(2);
  });

  it("coalesces duplicate report-image actions", async () => {
    const tool = Object.assign(Object.create(MergeSqlTool.prototype), { reportImageActionPromises: new Map() });
    const release = {};
    release.promise = new Promise((resolve) => {
      release.resolve = resolve;
    });
    const action = vi.fn(() => release.promise);

    const first = tool.runReportImageAction("copy", action);
    const second = tool.runReportImageAction("copy", action);
    await Promise.resolve();
    expect(action).toHaveBeenCalledOnce();

    release.resolve();
    await Promise.all([first, second]);
  });
});
