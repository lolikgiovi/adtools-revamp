// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("monaco-editor/esm/vs/editor/editor.main.js", () => ({ editor: {} }));
vi.mock("monaco-editor/esm/vs/language/json/monaco.contribution.js", () => ({}));
vi.mock("../../../core/MonacoOracle.js", () => ({ createOracleEditor: vi.fn() }));
import { VelocityTemplateTool } from "../main.js";
import { UsageTracker } from "../../../core/UsageTracker.js";

// Failure modes: failed/empty renders count as uses, automatic previews inflate totals,
// undeclared actions enter the success ledger, content leaks, and clipboard failures count.
afterEach(() => vi.restoreAllMocks());
describe("Velocity success boundaries", () => {
  it.each(["valid", "invalid", "empty"])("counts explicit rendering only when %s", (state) => {
    const events = vi.spyOn(UsageTracker, "trackEvent").mockImplementation(() => {});
    const uses = vi.spyOn(UsageTracker, "trackToolUse").mockImplementation(() => {});
    const tool = Object.assign(Object.create(VelocityTemplateTool.prototype), {
      editor: { getValue: () => "SECRET" },
      previewEditor: { getValue: () => "OUTPUT" },
      updatePreview() {
        this._renderState = state;
      },
    });
    tool.renderLocally();
    expect(uses).toHaveBeenCalledTimes(state === "valid" ? 1 : 0);
    expect(events).toHaveBeenCalledWith("velocity-template", "render_result", expect.objectContaining({ outcome: state }));
    expect(JSON.stringify(events.mock.calls)).not.toContain("SECRET");
  });
  it("includes the imported table without SQL predicates or row identifiers", () => {
    const events = vi.spyOn(UsageTracker, "trackEvent").mockImplementation(() => {});
    vi.spyOn(UsageTracker, "trackToolUse").mockImplementation(() => {});
    document.body.innerHTML =
      '<select id="velocitySqlField"><option value="0">TEMPLATE</option></select><textarea id="velocitySqlPreview">Hello</textarea>';
    const sql = "SELECT TEMPLATE, ID FROM APP.TEMPLATES WHERE ID = 'PRIVATE_ROW_ID'";
    const tool = Object.assign(Object.create(VelocityTemplateTool.prototype), {
      _sqlImportEditor: { getValue: () => sql },
      _sqlImportSql: sql,
      _sqlImportColumns: ["TEMPLATE", "ID"],
      _sqlImportRows: [["Hello", "PRIVATE_ROW_ID"]],
      _sqlImportRowIndex: 0,
      captureDocumentSnapshot: vi.fn(),
      editor: { setValue: vi.fn(), getValue: () => "Hello" },
      documents: [{ id: "fixture" }],
      activeDocumentId: "fixture",
      renderDocumentTabs: vi.fn(),
      scheduleDocumentSave: vi.fn(),
      closeSqlImport: vi.fn(),
      showUndo: vi.fn(),
    });
    tool.applySqlImport();
    expect(events).toHaveBeenCalledWith("velocity-template", "import_sql_result", expect.objectContaining({ table_name: "APP.TEMPLATES" }));
    expect(JSON.stringify(events.mock.calls)).not.toContain("PRIVATE_ROW_ID");
  });
});
