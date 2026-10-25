// @vitest-environment jsdom
// Failure cases: timestamp formats form batches; rankings lose their order; sorting mutates cached data;
// changing reports reuses an unrelated sort; null dates displace real timestamps.
import { afterEach, expect, it } from "vitest";
import { AnalyticsDashboardPage } from "../main.js";
let page;
afterEach(() => page?.unmount());
it("sorts dated detail rows by actual time without changing the cached data", () => {
  page = new AnalyticsDashboardPage();
  page.mount(document.createElement("div"));
  page.currentTab = "json-tools";
  const data = [
    { time: "2026-10-25T08:00:00+07:00", action: "older" },
    { time: "2026-10-25 16:00:00+07:00", action: "newer" },
    { time: null, action: "missing" },
  ];
  const content = page.container.querySelector(".panel-content");
  page.renderTable(content, data);
  expect(content.querySelector("tbody tr").textContent).toContain("newer");
  expect(data[0].action).toBe("older");
  content.querySelector('[data-sort-column="time"]').click();
  expect(content.querySelector("tbody tr").textContent).toContain("older");
});
it("preserves count-ranked reports without date columns", () => {
  page = new AnalyticsDashboardPage();
  page.mount(document.createElement("div"));
  page.currentTab = "custom";
  const content = page.container.querySelector(".panel-content");
  page.renderTable(content, [
    { tool: "First", count: 30 },
    { tool: "Second", count: 2 },
  ]);
  expect(content.querySelector("tbody tr").textContent).toContain("First");
});
