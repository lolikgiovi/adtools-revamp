// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../core/MonacoOracle.js", () => ({
  ensureMonacoWorkers: vi.fn(),
  setupMonacoOracle: vi.fn(),
  createOracleEditor: vi.fn(),
  ORACLE_LANGUAGE_ID: "oracle-sql",
  ORACLE_THEME: "oracle-theme",
}));

import { QuickQueryUI } from "../main.js";

function createTab(id) {
  return {
    id,
    title: id,
    tableName: "",
    schemaData: [["", "", "", "", "", ""]],
    inputData: [[], []],
    attachments: [],
    generatedSql: "",
  };
}

function createUi(tabs, activeTabId = tabs[0]?.id) {
  const ui = Object.create(QuickQueryUI.prototype);
  ui.tabs = tabs;
  ui.activeTabId = activeTabId;
  ui._storageReady = true;
  ui.storageService = {
    updateQueryTabs: vi.fn(async () => true),
    saveQueryTab: vi.fn(async () => true),
  };
  ui.elements = {};
  ui.flushPendingDataAutosave = vi.fn(async () => undefined);
  ui.saveActiveTabDraft = vi.fn(async () => true);
  ui.saveTabSession = vi.fn(async () => true);
  ui.applyTabDraft = vi.fn(async () => undefined);
  ui.renderTabs = vi.fn();
  ui.showTabUndo = vi.fn();
  return ui;
}

describe("Quick Query tab management", () => {
  it("closes every tab except the tab used for the command", async () => {
    const tabs = [createTab("tab-1"), createTab("tab-2"), createTab("tab-3")];
    const ui = createUi(tabs, "tab-2");

    await ui.closeOtherTabs("tab-3");

    expect(ui.tabs.map((tab) => tab.id)).toEqual(["tab-3"]);
    expect(ui.activeTabId).toBe("tab-3");
    expect(ui.storageService.updateQueryTabs).toHaveBeenCalledWith({
      deleteIds: ["tab-1", "tab-2"],
      tabs: [],
      tabOrder: ["tab-3"],
      activeTabId: "tab-3",
    });
    expect(ui.saveActiveTabDraft).toHaveBeenCalledOnce();
    expect(ui.applyTabDraft).toHaveBeenCalledWith(tabs[2]);
  });

  it("closes tabs to the right while keeping the active tab when it is not closed", async () => {
    const tabs = [createTab("tab-1"), createTab("tab-2"), createTab("tab-3"), createTab("tab-4")];
    const ui = createUi(tabs, "tab-2");

    await ui.closeTabsToRight("tab-2");

    expect(ui.tabs.map((tab) => tab.id)).toEqual(["tab-1", "tab-2"]);
    expect(ui.activeTabId).toBe("tab-2");
    expect(ui.storageService.updateQueryTabs).toHaveBeenCalledWith({
      deleteIds: ["tab-3", "tab-4"],
      tabs: [],
      tabOrder: ["tab-1", "tab-2"],
      activeTabId: "tab-2",
    });
    expect(ui.saveActiveTabDraft).toHaveBeenCalledOnce();
    expect(ui.applyTabDraft).not.toHaveBeenCalled();
  });

  it("activates the clicked tab when closing the tabs to its right also closes the active tab", async () => {
    const tabs = [createTab("tab-1"), createTab("tab-2"), createTab("tab-3"), createTab("tab-4")];
    const ui = createUi(tabs, "tab-4");

    await ui.closeTabsToRight("tab-2");

    expect(ui.tabs.map((tab) => tab.id)).toEqual(["tab-1", "tab-2"]);
    expect(ui.activeTabId).toBe("tab-2");
    expect(ui.saveActiveTabDraft).toHaveBeenCalledOnce();
    expect(ui.applyTabDraft).toHaveBeenCalledWith(tabs[1]);
  });

  it("closes tabs to the left and activates the clicked tab", async () => {
    const tabs = [createTab("tab-1"), createTab("tab-2"), createTab("tab-3")];
    const ui = createUi(tabs, "tab-1");

    await ui.closeTabsToLeft("tab-3");

    expect(ui.tabs.map((tab) => tab.id)).toEqual(["tab-3"]);
    expect(ui.activeTabId).toBe("tab-3");
    expect(ui.storageService.updateQueryTabs).toHaveBeenCalledWith({
      deleteIds: ["tab-1", "tab-2"],
      tabs: [],
      tabOrder: ["tab-3"],
      activeTabId: "tab-3",
    });
  });

  it("replaces all closed tabs with one blank tab so the tool remains usable", async () => {
    const tabs = [createTab("tab-1"), createTab("tab-2"), createTab("tab-3")];
    const ui = createUi(tabs, "tab-2");

    await ui.closeAllTabs();

    expect(ui.tabs).toHaveLength(1);
    expect(ui.tabs[0].id).not.toBe("tab-1");
    expect(ui.tabs[0].id).not.toBe("tab-2");
    expect(ui.tabs[0].id).not.toBe("tab-3");
    expect(ui.activeTabId).toBe(ui.tabs[0].id);
    expect(ui.storageService.updateQueryTabs).toHaveBeenCalledWith({
      deleteIds: ["tab-1", "tab-2", "tab-3"],
      tabs: [ui.tabs[0]],
      tabOrder: [ui.tabs[0].id],
      activeTabId: ui.tabs[0].id,
    });
    expect(ui.applyTabDraft).toHaveBeenCalledWith(ui.tabs[0]);
  });

  it("restores a bulk close with its original order and active tab", async () => {
    const tabs = [createTab("tab-1"), createTab("tab-2"), createTab("tab-3")];
    const ui = createUi(tabs, "tab-2");

    await ui.closeAllTabs();
    await ui.undoCloseTabs();

    expect(ui.tabs.map((tab) => tab.id)).toEqual(["tab-1", "tab-2", "tab-3"]);
    expect(ui.activeTabId).toBe("tab-2");
    expect(ui.storageService.updateQueryTabs).toHaveBeenLastCalledWith({
      deleteIds: [expect.stringMatching(/^qq-tab-/)],
      tabs: expect.arrayContaining([expect.objectContaining({ id: "tab-1" }), expect.objectContaining({ id: "tab-2" })]),
      tabOrder: ["tab-1", "tab-2", "tab-3"],
      activeTabId: "tab-2",
    });
  });

  it("keeps tabs open when the current draft cannot be saved", async () => {
    const tabs = [createTab("tab-1"), createTab("tab-2")];
    const ui = createUi(tabs);
    ui.saveActiveTabDraft.mockResolvedValue(false);

    expect(await ui.closeTab("tab-1")).toBe(false);
    expect(ui.tabs.map((tab) => tab.id)).toEqual(["tab-1", "tab-2"]);
    expect(ui.storageService.updateQueryTabs).not.toHaveBeenCalled();
  });

  it("scrolls the active tab into view after it is rendered", () => {
    const tabList = document.createElement("div");
    const activeTab = document.createElement("div");
    activeTab.dataset.tabId = "tab-3";
    activeTab.scrollIntoView = vi.fn();
    tabList.appendChild(activeTab);

    const ui = createUi([createTab("tab-1"), createTab("tab-2"), createTab("tab-3")], "tab-3");
    ui.elements = { tabList };

    ui.scrollActiveTabIntoView();

    expect(activeTab.scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "nearest",
      inline: "nearest",
    });
  });

  it("shows browser-like bulk close actions in the tab context menu", async () => {
    const tabList = document.createElement("div");
    document.body.appendChild(tabList);
    const tabs = [createTab("tab-1"), createTab("tab-2"), createTab("tab-3")];
    const ui = createUi(tabs, "tab-1");
    ui.elements = { tabList };

    ui.openTabContextMenu(
      {
        clientX: 20,
        clientY: 20,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      },
      "tab-2",
    );

    const labels = [...document.querySelectorAll(".qq-tab-context-menu button")].map((button) => button.textContent);
    expect(labels).toEqual([
      "Rename",
      "Duplicate",
      "Close",
      "Close Other Tabs",
      "Close Tabs to the Left",
      "Close Tabs to the Right",
      "Close All Tabs",
    ]);
    expect(document.querySelector(".qq-tab-context-menu")?.getAttribute("role")).toBe("menu");

    ui.closeTabContextMenu();
    tabList.remove();
  });
});
