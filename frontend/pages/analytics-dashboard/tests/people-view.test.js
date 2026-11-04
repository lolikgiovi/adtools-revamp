// @vitest-environment jsdom
// The dashboard shows who the users are and what each use recorded.
// Ways it could go wrong: the People list hides idle people or ignores the department picked in the summary; a person
// can't be opened from it; People rows lose department or role; recent uses hide their detail, show raw JSON, or let
// recorded text inject markup.
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnalyticsDashboardPage } from "../main.js";
import { renderDepartmentUsage } from "../departments.js";

let page;
afterEach(() => {
  page?.unmount();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

function mountPage() {
  page = new AnalyticsDashboardPage();
  page.mount(document.createElement("div"));
  page.token = "token";
  return page;
}

const departmentData = {
  departments: [
    { department: "RETAIL", registered_people: 1, active_people: 1, devices: 2, actions: 5, tools: 2 },
    { department: "WHOLESALE", registered_people: 1, active_people: 0, devices: 0, actions: 0, tools: 0 },
  ],
  tools: [{ department: "RETAIL", tool_id: "plantuml", actions: 4, people: 1 }],
  people: [
    { user_email: "ana@example.test", department: "RETAIL", role: "ENGINEER", uses: 5, tools: 2, devices: 2, top_tool: "plantuml" },
    { user_email: "quiet@example.test", department: "WHOLESALE", role: null, uses: 0, tools: 0, devices: 0, top_tool: null },
  ],
};

describe("people by department", () => {
  it("lists everyone, narrows to the department picked in the summary, and opens a person", () => {
    const view = mountPage();
    const container = document.createElement("div");
    const open = vi.spyOn(view, "openPerson").mockResolvedValue();
    renderDepartmentUsage(view, container, departmentData);
    const emails = () => [...container.querySelectorAll("[data-person]")].map((button) => button.dataset.person);
    expect(emails()).toEqual(["ana@example.test", "quiet@example.test"]);
    expect(container.querySelector(".department-people").textContent).toContain("Engineer");

    container.querySelector('[data-department-filter="WHOLESALE"]').click();
    expect(emails()).toEqual(["quiet@example.test"]);
    container.querySelector('[data-department-filter="WHOLESALE"]').click();
    expect(emails()).toEqual(["ana@example.test", "quiet@example.test"]);

    container.querySelector('[data-person="ana@example.test"]').click();
    expect(open).toHaveBeenCalledWith("ana@example.test");
  });
});

describe("people table", () => {
  it("shows each person's department and role", () => {
    const view = mountPage();
    view.currentTab = "who";
    const container = document.createElement("div");
    view.lastRenderedData = [
      { section: "Top users", rank: 1, user: "ana", user_email: "ana@example.test", department: "RETAIL", role: "ENGINEER", events: 5 },
    ];
    view.renderWhoInsights(container, view.lastRenderedData);
    const text = container.querySelector(".who-insights tbody").textContent;
    expect(text).toContain("RETAIL");
    expect(text).toContain("Engineer");
  });
});

describe("person detail", () => {
  it("shows department, role and the detail of each recent use, escaped", () => {
    const view = mountPage();
    view.selectedPerson = "ana@example.test";
    const content = document.createElement("div");
    view.renderPersonProfile(
      content,
      {
        summary: { user_email: "ana@example.test", department: "RETAIL", role: "ENGINEER", events: 1 },
        tools: [],
        actions: [],
        days: [],
        recent: [
          {
            user_email: "ana@example.test",
            tool_id: "plantuml",
            action: "view",
            device_id: "ana-mac",
            created_time: "2026-11-03T10:00:00",
            details: JSON.stringify({ file_name: "<b>payment</b>.puml", diagram_type: "sequence", line_count: 42 }),
          },
        ],
        errors: [],
      },
      "successful uses",
    );
    expect(content.querySelector(".person-heading").textContent).toContain("RETAIL");
    expect(content.querySelector(".person-heading").textContent).toContain("Engineer");
    const detail = content.querySelector(".person-use-detail").textContent;
    expect(detail).toContain("<b>payment</b>.puml");
    expect(detail).toContain("Sequence");
    expect(detail).toContain("42 lines");
    expect(content.querySelector(".person-use-detail b")).toBeNull();
    expect(detail).not.toContain("{");
  });
});
