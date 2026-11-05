// @vitest-environment jsdom
// Failure modes for work that belongs to one query tab:
// 1. Generation finishing after a tab switch writes tab A's SQL into tab B's editor, and Run Query sends it.
// 2. The "SQL matches its inputs" record is shared by all tabs, so tab B's stale SQL looks fresh after visiting tab A.
// 3. That record is lost on restart, so edited inputs no longer trigger regeneration before Run Query.
// 4. Excel rows imported in tab A are used when generating in tab B.
// 5. Re-importing an Excel file with the same header and row count keeps the old SQL marked fresh.
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../core/MonacoOracle.js", () => ({
  ensureMonacoWorkers: vi.fn(),
  setupMonacoOracle: vi.fn(),
  createOracleEditor: vi.fn(),
  ORACLE_LANGUAGE_ID: "oracle-sql",
  ORACLE_THEME: "oracle-theme",
}));
vi.mock("../../../core/UsageTracker.js", () => ({
  UsageTracker: { track() {}, trackEvent() {}, trackFailure() {}, flushSync() {} },
}));

import { QuickQueryUI } from "../main.js";
import { ExcelImportWorkerService } from "../services/ExcelImportWorkerService.js";
import { generationRecord, needsRegeneration } from "../services/GenerateAndRunService.js";

const grid = (data) => ({
  data,
  getData() {
    return this.data;
  },
  loadData(next) {
    this.data = next;
  },
});

function createUi() {
  const ui = Object.create(QuickQueryUI.prototype);
  let sql = "";
  ui.editor = { getValue: () => sql, setValue: (value) => (sql = value) };
  ui.elements = { tableNameInput: { value: "" } };
  ui.queryType = "merge";
  ui.getQueryTypeValue = () => ui.queryType;
  ui.setQueryTypeValue = (value) => (ui.queryType = value);
  ui.schemaTable = grid([["ID", "NUMBER", "No", "", "", "Yes"]]);
  ui.dataTable = grid([["ID"], ["1"]]);
  ui.processedFiles = [];
  ui.excelImportService = new ExcelImportWorkerService();
  ui.tabs = [ui.createTabDraft({ id: "A", tableName: "APP.A" }), ui.createTabDraft({ id: "B", tableName: "APP.B" })];
  ui.activeTabId = "A";
  for (const name of [
    "scheduleSchemaLayoutRefresh",
    "updateDataSpreadsheet",
    "_renderAttachmentsList",
    "_renderEmptyAttachmentsState",
    "updateAttachmentControlsState",
    "clearError",
    "renderTabs",
    "refreshLayouts",
    "scheduleInputValidation",
    "_showProgress",
    "_hideProgress",
    "_updateProgress",
    "showError",
    "showWarning",
    "_showAttachmentSizeWarning",
    "_trackQueryGenerated",
    "scheduleActiveTabDraftSave",
    "_updateExcelImportUI",
    "trackQuickQueryEvent",
  ]) {
    ui[name] = vi.fn();
  }
  return ui;
}

const switchTo = async (ui, id) => {
  ui.tabs = ui.tabs.map((tab) => (tab.id === ui.activeTabId ? ui.captureCurrentTabDraft() : tab));
  ui.activeTabId = id;
  await ui.applyTabDraft(ui.tabs.find((tab) => tab.id === id));
};

describe("Quick Query tab isolation", () => {
  it("does not put a generation result into the tab the user switched to", async () => {
    const ui = createUi();
    await ui.applyTabDraft(ui.tabs[0]);
    let finish;
    ui.queryExecutionService = {
      generateQuery: () => new Promise((resolve) => (finish = resolve)),
      cancel: vi.fn(),
    };
    ui.elements.tableNameInput.value = "APP.A";
    const running = ui._generateQuery("APP.A", "merge", ui.schemaTable.getData(), ui.dataTable.getData());
    await switchTo(ui, "B");
    expect(ui.queryExecutionService.cancel).toHaveBeenCalled();
    finish({ sql: "MERGE INTO APP.A ...", duplicateResult: null, usedWorker: true });
    await running;
    expect(ui.editor.getValue()).toBe("");
    expect(ui.isGenerating).toBe(false);
    expect(ui._generatedSql).toBeFalsy();
  });

  it("keeps each tab's generated-SQL record across switches and restarts", async () => {
    const ui = createUi();
    await ui.applyTabDraft(ui.tabs[1]);
    ui.activeTabId = "B";
    ui.elements.tableNameInput.value = "APP.B";
    ui.queryExecutionService = { generateQuery: async () => ({ sql: "MERGE INTO APP.B v1", duplicateResult: null }), cancel: vi.fn() };
    await ui._generateQuery("APP.B", "merge", ui.schemaTable.getData(), ui.dataTable.getData());
    ui.dataTable.loadData([["ID"], ["2"]]);

    await switchTo(ui, "A");
    ui.queryExecutionService.generateQuery = async () => ({ sql: "MERGE INTO APP.A", duplicateResult: null });
    await ui._generateQuery("APP.A", "merge", ui.schemaTable.getData(), ui.dataTable.getData());
    await switchTo(ui, "B");

    const fresh = () => ({ sql: ui.editor.getValue(), fingerprint: ui.currentQueryFingerprint(), generated: ui._generatedSql });
    expect(ui.editor.getValue()).toBe("MERGE INTO APP.B v1");
    expect(needsRegeneration(fresh())).toBe(true);

    // A restart rebuilds tabs from saved drafts.
    const restored = ui.createTabDraft(JSON.parse(JSON.stringify(ui.captureCurrentTabDraft())));
    ui._generatedSql = null;
    await ui.applyTabDraft(restored);
    expect(needsRegeneration(fresh())).toBe(true);
  });

  it("keeps Excel imports with the tab they were imported into", async () => {
    const ui = createUi();
    await ui.applyTabDraft(ui.tabs[0]);
    const result = { header: ["ID"], data: [["999"]], rowCount: 1 };
    ui.excelImportService.setImportedData(result);
    ui._onExcelImportSuccess(result, "a.xlsx");

    await switchTo(ui, "B");
    expect(ui.excelImportService.hasData()).toBe(false);
    await switchTo(ui, "A");
    expect(ui.excelImportService.getDataForQuery()).toEqual([["ID"], ["999"]]);
  });

  it("treats a re-imported Excel file as changed input", () => {
    const ui = createUi();
    ui.excelImportService.setImportedData({ header: ["ID"], data: [["1"]], rowCount: 1 });
    const before = ui.currentQueryFingerprint();
    ui.excelImportService.setImportedData({ header: ["ID"], data: [["2"]], rowCount: 1 });
    expect(ui.currentQueryFingerprint()).not.toBe(before);
  });

  it("records generated SQL by digest so restored drafts stay small", () => {
    const record = generationRecord("MERGE INTO APP.ITEM ...\n", "fp1");
    expect(record).not.toHaveProperty("sql");
    expect(needsRegeneration({ sql: "MERGE INTO APP.ITEM ...", fingerprint: "fp1", generated: record })).toBe(false);
    expect(needsRegeneration({ sql: "MERGE INTO APP.ITEM ...", fingerprint: "fp2", generated: record })).toBe(true);
    expect(needsRegeneration({ sql: "-- edited", fingerprint: "fp2", generated: record })).toBe(false);
  });
});
