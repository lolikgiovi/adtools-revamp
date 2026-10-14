// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnalyticsDashboardPage } from "../main.js";
// Failure cases: request uses truncated name; stale person response replaces another person;
// date changes lose identity; back navigation loses directory; empty profile appears broken.
let page;
afterEach(() => {
  page?.unmount();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});
function setup() {
  page = new AnalyticsDashboardPage();
  page.mount(document.createElement("div"));
  page.token = "token";
  page.currentTab = "who";
  page.lastRenderedData = [{ section: "Top users", rank: 1, user: "alex", user_email: "alex@one.test", events: 2 }];
  return page.container;
}
describe("person detail", () => {
  it("requests the exact person and keeps the selected date range", async () => {
    const root = setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        json: async () => ({
          ok: true,
          data: {
            summary: { user_email: "alex@one.test", events: 2, active_days: 1, tools_used: 1, devices_seen: 1 },
            tools: [{ tool_id: "quick-query", events: 2 }],
            actions: [{ tool_id: "quick-query", action: "merge", events: 2 }],
            days: [],
            recent: [],
            errors: [],
          },
        }),
      }),
    );
    await page.openPerson("alex@one.test");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ tabId: "who", person: "alex@one.test", range: "30d" });
    expect(root.querySelector(".person-profile").textContent).toContain("alex@one.test");
    expect(root.querySelector(".person-profile").textContent).toContain("Quick Query");
    root.querySelector("[data-person-back]").click();
    expect(page.selectedPerson).toBeNull();
    expect(root.querySelector(".who-insights")).not.toBeNull();
  });
  it("ignores an older profile response after selecting someone else", async () => {
    const root = setup();
    let resolve;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockReturnValueOnce(new Promise((r) => (resolve = r)))
        .mockResolvedValueOnce({
          status: 200,
          json: async () => ({
            ok: true,
            data: { summary: { user_email: "second@test", events: 0 }, tools: [], actions: [], days: [], recent: [], errors: [] },
          }),
        }),
    );
    const old = page.openPerson("first@test");
    await page.openPerson("second@test");
    resolve({ status: 200, json: async () => ({ ok: true, data: { summary: { user_email: "first@test", events: 99 } } }) });
    await old;
    expect(root.querySelector(".person-profile").textContent).toContain("second@test");
    expect(root.querySelector(".person-profile").textContent).not.toContain("first@test");
  });
});
