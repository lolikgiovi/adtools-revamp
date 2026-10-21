// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../core/MonacoOracle.js", () => ({
  ensureMonacoWorkers: vi.fn(),
  setupMonacoOracle: vi.fn(),
  createOracleEditor: vi.fn(),
  ORACLE_LANGUAGE_ID: "oracle-sql",
  ORACLE_THEME: "oracle-theme",
}));

vi.mock("../../../core/UsageTracker.js", () => ({
  UsageTracker: {
    track: () => {},
    trackEvent: () => {},
    flushSync: () => {},
  },
}));

import { QuickQueryUI } from "../main.js";
import { SchemaValidationService } from "../services/SchemaValidationService.js";
import { QueryGenerationService } from "../services/QueryGenerationService.js";

const savedSchema = [
  ["CONFIG_INTEGRATION_ID", "VARCHAR2(36)", "No", "", "", "Yes"],
  ["SERVICE_CODE", "VARCHAR2(50)", "No", "", "", "No"],
  ["ENVIRONMENT", "VARCHAR2(10)", "No", "", "", "No"],
  ["REQ_MAP_TEMPLATE", "CLOB", "Yes", "", "", "No"],
  ["CREATED_TIME", "TIMESTAMP(6)", "No", "", "", "No"],
];

const draftSchema = [
  ["SERVICE_CODE", "VARCHAR2", "No", "", "", "Yes"],
  ["ENVIRONMENT", "VARCHAR2", "No", "", "", "Yes"],
  ["REQ_MAP_TEMPLATE", "CLOB", "Yes", "", "", "No"],
];

const draftInput = [
  ["SERVICE_CODE", "ENVIRONMENT", "REQ_MAP_TEMPLATE"],
  ["PAYMENT", "DEV", "#if($customer.active)Hello $customer.name#end"],
];

function createUi({ storedSchema = savedSchema, tabs = [] } = {}) {
  const ui = Object.create(QuickQueryUI.prototype);
  ui.ready = Promise.resolve();
  ui.tabs = tabs;
  ui.storageService = {
    loadSchema: vi.fn(async () => storedSchema),
    saveQueryTab: vi.fn(async () => true),
  };
  ui.createNewTab = vi.fn(async () => {
    const tab = { id: "new-tab", tableName: "", schemaData: [["", "", "", "", "", ""]], inputData: [[], []] };
    ui.tabs.push(tab);
    return tab;
  });
  ui.applyTabDraft = vi.fn(async () => true);
  ui.saveTabSession = vi.fn(async () => true);
  ui.eventBus = { emit: vi.fn() };
  return ui;
}

describe("Quick Query created query tabs", () => {
  it("merges a partial SQL import draft into the saved table schema", async () => {
    const ui = createUi();

    const tab = await ui.openCreatedQuery({
      title: "BULLION - PAYMENT",
      tableName: "bullion.config_integration",
      queryType: "update",
      schemaData: draftSchema,
      inputData: draftInput,
      source: "velocity-template",
    });

    expect(ui.storageService.loadSchema).toHaveBeenCalledWith("BULLION.CONFIG_INTEGRATION");
    expect(tab.schemaData).toEqual([
      ["CONFIG_INTEGRATION_ID", "VARCHAR2(36)", "No", "", "", "No"],
      ["SERVICE_CODE", "VARCHAR2(50)", "No", "", "", "Yes"],
      ["ENVIRONMENT", "VARCHAR2(10)", "No", "", "", "Yes"],
      ["REQ_MAP_TEMPLATE", "CLOB", "Yes", "", "", "No"],
      ["CREATED_TIME", "TIMESTAMP(6)", "No", "", "", "No"],
    ]);
    expect(tab.inputData).toEqual([savedSchema.map((row) => row[0]), [null, ...draftInput[1], null]]);
    expect(draftInput[0]).toEqual(["SERVICE_CODE", "ENVIRONMENT", "REQ_MAP_TEMPLATE"]);
    expect(ui.applyTabDraft).toHaveBeenCalledWith(tab);
  });

  it("reuses an open tab schema when the table has no stored schema", async () => {
    const openTab = { id: "open-tab", tableName: "BULLION.CONFIG_INTEGRATION", schemaData: savedSchema };
    const ui = createUi({ storedSchema: null, tabs: [openTab] });

    const tab = await ui.openCreatedQuery({
      tableName: "bullion.config_integration",
      queryType: "update",
      schemaData: draftSchema,
      inputData: draftInput,
    });

    expect(tab.schemaData).toEqual([
      ["CONFIG_INTEGRATION_ID", "VARCHAR2(36)", "No", "", "", "No"],
      ["SERVICE_CODE", "VARCHAR2(50)", "No", "", "", "Yes"],
      ["ENVIRONMENT", "VARCHAR2(10)", "No", "", "", "Yes"],
      ["REQ_MAP_TEMPLATE", "CLOB", "Yes", "", "", "No"],
      ["CREATED_TIME", "TIMESTAMP(6)", "No", "", "", "No"],
    ]);
  });

  it("generates an UPDATE keyed by the imported row identifiers", async () => {
    const ui = createUi();
    const tab = await ui.openCreatedQuery({
      tableName: "bullion.config_integration",
      queryType: "update",
      schemaData: draftSchema,
      inputData: draftInput,
    });

    const sql = new QueryGenerationService().generateQuery(tab.tableName, "update", tab.schemaData, tab.inputData, []);

    expect(sql).not.toContain("CONFIG_INTEGRATION_ID");
    expect(sql.toLowerCase()).toContain("update bullion.config_integration");
    expect(sql.toLowerCase()).toContain("req_map_template");
    expect(sql.toLowerCase()).toContain("where service_code = 'payment' and environment = 'dev'");
  });
});

// Failure modes: a schema edit relabels positional values; cached casing rejects
// an otherwise valid import; alignment mutates the source draft; tab reload loses
// the imported identifiers or template; omitted columns become accidental SETs.
describe("created draft schema alignment regressions", () => {
  it("keeps identifiers and template values attached to their fields after a schema edit and reload", async () => {
    const ui = createUi();
    const tab = await ui.openCreatedQuery({
      tableName: "bullion.config_integration",
      queryType: "update",
      schemaData: draftSchema,
      inputData: draftInput,
    });
    let data = tab.inputData.map((row) => [...row]);
    ui.schemaTable = { getData: () => tab.schemaData };
    ui.dataTable = {
      getData: () => data,
      loadData: (rows) => {
        data = rows;
      },
      updateSettings: vi.fn(),
    };
    ui.updatePrimaryKeyHighlight = vi.fn();
    ui.scheduleActiveTabDraftSave = vi.fn();
    // The schema afterChange hook uses this sequence even for a data-type edit.
    tab.schemaData[1][1] = "VARCHAR2(60)";
    ui.updateDataSpreadsheet();
    ui.handleAddFieldNames();
    const reloaded = JSON.parse(JSON.stringify({ ...tab, inputData: data }));
    expect(reloaded.inputData).toEqual([savedSchema.map((row) => row[0]), [null, ...draftInput[1], null]]);
    const sql = new QueryGenerationService().generateQuery(reloaded.tableName, "update", reloaded.schemaData, reloaded.inputData, []);
    expect(sql).toContain("WHERE service_code = 'PAYMENT' AND environment = 'DEV'");
    expect(sql).toContain("req_map_template =");
    expect(sql).not.toContain("config_integration_id =");
    expect(sql).not.toContain("created_time =");
  });

  it("uses cached schema spelling for mixed-case draft headers without losing values", async () => {
    const ui = createUi({ storedSchema: savedSchema.map((row) => [row[0].toLowerCase(), ...row.slice(1)]) });
    const tab = await ui.openCreatedQuery({
      tableName: "bullion.config_integration",
      queryType: "update",
      schemaData: draftSchema,
      inputData: draftInput,
    });
    const validation = new SchemaValidationService();
    expect(validation.matchSchemaWithData(tab.schemaData, tab.inputData)).toBe(true);
    const sql = new QueryGenerationService().generateQuery(tab.tableName, "update", tab.schemaData, tab.inputData, []);
    expect(sql).toContain("WHERE service_code = 'PAYMENT' AND environment = 'DEV'");
    expect(sql).toContain("req_map_template =");
    expect(tab.schemaData.filter((row) => row[5] === "Yes").map((row) => row[0])).toEqual(["service_code", "environment"]);
  });
});
