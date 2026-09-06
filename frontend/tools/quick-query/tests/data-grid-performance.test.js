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
  const leftScroll = document.createElement("div");
  const dataContainer = document.createElement("div");
  const schemaContainer = document.createElement("div");
  const filesContainer = document.createElement("div");
  const wrapToggle = document.createElement("input");
  const wrapToggleLabel = document.createElement("span");
  const wordWrapButton = document.createElement("button");
  const wordWrapLabel = document.createElement("span");
  const maximizeButton = document.createElement("button");
  toolContainer.className = "quick-query-tool-container";
  contentA.className = "content-a";
  dataContainer.id = "spreadsheet-data";
  schemaContainer.id = "spreadsheet-schema";
  wrapToggle.id = "toggleWrapText";
  wrapToggleLabel.className = "wrap-text-toggle-label";
  wrapToggleLabel.textContent = "Wrap Text";
  wordWrapButton.id = "toggleWordWrap";
  wordWrapLabel.className = "word-wrap-toggle-label";
  wordWrapLabel.textContent = "Wrap";
  wordWrapButton.append(wordWrapLabel);
  maximizeButton.id = "toggleDataMaximize";
  leftScroll.className = "quick-query-left-scroll";
  filesContainer.id = "files-container";
  wrapToggle.type = "checkbox";
  Object.defineProperty(leftScroll, "clientHeight", { configurable: true, value: 320 });
  Object.defineProperty(filesContainer, "offsetHeight", { configurable: true, value: 56 });
  dataContainer.getBoundingClientRect = () => ({ top: toolContainer.classList.contains("data-maximized") ? 120 : 500 });
  leftScroll.append(schemaContainer, filesContainer);
  toolContainer.append(contentA, leftScroll, wrapToggle, wrapToggleLabel, wordWrapButton, maximizeButton, dataContainer);
  document.body.append(toolContainer);

  const ui = Object.create(QuickQueryUI.prototype);
  ui.elements = {
    toolContainer,
    contentA,
    leftScroll,
    dataContainer,
    schemaContainer,
    filesContainer,
    toggleWrapText: wrapToggle,
    wrapTextToggleLabel: wrapToggleLabel,
    toggleWordWrapButton: wordWrapButton,
    toggleDataMaximize: maximizeButton,
  };
  ui.scheduleSchemaLayoutRefresh = vi.fn();
  ui.scheduleDataTableLayoutRefresh = vi.fn(() => ui.syncDataTableLayout());
  ui.isDataMaximized = false;
  return { ui, dataContainer, maximizeButton, toolContainer, wordWrapButton, wrapToggle, wrapToggleLabel };
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

  it("bounds a long schema grid so its Handsontable header stays fixed", () => {
    const { ui } = createUi();
    const updateSettings = vi.fn();
    ui.schemaTable = {
      countRows: () => 40,
      getSettings: () => ({ minRows: 1, rowHeights: 20, columnHeaderHeight: 20 }),
      updateSettings,
      refreshDimensions: vi.fn(),
      render: vi.fn(),
    };

    ui.syncSchemaTableLayout();

    expect(updateSettings).toHaveBeenCalledWith({ height: 256 });
    expect(updateSettings).not.toHaveBeenCalledWith({ height: "auto" });
  });

  it("uses all remaining viewport height without imposing a small maximum", () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1200 });
    const { ui } = createUi();

    ui.initializeSpreadsheets();

    expect(handsontableInstances[1].settings.height).toBe(676);
  });

  it("enables automatic row measurement only while wrapping is on", () => {
    const { ui, dataContainer, wrapToggle, wrapToggleLabel } = createUi();
    ui.initializeSpreadsheets();

    wrapToggle.checked = true;
    ui.handleToggleWrapText();

    expect(dataContainer.classList.contains("wrap-text-on")).toBe(true);
    expect(wrapToggleLabel.textContent).toBe("Wrap Text");
    expect(wrapToggle.getAttribute("aria-label")).toBe("Wrap text in data preview cells");
    expect(ui.dataTable.updateSettings).toHaveBeenLastCalledWith(expect.objectContaining({ autoRowSize: true, rowHeights: undefined }));

    wrapToggle.checked = false;
    ui.handleToggleWrapText();

    expect(dataContainer.classList.contains("wrap-text-on")).toBe(false);
    expect(wrapToggleLabel.textContent).toBe("Wrap Text");
    expect(wrapToggle.getAttribute("aria-label")).toBe("Wrap text in data preview cells");
    expect(ui.dataTable.updateSettings).toHaveBeenLastCalledWith(expect.objectContaining({ autoRowSize: false, rowHeights: 20 }));
  });

  it("labels the editor word-wrap button with the action it will perform", () => {
    const { ui, wordWrapButton } = createUi();
    let wordWrap = "off";
    ui.editor = {
      getRawOptions: () => ({ wordWrap }),
      updateOptions: vi.fn((options) => {
        wordWrap = options.wordWrap;
      }),
    };

    ui.syncWordWrapToggle(wordWrap);
    expect(wordWrapButton.querySelector(".word-wrap-toggle-label").textContent).toBe("Wrap");

    ui.handleToggleWordWrap();
    expect(wordWrapButton.querySelector(".word-wrap-toggle-label").textContent).toBe("Unwrap");
    expect(wordWrapButton.getAttribute("aria-checked")).toBe("true");

    ui.handleToggleWordWrap();
    expect(wordWrapButton.querySelector(".word-wrap-toggle-label").textContent).toBe("Wrap");
    expect(wordWrapButton.getAttribute("aria-checked")).toBe("false");
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
