// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { AnalyticsDashboardPage } from "../main.js";
import { ApprovalPage } from "../../approval/main.js";

const TOKEN_KEY = "analytics.dashboard.token";

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Failure cases: restart loses the token; expired token unlocks; logout leaves a reusable token;
// existing tab sessions stop working; signing in fails to persist a token shared by both pages.
describe.each([
  ["Analytics", AnalyticsDashboardPage, "loadTabs", "handleAuth", "dashboard-password"],
  ["Approval", ApprovalPage, "loadRequests", "authenticate", "approval-password"],
])("%s password session", (_name, Page, loadMethod, authMethod, passwordId) => {
  function mount() {
    const page = new Page();
    vi.spyOn(page, loadMethod).mockResolvedValue();
    page.mount(document.createElement("div"));
    return page;
  }

  it("restores a persisted unexpired token after tab session storage is cleared", () => {
    const token = btoa(JSON.stringify({ exp: Date.now() + 24 * 60 * 60 * 1000 }));
    localStorage.setItem(TOKEN_KEY, token);
    sessionStorage.clear();
    const page = mount();
    expect(page.token).toBe(token);
    expect(page[loadMethod]).toHaveBeenCalledOnce();
    page.unmount?.();
  });

  it("does not restore an expired token", () => {
    localStorage.setItem(TOKEN_KEY, btoa(JSON.stringify({ exp: Date.now() - 1 })));
    const page = mount();
    expect(page.token).toBeNull();
    expect(page[loadMethod]).not.toHaveBeenCalled();
    page.unmount?.();
  });

  it("keeps existing tab sessions usable and removes both stores on logout", () => {
    const token = btoa(JSON.stringify({ exp: Date.now() + 60_000 }));
    sessionStorage.setItem(TOKEN_KEY, token);
    const page = mount();
    expect(page.token).toBe(token);
    localStorage.setItem(TOKEN_KEY, token);
    page.logout();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    page.unmount?.();
  });

  it("persists the token returned by password verification", async () => {
    const token = btoa(JSON.stringify({ exp: Date.now() + 24 * 60 * 60 * 1000 }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, token }) }));
    const page = mount();
    (page.container || page.root).querySelector(`#${passwordId}`).value = "test-password";
    await page[authMethod]({ preventDefault() {} });
    expect(localStorage.getItem(TOKEN_KEY)).toBe(token);
    page.unmount?.();
  });
});
