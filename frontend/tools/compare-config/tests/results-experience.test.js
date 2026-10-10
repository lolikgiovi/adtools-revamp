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
    expect(document.querySelector('[data-filter="differ"] .stat-label').textContent).toBe("Differing");
    expect(document.querySelector('[data-filter="differ"]').title).toBe(
      "4 records compared · 1 record with changed values · 1 record only in UAT · 1 record only in Pre-production",
    );
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

  it("opens a changed record on a text diff tabbed by its changed fields", () => {
    const view = new MasterDetailView();
    const root = document.createElement("div");
    root.innerHTML = view.render(
      [
        {
          status: "differ",
          key: { SERVICE_CODE: "gold-portfolio-buyback-price", ENVIRONMENT: "BETA" },
          env1_data: { SQL_QUERY: "#set($a = 1)", RESP_MAP_TEMPLATE: "<first/>", COLOR_HEX_CODE: "#E69F00" },
          env2_data: { SQL_QUERY: "#set($a = 2)", RESP_MAP_TEMPLATE: "<second/>", COLOR_HEX_CODE: "#E69F00" },
          differences: ["SQL_QUERY", "RESP_MAP_TEMPLATE"],
        },
      ],
      "(UAT1 COMP) SQL Query",
      "(UAT2 COMP) SQL Query",
      { compareFields: ["SQL_QUERY", "RESP_MAP_TEMPLATE", "COLOR_HEX_CODE"] },
    );

    expect(root.querySelector(".detail-title").textContent).toBe("gold-portfolio-buyback-price|BETA");
    expect([...root.querySelectorAll("[data-diff-field]")].map((tab) => tab.dataset.diffField)).toEqual([
      "SQL_QUERY",
      "RESP_MAP_TEMPLATE",
    ]);
    expect(root.querySelector('[data-diff-field="SQL_QUERY"]').getAttribute("aria-selected")).toBe("true");
    expect([...root.querySelectorAll(".detail-diff-columns span")].map((span) => span.textContent)).toEqual([
      "UAT1 COMP",
      "UAT2 COMP",
    ]);
    expect(root.querySelector(".detail-mode-switch")).toBeNull();
    expect(root.querySelector(".detail-text-diff .d2h-wrapper")).not.toBeNull();
  });

  it("swaps the diff for the chosen field and keeps focus on its tab", () => {
    const view = new MasterDetailView();
    const root = document.createElement("div");
    root.innerHTML = view.render(
      [
        {
          status: "differ",
          key: { id: "config" },
          env1_data: { value: '{"enabled":"0","note":"<script>"}', other: "before" },
          env2_data: { value: '{"enabled":"1","note":"<script>"}', other: "after" },
          differences: ["value", "other"],
        },
        { status: "only_in_env1", key: { id: "removed" }, env1_data: { value: "old" }, env2_data: null, differences: [] },
      ],
      "UAT",
      "Pre-production",
      { compareFields: ["value", "other"] },
    );
    document.body.appendChild(root);
    view.attachEventListeners(root);

    expect(root.querySelector(".detail-text-diff").textContent).toContain("enabled");
    expect(root.querySelector(".detail-text-diff script")).toBeNull();

    root.querySelector('[data-diff-field="other"]').click();
    expect(root.querySelector(".detail-text-diff").textContent).toContain("before");
    expect(root.querySelector(".detail-text-diff").textContent).toContain("after");
    expect(document.activeElement).toBe(root.querySelector('[data-diff-field="other"]'));

    root.querySelector('[data-index="1"]').click();
    expect(root.querySelector(".detail-text-diff").textContent).toContain("old");
  });

  it("marks the pane with no record and offers no field tabs for a matching record", () => {
    const view = new MasterDetailView();
    const root = document.createElement("div");
    root.innerHTML = view.render(
      [
        {
          status: "only_in_env2",
          key: { id: "added" },
          env1_data: null,
          env2_data: { value: "new" },
          differences: [],
        },
        {
          status: "match",
          key: { id: "same" },
          env1_data: { value: "on" },
          env2_data: { value: "on" },
          differences: [],
        },
      ],
      "(UAT1 COMP) SQL Query",
      "(UAT2 COMP) SQL Query",
      { compareFields: ["value"] },
    );

    expect([...root.querySelectorAll(".detail-diff-columns span")].map((span) => span.textContent)).toEqual([
      "UAT1 COMP · missing",
      "UAT2 COMP",
    ]);
    expect(root.querySelector(".detail-text-diff").textContent).toContain("(missing)");

    view.selectItem(1, root);
    expect(root.querySelector("[data-diff-field]")).toBeNull();
    expect(root.querySelector(".detail-diff-columns")).toBeNull();
    expect(root.querySelector(".detail-message").textContent).toContain("identical");
  });

  it("keeps the record list in place while the detail pane changes", () => {
    const view = new MasterDetailView();
    const root = document.createElement("div");
    root.innerHTML = view.render(
      [
        {
          status: "differ",
          key: { id: "first" },
          env1_data: { value: "1", other: "a" },
          env2_data: { value: "2", other: "a" },
          differences: ["value"],
        },
        {
          status: "differ",
          key: { id: "second" },
          env1_data: { value: "1", other: "a" },
          env2_data: { value: "1", other: "b" },
          differences: ["other"],
        },
      ],
      "UAT",
      "Pre-production",
      { compareFields: ["value", "other"] },
    );
    document.body.appendChild(root);
    view.attachEventListeners(root);

    expect([...root.querySelectorAll(".master-item-meta")].map((meta) => meta.textContent.trim())).toEqual([
      "value",
      "other",
    ]);

    const list = root.querySelector(".master-items");
    list.scrollTop = 140;
    root.querySelector('[data-index="1"]').click();

    expect(root.querySelector(".master-items")).toBe(list);
    expect(root.querySelector(".master-items").scrollTop).toBe(140);
    expect(root.querySelectorAll(".master-item")[1].classList.contains("selected")).toBe(true);
    expect(root.querySelectorAll(".master-item")[0].classList.contains("selected")).toBe(false);
  });

  it("walks records with the arrow keys and fields with the tab strip keys", () => {
    const view = new MasterDetailView();
    const root = document.createElement("div");
    root.innerHTML = view.render(
      [
        {
          status: "differ",
          key: { id: "first" },
          env1_data: { value: "1", other: "a" },
          env2_data: { value: "2", other: "b" },
          differences: ["value", "other"],
        },
        { status: "differ", key: { id: "second" }, env1_data: { value: "1" }, env2_data: { value: "2" }, differences: ["value"] },
      ],
      "UAT",
      "Pre-production",
      { compareFields: ["value", "other"] },
    );
    document.body.appendChild(root);
    view.attachEventListeners(root);

    const tablist = root.querySelector(".detail-field-tabs");
    expect(tablist.getAttribute("role")).toBe("tablist");
    tablist.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(view.selectedDiffField).toBe("other");
    expect(document.activeElement.dataset.diffField).toBe("other");

    const listbox = root.querySelector(".master-items");
    listbox.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(view.selectedIndex).toBe(1);
    expect(document.activeElement.dataset.index).toBe("1");
    listbox.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(view.selectedIndex).toBe(0);
  });

  it("shows strict JSON text differences even when parsed values are equivalent", () => {
    const view = new MasterDetailView();
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
    expect(document.querySelector("[data-diff-field]").dataset.diffField).toBe("value");
    expect(document.querySelector(".detail-text-diff .d2h-wrapper")).not.toBeNull();
  });
});
