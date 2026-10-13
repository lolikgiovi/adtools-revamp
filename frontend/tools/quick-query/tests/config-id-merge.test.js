// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../core/MonacoOracle.js", () => ({
  ensureMonacoWorkers: vi.fn(),
  setupMonacoOracle: vi.fn(),
  createOracleEditor: vi.fn(),
  ORACLE_LANGUAGE_ID: "oracle-sql",
  ORACLE_THEME: "oracle-theme",
}));
vi.mock("../../../components/ConfirmationDialog.js", () => ({ confirmAction: vi.fn() }));
vi.mock("../../../core/UsageTracker.js", () => ({ UsageTracker: { trackEvent: vi.fn() } }));

import { confirmAction } from "../../../components/ConfirmationDialog.js";
import { QuickQueryUI } from "../main.js";
import { QueryGenerationService } from "../services/QueryGenerationService.js";

// Failure cases: accidental ID replacement, ignored opt-in, lost INSERT ID, wrong
// table/type/casing, empty matched SET, missing repeat prompts, leaking choices,
// duplicate generation while awaiting a choice, and missing Excel option handoff.
const schema = [
  ["CONFIG_ID", "NUMBER", "No", "", "", "Yes"],
  ["PARAMETER_KEY", "VARCHAR2(50)", "No", "", "", ""],
  ["PARAMETER_VALUE", "VARCHAR2(50)", "Yes", "", "", ""],
];
const input = [
  ["CONFIG_ID", "PARAMETER_KEY", "PARAMETER_VALUE"],
  ["123", "some.key", "new value"],
];

describe("config MERGE ID policy", () => {
  it.each([undefined, false, true])("preserves INSERT and honors matched-update choice %s", (updateConfigIds) => {
    const sql = new QueryGenerationService().generateQuery("APP.APP_CONFIG", "merge", schema, input, [], { updateConfigIds });
    expect(sql).toContain("ON (tgt.parameter_key = src.parameter_key)");
    expect(sql.includes("tgt.config_id = src.config_id")).toBe(updateConfigIds === true);
    expect(sql).toContain("tgt.parameter_value = src.parameter_value");
    expect(sql).toContain("INSERT (config_id, parameter_key, parameter_value)");
    expect(sql).toContain("VALUES (src.config_id, src.parameter_key, src.parameter_value)");
  });

  it("handles lowercase fields and omits an empty matched branch", () => {
    const lowerSchema = schema.slice(0, 2).map((row) => [row[0].toLowerCase(), ...row.slice(1)]);
    const sql = new QueryGenerationService().generateQuery("app.config", "merge", lowerSchema, [
      ["config_id", "parameter_key"],
      ["123", "some.key"],
    ]);
    expect(sql).not.toContain("WHEN MATCHED");
    expect(sql).toContain("WHEN NOT MATCHED");
  });

  it("leaves non-config MERGE behavior unchanged", () => {
    const service = new QueryGenerationService();
    expect(service.generateQuery("APP.SETTINGS", "merge", schema, input)).toContain("tgt.parameter_key = src.parameter_key");
  });
});

// UPDATE-specific failures: ignored ID still appearing in SET or the changed-field
// SELECT, and generating an empty UPDATE when CONFIG_ID is the only editable field.
describe("config UPDATE ID policy", () => {
  it.each([undefined, false, true])("honors update choice %s in SQL and verification fields", (updateConfigIds) => {
    const sql = new QueryGenerationService().generateQuery("APP.APP_CONFIG", "update", schema, input, [], { updateConfigIds });
    expect(sql).toContain("WHERE parameter_key = 'some.key'");
    expect(sql.includes("config_id = (SELECT NVL(MAX(CONFIG_ID)+1, 1) FROM APP.APP_CONFIG)")).toBe(updateConfigIds === true);
    expect(sql).toContain("parameter_value = 'new value'");
    const verification = sql.split("------ SELECT Statement --------")[1];
    expect(verification.includes("SELECT parameter_key, config_id, parameter_value")).toBe(updateConfigIds === true);
    if (updateConfigIds !== true) expect(verification).toContain("SELECT parameter_key, parameter_value FROM");
  });

  it("rejects UPDATE with no editable fields after preserving CONFIG_ID", () => {
    expect(() =>
      new QueryGenerationService().generateQuery("APP.APP_CONFIG", "update", schema.slice(0, 2), [
        input[0].slice(0, 2),
        input[1].slice(0, 2),
      ]),
    ).toThrow("No fields to update");
  });
});

describe.each(["merge", "update"])("config %s choice flow", (queryType) => {
  let ui;
  beforeEach(() => {
    vi.clearAllMocks();
    ui = Object.create(QuickQueryUI.prototype);
    ui.elements = {
      tableNameInput: { value: "APP.APP_CONFIG" },
      defaultSysdateToggle: { checked: false },
    };
    ui.schemaTable = { getData: () => schema };
    ui.dataTable = { getData: () => input };
    ui.getQueryTypeValue = () => queryType;
    ui.flushPendingDataAutosave = vi.fn();
    ui.storageService = { saveSchema: vi.fn() };
    ui.excelImportService = { hasData: () => false };
    ui._detectHtmlInData = () => ({ hasHtml: false });
    ui._generateQuery = vi.fn();
    ui.showError = vi.fn();
    ui.editor = { setValue: vi.fn() };
    ui.processedFiles = [];
  });

  it("prompts on every generation and forwards the safe choice", async () => {
    confirmAction.mockResolvedValue(false);
    await ui.handleGenerateQuery();
    await ui.handleGenerateQuery();
    expect(confirmAction).toHaveBeenCalledTimes(2);
    expect(confirmAction).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Update existing CONFIG_IDs?", confirmLabel: "Update IDs", cancelLabel: "Keep existing IDs" }),
    );
    expect(ui._generateQuery).toHaveBeenLastCalledWith(
      "APP.APP_CONFIG",
      queryType,
      schema,
      input,
      "manual",
      expect.objectContaining({ updateConfigIds: false }),
    );
    ui.elements.tableNameInput.value = "APP.OTHER_CONFIG";
    await ui.handleGenerateQuery();
    expect(confirmAction).toHaveBeenCalledTimes(3);
  });

  it("allows revisiting the choice and passes it for Excel input", async () => {
    confirmAction.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await ui.handleGenerateQuery();
    ui.excelImportService = { hasData: () => true, getDataForQuery: () => input };
    await ui.handleGenerateQuery();
    expect(ui._generateQuery).toHaveBeenLastCalledWith(
      "APP.APP_CONFIG",
      queryType,
      schema,
      expect.any(Array),
      "excel",
      expect.objectContaining({ updateConfigIds: true }),
    );
  });

  it("blocks duplicate generation while the dialog is pending", async () => {
    let resolveChoice;
    confirmAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveChoice = resolve;
        }),
    );
    const pending = ui.handleGenerateQuery();
    await vi.waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
    await ui.handleGenerateQuery();
    expect(ui._generateQuery).not.toHaveBeenCalled();
    resolveChoice(false);
    await pending;
    expect(ui._generateQuery).toHaveBeenCalledTimes(1);
  });

  it.each(["insert"])("does not prompt for %s", async (type) => {
    ui.getQueryTypeValue = () => type;
    await ui.handleGenerateQuery();
    expect(confirmAction).not.toHaveBeenCalled();
  });
});
