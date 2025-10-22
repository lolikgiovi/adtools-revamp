import { BaseTool } from "../../core/BaseTool.js";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { SplunkVTLEditorTemplate } from "./template.js";
import { getIconSvg } from "./icon.js";
import { formatVtlTemplate, minifyVtlTemplate, lintVtlSyntax, toMonacoMarkers } from "./service.js";
import { UsageTracker } from "../../core/UsageTracker.js";
import "./styles.css";

class SplunkVTLEditor extends BaseTool {
  constructor(eventBus) {
    super({
      id: "splunk-template",
      name: "Splunk Template",
      description: "Edit Splunk templates with VTL formatting, minify, lint, and syntax highlighting",
      icon: "splunk-template",
      category: "config",
      eventBus,
    });
    this.editor = null;
    this._storageKey = "tool:splunk-template:editor";
  }

  getIconSvg() { return getIconSvg(); }
  render() { return SplunkVTLEditorTemplate; }

  async onMount() {
    await this.registerVtlLanguage();
    await this.initializeMonacoEditor();
    this.bindUIEvents();
  }

  onUnmount() {
    if (this.editor) {
      this.editor.dispose();
      this.editor = null;
    }
  }

  async registerVtlLanguage() {
    // Configure Monaco workers
    self.MonacoEnvironment = {
      getWorker(_, label) {
        switch (label) {
          case "css": return new cssWorker();
          case "html": return new htmlWorker();
          case "typescript":
          case "javascript": return new tsWorker();
          default: return new editorWorker();
        }
      },
    };

    monaco.languages.register({ id: "vtl-splunk" });
    monaco.languages.setLanguageConfiguration("vtl-splunk", {
      comments: { lineComment: "##", blockComment: ["#*", "*#"] },
      brackets: [ ["{", "}"], ["[", "]"], ["(", ")"] ],
      autoClosingPairs: [
        { open: "{", close: "}" }, { open: "[", close: "]" }, { open: "(", close: ")" },
        { open: "\"", close: "\"", notIn: ["string", "comment"] },
        { open: "'", close: "'", notIn: ["string", "comment"] },
      ],
    });

    monaco.languages.setMonarchTokensProvider("vtl-splunk", {
      defaultToken: "",
      tokenPostfix: ".vtl",
      keywords: ["if","elseif","else","end","set","foreach","macro","parse","include","define","stop"],
      tokenizer: {
        root: [
          // comments
          [/##.*$/, "comment"],
          [/\#\*[\s\S]*?\*\#/, "comment"],
          // strings
          [/"([^"\\]|\\.)*"/, "string"],
          [/'([^'\\]|\\.)*'/, "string"],
          // directives
          [/\#(if|elseif|else|end|set|foreach|macro|parse|include|define|stop)\b/, "keyword"],
          // variables $var, $!var, ${path}, $!{path}
          [/\$!?\{[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\}/, "variable"],
          [/\$!?[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/, "variable"],
          // delimiters for Splunk template
          [/\|/, "delimiter"],
          [/=/, "operator"],
          // numbers
          [/\b\d+(?:\.\d+)?\b/, "number"],
        ],
      },
    });
  }

  async initializeMonacoEditor() {
    const container = document.getElementById("vtlEditor");
    const initial = "eventType=EV_CPTS_TRANSACTION|channelCode=EVE|channelName=EVE|cifNo=$!{context.fromCif}|creditAccAlias=$!{context.merchantName}|creditAccName=$!{context.merchantName}|creditAccNo=$!{context.creditAccNo}|";
    let value = initial;
    try {
      const saved = localStorage.getItem(this._storageKey);
      if (saved !== null) value = saved;
    } catch (_) {}

    this.editor = monaco.editor.create(container, {
      value,
      language: "vtl-splunk",
      theme: "vs-dark",
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: "on",
      fontSize: 11,
      tabSize: 2,
      insertSpaces: true,
    });

    // Persist content to localStorage
    this._persistTimer = null;
    this.editor.onDidChangeModelContent(() => {
      clearTimeout(this._persistTimer);
      const v = this.editor.getValue();
      this._persistTimer = setTimeout(() => {
        try { localStorage.setItem(this._storageKey, v); } catch (_) {}
      }, 250);
    });
  }

  bindUIEvents() {
    const btnFormat = document.getElementById("btnFormatVtl");
    const btnMinify = document.getElementById("btnMinifyVtl");
    const btnLint = document.getElementById("btnLintVtl");
    const btnCopy = document.getElementById("btnCopyVtl");
    const btnPaste = document.getElementById("btnPasteVtl");
    const btnClear = document.getElementById("btnClearVtl");
    const lintOut = document.getElementById("vtlLintOutput");
    const lintSummary = document.getElementById("vtlLintSummary");

    btnFormat?.addEventListener("click", () => {
      const src = this.editor.getValue();
      const formatted = formatVtlTemplate(src);
      this.editor.setValue(formatted);
      this.updateLintMarkers();
      UsageTracker.trackFeature("splunk-template", "format");
    });

    btnMinify?.addEventListener("click", () => {
      const src = this.editor.getValue();
      const minified = minifyVtlTemplate(src);
      this.editor.setValue(minified);
      this.updateLintMarkers();
      UsageTracker.trackFeature("splunk-template", "minify", { bytes: minified.length });
    });

    const renderLint = ({ issues, summary }) => {
      if (!lintOut || !lintSummary) return;
      if (!issues.length) {
        lintSummary.textContent = "No issues found.";
        lintOut.innerHTML = "<div class=\"lint-item ok\">Syntax looks good.</div>";
        return;
      }
      lintSummary.textContent = `${summary.errors} error(s), ${summary.warnings} warning(s)`;
      lintOut.innerHTML = issues
        .map((i) => `<div class=\"lint-item ${i.severity === 'warning' ? 'warn' : ''}\">Line ${i.line}: ${i.message}</div>`)
        .join("");
    };

    btnLint?.addEventListener("click", () => {
      const src = this.editor.getValue();
      const result = lintVtlSyntax(src);
      renderLint(result);
      monaco.editor.setModelMarkers(this.editor.getModel(), "vtl-lint", toMonacoMarkers(result.issues));
      UsageTracker.trackFeature("splunk-template", "lint", { errors: result.summary.errors, warnings: result.summary.warnings });
    });

    btnCopy?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(this.editor.getValue());
      } catch (_) {}
    });
    btnPaste?.addEventListener("click", async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          const model = this.editor.getModel();
          if (model) {
            const full = model.getFullModelRange();
            this.editor.executeEdits("paste", [{ range: full, text }]);
          } else {
            this.editor.setValue(text);
          }
        }
      } catch (_) {}
    });
    btnClear?.addEventListener("click", () => {
      this.editor.setValue("");
      try { localStorage.setItem(this._storageKey, ""); } catch (_) {}
      this.updateLintMarkers();
    });
  }

  updateLintMarkers() {
    const src = this.editor.getValue();
    const result = lintVtlSyntax(src);
    monaco.editor.setModelMarkers(this.editor.getModel(), "vtl-lint", toMonacoMarkers(result.issues));
    const summary = document.getElementById("vtlLintSummary");
    const out = document.getElementById("vtlLintOutput");
    if (summary && out) {
      summary.textContent = result.issues.length ? `${result.summary.errors} error(s), ${result.summary.warnings} warning(s)` : "";
      out.innerHTML = result.issues
        .map((i) => `<div class=\"lint-item ${i.severity === 'warning' ? 'warn' : ''}\">Line ${i.line}: ${i.message}</div>`)
        .join("");
    }
  }
}

export { SplunkVTLEditor };