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

const VTL_FUNCTIONS = [
  ["dateShort", "Short date using d/M/yyyy", '$format.dateShort($context.value, "id-ID")'],
  ["dateLong", "Date with an abbreviated month", '$format.dateLong($context.value, "id-ID")'],
  ["dateFull", "Date with a full month name", '$format.dateFull($context.value, "id-ID")'],
  ["time12", "12-hour time with AM/PM", '$format.time12($context.value, "en-US")'],
  ["time24", "24-hour time", '$format.time24($context.value, "id-ID")'],
  [
    "formatDate",
    "Format a supported date with a Java SimpleDateFormat pattern",
    '$format.formatDate($context.value, "dd/MM/yyyy", "id-ID")',
  ],
  ["amount", "Group a decimal value and keep two decimal places", "$format.amount($context.value)"],
  ["smsCurrency", "Format a decimal without grouping", "$format.smsCurrency($context.value)"],
  ["currency", "Format a decimal with Indonesian separators", "$format.currency($context.value)"],
  ["trimLeft10", "Keep the first 10 characters", "$format.trimLeft10($context.value)"],
  ["trimLeft11", "Keep the first 11 characters", "$format.trimLeft11($context.value)"],
  ["trimLeft25", "Keep 25 characters and trim outer whitespace", "$format.trimLeft25($context.value)"],
  ["mask", "Mask the first four of the rightmost eight characters", "$format.mask($context.value)"],
  ["add", "Add decimal values exactly", "$format.add($context.first, $context.second)"],
  ["encrypt", "Return SHA-256 of value plus salt", '$format.encrypt($context.value, "salt")'],
  ["replaceByRegex", "Replace every Java-regex match", '$format.replaceByRegex($context.value, "regex", "replacement")'],
  ["get", "Format the current date and time", '$date.get("yyyy-MM-dd HH:mm:ss")'],
  ["convertDate", "Convert a timestamp or date", "$date.convertDate($context.value, \"yyyy-MM-dd'T'HH:mm:ss\")"],
];

class SplunkVTLEditor extends BaseTool {
  constructor(eventBus) {
    super({ id: "splunk-template", eventBus, isHeavyTool: true });
    this.editor = null;
    this.parametersEditor = null;
    this.table = null;
    this._storageKey = "tool:splunk-template:editor";
    this._parametersStorageKey = "tool:splunk-template:parameters";
    this._trailingPipe = false;
    this._resizerCleanup = null;
    this._suppressTableEdit = false;
    this._languageDisposables = [];
    this._clearedTemplate = null;
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
    clearTimeout(this._undoTimer);
    this._languageDisposables.forEach((disposable) => disposable.dispose());
    this._languageDisposables = [];
    if (this.editor) {
      this.editor.dispose();
      this.editor = null;
    }
    if (this.parametersEditor) {
      this.parametersEditor.dispose();
      this.parametersEditor = null;
    }
    if (this.table) {
      this.table.destroy();
      this.table = null;
    }
  }

  onWarmResume() {
    try {
      this.editor?.layout?.();
      this.parametersEditor?.layout?.();
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

    this._languageDisposables.push(
      monaco.languages.registerCompletionItemProvider("vtl-splunk", {
        triggerCharacters: ["$", "."],
        provideCompletionItems: (model, position) => {
          const linePrefix = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
          const namespace = linePrefix.match(/\$(format|date)\.$/)?.[1];
          if (!namespace && linePrefix.endsWith("$")) return { suggestions: [] };
          const functions = namespace ? VTL_FUNCTIONS.filter(([, , expression]) => expression.startsWith(`$${namespace}.`)) : VTL_FUNCTIONS;
          return {
            suggestions: functions.map(([name, detail, expression]) => ({
              label: name,
              kind: monaco.languages.CompletionItemKind.Function,
              detail,
              documentation: { value: `\`${expression}\`` },
              insertText: namespace ? expression.replace(`$${namespace}.`, "") : expression,
            })),
          };
        },
      }),
      monaco.languages.registerHoverProvider("vtl-splunk", {
        provideHover: (model, position) => {
          const line = model.getLineContent(position.lineNumber);
          const match = VTL_FUNCTIONS.find(([name]) => line.includes(`.${name}(`));
          if (!match) return null;
          return { contents: [{ value: `**${match[0]}** — ${match[1]}` }, { value: `\`${match[2]}\`` }] };
        },
      }),
    );
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
      scrollbar: { alwaysConsumeMouseWheel: false },
      wordWrap: "on",
      fontSize: 12,
      tabSize: 2,
      insertSpaces: true,
      ariaLabel: "Velocity template editor",
    });

    this._persistTimer = null;
    this._fieldsUpdateTimer = null;
    this.editor.onDidChangeModelContent(() => {
      clearTimeout(this._persistTimer);
      const v = this.editor.getValue();
      this.setSaveStatus("templateSaveStatus", "Saving…", true);
      this._persistTimer = setTimeout(() => {
        try {
          localStorage.setItem(this._storageKey, v);
          this.setSaveStatus("templateSaveStatus", "Saved locally");
        } catch (_) {
          this.setSaveStatus("templateSaveStatus", "Not saved");
        }
      }, 250);
      clearTimeout(this._fieldsUpdateTimer);
      this._fieldsUpdateTimer = setTimeout(() => {
        this.updateFieldsTable();
        this.syncContextFields();
      }, 300);
      this.schedulePreview();
    });
  }

  initializeParameters() {
    const container = document.getElementById("splunkParameters");
    if (!container) return;
    let saved = null;
    try {
      saved = localStorage.getItem(this._parametersStorageKey);
    } catch (_) {}
    this.parametersEditor = monaco.editor.create(container, {
      value: saved ?? JSON.stringify(this.buildSampleParameters(), null, 2),
      language: "json",
      theme: "vs-dark",
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      scrollbar: { alwaysConsumeMouseWheel: false },
      wordWrap: "on",
      fontSize: 12,
      tabSize: 2,
      insertSpaces: true,
      ariaLabel: "Sample parameters JSON",
    });
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
    const value = this.parametersEditor?.getValue().trim() || "{}";
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Sample data must be a JSON object.");
    return parsed;
  }

  schedulePreview() {
    clearTimeout(this._previewTimer);
    this._previewTimer = setTimeout(() => this.updatePreview(), 250);
  }

  setSaveStatus(id, text, saving = false) {
    const status = document.getElementById(id);
    if (!status) return;
    status.textContent = text;
    status.classList.toggle("is-saving", saving);
  }

  setContextError(message = "") {
    const status = document.getElementById("contextStatus");
    if (!status) return;
    status.textContent = message;
    status.hidden = !message;
  }

  updatePreview() {
    const output = document.getElementById("splunkPreview");
    const status = document.getElementById("previewStatus");
    if (!output || !status || !this.editor) return;
    let parameters;
    try {
      parameters = this.readParameters();
      this.setContextError();
    } catch (error) {
      this.setContextError(`Invalid JSON: ${error?.message || "Check the Context Data syntax."}`);
      output.classList.add("is-stale");
      status.textContent = "Preview paused until Context Data is valid.";
      status.hidden = false;
      status.classList.add("is-error");
      return;
    }
    try {
      const rendered = renderSplunkTemplate(this.editor.getValue(), parameters);
      this.highlightPreview(output, rendered);
      output.classList.remove("is-stale");
      status.textContent = "";
      status.hidden = true;
      status.classList.remove("is-error");
    } catch (error) {
      status.textContent = `Preview error: ${error?.message || "Unable to render template"}`;
      output.classList.add("is-stale");
      status.hidden = false;
      status.classList.add("is-error");
    }
  }

  highlightPreview(output, rendered) {
    output.replaceChildren();
    const append = (text, className) => {
      if (!text) return;
      const node = document.createElement("span");
      if (className) node.className = className;
      node.textContent = text;
      output.appendChild(node);
    };

    rendered.split("|").forEach((segment, index, segments) => {
      let cursor = 0;
      const assignment = /(^|[\s-]+)([A-Za-z_][\w.-]*)(\s*)(=)(\s*)(.*?)(?=(?:\s+-\s+|\s+)[A-Za-z_][\w.-]*\s*=|$)/g;
      for (const match of segment.matchAll(assignment)) {
        append(segment.slice(cursor, match.index) + match[1]);
        append(match[2], "vtl-preview-field");
        append(match[3]);
        append(match[4], "vtl-preview-operator");
        append(match[5]);
        append(match[6], "vtl-preview-value");
        cursor = match.index + match[0].length;
      }
      append(segment.slice(cursor));
      if (index < segments.length - 1) append("|", "vtl-preview-pipe");
    });
  }

  buildRequiredInputs() {
    const output = {};
    extractParameterPaths(this.editor?.getValue() || "").forEach((path) => setNestedValue(output, path, ""));
    return output;
  }

  syncContextFields() {
    if (!this.parametersEditor) return false;
    let current;
    try {
      current = this.readParameters();
    } catch (_) {
      return false;
    }
    const generated = this.buildSampleParameters(current);
    if (JSON.stringify(generated) === JSON.stringify(current)) return true;
    this.parametersEditor.setValue(JSON.stringify(generated, null, 2));
    return true;
  }

  activateEditorView(view) {
    const isText = view === "text";
    const textPanel = document.getElementById("textEditorPanel");
    const tablePanel = document.getElementById("tableEditorPanel");
    const textActions = document.getElementById("textEditorActions");
    const tableActions = document.getElementById("tableEditorActions");
    const textButton = document.getElementById("btnTextView");
    const tableButton = document.getElementById("btnTableView");

    if (textPanel) {
      textPanel.hidden = !isText;
      textPanel.classList.toggle("is-active", isText);
    }
    if (tablePanel) {
      tablePanel.hidden = isText;
      tablePanel.classList.toggle("is-active", !isText);
    }
    if (textActions) textActions.hidden = !isText;
    if (tableActions) tableActions.hidden = isText;
    textButton?.classList.toggle("is-active", isText);
    tableButton?.classList.toggle("is-active", !isText);
    textButton?.setAttribute("aria-selected", String(isText));
    tableButton?.setAttribute("aria-selected", String(!isText));
    textButton?.setAttribute("tabindex", isText ? "0" : "-1");
    tableButton?.setAttribute("tabindex", isText ? "-1" : "0");

    if (isText) this.editor?.layout?.();
    else {
      this.toggleFunctionLibrary(false, false);
      this.updateFieldsTable();
      this.table?.refreshDimensions?.();
      this.table?.render?.();
    }
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

  toggleFunctionLibrary(open, restoreFocus = true) {
    const panel = document.getElementById("functionLibraryPanel");
    const trigger = document.getElementById("btnFunctions");
    if (!panel || !trigger) return;
    if (open && !panel.open) {
      if (typeof panel.showModal === "function") panel.showModal();
      else panel.setAttribute("open", "");
    } else if (!open && panel.open) {
      if (typeof panel.close === "function") panel.close();
      else panel.removeAttribute("open");
    }
    trigger.setAttribute("aria-expanded", String(open));
    requestAnimationFrame(() => {
      if (open) document.getElementById("functionSearch")?.focus();
      else if (restoreFocus) trigger.focus();
    });
  }

  filterFunctions(query) {
    const normalized = String(query || "")
      .trim()
      .toLowerCase();
    let visibleCount = 0;
    document.querySelectorAll("[data-function-group]").forEach((group) => {
      let groupCount = 0;
      group.querySelectorAll("[data-function-item]").forEach((item) => {
        const visible = !normalized || item.textContent.toLowerCase().includes(normalized);
        item.hidden = !visible;
        if (visible) groupCount++;
      });
      group.hidden = groupCount === 0;
      if (normalized && groupCount > 0) group.open = true;
      visibleCount += groupCount;
    });
    const empty = document.getElementById("functionEmptyState");
    if (empty) empty.hidden = visibleCount > 0;
  }

  insertFunctionExpression(expression) {
    if (!this.editor || !expression) return;
    this.activateEditorView("text");
    const selection = this.editor.getSelection();
    const model = this.editor.getModel();
    if (!selection || !model) return;
    const insertionOffset = model.getOffsetAt(selection.getStartPosition());
    this.editor.executeEdits("function-library", [{ range: selection, text: expression, forceMoveMarkers: true }]);
    const placeholderOffset = expression.indexOf("$context.value");
    if (placeholderOffset >= 0) {
      const startOffset = insertionOffset + placeholderOffset;
      const start = model.getPositionAt(startOffset);
      const end = model.getPositionAt(startOffset + "$context.value".length);
      this.editor.setSelection(new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column));
    } else this.editor.setPosition(model.getPositionAt(insertionOffset + expression.length));
    this.toggleFunctionLibrary(false, false);
    this.editor.focus();
    this.showSuccess("Function inserted at cursor");
  }

  showUndoClear(previousValue) {
    const toast = document.getElementById("vtlUndoToast");
    if (!toast) return;
    this._clearedTemplate = previousValue;
    toast.hidden = false;
    clearTimeout(this._undoTimer);
    this._undoTimer = setTimeout(() => {
      toast.hidden = true;
      this._clearedTemplate = null;
    }, 7000);
  }

  hideUndoClear() {
    const toast = document.getElementById("vtlUndoToast");
    if (toast) toast.hidden = true;
    clearTimeout(this._undoTimer);
  }

  bindUIEvents() {
    const btnFormat = document.getElementById("btnFormatVtl");
    const btnMinify = document.getElementById("btnMinifyVtl");
    const btnCopy = document.getElementById("btnCopyVtl");
    const btnPaste = document.getElementById("btnPasteVtl");
    const btnClear = document.getElementById("btnClearVtl");
    const btnAddField = document.getElementById("btnAddField");
    const btnGenerateParameters = document.getElementById("btnGenerateParameters");
    const btnFormatParameters = document.getElementById("btnFormatParameters");
    const btnCopyPreview = document.getElementById("btnCopyPreview");
    const btnCopyInputsJson = document.getElementById("btnCopyInputsJson");
    const btnCopyInputsLines = document.getElementById("btnCopyInputsLines");
    const btnTextView = document.getElementById("btnTextView");
    const btnTableView = document.getElementById("btnTableView");
    const btnFunctions = document.getElementById("btnFunctions");
    const btnCloseFunctions = document.getElementById("btnCloseFunctions");
    const functionPanel = document.getElementById("functionLibraryPanel");
    const functionSearch = document.getElementById("functionSearch");
    const btnTogglePreviewWrap = document.getElementById("btnTogglePreviewWrap");
    const moreActions = document.getElementById("editorMoreActions");

    btnTextView?.addEventListener("click", () => this.activateEditorView("text"));
    btnTableView?.addEventListener("click", () => this.activateEditorView("table"));
    document.querySelector(".vtl-view-switch")?.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const currentIsText = btnTextView?.getAttribute("aria-selected") === "true";
      const useText = event.key === "Home" || ((event.key === "ArrowLeft" || event.key === "ArrowRight") && !currentIsText);
      this.activateEditorView(useText ? "text" : "table");
      (useText ? btnTextView : btnTableView)?.focus();
    });

    btnFunctions?.addEventListener("click", () => this.toggleFunctionLibrary(btnFunctions.getAttribute("aria-expanded") !== "true"));
    btnCloseFunctions?.addEventListener("click", () => this.toggleFunctionLibrary(false));
    functionPanel?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.toggleFunctionLibrary(false);
    });
    functionPanel?.addEventListener("cancel", (event) => {
      event.preventDefault();
      this.toggleFunctionLibrary(false);
    });
    functionPanel?.addEventListener("click", (event) => {
      if (event.target === functionPanel) this.toggleFunctionLibrary(false);
    });
    this.container?.querySelector(".splunk-vtl-editor")?.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (btnFunctions?.getAttribute("aria-expanded") === "true") this.toggleFunctionLibrary(false);
      moreActions?.removeAttribute("open");
    });
    this.container?.querySelector(".splunk-vtl-editor")?.addEventListener("click", (event) => {
      if (moreActions && !moreActions.contains(event.target)) moreActions.removeAttribute("open");
    });
    functionSearch?.addEventListener("input", () => this.filterFunctions(functionSearch.value));
    functionPanel?.addEventListener("click", (event) => {
      const insertButton = event.target.closest("[data-insert-expression]");
      const copyButton = event.target.closest("[data-copy-expression]");
      if (insertButton) this.insertFunctionExpression(insertButton.dataset.insertExpression);
      if (copyButton) this.copyToClipboard(copyButton.dataset.copyExpression, copyButton);
    });

    this.parametersEditor?.onDidChangeModelContent(() => {
      clearTimeout(this._parametersPersistTimer);
      this.setSaveStatus("contextSaveStatus", "Saving…", true);
      this._parametersPersistTimer = setTimeout(() => {
        try {
          localStorage.setItem(this._parametersStorageKey, this.parametersEditor?.getValue() || "");
          this.setSaveStatus("contextSaveStatus", "Saved locally");
        } catch (_) {
          this.setSaveStatus("contextSaveStatus", "Not saved");
        }
      }, 250);
      this.schedulePreview();
    });

    btnGenerateParameters?.addEventListener("click", () => {
      if (!this.syncContextFields()) {
        this.setContextError("Context Data must be valid JSON before fields can be synchronized.");
        this.showError("Fix the Context Data JSON, then try Sync fields again.");
      } else this.showSuccess("Context fields synchronized");
    });

    btnFormatParameters?.addEventListener("click", () => {
      try {
        this.parametersEditor?.setValue(JSON.stringify(this.readParameters(), null, 2));
        this.setContextError();
        this.showSuccess("Context Data formatted");
      } catch (error) {
        this.setContextError(`Invalid JSON: ${error?.message || "Check the Context Data syntax."}`);
        this.showError("Fix the Context Data JSON before formatting it.");
      }
    });

    btnCopyPreview?.addEventListener("click", () => this.copyToClipboard(document.getElementById("splunkPreview")?.textContent || ""));

    btnCopyInputsJson?.addEventListener("click", () => this.copyToClipboard(JSON.stringify(this.buildRequiredInputs(), null, 2)));

    btnCopyInputsLines?.addEventListener("click", () =>
      this.copyToClipboard(extractParameterPaths(this.editor?.getValue() || "").join("\n")),
    );

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
      this.showSuccess("Template formatted");
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
      moreActions?.removeAttribute("open");
      this.showSuccess("Template minified");
    });

    btnCopy?.addEventListener("click", async () => {
      const copied = await this.copyToClipboard(this.editor.getValue(), btnCopy);
      if (copied) {
        this.trackAnalytics("copy_success", {
          field_count: extractFieldsFromTemplate(this.editor.getValue()).length,
          ...summarizeText(this.editor.getValue(), "output"),
        });
      }
    });
    btnPaste?.addEventListener("click", async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (!text) {
          this.showError("Clipboard is empty");
          return;
        }
        const model = this.editor.getModel();
        if (model) this.editor.executeEdits("paste", [{ range: model.getFullModelRange(), text }]);
        else this.editor.setValue(text);
        this.updateFieldsTable();
        moreActions?.removeAttribute("open");
        this.showSuccess("Template pasted from clipboard");
        this.trackAnalytics("paste_template", {
          field_count: extractFieldsFromTemplate(text).length,
          ...summarizeText(text, "input"),
        });
      } catch (_) {
        this.showError("Could not read the clipboard. Check browser permission and try again.");
      }
    });
    btnClear?.addEventListener("click", () => {
      const previousValue = this.editor.getValue();
      if (!previousValue) return;
      this.editor.setValue("");
      this.updateFieldsTable();
      moreActions?.removeAttribute("open");
      this.showUndoClear(previousValue);
      try {
        localStorage.setItem(this._storageKey, "");
      } catch (_) {}
    });

    document.getElementById("btnUndoClear")?.addEventListener("click", () => {
      if (this._clearedTemplate === null) return;
      this.editor.setValue(this._clearedTemplate);
      this.hideUndoClear();
      this._clearedTemplate = null;
      this.showSuccess("Template restored");
    });
    document.getElementById("btnDismissUndo")?.addEventListener("click", () => this.hideUndoClear());

    btnTogglePreviewWrap?.addEventListener("click", () => {
      const preview = document.getElementById("splunkPreview");
      const nowrap = preview?.classList.toggle("is-nowrap") || false;
      btnTogglePreviewWrap.setAttribute("aria-pressed", String(!nowrap));
      btnTogglePreviewWrap.textContent = nowrap ? "No wrap" : "Wrap";
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

    const applyWidth = (left, rect = layout.getBoundingClientRect()) => {
      const total = rect.width - RESIZER_W;
      const clamped = Math.max(MIN_LEFT, Math.min(left, total - MIN_RIGHT));
      layout.style.gridTemplateColumns = `${clamped}px ${RESIZER_W}px ${total - clamped}px`;
      resizer.setAttribute("aria-valuenow", String(total > 0 ? Math.round((clamped / total) * 100) : 50));
    };

    const onMove = (e) => {
      if (!dragging) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const rect = layout.getBoundingClientRect();
      applyWidth(clientX - rect.left, rect);
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
      if (window.innerWidth <= 940) return; // disabled on stacked layout
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
    const onKeyDown = (event) => {
      if (window.innerWidth <= 940 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const rect = layout.getBoundingClientRect();
      const total = rect.width - RESIZER_W;
      const current = (total * (Number(resizer.getAttribute("aria-valuenow")) || 60)) / 100;
      if (event.key === "Home") applyWidth(MIN_LEFT, rect);
      else if (event.key === "End") applyWidth(total - MIN_RIGHT, rect);
      else applyWidth(current + (event.key === "ArrowLeft" ? -24 : 24), rect);
    };
    resizer.addEventListener("keydown", onKeyDown);

    this._resizerCleanup = () => {
      resizer.removeEventListener("mousedown", onDown);
      resizer.removeEventListener("touchstart", onDown);
      resizer.removeEventListener("keydown", onKeyDown);
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
