import { describe, expect, it, vi } from "vitest";

vi.mock("../../../core/MonacoOracle.js", () => ({
  ensureMonacoWorkers: vi.fn(),
  setupMonacoOracle: vi.fn(),
  createOracleEditor: vi.fn(),
  ORACLE_LANGUAGE_ID: "oracle-sql",
  ORACLE_THEME: "oracle-theme",
}));

import { QuickQueryUI } from "../main.js";

// Failure cases: Excel errors keep grid coordinates (off by one from the issue panel's "Excel row N"),
// grid errors lose their clickable cell links, surrounding error text or line breaks dropped,
// multi-letter columns or several references mis-parsed, and duplicate warnings in Excel mode
// listing grid cells per key column instead of each Excel row once.
function createUi(excel) {
  document.body.innerHTML = '<div id="errors"></div><div id="warnings"></div>';
  const ui = Object.create(QuickQueryUI.prototype);
  ui.excelImportService = { hasData: () => excel };
  ui.dataTable = null;
  ui.elements = {
    errorMessages: document.getElementById("errors"),
    warningMessages: document.getElementById("warnings"),
  };
  return ui;
}

const duplicateWarning = {
  summary: "Warning: Duplicate primary keys detected (2 rows affected)",
  duplicates: [{ pkFields: ["ID", "CODE"], pkValues: ["1", "A"], columns: [0, 1], rows: [1, 3] }],
};

describe("Quick Query error row coordinates", () => {
  it("names Excel rows the same way as the issue panel", () => {
    const ui = createUi(true);
    ui.showError('Error in Cell AB1, Field "NAME":<br>Value too long. See Cell C12 too.');
    const errors = ui.elements.errorMessages;
    expect(errors.textContent).toBe('Error in Excel row 2, Field "NAME":\nValue too long. See Excel row 13 too.');
    expect(errors.querySelector("button")).toBe(null);
  });

  it("keeps clickable grid cell links outside Excel mode", () => {
    const ui = createUi(false);
    ui.showError('Error in Cell AB1, Field "NAME":<br>Value too long.');
    const link = ui.elements.errorMessages.querySelector("button.qq-cell-link");
    expect(link.textContent).toBe("Cell AB1");
    expect(ui.elements.errorMessages.textContent).toBe('Error in Cell AB1, Field "NAME":\nValue too long.');
  });

  it("lists each duplicate Excel row once", () => {
    const ui = createUi(true);
    ui.showWarning(duplicateWarning);
    expect(ui.elements.warningMessages.querySelector("p").textContent).toBe(
      "Primary key ID, CODE with value 1, A appears in Excel rows 2, 4",
    );
  });

  it("links each duplicate key cell in the grid", () => {
    const ui = createUi(false);
    ui.showWarning(duplicateWarning);
    const line = ui.elements.warningMessages.querySelector("p");
    expect(line.textContent).toBe("Primary key ID, CODE with value 1, A appears in cells: A1 / B1, A3 / B3");
    expect(line.querySelectorAll("button.qq-cell-link")).toHaveLength(4);
  });
});
