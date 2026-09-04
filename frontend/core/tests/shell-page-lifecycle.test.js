// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App.js";
import { AboutPage } from "../../pages/about/main.js";
import { AnalyticsDashboardPage } from "../../pages/analytics-dashboard/main.js";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  sessionStorage.clear();
});

describe("shell page lifecycle", () => {
  it("disposes the App-owned shell page once", () => {
    const page = { deactivate: vi.fn(), unmount: vi.fn() };
    const app = Object.assign(Object.create(App.prototype), { currentShellPage: page });

    app.clearCurrentShellPage();
    app.clearCurrentShellPage();

    expect(page.deactivate).toHaveBeenCalledOnce();
    expect(page.unmount).toHaveBeenCalledOnce();
    expect(app.currentShellPage).toBeNull();
  });

  it("removes About's exact outside-click listener and tolerates repeated unmounts", () => {
    const page = new AboutPage();
    const root = document.createElement("div");
    page.mount(root);
    const listener = page._documentClickListener;
    const removeSpy = vi.spyOn(document, "removeEventListener");

    page.unmount();
    page.unmount();

    expect(listener).toEqual(expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("click", listener);
    expect(removeSpy.mock.calls.filter(([eventName, callback]) => eventName === "click" && callback === listener)).toHaveLength(1);
    expect(page.container).toBeNull();
  });

  it("keeps active Analytics Escape behavior and removes it on unmount", () => {
    const page = new AnalyticsDashboardPage();
    const root = document.createElement("div");
    page.mount(root);
    const listener = page.documentKeydownListener;
    const closeRowDetail = vi.spyOn(page, "closeRowDetail").mockImplementation(() => {});

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(closeRowDetail).toHaveBeenCalledOnce();

    page.unmount();
    page.unmount();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(listener).toEqual(expect.any(Function));
    expect(page.documentKeydownListener).toBeNull();
    expect(closeRowDetail).toHaveBeenCalledOnce();
  });
});
