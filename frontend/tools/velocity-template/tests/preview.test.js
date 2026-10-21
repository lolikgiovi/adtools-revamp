import { vi } from "vitest";

vi.mock("monaco-editor/esm/vs/editor/editor.main.js", () => ({
  editor: { setModelMarkers: vi.fn(), setModelLanguage: vi.fn() },
  MarkerSeverity: { Error: 8 },
}));
vi.mock("monaco-editor/esm/vs/language/json/monaco.contribution.js", () => ({}));
vi.mock("../../../core/MonacoOracle.js", () => ({ createOracleEditor: vi.fn() }));

import * as monaco from "monaco-editor/esm/vs/editor/editor.main.js";
import { VelocityTemplateTool } from "../main.js";

// Failures: blank/whitespace templates produce JSON errors, old output or markers
// survive clearing/switching documents, invalid context blocks the empty state,
// recovery announcements survive, or nonempty templates lose JSON validation.
describe("Velocity preview empty state", () => {
  let tool;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = `
      <div id="velocityPreview" class="is-stale"></div>
      <div id="velocityPreviewStatus" class="is-error">Previous error</div>
      <div id="velocityContextError">Previous context error</div>
      <div id="velocityResultMeta"></div>
      <div id="velocityRenderAnnouncement">Result updated at 13:54:45.</div>
      <button id="btnCopyVelocityPreview"></button>`;
    const editor = (value) => ({
      getValue: vi.fn(() => value),
      getModel: vi.fn(() => ({ getLineMaxColumn: () => 1, getLineCount: () => 1 })),
      setValue: vi.fn(),
      updateOptions: vi.fn(),
    });
    tool = Object.assign(Object.create(VelocityTemplateTool.prototype), {
      editor: editor(""),
      contextEditor: editor("{"),
      previewEditor: editor("previous output"),
      _resultType: "json",
      _lastRender: { at: Date.now(), bytes: 15 },
      _hadRenderError: true,
    });
  });

  it.each(["", " \n\t", "\r\n"])("leaves a blank template idle: %j", (template) => {
    tool.editor.getValue.mockReturnValue(template);
    tool.updatePreview();

    expect(tool.previewEditor.setValue).toHaveBeenCalledWith("");
    expect(tool.contextEditor.getValue).not.toHaveBeenCalled();
    expect(tool._lastRender).toBeNull();
    expect(tool._hadRenderError).toBe(false);
    expect(document.getElementById("velocityPreviewStatus").hidden).toBe(true);
    expect(document.getElementById("velocityContextError").hidden).toBe(true);
    expect(document.getElementById("velocityRenderAnnouncement").textContent).toBe("");
    expect(document.getElementById("velocityPreview").classList.contains("is-stale")).toBe(false);
    expect(document.getElementById("velocityResultMeta").dataset.state).toBe("empty");
    expect(document.getElementById("btnCopyVelocityPreview").disabled).toBe(true);
    for (const owner of ["velocity-template", "velocity-context", "velocity-output"]) {
      expect(monaco.editor.setModelMarkers).toHaveBeenCalledWith(expect.anything(), owner, []);
    }
  });

  it("keeps validating JSON from nonempty templates, including templates that render nothing", () => {
    tool.editor.getValue.mockReturnValue("#if(false){}#end");
    tool.contextEditor.getValue.mockReturnValue("{}");
    tool.updatePreview();
    expect(document.getElementById("velocityResultMeta").dataset.state).toBe("invalid");
    expect(document.getElementById("velocityPreviewStatus").hidden).toBe(false);
  });

  it("renders normally after an empty template", () => {
    tool.updatePreview();
    tool.editor.getValue.mockReturnValue('{"ok":true}');
    tool.contextEditor.getValue.mockReturnValue("{}");
    tool.updatePreview();
    expect(tool.previewEditor.setValue).toHaveBeenLastCalledWith('{\n  "ok": true\n}');
    expect(document.getElementById("velocityResultMeta").dataset.state).toBe("valid");
    expect(document.getElementById("btnCopyVelocityPreview").disabled).toBe(false);
  });
});
