// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../App.js";
import { Sidebar } from "../../components/Sidebar.js";

afterEach(() => {
  localStorage.clear();
  delete window.__TAURI__;
  document.body.innerHTML = "";
});

describe("privileged sidebar pages", () => {
  // Failure cases: matching email blocked by a missing/false flag; absent or other email granted access by the flag.
  it.each([null, "false", "true"])("shows the privileged pages for the configured email with flag %s", (flag) => {
    localStorage.setItem("user.email", " FASHALLI.BILHAQ@BANKMANDIRI.CO.ID ");
    if (flag !== null) localStorage.setItem("administrator", flag);
    const app = Object.create(App.prototype);

    expect(app.buildMenuConfig().footer.map((item) => item.id)).toEqual(["about", "settings", "analytics-dashboard", "approval"]);
  });

  it.each(["", "another@bankmandiri.co.id"])("does not show the privileged pages for other email %s with the flag", (email) => {
    if (email) localStorage.setItem("user.email", email);
    localStorage.setItem("administrator", "true");
    const app = Object.create(App.prototype);

    expect(app.buildMenuConfig().footer.map((item) => item.id)).toEqual(["about", "settings"]);
  });

  it("renders the privileged entries in the web runtime", async () => {
    localStorage.setItem("user.email", "fashalli.bilhaq@bankmandiri.co.id");
    const app = Object.create(App.prototype);
    const sidebar = Object.assign(Object.create(Sidebar.prototype), {
      menuConfig: app.buildMenuConfig(),
      getMenuConfig: app.buildMenuConfig.bind(app),
      tools: [],
      getIcon: () => '<svg viewBox="0 0 24 24"></svg>',
      toolsConfigMap: new Map(),
      categoriesMap: new Map(),
      router: { getCurrentRoute: () => null },
      _menuRuntimeRetry: true,
    });
    document.body.innerHTML = '<div class="sidebar-menu" data-group="footer"></div>';

    await sidebar.renderMenuGroups();
    expect(document.querySelector('[data-page="analytics-dashboard"]')).not.toBeNull();
    expect(document.querySelector('[data-page="approval"]')).not.toBeNull();
  });
});
