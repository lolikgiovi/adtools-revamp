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
  // Failure modes: unedited starter previews count as use, every debounce counts, a new day never counts,
  // other documents share one claim, invalid output counts, and storage failures throw.
  it("counts an edited document's automatic preview once per document per day", () => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T10:00:00"));
    const uses = vi.spyOn(UsageTracker, "trackToolUse").mockImplementation(() => {});
    vi.spyOn(UsageTracker, "trackEvent").mockImplementation(() => {});
    const tool = Object.assign(Object.create(VelocityTemplateTool.prototype), {
      activeDocumentId: "a",
      _editedDocuments: new Set(),
      editor: { getValue: () => "Hello $name" },
      previewEditor: { getValue: () => "Hello" },
    });
    tool.recordAutomaticPreview("valid");
    expect(uses).not.toHaveBeenCalled();
    tool._editedDocuments.add("a");
    tool.recordAutomaticPreview("error");
    expect(uses).not.toHaveBeenCalled();
    tool.recordAutomaticPreview("valid");
    tool.recordAutomaticPreview("valid");
    expect(uses).toHaveBeenCalledTimes(1);
    expect(uses).toHaveBeenCalledWith("velocity-template", "preview", expect.any(Object));
    tool.activeDocumentId = "b";
    tool._editedDocuments.add("b");
    tool.recordAutomaticPreview("valid");
    expect(uses).toHaveBeenCalledTimes(2);
    vi.setSystemTime(new Date("2026-11-06T10:00:00"));
    tool.activeDocumentId = "a";
    tool.recordAutomaticPreview("valid");
    expect(uses).toHaveBeenCalledTimes(3);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => tool.recordAutomaticPreview("valid")).not.toThrow();
    vi.useRealTimers();
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
