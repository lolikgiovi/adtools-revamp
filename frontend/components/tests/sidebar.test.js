// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "../Sidebar.js";
import { UsageTracker } from "../../core/UsageTracker.js";

const tools = [
  { id: "uuid-generator", name: "UUID Generator", icon: "uuid", category: "general" },
  { id: "json-tools", name: "JSON Tools", icon: "json", category: "general" },
];

function createSidebar({ pinnedTools = [], pinEducationShown = Sidebar.MAX_PIN_EDUCATION_SHOWN } = {}) {
  document.body.innerHTML = `
    <aside class="sidebar">
      <div class="sidebar-content"></div>
    </aside>
  `;

  return Object.assign(Object.create(Sidebar.prototype), {
    eventBus: { emit: vi.fn() },
    router: { getCurrentRoute: () => null },
    tools,
    getIcon: () => '<svg viewBox="0 0 24 24"></svg>',
    toolsConfigMap: new Map(tools.map((tool, index) => [tool.id, { ...tool, order: index }])),
    categoriesMap: new Map([["general", { id: "general", name: "General", order: 10 }]]),
    state: { isOpen: false, isCollapsed: false, isMobile: false },
    pinnedTools: new Set(pinnedTools),
    pinEducationShown,
    storage: localStorage,
    contextMenuEl: null,
    contextMenuToolId: null,
    pinEducationEl: null,
    pinEducationAnchor: null,
    pinEducationTimer: null,
    _runtimeRetry: true,
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.restoreAllMocks();
});

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(UsageTracker, "trackEvent").mockImplementation(() => {});
});

describe("Sidebar pinning", () => {
  it("moves a tool into the pinned group and logs the tool on pin and unpin", async () => {
    const sidebar = createSidebar();
    await sidebar.renderTools();

    const menuButton = document.querySelector('[data-tool="uuid-generator"] .sidebar-menu-button');
    const contextMenuEvent = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 60 });
    menuButton.dispatchEvent(contextMenuEvent);

    expect(contextMenuEvent.defaultPrevented).toBe(true);
    expect(document.querySelector(".sidebar-pin-context-menu")).not.toBeNull();
    expect(document.querySelector("[role='menuitem']").textContent).toContain("Pin UUID Generator");

    document.querySelector("[role='menuitem']").click();
    await sidebar.renderTools();

    expect(JSON.parse(localStorage.getItem(Sidebar.PINNED_TOOLS_STORAGE_KEY))).toEqual(["uuid-generator"]);
    expect(document.querySelector('[data-category="pinned"] [data-tool="uuid-generator"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-tool="uuid-generator"]')).toHaveLength(1);
    expect(UsageTracker.trackEvent).toHaveBeenCalledWith("uuid-generator", "sidebar_pin", {
      tool_id: "uuid-generator",
      source: "sidebar_context_menu",
    });

    const pinnedButton = document.querySelector('[data-category="pinned"] [data-tool="uuid-generator"] .sidebar-menu-button');
    pinnedButton.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 60 }));
    expect(document.querySelector("[role='menuitem']").textContent).toContain("Unpin UUID Generator");
    document.querySelector("[role='menuitem']").click();
    await sidebar.renderTools();

    expect(JSON.parse(localStorage.getItem(Sidebar.PINNED_TOOLS_STORAGE_KEY))).toEqual([]);
    expect(document.querySelector('[data-category="pinned"]')).toBeNull();
    expect(UsageTracker.trackEvent).toHaveBeenLastCalledWith("uuid-generator", "sidebar_unpin", {
      tool_id: "uuid-generator",
      source: "sidebar_context_menu",
    });
  });

  it("shows the pin education only once", async () => {
    const sidebar = createSidebar({ pinEducationShown: 0 });
    await sidebar.renderTools();
    sidebar.maybeShowPinEducation();

    expect(document.querySelector(".sidebar-pin-education").textContent).toContain("Right-click a tool to pin or unpin it");
    expect(localStorage.getItem(Sidebar.PIN_EDUCATION_STORAGE_KEY)).toBe("1");

    sidebar.hidePinEducation();
    sidebar.maybeShowPinEducation();
    expect(document.querySelector(".sidebar-pin-education")).toBeNull();
    expect(localStorage.getItem(Sidebar.PIN_EDUCATION_STORAGE_KEY)).toBe("1");
  });
});
