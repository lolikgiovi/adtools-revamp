import { BaseTool } from "../../core/BaseTool.js";
import * as monaco from "monaco-editor/esm/vs/editor/editor.main.js";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { configureMonacoWorkers } from "../../core/MonacoWorkers.js";
import { SplunkVTLEditorTemplate } from "./template.js";
import { getIconSvg } from "./icon.js";
import {
  extractFieldsFromTemplate,
  extractParameterPaths,
  formatVtlTemplate,
  minifyVtlTemplate,
  renderSplunkTemplate,
  setNestedValue,
  splitByPipesSafely,
} from "./service.js";
import { UsageTracker } from "../../core/UsageTracker.js";
import { cleanAnalyticsMeta, summarizeText } from "../../core/AnalyticsMeta.js";
import "./styles.css";
import Handsontable from "handsontable";
import "handsontable/dist/handsontable.full.css";

class SplunkVTLEditor extends BaseTool {
  constructor(eventBus) {
    super({ id: "splunk-template", eventBus, isHeavyTool: true });
    this.editor = null;
    this.table = null;
    this._storageKey = "tool:splunk-template:editor";
    this._parametersStorageKey = "tool:splunk-template:parameters";
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

  trackAnalytics(event, meta = {}) {
    try {
      const cleanMeta = cleanAnalyticsMeta(meta);
      UsageTracker.trackEvent("splunk-template", event, cleanMeta);
      const usageActions = { format_action: "format", minify_action: "minify", copy_success: "copy" };
      if (usageActions[event]) UsageTracker.trackToolUse("splunk-template", usageActions[event], cleanMeta);
    } catch (_) {}
  }

  async onMount() {
    await this.registerVtlLanguage();
    await this.initializeMonacoEditor();
    this.initializeFieldsTable();
    this.initializeParameters();
    this.initializeResizer();
    this.bindUIEvents();
    this.updateFieldsTable();
    this.updatePreview();
    UsageTracker.trackFeature("splunk-template", "mount", "", 5000);
  }

  onUnmount() {
    this.cleanupResizer();
    clearTimeout(this._persistTimer);
    clearTimeout(this._fieldsUpdateTimer);
    clearTimeout(this._previewTimer);
    clearTimeout(this._parametersPersistTimer);
    if (this.editor) {
      this.editor.dispose();
      this.editor = null;
    }
    if (this.table) {
      this.table.destroy();
      this.table = null;
    }
  }

  onWarmResume() {
    try {
      this.editor?.layout?.();
      this.table?.refreshDimensions?.();
      this.table?.render?.();
    } catch (_) {}
  }

  async registerVtlLanguage() {
    configureMonacoWorkers(self, { editor: editorWorker });

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
      this.schedulePreview();
    });
  }

  initializeParameters() {
    const input = document.getElementById("splunkParameters");
    if (!input) return;
    let saved = null;
    try {
      saved = localStorage.getItem(this._parametersStorageKey);
    } catch (_) {}
    input.value = saved ?? JSON.stringify(this.buildSampleParameters(), null, 2);
  }

  buildSampleParameters(existing = {}) {
    const output = structuredClone(existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {});
    const hasPath = (path) => path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), output) !== undefined;
    extractParameterPaths(this.editor?.getValue() || "").forEach((path) => {
      if (hasPath(path)) return;
      const leaf = path.split(".").at(-1).toLowerCase();
      let value = `sample-${leaf}`;
      if (/date|time/.test(leaf)) value = "2026-09-12 13:14:15";
      else if (/amount|balance|total|price/.test(leaf)) value = "1234.50";
      else if (/success|active|enabled/.test(leaf)) value = true;
      setNestedValue(output, path, value);
    });
    return output;
  }

  readParameters() {
    const input = document.getElementById("splunkParameters");
    const value = input?.value.trim() || "{}";
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Sample data must be a JSON object.");
    return parsed;
  }

  schedulePreview() {
    clearTimeout(this._previewTimer);
    this._previewTimer = setTimeout(() => this.updatePreview(), 250);
  }

  updatePreview() {
    const output = document.getElementById("splunkPreview");
    const status = document.getElementById("previewStatus");
    if (!output || !status || !this.editor) return;
    try {
      const rendered = renderSplunkTemplate(this.editor.getValue(), this.readParameters());
      output.textContent = rendered;
      status.textContent = `Rendered successfully · ${rendered.length.toLocaleString()} characters`;
      status.classList.remove("is-error");
    } catch (error) {
      output.textContent = "";
      status.textContent = `Preview error: ${error?.message || "Unable to render template"}`;
      status.classList.add("is-error");
    }
  }

  activateWorkspacePanel(panelId) {
    document.querySelectorAll(".workspace-pane .vtl-tab").forEach((tab) => {
      const active = tab.dataset.panel === panelId;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll(".workspace-pane .vtl-workspace-panel").forEach((panel) => {
      const active = panel.id === panelId;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });
    const actionByPanel = { fieldsPanel: "fieldsActions", parametersPanel: "parametersActions", previewPanel: "previewActions" };
    Object.values(actionByPanel).forEach((id) => {
      const actions = document.getElementById(id);
      if (actions) actions.hidden = id !== actionByPanel[panelId];
    });
    if (panelId === "fieldsPanel") {
      this.table?.refreshDimensions?.();
      this.table?.render?.();
    }
    if (panelId === "previewPanel") this.updatePreview();
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
    const parametersInput = document.getElementById("splunkParameters");
    const btnGenerateParameters = document.getElementById("btnGenerateParameters");
    const btnFormatParameters = document.getElementById("btnFormatParameters");
    const btnCopyPreview = document.getElementById("btnCopyPreview");

    document.querySelectorAll(".workspace-pane .vtl-tab").forEach((tab) => {
      tab.addEventListener("click", () => this.activateWorkspacePanel(tab.dataset.panel));
    });

    parametersInput?.addEventListener("input", () => {
      clearTimeout(this._parametersPersistTimer);
      this._parametersPersistTimer = setTimeout(() => {
        try {
          localStorage.setItem(this._parametersStorageKey, parametersInput.value);
        } catch (_) {}
      }, 250);
      this.schedulePreview();
    });

    btnGenerateParameters?.addEventListener("click", () => {
      try {
        const generated = this.buildSampleParameters(this.readParameters());
        parametersInput.value = JSON.stringify(generated, null, 2);
        parametersInput.dispatchEvent(new Event("input"));
      } catch (error) {
        this.showError(error?.message || "Sample data is not valid JSON");
      }
    });

    btnFormatParameters?.addEventListener("click", () => {
      try {
        parametersInput.value = JSON.stringify(this.readParameters(), null, 2);
        parametersInput.dispatchEvent(new Event("input"));
      } catch (error) {
        this.showError(error?.message || "Sample data is not valid JSON");
      }
    });

    btnCopyPreview?.addEventListener("click", () => this.copyToClipboard(document.getElementById("splunkPreview")?.textContent || ""));

    btnFormat?.addEventListener("click", () => {
      const src = this.editor.getValue();
      const formatted = formatVtlTemplate(src);
      this.editor.setValue(formatted);
      this.updateFieldsTable();
      this.trackAnalytics("format_action", {
        field_count: extractFieldsFromTemplate(formatted).length,
        ...summarizeText(src, "input"),
        ...summarizeText(formatted, "output"),
      });
    });

    btnMinify?.addEventListener("click", () => {
      const src = this.editor.getValue();
      const minified = minifyVtlTemplate(src);
      this.editor.setValue(minified);
      this.updateFieldsTable();
      this.trackAnalytics("minify_action", {
        field_count: extractFieldsFromTemplate(minified).length,
        ...summarizeText(src, "input"),
        ...summarizeText(minified, "output"),
      });
    });

    btnCopy?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(this.editor.getValue());
        this.trackAnalytics("copy_success", {
          field_count: extractFieldsFromTemplate(this.editor.getValue()).length,
          ...summarizeText(this.editor.getValue(), "output"),
        });
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
          this.trackAnalytics("paste_template", {
            field_count: extractFieldsFromTemplate(text).length,
            ...summarizeText(text, "input"),
          });
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
        this.trackAnalytics("add_field", { field_count: this.table.countRows() });
      } catch (_) {}
      this._suppressTableEdit = false;
    });
  }

  // Build value expression from a row
  _rowToExpr(row) {
    const src = (row.source || "").toLowerCase();
    const val = (row.value ?? "").trim();
    if (!val) return "";
    if (row.expression && src === row.originalSource && val === row.originalValue) return row.expression;
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
      rowMap.set((r.originalField || f).trim(), { row: r, expression: expr });
    });

    const updated = [];
    const seen = new Set();
    for (const raw of segments) {
      // Keep any leading header/directive text while identifying the field token immediately before '='.
      const m = String(raw).match(/^([\s\S]*?)([^\s=|]+)(\s*=\s*)([\s\S]*?)$/);
      if (!m) {
        // Not a key=value segment; keep exactly as-is
        updated.push(String(raw));
        continue;
      }
      const prefix = m[1];
      const field = m[2];
      const eqSpacing = m[3];
      const valuePart = m[4];

      if (rowMap.has(field)) {
        const entry = rowMap.get(field);
        const valLeadMatch = valuePart.match(/^\s*/);
        const valTrailMatch = valuePart.match(/\s*$/);
        const valLead = valLeadMatch ? valLeadMatch[0] : "";
        const valTrail = valTrailMatch ? valTrailMatch[0] : "";
        updated.push(`${prefix}${entry.row.field.trim()}${eqSpacing}${valLead}${entry.expression}${valTrail}`);
        seen.add(field);
      } else {
        // Keep original segment untouched
        updated.push(String(raw));
      }
    }

    // Append new fields not present in original
    for (const [originalField, entry] of rowMap.entries()) {
      if (!seen.has(originalField)) {
        updated.push(`${entry.row.field.trim()}=${entry.expression}`);
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
