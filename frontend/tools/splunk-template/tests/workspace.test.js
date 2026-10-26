import fs from "node:fs";
import postcss from "postcss";
import path from "node:path";
import { vi } from "vitest";

vi.mock("monaco-editor/esm/vs/editor/editor.main.js", () => ({ editor: {} }));
vi.mock("monaco-editor/esm/vs/language/json/monaco.contribution.js", () => ({}));
vi.mock("handsontable", () => ({ default: class {} }));
import { SplunkVTLEditor } from "../main.js";

// Failure modes: lazy-loaded CSS restyles unrelated panes or hidden elements;
// switching loses unsaved template/context edits; a pending sync edits the next tab;
// closing the active tab selects a missing document; names inject markup.
describe("template workspace isolation", () => {
  it.each(["splunk-template", "html-editor"])("%s styles cannot match unrelated tool panels", (tool) => {
    document.body.innerHTML =
      '<div class="other-tool"><div class="pane editor-pane"><div class="pane-header"></div><div hidden></div></div></div>';
    const cssFiles = (file) => {
      const root = postcss.parse(fs.readFileSync(file, "utf8"));
      const roots = [root];
      root.walkAtRules("import", (rule) => roots.push(...cssFiles(path.resolve(path.dirname(file), rule.params.replaceAll('"', "")))));
      return roots;
    };
    const leaks = [];
    for (const css of cssFiles(`frontend/tools/${tool}/styles.css`))
      css.walkRules((rule) => {
        for (const selector of rule.selectors) {
          if (document.querySelector(selector)) leaks.push(selector);
        }
      });
    expect(leaks).toEqual([]);
  });

  it("switches paired editor models without losing drafts and clears pending work", async () => {
    const model = (value) => ({ getValue: () => value });
    const first = { id: "one", templateModel: model("first draft"), contextModel: model('{"a":1}') };
    const next = { id: "two", templateModel: model("second draft"), contextModel: model('{"b":2}') };
    const editor = (current) => ({ getModel: () => current, setModel: vi.fn(), saveViewState: vi.fn(), restoreViewState: vi.fn() });
    const tool = Object.assign(new SplunkVTLEditor(), {
      documents: [first, next],
      activeDocumentId: "one",
      editor: editor(first.templateModel),
      parametersEditor: editor(first.contextModel),
      renderDocumentTabs: vi.fn(),
      updateFieldsTable: vi.fn(),
      updatePreview: vi.fn(),
      persistDocuments: vi.fn().mockResolvedValue(),
      hideUndoClear: vi.fn(),
    });
    vi.useFakeTimers();
    const staleSync = vi.fn();
    tool._fieldsUpdateTimer = setTimeout(staleSync, 300);
    await tool.switchDocument("two");
    vi.runAllTimers();
    expect(staleSync).not.toHaveBeenCalled();
    expect(tool.editor.setModel).toHaveBeenCalledWith(next.templateModel);
    expect(tool.parametersEditor.setModel).toHaveBeenCalledWith(next.contextModel);
    expect(first.templateModel.getValue()).toBe("first draft");
    expect(tool.activeDocumentId).toBe("two");
    vi.useRealTimers();
  });
});
