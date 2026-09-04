// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { AnalyticsDashboardPage } from "../main.js";

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

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
  return page;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  sessionStorage.clear();
});

describe("AnalyticsDashboardPage request currentness", () => {
  it("ignores an older tab response after switching tabs", async () => {
    const page = createPage();
    const first = deferred();
    const second = deferred();
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise));

    page.currentTab = "daily";
    const firstLoad = page.loadCurrentTabData();
    page.switchTab("events");

    first.resolve(response({ ok: true, data: [{ action: "stale" }] }));
    second.resolve(response({ ok: true, data: [{ action: "current" }] }));
    await firstLoad;
    await Promise.resolve();
    await Promise.resolve();

    expect(page.currentTab).toBe("events");
    expect(page.container.querySelector(".panel-content").textContent).toContain("current");
    expect(page.container.querySelector(".panel-content").textContent).not.toContain("stale");

    page.unmount();
  });

  it("logs out only for a current request that receives 401", async () => {
    const page = createPage();
    const logout = vi.spyOn(page, "logout").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ok: false }, 401)));

    page.currentTab = "daily";
    await page.loadCurrentTabData();

    expect(logout).toHaveBeenCalledOnce();
    page.unmount();
  });
});
