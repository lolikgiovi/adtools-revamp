import { BaseTool } from "../../core/BaseTool.js";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { SplunkVTLEditorTemplate } from "./template.js";
import { getIconSvg } from "./icon.js";
import { formatVtlTemplate, minifyVtlTemplate, extractFieldsFromTemplate, splitByPipesSafely } from "./service.js";
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
    this._trailingPipe = false;
    this._resizerCleanup = null;
    this._suppressTableEdit = false;
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
    UsageTracker.trackFeature("splunk-template", "mount", "", 5000);
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
          [/##.*$/, "comment"],
          [/\#\*[\s\S]*?\*\#/, "comment"],
          [/"([^"\\]|\\.)*"/, "string"],
          [/'([^'\\]|\\.)*'/, "string"],
          [/\#(if|elseif|else|end|set|foreach|macro|parse|include|define|stop)\b/, "keyword"],
          [/\$!?\{[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\}/, "variable"],
          [/\$!?[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/, "variable"],
          [/\|/, "delimiter"],
          [/=/, "operator"],
          [/\b\d+(?:\.\d+)?\b/, "number"],
        ],
      },
    });
  }

  async initializeMonacoEditor() {
    const container = document.getElementById("vtlEditor");
    const initial =
      "[$context.event.toUpperCase()] logdate=$!context.captureDate - IPAddress=$!context.clientIp|channelCode=$!context.channelId|channelName=$!context.channelId|cifNo=$!context.cif|deviceId=$!context.deviceId|emailAddress=$!context.email|eventType=$!context.event.toUpperCase()|isSuccess=false|mobilePhone=$!context.mobileNumber|statusCode=$!context.statusCode|statusName=$!context.status|transactionDate=$!context.captureDate|userActivationDate=$!context.registeredDate|userAgent=$!context.osVersion|userID=$!context.userId|sessionId=$!context.authorization|appsVersion=$!context.clientVersion";
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
        {
          data: "source",
          type: "dropdown",
          source: ["context", "variable", "hardcoded"],
          allowInvalid: false,
          className: "v-align-middle",
        },
        { data: "value", type: "text", className: "v-align-middle" },
        { data: "functions", type: "text", className: "v-align-middle", readOnly: true },
      ],
      colHeaders: ["Field", "Source", "Value", "VTL Functions"],
      rowHeaders: true,
      stretchH: "all",
      licenseKey: "non-commercial-and-evaluation",
      width: "100%",
      height: "100%",
      manualColumnResize: true,
      fixedColumnsLeft: 1,
      className: "ht-theme-light",
      columnSorting: true,
      minSpareRows: 0,
      afterChange: (changes, src) => {
        if (this._suppressTableEdit) return;
        if (!changes || src === "loadData") return;
        this.onTableChanged();
      },
      afterCreateRow: (index, amount, source) => {
        if (this._suppressTableEdit) return;
        this.onTableChanged();
      },
      afterRemoveRow: (index, amount, physicalRows, source) => {
        if (this._suppressTableEdit) return;
        this.onTableChanged();
      },
    });
  }

  updateFieldsTable() {
    if (!this.table || !this.editor) return;
    const src = this.editor.getValue();
    const { trailingPipe } = splitByPipesSafely(src);
    this._trailingPipe = trailingPipe;
    const rows = extractFieldsFromTemplate(src);
    this._suppressTableEdit = true;
    this.table.loadData(rows);
    setTimeout(() => {
      this._suppressTableEdit = false;
    }, 10);
  }

  bindUIEvents() {
    const btnFormat = document.getElementById("btnFormatVtl");
    const btnMinify = document.getElementById("btnMinifyVtl");
    const btnCopy = document.getElementById("btnCopyVtl");
    const btnPaste = document.getElementById("btnPasteVtl");
    const btnClear = document.getElementById("btnClearVtl");
    const btnAddField = document.getElementById("btnAddField");

    btnFormat?.addEventListener("click", () => {
      const src = this.editor.getValue();
      const formatted = formatVtlTemplate(src);
      this.editor.setValue(formatted);
      this.updateFieldsTable();
      UsageTracker.trackEvent("splunk-template", "format_action");
    });

    btnMinify?.addEventListener("click", () => {
      const src = this.editor.getValue();
      const minified = minifyVtlTemplate(src);
      this.editor.setValue(minified);
      this.updateFieldsTable();
      UsageTracker.trackEvent("splunk-template", "minify_action");
    });

    btnCopy?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(this.editor.getValue());
        UsageTracker.trackEvent("splunk-template", "copy_success");
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

    // Add Field: insert a blank row at the end without triggering sync
    btnAddField?.addEventListener("click", () => {
      if (!this.table) return;
      this._suppressTableEdit = true;
      try {
        const idx = this.table.countRows();
        this.table.alter("insert_row", idx, 1);
        // Initialize with safe defaults
        this.table.setDataAtRowProp(idx, "field", "");
        this.table.setDataAtRowProp(idx, "source", "hardcoded");
        this.table.setDataAtRowProp(idx, "value", "");
        this.table.setDataAtRowProp(idx, "functions", "");
        this.table.selectCell(idx, 0);
        UsageTracker.trackEvent("splunk-template", "add_field");
      } catch (_) {}
      this._suppressTableEdit = false;
    });
  }

  // Build value expression from a row
  _rowToExpr(row) {
    const src = (row.source || "").toLowerCase();
    const val = (row.value ?? "").trim();
    if (!val) return "";
    if (src === "context") return `$!{context.${val}}`;
    if (src === "variable") return `$!{${val}}`;
    return val; // hardcoded literal
  }

  // Apply table rows back to template, preserving non key=value segments
  _applyTableToTemplate(template, rows) {
    const { segments } = splitByPipesSafely(String(template));
    const rowMap = new Map();
    rows.forEach((r) => {
      const f = (r.field ?? "").trim();
      if (!f) return;
      const expr = this._rowToExpr(r);
      if (!expr) return;
      rowMap.set(f, expr);
    });

    const updated = [];
    const seen = new Set();
    for (const raw of segments) {
      // Preserve original leading/trailing whitespace and spacing around '='
      const m = String(raw).match(/^(\s*[^=|]+?)(\s*=\s*)([\s\S]*?)$/);
      if (!m) {
        // Not a key=value segment; keep exactly as-is
        updated.push(String(raw));
        continue;
      }
      const leftWithLead = m[1]; // includes any leading whitespace and field name
      const eqSpacing = m[2];
      const valuePart = m[3]; // may include leading/trailing spaces

      // Extract field name (trimmed) to match rowMap
      const field = leftWithLead.trim();

      if (rowMap.has(field)) {
        const newExpr = rowMap.get(field);
        const valLeadMatch = valuePart.match(/^\s*/);
        const valTrailMatch = valuePart.match(/\s*$/);
        const valLead = valLeadMatch ? valLeadMatch[0] : "";
        const valTrail = valTrailMatch ? valTrailMatch[0] : "";
        updated.push(`${leftWithLead}${eqSpacing}${valLead}${newExpr}${valTrail}`);
        seen.add(field);
      } else {
        // Keep original segment untouched
        updated.push(String(raw));
      }
    }

    // Append new fields not present in original
    for (const [field, expr] of rowMap.entries()) {
      if (!seen.has(field)) {
        updated.push(`${field}=${expr}`);
      }
    }

    let out = updated.join("|");
    if (this._trailingPipe) out += "|";
    return out;
  }

  onTableChanged() {
    if (!this.table || !this.editor) return;
    const rows = this.table.getSourceData();
    // Filter out empty rows
    const filtered = rows.filter((r) => (r.field ?? "").trim().length > 0);
    const current = this.editor.getValue();
    const next = this._applyTableToTemplate(current, filtered);
    this.editor.setValue(next);
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
      try {
        this._resizerCleanup();
      } catch (_) {}
      this._resizerCleanup = null;
    }
  }
}

export { SplunkVTLEditor };
