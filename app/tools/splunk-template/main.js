import { BaseTool } from "../../core/BaseTool.js";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { SplunkVTLEditorTemplate } from "./template.js";
import { getIconSvg } from "./icon.js";
import { formatVtlTemplate, minifyVtlTemplate, extractFieldsFromTemplate } from "./service.js";
import { UsageTracker } from "../../core/UsageTracker.js";
import "./styles.css";
import Handsontable from "handsontable";
import "handsontable/dist/handsontable.full.css";

class SplunkVTLEditor extends BaseTool {
  constructor(eventBus) {
    super({
      id: "splunk-template",
      name: "Splunk Template",
      description: "Edit Splunk templates with formatting, minify, syntax highlighting, and field review",
      icon: "splunk-template",
      category: "config",
      eventBus,
    });
    this.editor = null;
    this.table = null;
    this._storageKey = "tool:splunk-template:editor";
  }

  getIconSvg() {
    return getIconSvg();
  }
  render() {
    return SplunkVTLEditorTemplate;
  }

  async onMount() {
    await this.registerVtlLanguage();
    await this.initializeMonacoEditor();
    this.initializeFieldsTable();
    this.initializeResizer();
    this.bindUIEvents();
    this.updateFieldsTable();
  }

  onUnmount() {
    this.cleanupResizer();
    if (this.editor) {
      this.editor.dispose();
      this.editor = null;
    }
    if (this.table) {
      this.table.destroy();
      this.table = null;
    }
  }

  async registerVtlLanguage() {
    // Configure Monaco workers
    self.MonacoEnvironment = {
      getWorker(_, label) {
        switch (label) {
          case "css":
            return new cssWorker();
          case "html":
            return new htmlWorker();
          case "typescript":
          case "javascript":
            return new tsWorker();
          default:
            return new editorWorker();
        }
      },
    };

    monaco.languages.register({ id: "vtl-splunk" });
    monaco.languages.setLanguageConfiguration("vtl-splunk", {
      comments: { lineComment: "##", blockComment: ["#*", "*#"] },
      brackets: [
        ["{", "}"],
        ["[", "]"],
        ["(", ")"],
      ],
      autoClosingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: "(", close: ")" },
        { open: '"', close: '"', notIn: ["string", "comment"] },
        { open: "'", close: "'", notIn: ["string", "comment"] },
      ],
    });

    monaco.languages.setMonarchTokensProvider("vtl-splunk", {
      defaultToken: "",
      tokenPostfix: ".vtl",
      keywords: ["if", "elseif", "else", "end", "set", "foreach", "macro", "parse", "include", "define", "stop"],
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
    const initial =
      "eventType=EV_CPTS_TRANSACTION|channelCode=EVE|channelName=EVE|cifNo=$!{context.fromCif}|creditAccAlias=$!{context.merchantName}|creditAccName=$!{context.merchantName}|creditAccNo=$!{context.creditAccNo}|";
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
    this._fieldsUpdateTimer = null;
    this.editor.onDidChangeModelContent(() => {
      clearTimeout(this._persistTimer);
      const v = this.editor.getValue();
      this._persistTimer = setTimeout(() => {
        try {
          localStorage.setItem(this._storageKey, v);
        } catch (_) {}
      }, 250);
      // debounce table update
      clearTimeout(this._fieldsUpdateTimer);
      this._fieldsUpdateTimer = setTimeout(() => this.updateFieldsTable(), 300);
    });
  }

  initializeFieldsTable() {
    const container = document.getElementById("fieldsTable");
    if (!container) return;
    this.table = new Handsontable(container, {
      data: [],
      columns: [
        { data: "field", type: "text", className: "v-align-middle" },
        { data: "source", type: "text", className: "v-align-middle" },
        { data: "value", type: "text", className: "v-align-middle" },
        { data: "functions", type: "text", className: "v-align-middle" },
      ],
      colHeaders: ["Field", "Source", "Value", "VTL Functions"],
      rowHeaders: true,
      stretchH: "all",
      licenseKey: "non-commercial-and-evaluation",
      width: "100%",
      height: "100%",
      manualColumnResize: true,
      className: "ht-theme-light",
      columnSorting: true,
    });
  }

  updateFieldsTable() {
    if (!this.table || !this.editor) return;
    const src = this.editor.getValue();
    const rows = extractFieldsFromTemplate(src);
    this.table.loadData(rows);
  }

  bindUIEvents() {
    const btnFormat = document.getElementById("btnFormatVtl");
    const btnMinify = document.getElementById("btnMinifyVtl");
    const btnCopy = document.getElementById("btnCopyVtl");
    const btnPaste = document.getElementById("btnPasteVtl");
    const btnClear = document.getElementById("btnClearVtl");

    btnFormat?.addEventListener("click", () => {
      const src = this.editor.getValue();
      const formatted = formatVtlTemplate(src);
      this.editor.setValue(formatted);
      this.updateFieldsTable();
      UsageTracker.trackFeature("splunk-template", "format");
    });

    btnMinify?.addEventListener("click", () => {
      const src = this.editor.getValue();
      const minified = minifyVtlTemplate(src);
      this.editor.setValue(minified);
      this.updateFieldsTable();
      UsageTracker.trackFeature("splunk-template", "minify", { bytes: minified.length });
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
          this.updateFieldsTable();
        }
      } catch (_) {}
    });
    btnClear?.addEventListener("click", () => {
      this.editor.setValue("");
      this.updateFieldsTable();
      try {
        localStorage.setItem(this._storageKey, "");
      } catch (_) {}
    });
  }

  initializeResizer() {
    const layout = document.querySelector(".vtl-layout");
    const resizer = document.getElementById("vtlResizer");
    if (!layout || !resizer) return;

    const RESIZER_W = 6;
    const MIN_LEFT = 240;
    const MIN_RIGHT = 240;
    let dragging = false;

    const onMove = (e) => {
      if (!dragging) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const rect = layout.getBoundingClientRect();
      const total = rect.width - RESIZER_W;
      let left = clientX - rect.left;
      left = Math.max(MIN_LEFT, Math.min(left, total - MIN_RIGHT));
      layout.style.gridTemplateColumns = `${left}px ${RESIZER_W}px ${total - left}px`;
      e.preventDefault();
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("is-resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };

    const onDown = (e) => {
      if (window.innerWidth <= 900) return; // disabled on mobile layout
      dragging = true;
      document.body.classList.add("is-resizing");
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      window.addEventListener("touchmove", onMove, { passive: false });
      window.addEventListener("touchend", onUp);
      e.preventDefault();
    };

    resizer.addEventListener("mousedown", onDown);
    resizer.addEventListener("touchstart", onDown, { passive: false });

    this._resizerCleanup = () => {
      resizer.removeEventListener("mousedown", onDown);
      resizer.removeEventListener("touchstart", onDown);
      onUp();
    };
  }

  cleanupResizer() {
    if (this._resizerCleanup) {
      try { this._resizerCleanup(); } catch (_) {}
      this._resizerCleanup = null;
    }
  }
}

export { SplunkVTLEditor };
