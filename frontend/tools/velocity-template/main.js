import { BaseTool } from "../../core/BaseTool.js";
import { cleanAnalyticsMeta, summarizeText } from "../../core/AnalyticsMeta.js";
import { configureMonacoWorkers } from "../../core/MonacoWorkers.js";
import { UsageTracker } from "../../core/UsageTracker.js";
import { OracleConnectionService } from "../../core/OracleConnectionService.js";
import { isTauri } from "../../core/Runtime.js";
import * as monaco from "monaco-editor/esm/vs/editor/editor.main.js";
import "monaco-editor/esm/vs/language/json/monaco.contribution.js";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import { getIconSvg } from "./icon.js";
import {
  extractContextPaths,
  extractVelocityVariables,
  formatRenderedResult,
  normalizeImportedTemplateValue,
  parseTemplateImportQuery,
  renderVelocityTemplate,
  setNestedValue,
} from "./service.js";
import { VelocityTemplate } from "./template.js";
import "./styles.css";

const DIRECTIVES = [
  ["#if", "#if(${1:condition})\n$0\n#end"],
  ["#elseif", "#elseif(${1:condition})"],
  ["#else", "#else"],
  ["#end", "#end"],
  ["#set", "#set($${1:name} = ${2:value})"],
  ["#foreach", "#foreach($${1:item} in $${2:items})\n$0\n#end"],
  ["#macro", "#macro(${1:name} $${2:argument})\n$0\n#end"],
];

const VELOCITY_FUNCTIONS = [
  ["toString", "Convert the value to text", "toString()"],
  ["size", "Return the collection, map, or text size", "size()"],
  ["isEmpty", "Check whether the value is empty", "isEmpty()"],
  ["contains", "Check whether the value contains an item", "contains(${1:value})"],
  ["get", "Get an item by key or index", "get(${1:key})"],
  ["keySet", "Return the keys in a map", "keySet()"],
  ["values", "Return the values in a map", "values()"],
  ["toUpperCase", "Convert text to uppercase", "toUpperCase()"],
  ["toLowerCase", "Convert text to lowercase", "toLowerCase()"],
  ["trim", "Remove leading and trailing whitespace", "trim()"],
  ["substring", "Return part of a text value", "substring(${1:start}${2:, end})"],
  ["startsWith", "Check whether text starts with a value", "startsWith(${1:value})"],
  ["endsWith", "Check whether text ends with a value", "endsWith(${1:value})"],
  ["replace", "Replace text occurrences", "replace(${1:search}, ${2:replacement})"],
];

function contextPaths(value, prefix = "", depth = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 5) return [];
  return Object.entries(value).flatMap(([key, nested]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return [];
    const path = prefix ? `${prefix}.${key}` : key;
    return [path, ...contextPaths(nested, path, depth + 1)];
  });
}

class VelocityTemplateTool extends BaseTool {
  constructor(eventBus) {
    super({ id: "velocity-template", eventBus, isHeavyTool: true });
    this.editor = null;
    this.contextEditor = null;
    this.previewEditor = null;
    this._languageDisposables = [];
    this._templateStorageKey = "tool:velocity-template:editor";
    this._contextStorageKey = "tool:velocity-template:context";
    this._resultTypeStorageKey = "tool:velocity-template:result-type";
    this._paneStateStorageKey = "tool:velocity-template:pane-state";
    this._sqlImportRows = [];
    this._sqlImportColumns = [];
  }

  getIconSvg() {
    return getIconSvg();
  }

  render() {
    return VelocityTemplate;
  }

  async onMount() {
    this.registerLanguage();
    this.initializeEditors();
    this.initializeResizer();
    this.bindEvents();
    this.initializePaneState();
    this.initializeSqlImport();
    this.updatePreview();
    UsageTracker.trackFeature("velocity-template", "mount", "", 5000);
  }

  onUnmount() {
    clearTimeout(this._templateTimer);
    clearTimeout(this._contextTimer);
    clearTimeout(this._previewTimer);
    this._languageDisposables.forEach((disposable) => disposable.dispose());
    this._languageDisposables = [];
    this.editor?.dispose();
    this.contextEditor?.dispose();
    this.previewEditor?.dispose();
    this.editor = null;
    this.contextEditor = null;
    this.previewEditor = null;
    document.getElementById("velocitySqlImportDialog")?.close?.();
    this.cleanupResizer();
  }

  onWarmResume() {
    this.editor?.layout?.();
    this.contextEditor?.layout?.();
    this.previewEditor?.layout?.();
  }

  registerLanguage() {
    configureMonacoWorkers(self, { editor: editorWorker, json: jsonWorker });
    if (!monaco.languages.getLanguages().some((language) => language.id === "velocity")) {
      monaco.languages.register({ id: "velocity" });
    }
    monaco.languages.setLanguageConfiguration("velocity", {
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
    monaco.languages.setMonarchTokensProvider("velocity", {
      tokenizer: {
        root: [
          [/##.*$/, "comment"],
          [/#\*/, "comment", "@blockComment"],
          [/"([^"\\]|\\.)*"/, "string"],
          [/'([^'\\]|\\.)*'/, "string"],
          [/#(if|elseif|else|end|set|foreach|macro|parse|include|define|evaluate|stop|break)\b/, "keyword"],
          [/\$!?\{[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*\}/, "variable"],
          [/\$!?[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*/, "variable"],
          [/\b(?:true|false|null)\b/, "constant"],
          [/\b\d+(?:\.\d+)?\b/, "number"],
          [/[=!<>+*/%-]+/, "operator"],
        ],
        blockComment: [
          [/[^*]+/, "comment"],
          [/\*#/, "comment", "@pop"],
          [/./, "comment"],
        ],
      },
    });
    this._languageDisposables.push(
      monaco.languages.registerCompletionItemProvider("velocity", {
        triggerCharacters: ["#", "$", "."],
        provideCompletionItems: (model, position) => this.completions(model, position),
      }),
    );
  }

  completions(model, position) {
    const prefix = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
    const rangeFrom = (length) => ({
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: position.column - length,
      endColumn: position.column,
    });
    const directive = prefix.match(/#[A-Za-z]*$/);
    if (directive) {
      return {
        suggestions: DIRECTIVES.map(([label, insertText]) => ({
          label,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range: rangeFrom(directive[0].length),
        })),
      };
    }
    const reference = prefix.match(/\$!?\{?[A-Za-z_][\w.]*$|\$!?\{?$/);
    if (!reference) return { suggestions: [] };
    let context = {};
    try {
      context = this.readContext();
    } catch (_) {
      // Invalid JSON is surfaced by the preview; autocomplete simply has no context suggestions.
    }
    const quiet = reference[0].startsWith("$!");
    const wrapped = reference[0].includes("{");
    const contextVariables = contextPaths(context);
    const paths = new Set([...contextVariables, ...extractVelocityVariables(model.getValue())]);
    const suggestions = [...paths].map((path) => ({
      label: `$${path}`,
      kind: monaco.languages.CompletionItemKind.Variable,
      insertText: `$${quiet ? "!" : ""}${wrapped ? "{" : ""}${path}${wrapped ? "}" : ""}`,
      range: rangeFrom(reference[0].length),
      detail: contextVariables.includes(path) ? "Context variable" : "Template variable",
    }));
    const functionCall = prefix.match(/\$!?\{?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\.([A-Za-z_]\w*)?$/);
    if (functionCall) {
      const typedName = functionCall[1] || "";
      suggestions.push(
        ...VELOCITY_FUNCTIONS.filter(([name]) => name.toLowerCase().startsWith(typedName.toLowerCase())).map(
          ([name, detail, insertText]) => ({
            label: name,
            kind: monaco.languages.CompletionItemKind.Function,
            detail,
            insertText,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range: rangeFrom(typedName.length),
          }),
        ),
      );
    }
    return { suggestions };
  }

  initializeEditors() {
    const template = this.readStored(
      this._templateStorageKey,
      [
        "Hello, $customer.name!",
        "",
        "#if($customer.active)",
        "Your items:",
        "#foreach($item in $items)",
        "- $item",
        "#end",
        "#else",
        "Your account is inactive.",
        "#end",
      ].join("\n"),
    );
    const context = this.readStored(
      this._contextStorageKey,
      JSON.stringify({ customer: { name: "Maya", active: true }, items: ["One", "Two"] }, null, 2),
    );
    this.editor = monaco.editor.create(
      document.getElementById("velocityEditor"),
      this.editorOptions(template, "velocity", "Velocity template editor"),
    );
    this.contextEditor = monaco.editor.create(
      document.getElementById("velocityContext"),
      this.editorOptions(context, "json", "Velocity context JSON"),
    );
    this.previewEditor = monaco.editor.create(document.getElementById("velocityPreview"), {
      ...this.editorOptions("", "plaintext", "Rendered Velocity template"),
      readOnly: true,
      domReadOnly: true,
      lineNumbers: "off",
      folding: false,
      glyphMargin: false,
      lineDecorationsWidth: 0,
      lineNumbersMinChars: 0,
      renderLineHighlight: "none",
      overviewRulerLanes: 0,
      wordWrap: "on",
    });
    const resultType = this.readStored(this._resultTypeStorageKey, "text");
    this.setResultType(resultType === "json" ? "json" : "text", { updatePreview: false });
  }

  editorOptions(value, language, ariaLabel) {
    return {
      value,
      language,
      theme: "vs-dark",
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      scrollbar: { alwaysConsumeMouseWheel: false },
      wordWrap: "on",
      quickSuggestions: { other: true, comments: false, strings: true },
      suggestOnTriggerCharacters: true,
      wordBasedSuggestions: "off",
      fontSize: 12,
      tabSize: 2,
      insertSpaces: true,
      ariaLabel,
    };
  }

  readStored(key, fallback) {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch (_) {
      return fallback;
    }
  }

  persist(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (_) {
      // The editor remains usable when storage is unavailable or full.
    }
  }

  readContext() {
    const parsed = JSON.parse(this.contextEditor?.getValue().trim() || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Context must be a JSON object.");
    return parsed;
  }

  configurePreviewMode(mode) {
    const isJson = mode === "json";
    const model = this.previewEditor?.getModel();
    if (model) monaco.editor.setModelLanguage(model, isJson ? "json" : "plaintext");
    this.previewEditor?.updateOptions({
      lineNumbers: "on",
      lineNumbersMinChars: 3,
      lineDecorationsWidth: 8,
      folding: isJson,
      showFoldingControls: isJson ? "mouseover" : "never",
    });
  }

  schedulePreview() {
    clearTimeout(this._previewTimer);
    this._previewTimer = setTimeout(() => this.updatePreview(), 200);
  }

  updatePreview() {
    const output = document.getElementById("velocityPreview");
    const status = document.getElementById("velocityPreviewStatus");
    const contextError = document.getElementById("velocityContextError");
    if (!output || !status || !contextError || !this.editor || !this.previewEditor) return;
    let rendered = "";
    try {
      rendered = renderVelocityTemplate(this.editor.getValue(), this.readContext());
      const resultType = this._resultType || "text";
      const displayValue = formatRenderedResult(rendered, resultType);
      this.configurePreviewMode(resultType);
      monaco.editor.setModelMarkers(this.editor.getModel(), "velocity-template", []);
      monaco.editor.setModelMarkers(this.contextEditor.getModel(), "velocity-context", []);
      this.previewEditor.setValue(displayValue);
      output.classList.remove("is-stale");
      status.hidden = true;
      status.textContent = "";
      status.classList.remove("is-error");
      contextError.hidden = true;
      contextError.textContent = "";
    } catch (error) {
      const message = error?.message || "Unable to render template.";
      const isJsonError = error instanceof SyntaxError;
      const isOutputError = error?.kind === "output";
      const line = Math.max(1, Number(error?.line) || 1);
      const column = Math.max(1, Number(error?.column) || 1);
      const model = this.editor.getModel();
      const endColumn = model ? model.getLineMaxColumn(Math.min(line, model.getLineCount())) : column + 1;
      monaco.editor.setModelMarkers(
        this.editor.getModel(),
        "velocity-template",
        isJsonError || isOutputError
          ? []
          : [
              {
                severity: monaco.MarkerSeverity.Error,
                message,
                startLineNumber: line,
                startColumn: column,
                endLineNumber: line,
                endColumn: Math.max(column + 1, endColumn),
              },
            ],
      );
      if (isOutputError) {
        this.configurePreviewMode("json");
        this.previewEditor.setValue(rendered);
        output.classList.remove("is-stale");
      } else output.classList.add("is-stale");
      status.textContent = isJsonError
        ? `Context JSON error — ${message}`
        : isOutputError
          ? `Rendered JSON error · Output line ${line}, column ${column} — ${message}`
          : `${error?.kind === "syntax" ? "Velocity syntax error" : "Velocity rendering error"} · Line ${line}, column ${column} — ${message}`;
      status.hidden = false;
      status.classList.add("is-error");
      contextError.textContent = isJsonError ? `Invalid JSON: ${message}` : "";
      contextError.hidden = !isJsonError;
    }
  }

  buildSampleContext(existing = {}) {
    const result = structuredClone(existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {});
    const hasPath = (path) => path.split(".").reduce((value, key) => value?.[key], result) !== undefined;
    extractContextPaths(this.editor?.getValue() || "").forEach((path) => {
      if (hasPath(path)) return;
      const leaf = path.split(".").at(-1).toLowerCase();
      let value = `sample-${leaf}`;
      if (/^(?:is|has)|active|enabled|success/.test(leaf)) value = true;
      else if (/items|list|rows|entries|users/.test(leaf)) value = [];
      else if (/count|amount|total|price|age/.test(leaf)) value = 1;
      setNestedValue(result, path, value);
    });
    return result;
  }

  syncContext() {
    const value = this.buildSampleContext(this.readContext());
    this.contextEditor?.setValue(JSON.stringify(value, null, 2));
  }

  setResultType(mode, { updatePreview = true } = {}) {
    this._resultType = mode === "json" ? "json" : "text";
    const trigger = document.getElementById("velocityResultType");
    if (trigger) trigger.textContent = this._resultType === "json" ? "JSON" : "Text";
    this.container?.querySelectorAll("[data-result-type]").forEach((button) => {
      button.setAttribute("aria-checked", String(button.dataset.resultType === this._resultType));
    });
    this.persist(this._resultTypeStorageKey, this._resultType);
    document.getElementById("velocityResultTypeMenu")?.removeAttribute("open");
    if (updatePreview) this.updatePreview();
  }

  initializePaneState() {
    let state = "expanded";
    try {
      state = JSON.parse(this.readStored(this._paneStateStorageKey, '"expanded"'));
    } catch (_) {
      // Ignore malformed persisted UI state and use the expanded layout.
    }
    this.setPaneState(["template", "context"].includes(state) ? state : "expanded", { persist: false });
  }

  setPaneState(collapsedPane, { persist = true } = {}) {
    const layout = this.container?.querySelector(".vtl-layout");
    if (!layout) return;
    const state = ["template", "context"].includes(collapsedPane) ? collapsedPane : "expanded";
    layout.classList.toggle("is-template-collapsed", state === "template");
    layout.classList.toggle("is-context-collapsed", state === "context");
    const templateButton = document.getElementById("btnCollapseVelocityTemplate");
    const contextButton = document.getElementById("btnCollapseVelocityContext");
    templateButton?.setAttribute("aria-expanded", String(state !== "template"));
    contextButton?.setAttribute("aria-expanded", String(state !== "context"));
    templateButton?.setAttribute("aria-label", state === "template" ? "Expand Velocity Template" : "Collapse Velocity Template");
    contextButton?.setAttribute("aria-label", state === "context" ? "Expand Context Data" : "Collapse Context Data");
    if (persist) this.persist(this._paneStateStorageKey, JSON.stringify(state));
    requestAnimationFrame(() => {
      this.editor?.layout?.();
      this.contextEditor?.layout?.();
    });
  }

  initializeSqlImport() {
    const button = document.getElementById("btnImportVelocitySql");
    if (button) button.hidden = !isTauri();
  }

  loadOracleConnections() {
    try {
      const connections = JSON.parse(localStorage.getItem("config.oracle.connections") || "[]");
      return Array.isArray(connections) ? connections.filter((item) => item?.name && item?.connect_string) : [];
    } catch (_) {
      return [];
    }
  }

  openSqlImport() {
    const connections = this.loadOracleConnections();
    if (!connections.length) {
      this.showError("No Oracle connections configured. Add one in Settings first.");
      return;
    }
    this._sqlImportConnections = connections;
    const select = document.getElementById("velocitySqlConnection");
    select.replaceChildren(
      ...connections.map((connection) => {
        const option = document.createElement("option");
        option.value = connection.name;
        option.textContent = `${connection.name} (${connection.connect_string})`;
        return option;
      }),
    );
    const dialog = document.getElementById("velocitySqlImportDialog");
    document.getElementById("velocitySqlImportError").hidden = true;
    document.getElementById("velocitySqlSelection").hidden = true;
    document.getElementById("btnApplyVelocitySqlImport").disabled = true;
    document.getElementById("velocitySqlImportOverlay").hidden = false;
    dialog.showModal();
    document.getElementById("velocitySqlQuery")?.focus();
  }

  closeSqlImport() {
    document.getElementById("velocitySqlImportDialog")?.close();
    document.getElementById("velocitySqlImportOverlay").hidden = true;
    document.getElementById("btnImportVelocitySql")?.focus();
  }

  showSqlImportError(error) {
    const output = document.getElementById("velocitySqlImportError");
    output.textContent = error?.message || String(error);
    output.hidden = false;
  }

  updateSqlImportPreview() {
    const rowIndex = Number(document.getElementById("velocitySqlRow")?.value || 0);
    const columnIndex = Number(document.getElementById("velocitySqlField")?.value || 0);
    const preview = document.getElementById("velocitySqlPreview");
    const apply = document.getElementById("btnApplyVelocitySqlImport");
    try {
      const value = normalizeImportedTemplateValue(this._sqlImportRows[rowIndex]?.[columnIndex]);
      preview.value = value;
      apply.disabled = false;
    } catch (error) {
      preview.value = "";
      apply.disabled = true;
      this.showSqlImportError(error);
    }
  }

  async fetchSqlImportFields() {
    const fetchButton = document.getElementById("btnFetchVelocitySql");
    const error = document.getElementById("velocitySqlImportError");
    error.hidden = true;
    const connection = this._sqlImportConnections?.find((item) => item.name === document.getElementById("velocitySqlConnection")?.value);
    if (!connection) return this.showSqlImportError("Select an Oracle connection.");
    try {
      const sql = parseTemplateImportQuery(document.getElementById("velocitySqlQuery")?.value);
      fetchButton.disabled = true;
      fetchButton.textContent = "Fetching…";
      const result = await OracleConnectionService.queryViaSidecar(connection.name, connection, sql, 100);
      if (!Array.isArray(result?.columns) || !Array.isArray(result?.rows)) throw new Error("Oracle returned an unexpected result.");
      if (!result.rows.length) throw new Error("The query returned no rows.");
      if (!result.columns.length) throw new Error("The query returned no fields.");
      this._sqlImportColumns = result.columns.map(String);
      this._sqlImportRows = result.rows;
      const rowSelect = document.getElementById("velocitySqlRow");
      const fieldSelect = document.getElementById("velocitySqlField");
      rowSelect.replaceChildren(
        ...result.rows.map((_, index) => {
          const option = document.createElement("option");
          option.value = String(index);
          option.textContent = `Row ${index + 1}`;
          return option;
        }),
      );
      fieldSelect.replaceChildren(
        ...this._sqlImportColumns.map((column, index) => {
          const option = document.createElement("option");
          option.value = String(index);
          option.textContent = column;
          return option;
        }),
      );
      document.getElementById("velocitySqlSelection").hidden = false;
      this.updateSqlImportPreview();
    } catch (fetchError) {
      document.getElementById("velocitySqlSelection").hidden = true;
      document.getElementById("btnApplyVelocitySqlImport").disabled = true;
      this.showSqlImportError(fetchError);
    } finally {
      fetchButton.disabled = false;
      fetchButton.textContent = "Fetch fields";
    }
  }

  applySqlImport() {
    this.editor?.setValue(document.getElementById("velocitySqlPreview")?.value || "");
    this.closeSqlImport();
    this.showSuccess("Velocity template imported from SQL");
  }

  track(action, input, output = input) {
    try {
      const meta = cleanAnalyticsMeta({ ...summarizeText(input, "input"), ...summarizeText(output, "output") });
      UsageTracker.trackEvent("velocity-template", `${action}_action`, meta);
      UsageTracker.trackToolUse("velocity-template", action, meta);
    } catch (_) {
      // Analytics must never interrupt template editing.
    }
  }

  bindEvents() {
    this.editor?.onDidChangeModelContent(() => {
      clearTimeout(this._templateTimer);
      this._templateTimer = setTimeout(() => this.persist(this._templateStorageKey, this.editor?.getValue() || ""), 250);
      this.schedulePreview();
    });
    this.contextEditor?.onDidChangeModelContent(() => {
      clearTimeout(this._contextTimer);
      this._contextTimer = setTimeout(() => this.persist(this._contextStorageKey, this.contextEditor?.getValue() || ""), 250);
      this.schedulePreview();
    });
    document.getElementById("btnCopyVelocity")?.addEventListener("click", async () => {
      if (await this.copyToClipboard(this.editor.getValue())) this.track("copy", this.editor.getValue());
    });
    document
      .getElementById("btnCopyVelocityPreview")
      ?.addEventListener("click", () => this.copyToClipboard(this.previewEditor?.getValue() || ""));
    document.getElementById("btnPasteVelocity")?.addEventListener("click", async () => {
      try {
        const value = await navigator.clipboard.readText();
        if (!value) return this.showError("Clipboard is empty");
        this.editor.setValue(value);
        document.getElementById("velocityMoreActions")?.removeAttribute("open");
        this.showSuccess("Template pasted from clipboard");
      } catch (_) {
        this.showError("Could not read the clipboard. Check browser permission and try again.");
      }
    });
    document.getElementById("btnClearVelocity")?.addEventListener("click", () => {
      this.editor.setValue("");
      document.getElementById("velocityMoreActions")?.removeAttribute("open");
    });
    document.getElementById("btnFormatVelocityContext")?.addEventListener("click", () => {
      try {
        this.contextEditor.setValue(JSON.stringify(this.readContext(), null, 2));
        this.showSuccess("Context JSON formatted");
      } catch (error) {
        this.showError(`Invalid JSON: ${error?.message || "Check the Context Data syntax."}`);
      }
    });
    document.getElementById("btnSyncVelocityContext")?.addEventListener("click", () => {
      try {
        this.syncContext();
        this.showSuccess("Context fields synchronized");
      } catch (_) {
        this.showError("Fix the Context Data JSON, then try Sync fields again.");
      }
    });
    this.container?.querySelectorAll("[data-result-type]").forEach((button) => {
      button.addEventListener("click", () => this.setResultType(button.dataset.resultType));
    });
    document.getElementById("btnCollapseVelocityTemplate")?.addEventListener("click", () => {
      const collapsed = this.container?.querySelector(".vtl-layout")?.classList.contains("is-template-collapsed");
      this.setPaneState(collapsed ? "expanded" : "template");
    });
    document.getElementById("btnCollapseVelocityContext")?.addEventListener("click", () => {
      const collapsed = this.container?.querySelector(".vtl-layout")?.classList.contains("is-context-collapsed");
      this.setPaneState(collapsed ? "expanded" : "context");
    });
    document.getElementById("btnImportVelocitySql")?.addEventListener("click", () => this.openSqlImport());
    document.getElementById("btnFetchVelocitySql")?.addEventListener("click", () => this.fetchSqlImportFields());
    document.getElementById("velocitySqlRow")?.addEventListener("change", () => this.updateSqlImportPreview());
    document.getElementById("velocitySqlField")?.addEventListener("change", () => this.updateSqlImportPreview());
    document.getElementById("btnApplyVelocitySqlImport")?.addEventListener("click", () => this.applySqlImport());
    document.getElementById("btnCloseVelocitySqlImport")?.addEventListener("click", () => this.closeSqlImport());
    document.getElementById("btnCancelVelocitySqlImport")?.addEventListener("click", () => this.closeSqlImport());
    document.getElementById("velocitySqlImportOverlay")?.addEventListener("click", () => this.closeSqlImport());
    document.getElementById("velocitySqlImportDialog")?.addEventListener("close", () => {
      document.getElementById("velocitySqlImportOverlay").hidden = true;
    });
    document.getElementById("btnToggleVelocityWrap")?.addEventListener("click", (event) => {
      const output = document.getElementById("velocityPreview");
      const nowrap = output?.classList.toggle("is-nowrap") || false;
      this.previewEditor?.updateOptions({ wordWrap: nowrap ? "off" : "on" });
      event.currentTarget.setAttribute("aria-pressed", String(!nowrap));
      event.currentTarget.textContent = nowrap ? "No wrap" : "Wrap";
    });
    this.container?.querySelector(".velocity-template-tool")?.addEventListener("click", (event) => {
      [document.getElementById("velocityMoreActions"), document.getElementById("velocityResultTypeMenu")].forEach((menu) => {
        if (menu && !menu.contains(event.target)) menu.removeAttribute("open");
      });
    });
  }

  initializeResizer() {
    const layout = this.container?.querySelector(".vtl-layout");
    const resizer = document.getElementById("velocityResizer");
    if (!layout || !resizer) return;
    let dragging = false;
    const apply = (clientX) => {
      const rect = layout.getBoundingClientRect();
      const total = rect.width - 6;
      const left = Math.max(240, Math.min(clientX - rect.left, total - 240));
      layout.style.gridTemplateColumns = `${left}px 6px ${total - left}px`;
      resizer.setAttribute("aria-valuenow", String(Math.round((left / total) * 100)));
    };
    const move = (event) => {
      if (!dragging) return;
      apply(event.clientX);
      event.preventDefault();
    };
    const up = () => {
      dragging = false;
      document.body.classList.remove("is-resizing");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    const down = (event) => {
      if (window.innerWidth <= 940) return;
      dragging = true;
      document.body.classList.add("is-resizing");
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      event.preventDefault();
    };
    const keydown = (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      const rect = layout.getBoundingClientRect();
      const current = rect.left + ((Number(resizer.getAttribute("aria-valuenow")) || 60) / 100) * (rect.width - 6);
      apply(current + (event.key === "ArrowLeft" ? -24 : 24));
      event.preventDefault();
    };
    resizer.addEventListener("mousedown", down);
    resizer.addEventListener("keydown", keydown);
    this._resizerCleanup = () => {
      resizer.removeEventListener("mousedown", down);
      resizer.removeEventListener("keydown", keydown);
      up();
    };
  }

  cleanupResizer() {
    this._resizerCleanup?.();
    this._resizerCleanup = null;
  }
}

export { VelocityTemplateTool };
