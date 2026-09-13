// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { CompareConfigTool } from "../main.js";
import { CompareConfigTemplate } from "../template.js";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Compare Config interactions", () => {
  it("binds unified source controls and action buttons through the mount lifecycle", () => {
    document.body.innerHTML = CompareConfigTemplate;

    const tool = new CompareConfigTool({ emit: vi.fn() });
    const sourceTypeChange = vi.spyOn(tool, "onUnifiedSourceTypeChange").mockImplementation(() => {});
    const loadData = vi.spyOn(tool, "loadUnifiedData").mockImplementation(() => {});
    const compare = vi.spyOn(tool, "executeUnifiedComparison").mockImplementation(() => {});

    tool.bindEvents();

    const sourceAExcel = document.getElementById("source-a-type-excel");
    sourceAExcel.checked = true;
    sourceAExcel.dispatchEvent(new Event("change", { bubbles: true }));

    const queryModeButton = document.getElementById("source-a-query-mode-btn");
    queryModeButton.click();
    expect(document.getElementById("source-a-query-mode-dropdown").classList.contains("show")).toBe(true);

    const loadButton = document.getElementById("btn-unified-load-data");
    const compareButton = document.getElementById("btn-unified-compare");
    loadButton.disabled = false;
    compareButton.disabled = false;
    loadButton.click();
    compareButton.click();

    expect(sourceTypeChange).toHaveBeenCalledWith("A", "excel");
    expect(loadData).toHaveBeenCalledOnce();
    expect(compare).toHaveBeenCalledOnce();

    tool.onUnmount();
  });
});
