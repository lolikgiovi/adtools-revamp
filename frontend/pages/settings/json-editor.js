import * as monaco from "monaco-editor/esm/vs/editor/editor.main.js";
import "monaco-editor/esm/vs/language/json/monaco.contribution.js";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import { configureMonacoWorkers } from "../../core/MonacoWorkers.js";

export function createSettingsJsonEditor(container, { onChange, label = "Connections JSON" }) {
  configureMonacoWorkers(globalThis, { editor: editorWorker, json: jsonWorker });
  const model = monaco.editor.createModel("", "json");
  const editor = monaco.editor.create(container, {
    model,
    theme: "vs-dark",
    ariaLabel: label,
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13,
    lineNumbersMinChars: 3,
    padding: { top: 8, bottom: 8 },
    scrollBeyondLastLine: false,
    wordWrap: "on",
    folding: true,
    scrollbar: { alwaysConsumeMouseWheel: false },
    formatOnPaste: true,
    formatOnType: true,
    tabSize: 2,
    insertSpaces: true,
    wordBasedSuggestions: "off",
  });
  const change = editor.onDidChangeModelContent(onChange);
  return {
    getValue: () => editor.getValue(),
    setValue: (value) => editor.setValue(value),
    focus: () => editor.focus(),
    updateOptions: (options) => editor.updateOptions(options),
    format: () => editor.getAction("editor.action.formatDocument").run(),
    dispose: () => {
      change.dispose();
      editor.dispose();
      model.dispose();
    },
  };
}
