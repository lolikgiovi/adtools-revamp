// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { AnalyticsDashboardPage } from "../main.js";
// Failure cases: misleading denominator; missing metric creates NaN; decorative summaries repeat data;
// navigation opens the same scalar modal instead of evidence; a zero denominator creates false percentage.
let page;
afterEach(() => {
  page?.unmount();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});
const metrics = [
  { metric: "Active users", value: "34" },
  { metric: "Successful tool uses", value: "4994" },
  { metric: "Tool opens", value: "1842" },
  { metric: "Uncaught errors", value: "50" },
  { metric: "Affected users", value: "13" },
  { metric: "Most used tool", value: "quick-query (2322)" },
  { metric: "Noisiest error", value: "run-query / Error (16)" },
];
it("leads with measured usage concentration and opens evidence views", () => {
  page = new AnalyticsDashboardPage();
  page.mount(document.createElement("div"));
  page.currentTab = "overview";
  vi.spyOn(page, "loadCurrentTabData").mockResolvedValue();
  const content = page.container.querySelector(".panel-content");
  page.renderTable(content, metrics);
  expect(content.textContent).toContain("46.5%");
  expect(content.textContent).toContain("Quick Query");
  expect(content.querySelector(".overview-grid")).toBeNull();
  expect(content.textContent).not.toContain("Showing 7 rows");
  content.querySelector('[data-overview-view="opportunities"]').click();
  expect(page.currentTab).toBe("opportunities");
});
it("does not invent a share when total successful uses is unavailable", () => {
  page = new AnalyticsDashboardPage();
  page.mount(document.createElement("div"));
  page.currentTab = "overview";
  const content = page.container.querySelector(".panel-content");
  page.renderTable(
    content,
    metrics.filter((row) => row.metric !== "Successful tool uses"),
  );
  expect(content.textContent).not.toContain("NaN");
  expect(content.textContent).not.toContain("Infinity");
  expect(content.textContent).not.toContain("46.5%");
});
