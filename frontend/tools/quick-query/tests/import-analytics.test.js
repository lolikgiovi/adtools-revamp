// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../../../core/MonacoOracle.js", () => ({
  ensureMonacoWorkers: vi.fn(),
  setupMonacoOracle: vi.fn(),
  createOracleEditor: vi.fn(),
  ORACLE_LANGUAGE_ID: "oracle-sql",
  ORACLE_THEME: "oracle-theme",
}));
import { QuickQueryUI } from "../main.js";
import { UsageTracker } from "../../../core/UsageTracker.js";
import { OracleDataImportService } from "../services/OracleDataImportService.js";
import { buildQuickQueryGeneratedMeta } from "../services/QuickQueryAnalyticsService.js";

// Failure modes: successful import never emits adoption, rejected files count as imported,
// analytics exceptions break importing, filenames/errors/rows leak, and Oracle is called manual.
afterEach(() => vi.restoreAllMocks());
describe("Quick Query import analytics", () => {
  it("records successful Excel import counts without document content", () => {
    const spy = vi.spyOn(UsageTracker, "trackEvent").mockImplementation(() => {});
    const ui = Object.assign(Object.create(QuickQueryUI.prototype), {
      schemaTable: { getData: () => [] },
      _updateExcelImportUI: vi.fn(),
      tabs: [],
    });
    ui._onExcelImportSuccess({ header: ["SECRET"], rowCount: 12 }, "/Users/me/imports/rates.xlsx");
    expect(spy).toHaveBeenCalledWith("quick-query", "excel_import_result", {
      outcome: "success",
      row_count: 12,
      column_count: 1,
      file_name: "rates.xlsx",
    });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("SECRET");
  });
  it("records failed Excel imports with the filename and no raw error", async () => {
    const spy = vi.spyOn(UsageTracker, "trackEvent").mockImplementation(() => {});
    const ui = Object.assign(Object.create(QuickQueryUI.prototype), {
      excelImportService: { processFromFile: vi.fn().mockRejectedValue(new Error("SECRET")) },
      showError: vi.fn(),
    });
    await ui.handleExcelFileInput({ target: { files: [{ name: "SECRET.xlsx" }], value: "SECRET" } });
    expect(spy).toHaveBeenCalledWith("quick-query", "excel_import_result", {
      outcome: "failed",
      reason: "file_processing",
      file_name: "SECRET.xlsx",
    });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("message");
  });
  it("extracts joined source tables without interpreting literals or comments as tables", () => {
    const parsed = OracleDataImportService.parseQuery(
      "SELECT A.ID FROM APP.ITEM A JOIN APP.TYPES B ON A.ID=B.ID WHERE A.NAME='FROM SECRET.DATA' /* JOIN HIDDEN.DATA */",
      ["ID"],
    );
    expect(parsed.sourceTables).toEqual(["APP.ITEM", "APP.TYPES"]);
  });
  it("records Oracle row counts and table identifiers after loading the data sheet", async () => {
    const spy = vi.spyOn(UsageTracker, "trackEvent").mockImplementation(() => {});
    vi.spyOn(OracleDataImportService, "fetch").mockResolvedValue([[1], [2]]);
    const ui = Object.assign(Object.create(QuickQueryUI.prototype), {
      elements: {
        tableNameInput: { value: "APP.ITEM" },
        oracleDataConnection: { value: "LOCAL" },
        fetchOracleDataButton: document.createElement("button"),
        oracleDataError: document.createElement("div"),
        oracleDataSwitchTable: document.createElement("div"),
      },
      _oracleDataConnections: [{ name: "LOCAL" }],
      _oracleDataEditor: { getValue: () => "SELECT A.ID FROM APP.ITEM A JOIN APP.TYPES B ON A.ID=B.ID" },
      schemaTable: { getData: () => [["ID", "NUMBER"]] },
      dataTable: { loadData: vi.fn() },
      tabs: [],
      saveOracleDataImportDraft: vi.fn(),
      handleClearExcelImport: vi.fn(),
      setDataSheetColumns: vi.fn(),
      scheduleActiveTabDraftSave: vi.fn(),
      closeOracleDataImport: vi.fn(),
      showOracleDataError: vi.fn(),
    });
    await ui.fetchOracleData();
    expect(ui.dataTable.loadData).toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith(
      "quick-query",
      "oracle_import_result",
      expect.objectContaining({
        outcome: "success",
        row_count: 2,
        table_name: "APP.ITEM",
        source_tables: "APP.ITEM,APP.TYPES",
        has_join: true,
      }),
    );
    expect(JSON.stringify(spy.mock.calls)).not.toContain("ON A.ID");
  });
  it.each(["oracle", "manual", "excel", "clipboard", "mixed", "saved", "unknown"])(
    "keeps %s provenance in generated metadata",
    (dataSource) => {
      expect(buildQuickQueryGeneratedMeta({ dataSource }).data_source).toBe(dataSource);
    },
  );
  it("keeps import completion independent of telemetry availability", () => {
    vi.spyOn(UsageTracker, "trackEvent").mockImplementation(() => {
      throw new Error("telemetry");
    });
    const ui = Object.assign(Object.create(QuickQueryUI.prototype), {
      schemaTable: { getData: () => [] },
      _updateExcelImportUI: vi.fn(),
      tabs: [],
    });
    expect(() => ui._onExcelImportSuccess({ header: [], rowCount: 0 })).not.toThrow();
    expect(ui._updateExcelImportUI).toHaveBeenCalled();
  });
});
