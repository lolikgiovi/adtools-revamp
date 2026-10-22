import { describe, expect, it, vi } from "vitest";

// Editor boundary failures: JSON language/formatting missing, model and undo history retain
// passwords after close, theme observers survive disposal, and a read-only apply is editable.
const state = vi.hoisted(() => ({ model: null, editor: null }));
vi.mock("monaco-editor/esm/vs/editor/editor.main.js", () => ({
  editor: {
    createModel: vi.fn((value, language) => {
      state.model = { language, value, dispose: vi.fn() };
      return state.model;
    }),
    create: vi.fn((_container, options) => {
      state.editor = {
        options,
        getValue: () => state.model.value,
        setValue: (value) => {
          state.model.value = value;
        },
        focus: vi.fn(),
        updateOptions: vi.fn(),
        dispose: vi.fn(),
        onDidChangeModelContent: vi.fn(() => ({ dispose: vi.fn() })),
        getAction: vi.fn(() => ({ run: vi.fn().mockResolvedValue(undefined) })),
      };
      return state.editor;
    }),
    setTheme: vi.fn(),
  },
}));
vi.mock("monaco-editor/esm/vs/language/json/monaco.contribution.js", () => ({}));
vi.mock("monaco-editor/esm/vs/editor/editor.worker?worker", () => ({ default: class {} }));
vi.mock("monaco-editor/esm/vs/language/json/json.worker?worker", () => ({ default: class {} }));
import { createSettingsJsonEditor } from "../json-editor.js";

describe("Oracle JSON Monaco lifecycle", () => {
  it("creates a JSON model with formatting and disposes its secret/undo history", async () => {
    const container = document.createElement("div");
    const adapter = createSettingsJsonEditor(container, { onChange: vi.fn() });
    expect(state.model.language).toBe("json");
    expect(state.editor.options.theme).toBe("vs-dark");
    expect(state.editor.options.formatOnPaste).toBe(true);
    adapter.setValue('{"password":"fake-test-secret"}');
    expect(adapter.getValue()).toContain("fake-test-secret");
    adapter.updateOptions({ readOnly: true });
    expect(state.editor.updateOptions).toHaveBeenCalledWith({ readOnly: true });
    await adapter.format();
    expect(state.editor.getAction).toHaveBeenCalledWith("editor.action.formatDocument");
    adapter.dispose();
    expect(state.editor.dispose).toHaveBeenCalledOnce();
    expect(state.model.dispose).toHaveBeenCalledOnce();
  });
});
