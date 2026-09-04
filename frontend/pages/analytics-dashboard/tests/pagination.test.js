// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { AnalyticsDashboardPage } from "../main.js";

function response(body, status = 200) {
  return {
    status,
    json: async () => body,
  };
}

function createPage() {
  const page = new AnalyticsDashboardPage();
  const root = document.createElement("div");
  page.mount(root);
  page.token = "token";
  page.currentTab = "daily";
  return page;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  sessionStorage.clear();
});

describe("AnalyticsDashboardPage pagination", () => {
  it("loads the first page and appends the next page without losing rows", async () => {
    const page = createPage();
    const firstRows = Array.from({ length: 100 }, (_, index) => ({ time: `00:${index}`, user: `user-${index}`, action: "open" }));
    const secondRows = [{ time: "01:00", user: "last-user", action: "run" }];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ ok: true, data: firstRows, pagination: { page: 1, pageSize: 100, hasMore: true } }))
      .mockResolvedValueOnce(response({ ok: true, data: secondRows, pagination: { page: 2, pageSize: 100, hasMore: false } }));
    vi.stubGlobal("fetch", fetchMock);

    await page.loadCurrentTabData();

    const content = page.container.querySelector(".panel-content");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ tabId: "daily", page: 1, pageSize: 100, search: "" });
    expect(page.pagination.daily).toMatchObject({ page: 1, hasMore: true, rows: firstRows });
    expect(content.querySelector("#dashboard-load-more")).not.toBeNull();
    expect(content.textContent).toContain("user-99");

    await page.loadCurrentTabData({ append: true });

    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ tabId: "daily", page: 2, pageSize: 100, search: "" });
    expect(page.pagination.daily.rows).toHaveLength(101);
    expect(content.textContent).toContain("last-user");
    expect(content.querySelector("#dashboard-load-more")).toBeNull();

    page.unmount();
  });

  it("normalizes search state and sends it to the server for the first page", async () => {
    const page = createPage();
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        ok: true,
        data: [{ time: "now", user: "Ada", action: "open" }],
        pagination: { page: 1, pageSize: 100, hasMore: false },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const searchInput = page.container.querySelector("#dashboard-search");
    searchInput.value = "  ADA  ";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));

    await Promise.resolve();
    await Promise.resolve();

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ tabId: "daily", page: 1, search: "ada" });
    expect(page.pagination.daily.search).toBe("ada");
    page.unmount();
  });
});
