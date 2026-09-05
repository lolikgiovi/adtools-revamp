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
  it("does not show the privileged pages for the configured email without the flag", () => {
    localStorage.setItem("user.email", "FASHALLI.BILHAQ@BANKMANDIRI.CO.ID");
    const app = Object.create(App.prototype);

    expect(app.buildMenuConfig().footer.map((item) => item.id)).toEqual(["about", "settings"]);
  });

  it("does not show the privileged pages for the flag without the configured email", () => {
    localStorage.setItem("administrator", "true");
    const app = Object.create(App.prototype);

    expect(app.buildMenuConfig().footer.map((item) => item.id)).toEqual(["about", "settings"]);
  });

  it("shows the privileged pages only when both conditions match", () => {
    localStorage.setItem("user.email", "FASHALLI.BILHAQ@BANKMANDIRI.CO.ID");
    localStorage.setItem("administrator", "true");
    const app = Object.create(App.prototype);

    expect(app.buildMenuConfig().footer.map((item) => item.id)).toEqual(["about", "settings", "analytics-dashboard", "approval"]);
  });

  it("marks both pages as web sidebar entries", () => {
    localStorage.setItem("user.email", "fashalli.bilhaq@bankmandiri.co.id");
    localStorage.setItem("administrator", "true");
    const app = Object.create(App.prototype);
    const privilegedItems = app.getPrivilegedSidebarItems();

    expect(privilegedItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "analytics-dashboard", name: "Analytics", requiresTauri: false }),
        expect.objectContaining({ id: "approval", name: "Approval", requiresTauri: false }),
      ]),
    );
  });

  it("renders the privileged entries in the web runtime", async () => {
    localStorage.setItem("user.email", "fashalli.bilhaq@bankmandiri.co.id");
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
    expect(document.querySelector('[data-page="analytics-dashboard"]')).not.toBeNull();
    expect(document.querySelector('[data-page="approval"]')).not.toBeNull();
  });
});
