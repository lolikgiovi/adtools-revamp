// @vitest-environment jsdom
// Failure cases: missing sections, wrong default/deep link, publishing still in Settings, child listeners surviving navigation.
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardPage } from "../main.js";
import { SettingsTemplate } from "../../settings/template.js";

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Dashboard navigation", () => {
  it.each([
    [null, "analytics", "#dashboard-auth-form"],
    [{ section: "approvals" }, "approvals", "#approval-auth-form"],
    [{ section: "publish-settings" }, "publish-settings", ".publish-auth"],
    [{ section: "unknown" }, "analytics", "#dashboard-auth-form"],
  ])("opens the requested section %j", (data, section, selector) => {
    const page = new DashboardPage();
    page.mount(document.body, data);
    expect([...document.querySelectorAll(".dashboard-navigation a")].map((link) => link.textContent)).toEqual([
      "Analytics",
      "Approvals",
      "Publish Settings",
    ]);
    expect(document.querySelector('[aria-current="page"]').getAttribute("href")).toBe(`#dashboard/${section}`);
    expect(document.querySelector(selector)).not.toBeNull();
    page.unmount();
    page.unmount();
  });

  it("removes analytics keyboard handlers on exit", () => {
    const page = new DashboardPage();
    page.mount(document.body);
    const child = page.child;
    const close = vi.spyOn(child, "closeRowDetail").mockImplementation(() => {});
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(close).toHaveBeenCalledOnce();
    page.unmount();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("keeps publishing out of Settings", () => {
    document.body.innerHTML = SettingsTemplate;
    expect(document.querySelector(".settings-publish, #settings-publishing")).toBeNull();
    expect(document.querySelector(".settings-sync-row")).not.toBeNull();
  });
});
