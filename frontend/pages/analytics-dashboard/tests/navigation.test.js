// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnalyticsDashboardPage } from "../main.js";

// Failure cases: report overload returns; custom reports disappear; report IDs inject markup;
// browsing sends an invalid query; stale requests replace the catalog; selected reports lose context.
const tabs = [
  { id: "overview", name: "Overview" },
  { id: "who", name: "Who" },
  { id: "opportunities", name: "Opportunities" },
  { id: "daily", name: "Recent Activity" },
  { id: "quick-query", name: "Quick Query" },
  { id: "qq-outcomes", name: "QQ Outcomes" },
  { id: "errors", name: "Error Details" },
  { id: "custom-report", name: "Custom Report" },
];
let page;
afterEach(() => {
  page?.unmount();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});
function setup() {
  page = new AnalyticsDashboardPage();
  page.mount(document.createElement("div"));
  page.tabs = tabs;
  vi.spyOn(page, "loadCurrentTabData").mockResolvedValue();
  page.renderTabs();
  return page.container;
}
describe("dashboard navigation", () => {
  it("keeps only four main views and the report library in primary navigation", () => {
    const root = setup();
    expect(root.querySelectorAll("#dynamic-tabs button")).toHaveLength(5);
    expect(root.querySelector("#dynamic-tabs").textContent).not.toContain("QQ Outcomes");
  });
  it.each(["capability-adoption", "capability-people", "import-sources"])(
    "keeps %s discoverable and scoped to the selected date range",
    (id) => {
      const root = setup();
      page.tabs = [...tabs, { id, name: id }];
      expect(page.getReportGroups().find((group) => group.tabs.some((tab) => tab.id === id)).name).not.toBe("Custom Reports");
      page.switchTab(id);
      expect(root.querySelector(".dashboard-range").hidden).toBe(false);
      expect(page.getCacheKey(id)).toBe(`${id}:30d`);
      page.selectedRange = "7d";
      expect(page.getCacheKey(id)).toBe(`${id}:7d`);
      expect(root.querySelector("#dashboard-scope").textContent).toContain("last 30 days");
    },
  );

  it("groups every report, preserves custom reports, and searches by tool", () => {
    const root = setup();
    page.showReportLibrary();
    expect(page.currentTab).toBe("__reports");
    expect(page.loadCurrentTabData).not.toHaveBeenCalled();
    expect(root.querySelector(".report-library").textContent).toContain("Custom Report");
    const search = root.querySelector("#report-library-search");
    search.value = "Quick Query";
    search.dispatchEvent(new Event("input"));
    const matches = root.querySelectorAll(".report-link");
    expect(matches).toHaveLength(2);
    matches[1].click();
    expect(page.currentTab).toBe("qq-outcomes");
    expect(root.querySelector("#dashboard-report-title").textContent).toBe("QQ Outcomes");
    expect(root.querySelector("#dashboard-scope").textContent).toContain("Report-defined");
  });
  it("gives primary views one visible identity and contextual filters", () => {
    const root = setup();
    for (const [tab, search] of [
      ["overview", null],
      ["opportunities", "Search tools"],
      ["who", "Search people"],
      ["daily", "Search activity"],
    ]) {
      page.switchTab(tab);
      expect(root.querySelector(".dashboard-report-heading").hidden).toBe(true);
      expect(root.querySelector("#dashboard-report-picker")).toBeNull();
      const input = root.querySelector("#dashboard-search");
      expect(input.closest("label").hidden).toBe(search === null);
      if (search) expect(input.getAttribute("aria-label")).toBe(search);
    }
    page.switchTab("custom-report");
    expect(root.querySelector(".dashboard-report-heading").hidden).toBe(false);
    expect(root.querySelector("#dashboard-report-title").textContent).toBe("Custom Report");
    expect(root.querySelector("[data-library]").getAttribute("aria-current")).toBe("page");
  });
});
