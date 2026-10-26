import { vi } from "vitest";

vi.mock("monaco-editor/esm/vs/editor/editor.main.js", () => ({
  editor: { setModelMarkers: vi.fn(), setModelLanguage: vi.fn() },
  MarkerSeverity: { Error: 8 },
}));
vi.mock("monaco-editor/esm/vs/language/json/monaco.contribution.js", () => ({}));
vi.mock("../../../core/MonacoOracle.js", () => ({ createOracleEditor: vi.fn() }));
vi.mock("../validator.js", () => ({
  requestVelocityValidation: vi.fn(),
  readVelocityValidatorSettings: () => ({ url: "http://localhost/velocity" }),
}));
import { requestVelocityValidation } from "../validator.js";
import { VelocityTemplateTool } from "../main.js";

// Failures: local helper errors block API requests; repeated clicks submit twice;
// edits, tab changes, unmounts, and out-of-order responses overwrite newer output;
// 503 implies invalid Velocity; local preview is mislabeled as API validation;
// mode changes make extra requests; invalid context is sent to the API.
describe("Velocity API validation journey", () => {
  let tool;
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = `
      <button id="btnValidateVelocity">Validate</button>
      <div id="velocityValidationStatus" hidden></div>
      <div id="velocityPreview"></div><div id="velocityPreviewStatus"></div>
      <div id="velocityContextError"></div><div id="velocityResultMeta"></div>
      <div id="velocityRenderAnnouncement"></div><button id="btnCopyVelocityPreview"></button>`;
    const editor = (value) => ({
      getValue: vi.fn(() => value),
      getModel: () => ({ getLineMaxColumn: () => 100, getLineCount: () => 1 }),
      setValue: vi.fn(),
      updateOptions: vi.fn(),
    });
    tool = Object.assign(Object.create(VelocityTemplateTool.prototype), {
      editor: editor('{"coba":"$fn.getTellerIdDynamic()"}'),
      contextEditor: editor("{}"),
      previewEditor: editor(""),
      _resultType: "json",
      activeDocumentId: "first",
      _mountSequence: 1,
    });
    requestVelocityValidation.mockResolvedValue({ status: 200, body: '{"coba":"123"}' });
  });

  it("validates with the API even when the local helper is unsupported, and reuses the response for display changes", async () => {
    tool.updatePreview();
    expect(requestVelocityValidation).not.toHaveBeenCalled();
    await tool.validateWithApi();
    expect(requestVelocityValidation).toHaveBeenCalledOnce();
    expect(tool.previewEditor.setValue).toHaveBeenLastCalledWith('{\n  "coba": "123"\n}');
    expect(document.getElementById("velocityPreviewStatus").hidden).toBe(true);
    expect(document.getElementById("velocityResultMeta").textContent).toContain("API response · HTTP 200");
    tool._resultType = "text";
    tool.updatePreview();
    expect(tool.previewEditor.setValue).toHaveBeenLastCalledWith('{"coba":"123"}');
    expect(requestVelocityValidation).toHaveBeenCalledOnce();
  });

  it("shows 503 as unavailable and preserves the response for diagnosis", async () => {
    requestVelocityValidation.mockResolvedValue({ status: 503, body: "Service unavailable" });
    await tool.validateWithApi();
    expect(tool.previewEditor.setValue).toHaveBeenLastCalledWith("Service unavailable");
    expect(document.getElementById("velocityValidationStatus").textContent).toMatch(/unavailable.*503/i);
    expect(document.getElementById("velocityResultMeta").textContent).not.toMatch(/invalid/i);
  });

  it("invalidates the API result after an edit and returns to a labeled local preview", async () => {
    await tool.validateWithApi();
    tool.editor.getValue.mockReturnValue("changed");
    tool.markResultStale();
    tool.updatePreview();
    expect(document.getElementById("velocityValidationStatus").textContent).toMatch(/stale/i);
    expect(document.getElementById("velocityResultMeta").textContent).toContain("Local preview");
    expect(tool.previewEditor.setValue).toHaveBeenLastCalledWith("changed");
  });

  it.each(["edit", "switch", "unmount"])("discards pending responses after %s", async (action) => {
    let resolve;
    requestVelocityValidation.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = tool.validateWithApi();
    await tool.validateWithApi();
    expect(requestVelocityValidation).toHaveBeenCalledOnce();
    if (action === "edit") {
      tool.contextEditor.getValue.mockReturnValue('{"changed":true}');
      tool.markResultStale();
    }
    if (action === "switch") tool.activeDocumentId = "second";
    if (action === "unmount") tool._mountSequence++;
    resolve({ status: 200, body: "late result" });
    await pending;
    expect(tool.previewEditor.setValue).not.toHaveBeenCalledWith("late result");
    expect(document.getElementById("btnValidateVelocity").disabled).toBe(false);
  });

  it("rejects invalid context without submitting it", async () => {
    tool.contextEditor.getValue.mockReturnValue("{");
    await tool.validateWithApi();
    expect(requestVelocityValidation).not.toHaveBeenCalled();
    expect(document.getElementById("velocityValidationStatus").textContent).toMatch(/context/i);
  });
});
