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
  const dataContainer = document.createElement("div");
  const schemaContainer = document.createElement("div");
  const wrapToggle = document.createElement("input");
  dataContainer.id = "spreadsheet-data";
  schemaContainer.id = "spreadsheet-schema";
  wrapToggle.id = "toggleWrapText";
  wrapToggle.type = "checkbox";
  dataContainer.getBoundingClientRect = () => ({ top: 500 });
  document.body.append(schemaContainer, wrapToggle, dataContainer);

  const ui = Object.create(QuickQueryUI.prototype);
  ui.elements = { dataContainer, schemaContainer, toggleWrapText: wrapToggle };
  ui.scheduleSchemaLayoutRefresh = vi.fn();
  return { ui, dataContainer, wrapToggle };
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
});
