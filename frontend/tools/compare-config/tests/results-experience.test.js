// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { CompareConfigTool } from "../main.js";
import { GridView } from "../views/GridView.js";
import { MasterDetailView } from "../views/MasterDetailView.js";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("comparison review results", () => {
  it("groups changed and missing rows under Differing, with just two result filters", () => {
    document.body.innerHTML = '<div id="results-summary"></div><div id="results-content"></div>';
    const tool = new CompareConfigTool({ emit: vi.fn() });
    tool.queryMode = "unified";
    tool.results.unified = {
      env1_name: "UAT",
      env2_name: "Pre-production",
      _metadata: { sourceLimits: [{ name: "UAT", rowCount: 500, maxRows: 500 }] },
      summary: { total: 4, matches: 1, differs: 1, only_in_env1: 1, only_in_env2: 1 },
      rows: [
        { status: "match", key: { id: "a" }, env1_data: { value: "1" }, env2_data: { value: "1" } },
        { status: "differ", key: { id: "b" }, env1_data: { value: "1" }, env2_data: { value: "2" }, differences: ["value"] },
        { status: "only_in_env1", key: { id: "c" }, env1_data: { value: "3" } },
        { status: "only_in_env2", key: { id: "d" }, env2_data: { value: "4" } },
      ],
    };

    tool.renderSummary();
    expect([...document.querySelectorAll(".summary-stat")].map((button) => button.dataset.filter)).toEqual(["differ", "match"]);
    expect(document.querySelector('[data-filter="differ"] .stat-value').textContent).toBe("3");
    expect(document.getElementById("results-summary").textContent).toContain("Only in UAT");
    expect(document.querySelector(".summary-breakdown").textContent).toContain("4 records compared");
    expect(document.querySelector(".row-limit-warning")).toBeNull();
    expect(tool.getFilteredComparisons().map((row) => row.key.id)).toEqual(["b", "c", "d"]);
    document.querySelector('[data-filter="match"]').click();
    expect(tool.getFilteredComparisons().map((row) => row.key.id)).toEqual(["a"]);
  });

  it("keeps long grid values compact and opens the selected row for inspection", () => {
    const view = new GridView();
    const longValue = JSON.stringify({ description: "a".repeat(320) });
    const comparison = {
      status: "differ",
      key: { PARAMETER_KEY: "loan.setting" },
      env1_data: { PARAMETER_VALUE: longValue },
      env2_data: { PARAMETER_VALUE: longValue.replace("a", "b") },
      differences: ["PARAMETER_VALUE"],
    };
    const root = document.createElement("div");
    root.innerHTML = view.render([comparison], "UAT", "Pre-production", { compareFields: ["PARAMETER_VALUE"] });
    document.body.appendChild(root);
    const onInspect = vi.fn();
    view.onInspect = onInspect;
    view.attachEventListeners(root);

    expect(root.querySelector(".val-cell").textContent.length).toBeLessThan(longValue.length);
    expect(root.querySelector(".grid-inspect-button")).not.toBeNull();
    root.querySelector(".grid-inspect-button").click();
    expect(onInspect).toHaveBeenCalledWith(0);
  });

  it("uses concise source names in the grid while preserving the full comparison title", () => {
    const view = new GridView();
    const root = document.createElement("div");
    root.innerHTML = view.render(
      [{ status: "only_in_env1", key: { id: "config" }, env1_data: { value: "on" }, env2_data: null, differences: ["value"] }],
      "(UAT1 COMP) SQL Query",
      "(PREPROD COMP) SQL Query",
      { compareFields: ["value"], showStatus: true },
    );

    expect([...root.querySelectorAll(".env-header-sub")].map((header) => header.textContent.trim())).toEqual(["UAT1 COMP", "PREPROD COMP"]);
    expect(root.querySelector(".status-cell").textContent).toContain("Only in UAT1 COMP");
    expect(root.querySelector(".status-badge").classList.contains("status-only-in-env1")).toBe(true);
    expect(root.querySelectorAll(".val-cell")[1].textContent).toBe("Missing");
    expect(root.querySelectorAll(".val-cell")[1].classList.contains("is-diff")).toBe(true);
  });

  it("shows changed JSON properties and readable full values in detail view", () => {
    const view = new MasterDetailView();
    const root = document.createElement("div");
    root.innerHTML = view.render(
      [
        {
          status: "differ",
          key: { id: "config" },
          env1_data: { value: '{"enabled":"0","limits":{"max":10}}' },
          env2_data: { value: '{"enabled":"1","limits":{"max":10}}' },
          differences: ["value"],
        },
      ],
      "UAT",
      "Pre-production",
      { compareFields: ["value"] },
    );

    expect(root.querySelector(".json-changes").textContent).toContain("enabled");
    expect(root.querySelector(".json-changes").textContent).toContain('"0"');
    expect(root.querySelector(".json-changes").textContent).toContain('"1"');
    expect(root.querySelectorAll(".detail-json-value")).toHaveLength(2);
    expect(root.querySelector(".detail-json-value").textContent).toContain("\n");
  });

  it("switches a selected record between field and side-by-side text diffs", () => {
    const view = new MasterDetailView();
    const root = document.createElement("div");
    root.innerHTML = view.render(
      [
        {
          status: "differ",
          key: { id: "config" },
          env1_data: { value: '{"enabled":"0","note":"<script>"}' },
          env2_data: { value: '{"enabled":"1","note":"<script>"}' },
          differences: ["value"],
        },
        { status: "only_in_env1", key: { id: "removed" }, env1_data: { value: "old" }, env2_data: null },
      ],
      "UAT",
      "Pre-production",
      { compareFields: ["value"] },
    );
    document.body.appendChild(root);
    view.attachEventListeners(root);

    root.querySelector('[data-detail-mode="text-diff"]').click();
    expect(root.querySelector(".detail-text-diff .d2h-wrapper")).not.toBeNull();
    expect(document.activeElement).toBe(root.querySelector('[data-detail-mode="text-diff"]'));
    expect(root.querySelector(".detail-text-diff").textContent).toContain("enabled");
    expect(root.querySelector(".detail-text-diff").textContent).toContain("UAT");
    expect(root.querySelector(".detail-text-diff").textContent).toContain("Pre-production");
    expect(root.querySelector(".detail-text-diff script")).toBeNull();

    root.querySelector('[data-index="1"]').click();
    expect(root.querySelector(".detail-text-diff .d2h-wrapper")).not.toBeNull();
    expect(root.querySelector(".detail-text-diff").textContent).toContain("old");
    root.querySelector('[data-detail-mode="fields"]').click();
    expect(root.querySelector(".detail-text-diff")).toBeNull();
  });

  it("shows strict JSON text differences even when parsed values are equivalent", () => {
    const view = new MasterDetailView();
    view.detailMode = "text-diff";
    const root = document.createElement("div");
    root.innerHTML = view.render(
      [{
        status: "differ",
        key: { id: "format" },
        env1_data: { value: '{"enabled":true}' },
        env2_data: { value: '{ "enabled": true }' },
        differences: ["value"],
      }],
      "UAT",
      "Pre-production",
      { compareFields: ["value"] },
    );

    expect(root.querySelector(".detail-text-diff .d2h-del")).not.toBeNull();
    expect(root.querySelector(".detail-text-diff .d2h-ins")).not.toBeNull();
  });

  it("opens the text diff from a grid inspection in the full results flow", () => {
    document.body.innerHTML = '<div id="results-content"></div><span id="view-type-label"></span>';
    const tool = new CompareConfigTool({ emit: vi.fn() });
    tool.queryMode = "unified";
    tool.results.unified = {
      env1_name: "UAT",
      env2_name: "Pre-production",
      _metadata: { compareFields: ["value"] },
      rows: [{
        status: "differ", key: { id: "config" },
        env1_data: { value: "before" }, env2_data: { value: "after" }, differences: ["value"],
      }],
    };

    tool.renderResults();
    document.querySelector(".grid-inspect-button").click();
    document.querySelector('[data-detail-mode="text-diff"]').click();
    expect(document.querySelector(".detail-text-diff .d2h-wrapper")).not.toBeNull();
  });
});
