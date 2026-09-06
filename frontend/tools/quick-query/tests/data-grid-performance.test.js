// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const handsontableInstances = vi.hoisted(() => []);

vi.mock("handsontable", () => ({
  default: class HandsontableMock {
    constructor(element, settings) {
      this.rootElement = element;
      this.settings = { ...settings };
      this.updateSettings = vi.fn((nextSettings) => {
        this.settings = { ...this.settings, ...nextSettings };
      });
      this.render = vi.fn();
      this.refreshDimensions = vi.fn();
      handsontableInstances.push(this);
    }
  },
}));

vi.mock("../../../core/MonacoOracle.js", () => ({
  ensureMonacoWorkers: vi.fn(),
  setupMonacoOracle: vi.fn(),
  createOracleEditor: vi.fn(),
  ORACLE_LANGUAGE_ID: "oracle-sql",
  ORACLE_THEME: "oracle-theme",
}));

import { QuickQueryUI } from "../main.js";

function createUi() {
  const toolContainer = document.createElement("div");
  const contentA = document.createElement("div");
  const dataContainer = document.createElement("div");
  const schemaContainer = document.createElement("div");
  const wrapToggle = document.createElement("input");
  const maximizeButton = document.createElement("button");
  toolContainer.className = "quick-query-tool-container";
  contentA.className = "content-a";
  dataContainer.id = "spreadsheet-data";
  schemaContainer.id = "spreadsheet-schema";
  wrapToggle.id = "toggleWrapText";
  maximizeButton.id = "toggleDataMaximize";
  wrapToggle.type = "checkbox";
  dataContainer.getBoundingClientRect = () => ({ top: toolContainer.classList.contains("data-maximized") ? 120 : 500 });
  toolContainer.append(contentA, schemaContainer, wrapToggle, maximizeButton, dataContainer);
  document.body.append(toolContainer);

  const ui = Object.create(QuickQueryUI.prototype);
  ui.elements = { toolContainer, contentA, dataContainer, schemaContainer, toggleWrapText: wrapToggle, toggleDataMaximize: maximizeButton };
  ui.scheduleSchemaLayoutRefresh = vi.fn();
  ui.scheduleDataTableLayoutRefresh = vi.fn(() => ui.syncDataTableLayout());
  ui.isDataMaximized = false;
  return { ui, dataContainer, maximizeButton, toolContainer, wrapToggle };
}

describe("Quick Query data-grid performance", () => {
  beforeEach(() => {
    handsontableInstances.length = 0;
    document.body.replaceChildren();
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  });

  it("constructs the data grid with a finite virtualized viewport and fixed rows", () => {
    const { ui } = createUi();

    ui.initializeSpreadsheets();

    const dataTable = handsontableInstances[1];
    expect(dataTable.settings.height).toBe(276);
    expect(dataTable.settings.autoRowSize).toBe(false);
    expect(dataTable.settings.rowHeights).toBe(20);
  });

  it("uses all remaining viewport height without imposing a small maximum", () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1200 });
    const { ui } = createUi();

    ui.initializeSpreadsheets();

    expect(handsontableInstances[1].settings.height).toBe(676);
  });

  it("enables automatic row measurement only while wrapping is on", () => {
    const { ui, dataContainer, wrapToggle } = createUi();
    ui.initializeSpreadsheets();

    wrapToggle.checked = true;
    ui.handleToggleWrapText();

    expect(dataContainer.classList.contains("wrap-text-on")).toBe(true);
    expect(ui.dataTable.updateSettings).toHaveBeenLastCalledWith(expect.objectContaining({ autoRowSize: true, rowHeights: undefined }));

    wrapToggle.checked = false;
    ui.handleToggleWrapText();

    expect(dataContainer.classList.contains("wrap-text-on")).toBe(false);
    expect(ui.dataTable.updateSettings).toHaveBeenLastCalledWith(expect.objectContaining({ autoRowSize: false, rowHeights: 20 }));
  });

  it("maximizes the data workspace and restores the split workspace", () => {
    const { ui, maximizeButton, toolContainer } = createUi();
    ui.initializeSpreadsheets();

    ui.toggleDataMaximize();

    expect(toolContainer.classList.contains("data-maximized")).toBe(true);
    expect(maximizeButton.textContent).toBe("Restore Split View");
    expect(maximizeButton.getAttribute("aria-pressed")).toBe("true");
    expect(ui.dataTable.updateSettings).toHaveBeenLastCalledWith(expect.objectContaining({ height: 656 }));

    ui.handleDataMaximizeKeydown({ key: "Escape" });

    expect(toolContainer.classList.contains("data-maximized")).toBe(false);
    expect(maximizeButton.textContent).toBe("Maximize Data");
    expect(maximizeButton.getAttribute("aria-pressed")).toBe("false");
    expect(ui.dataTable.updateSettings).toHaveBeenLastCalledWith(expect.objectContaining({ height: 276 }));
  });
});
