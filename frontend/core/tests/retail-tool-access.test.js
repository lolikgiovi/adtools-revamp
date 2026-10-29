// @vitest-environment jsdom
// Failure cases: missing or non-RETAIL departments hide execution tools; direct links redirect;
// desktop-only tools become visible in the browser; unrelated tools are accidentally restricted.
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App.js";
import { Sidebar } from "../../components/Sidebar.js";
import { buildToolDefinitions } from "../../config/toolDefinitions.js";
import config from "../../config/tools.json";

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
  delete window.__TAURI__;
});

function appHarness() {
  return Object.assign(Object.create(App.prototype), {
    toolDefinitions: buildToolDefinitions(config.tools),
    router: { navigate: vi.fn() },
    isNavigationCurrent: () => true,
    ensureToolLoaded: vi.fn(),
  });
}

describe("Execution-tool visibility for all departments", () => {
  it.each([null, "", "SME", "WHOLESALE", "RETAIL OPERATIONS", "RETAIL", " retail "])(
    "shows discovery and pinned navigation for department %s",
    async (department) => {
      if (department !== null) localStorage.setItem("user.department", department);
      window.__TAURI__ = {};
      const app = appHarness();
      const allowed = true;
      for (const forHome of [false, true]) {
        const visible = app.getVisibleToolDefinitions({ runtimeIsTauri: true, forHome }).map((tool) => tool.id);
        expect(visible.includes("run-query")).toBe(allowed);
        expect(visible.includes("run-batch")).toBe(allowed);
        expect(visible).toContain("redis-cache");
      }
      document.body.innerHTML = '<div class="sidebar-content"></div>';
      const sidebar = Object.assign(Object.create(Sidebar.prototype), {
        tools: app.getToolDefinitions(),
        toolsConfigMap: new Map(config.tools.map((tool) => [tool.id, tool])),
        categoriesMap: new Map(config.categories.map((category) => [category.id, category])),
        router: { getCurrentRoute: () => null },
        getIcon: () => "<svg></svg>",
        pinnedTools: new Set(["run-query", "run-batch"]),
        _runtimeRetry: true,
      });
      await sidebar.renderTools();
      expect(Boolean(document.querySelector('[data-tool="run-query"]'))).toBe(allowed);
      expect(Boolean(document.querySelector('[data-tool="run-batch"]'))).toBe(allowed);
      expect(document.querySelector('[data-tool="redis-cache"]')).not.toBeNull();
    },
  );

  it("keeps execution tools desktop-only", () => {
    const app = appHarness();
    for (const forHome of [false, true]) {
      const visible = app.getVisibleToolDefinitions({ runtimeIsTauri: false, forHome }).map((tool) => tool.id);
      expect(visible).not.toContain("run-query");
      expect(visible).not.toContain("run-batch");
    }
  });

  it.each([
    [null, "run-query"],
    ["SME", "run-query"],
    [null, "run-batch"],
    ["SME", "run-batch"],
  ])("loads a direct link for department %s and tool %s", async (department, toolId) => {
    if (department !== null) localStorage.setItem("user.department", department);
    localStorage.setItem("user.email", "registered@bankmandiri.co.id");
    localStorage.setItem("user.username", "Registered User");
    localStorage.setItem("user.registered", "true");
    window.__TAURI__ = {};
    const app = appHarness();
    app.clearCurrentShellPage = vi.fn();
    app.setMainContentFlush = vi.fn();
    app.warmHeavyTools = new Map();
    app.renderLoadingState = vi.fn();
    app.loadWithAssetRecovery = (load) => load();
    await app.showTool(toolId);
    expect(app.router.navigate).not.toHaveBeenCalled();
    expect(app.ensureToolLoaded).toHaveBeenCalledWith(toolId);
  });
});
