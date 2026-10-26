// @vitest-environment jsdom
// Failure cases: missing/other departments see Run Query or Run Batch; pins bypass filtering; direct links load it;
// RETAIL loses access; department casing/whitespace changes access; unrelated tools are accidentally restricted.
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

describe("RETAIL execution-tool visibility", () => {
  it.each([null, "", "SME", "WHOLESALE", "RETAIL OPERATIONS", "RETAIL", " retail "])(
    "filters discovery and pinned navigation for department %s",
    async (department) => {
      if (department !== null) localStorage.setItem("user.department", department);
      window.__TAURI__ = {};
      const app = appHarness();
      const allowed = department?.trim().toUpperCase() === "RETAIL";
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

  it.each([
    [null, "run-query"],
    ["SME", "run-query"],
    [null, "run-batch"],
    ["SME", "run-batch"],
  ])("redirects a direct link for department %s and tool %s before loading", async (department, toolId) => {
    if (department !== null) localStorage.setItem("user.department", department);
    localStorage.setItem("user.email", "registered@bankmandiri.co.id");
    localStorage.setItem("user.username", "Registered User");
    localStorage.setItem("user.registered", "true");
    window.__TAURI__ = {};
    const app = appHarness();
    await app.showTool(toolId);
    expect(app.router.navigate).toHaveBeenCalledWith("home");
    expect(app.ensureToolLoaded).not.toHaveBeenCalled();
  });
});
