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
  it("shows the desktop-only pages for the configured administrator email", () => {
    localStorage.setItem("user.email", "FASHALLI.BILHAQ@BANKMANDIRI.CO.ID");
    const app = Object.create(App.prototype);

    expect(app.buildMenuConfig().footer.map((item) => item.id)).toEqual(["about", "settings", "analytics-dashboard", "approval"]);
  });

  it("shows the desktop-only pages when the administrator override is enabled", () => {
    localStorage.setItem("administrator", "true");
    const app = Object.create(App.prototype);

    expect(app.buildMenuConfig().footer.map((item) => item.id)).toEqual(["about", "settings", "analytics-dashboard", "approval"]);
  });

  it("does not add the pages for other users", () => {
    localStorage.setItem("user.email", "someone@bankmandiri.co.id");
    const app = Object.create(App.prototype);

    expect(app.buildMenuConfig().footer.map((item) => item.id)).toEqual(["about", "settings"]);
  });

  it("marks both pages as desktop-only sidebar entries", () => {
    localStorage.setItem("administrator", "true");
    const app = Object.create(App.prototype);
    const privilegedItems = app.getPrivilegedSidebarItems();

    expect(privilegedItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "analytics-dashboard", requiresTauri: true }),
        expect.objectContaining({ id: "approval", requiresTauri: true }),
      ]),
    );
  });

  it("renders the privileged entries only in the desktop runtime", async () => {
    localStorage.setItem("administrator", "true");
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
    expect(document.querySelector('[data-page="analytics-dashboard"]')).toBeNull();
    expect(document.querySelector('[data-page="approval"]')).toBeNull();

    window.__TAURI__ = {};
    await sidebar.renderMenuGroups();
    expect(document.querySelector('[data-page="analytics-dashboard"]')).not.toBeNull();
    expect(document.querySelector('[data-page="approval"]')).not.toBeNull();
  });
});
