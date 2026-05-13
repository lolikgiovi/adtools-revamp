import { BaseTool } from "../../core/BaseTool.js";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import { UsageTracker } from "../../core/UsageTracker.js";
import { cleanAnalyticsMeta, summarizeText } from "../../core/AnalyticsMeta.js";
import { getIconSvg } from "./icon.js";
import { VelocityTemplateToolTemplate } from "./template.js";
import { LIVIN_FN_COMPLETIONS, VTL_SNIPPET_COMPLETIONS } from "./functionCatalog.js";
import {
  DEFAULT_PAYLOAD,
  DEFAULT_TEMPLATE,
  DEFAULT_VELOCITY_ENDPOINT,
  classifyResult,
  getVelocitySettings,
  formatVelocityParseError,
  parseHeaderSettings,
  parseJsonObject,
  requestVelocityTemplate,
  validateVelocitySyntax,
} from "./service.js";
import "./styles.css";

const VELOCITY_LANGUAGE_ID = "velocity-template";
const VELOCITY_TEMPLATE_KEY = "tool:velocity-template:template";
const VELOCITY_PAYLOAD_KEY = "tool:velocity-template:payload";
const VELOCITY_LAYOUT_KEY = "tool:velocity-template:layout";
const VELOCITY_PAYLOAD_COLLAPSED_KEY = "tool:velocity-template:payload-collapsed";
let velocityLanguageRegistered = false;
let velocityCompletionRegistered = false;

class VelocityTemplateTool extends BaseTool {
  constructor(eventBus) {
    super({
      id: "velocity-template",
      name: "Velocity Template",
      description: "Create, validate, and parse Apache Velocity templates",
      icon: "velocity-template",
      category: "config",
      eventBus,
      isHeavyTool: true,
    });
    this.templateEditor = null;
    this.payloadEditor = null;
    this.resultEditor = null;
    this.lastResultRaw = "";
    this._persistTimer = null;
    this._resizeCleanup = null;
  }

  getIconSvg() {
    return getIconSvg();
  }

  render() {
    return VelocityTemplateToolTemplate;
  }

  async onMount() {
    this.registerVelocityLanguage();
    this.initializeEditors();
    this.bindEvents();
    this.restoreLayoutState();
    this.initializePaneResizing();
    this.refreshEndpointLabel();
    this.showStatus("Ready. Configure endpoint and headers in Settings.", "info");
    try {
      UsageTracker.trackFeature("velocity-template", "mount", "", 5000);
    } catch (_) {}
  }

  onUnmount() {
    this.templateEditor?.dispose?.();
    this.payloadEditor?.dispose?.();
    this.resultEditor?.dispose?.();
    this._resizeCleanup?.();
    this.templateEditor = null;
    this.payloadEditor = null;
    this.resultEditor = null;
    this._resizeCleanup = null;
  }

  onWarmResume() {
    try {
      this.templateEditor?.layout?.();
      this.payloadEditor?.layout?.();
      this.resultEditor?.layout?.();
      this.layoutEditors();
      this.refreshEndpointLabel();
    } catch (_) {}
  }

  trackAnalytics(event, meta = {}) {
    try {
      UsageTracker.trackEvent("velocity-template", event, cleanAnalyticsMeta(meta));
    } catch (_) {}
  }

  configureWorkers() {
    self.MonacoEnvironment = {
      getWorker(_, label) {
        if (label === "json") return new jsonWorker();
        if (label === "html") return new htmlWorker();
        return new editorWorker();
      },
    };
  }

  registerVelocityLanguage() {
    this.configureWorkers();
    if (!velocityLanguageRegistered && !monaco.languages.getLanguages().some((language) => language.id === VELOCITY_LANGUAGE_ID)) {
      monaco.languages.register({ id: VELOCITY_LANGUAGE_ID, aliases: ["Velocity", "VTL", "Apache Velocity"] });
      monaco.languages.setLanguageConfiguration(VELOCITY_LANGUAGE_ID, {
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
      monaco.languages.setMonarchTokensProvider(VELOCITY_LANGUAGE_ID, {
        defaultToken: "",
        tokenPostfix: ".vtl",
        keywords: ["if", "elseif", "else", "end", "set", "foreach", "macro", "parse", "include", "define", "stop", "break", "evaluate"],
        tokenizer: {
          root: [
            [/##.*$/, "comment"],
            [/#\*/, "comment", "@comment"],
            [/"(?:[^"\\]|\\.)*"(?=\s*:)/, "json-key"],
            [/"([^"\\]|\\.)*"/, "string"],
            [/'([^'\\]|\\.)*'/, "string"],
            [/#(if|elseif|else|end|set|foreach|macro|parse|include|define|stop|break|evaluate)\b/, "keyword"],
            [/\$!?\{[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*(?:\([^)]*\))?)*\}/, "variable"],
            [/\$!?[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*(?:\([^)]*\))?)*/, "variable"],
            [/\.[A-Za-z_][\w]*(?=\()/, "predefined"],
            [/[,:]/, "delimiter"],
            [/[{}()[\]]/, "delimiter.bracket"],
            [/[=><!?:+\-*/%&|]+/, "operator"],
            [/\b(?:true|false|null)\b/, "constant"],
            [/\b\d+(?:\.\d+)?\b/, "number"],
          ],
          comment: [
            [/[^*#]+/, "comment"],
            [/\*#/, "comment", "@pop"],
            [/[*#]/, "comment"],
          ],
        },
      });
      monaco.editor.defineTheme("velocity-template-dark", {
        base: "vs-dark",
        inherit: true,
        rules: [
          { token: "keyword", foreground: "93c5ff" },
          { token: "variable", foreground: "ffcb6b" },
          { token: "predefined", foreground: "c792ea" },
          { token: "json-key", foreground: "9cdcfe" },
          { token: "string", foreground: "ce9178" },
          { token: "number", foreground: "b5cea8" },
          { token: "constant", foreground: "569cd6" },
          { token: "delimiter", foreground: "d4d4d4" },
          { token: "delimiter.bracket", foreground: "ffd700" },
          { token: "comment", foreground: "6a9955" },
        ],
        colors: {
          "editor.background": "#1e1e1e",
        },
      });
      velocityLanguageRegistered = true;
    }

    if (!velocityCompletionRegistered) {
      monaco.languages.registerCompletionItemProvider(VELOCITY_LANGUAGE_ID, {
        triggerCharacters: ["$", "#", "."],
        provideCompletionItems: () => {
          const settings = getVelocitySettings();
          const customCompletions = settings.customFunctions.map((name) => ({
            label: name.startsWith("$") ? name : `$fn.${name}`,
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: name.startsWith("$") ? name : `$fn.${name}`,
            detail: "Custom Velocity function",
            documentation: "Configured in Settings.",
          }));
          const suggestions = [...VTL_SNIPPET_COMPLETIONS, ...LIVIN_FN_COMPLETIONS].map((item) => ({
            label: item.label,
            kind: item.label.startsWith("#") ? monaco.languages.CompletionItemKind.Keyword : monaco.languages.CompletionItemKind.Function,
            insertText: item.insertText,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            detail: item.detail,
            documentation: item.documentation,
          }));
          return { suggestions: [...suggestions, ...customCompletions] };
        },
      });
      velocityCompletionRegistered = true;
    }
  }

  initializeEditors() {
    const templateValue = this.loadSaved(VELOCITY_TEMPLATE_KEY, DEFAULT_TEMPLATE);
    const payloadValue = this.loadSaved(VELOCITY_PAYLOAD_KEY, DEFAULT_PAYLOAD);

    this.templateEditor = monaco.editor.create(document.getElementById("velocityTemplateEditor"), {
      value: templateValue,
      language: VELOCITY_LANGUAGE_ID,
      theme: "velocity-template-dark",
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: "on",
      tabSize: 2,
      insertSpaces: true,
      fontSize: 12,
    });

    this.payloadEditor = monaco.editor.create(document.getElementById("velocityPayloadEditor"), {
      value: payloadValue,
      language: "json",
      theme: "vs-dark",
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: "on",
      formatOnPaste: true,
      formatOnType: true,
      tabSize: 2,
      insertSpaces: true,
      fontSize: 12,
    });

    this.resultEditor = monaco.editor.create(document.getElementById("velocityResultEditor"), {
      value: "",
      language: "plaintext",
      theme: "vs-dark",
      automaticLayout: true,
      minimap: { enabled: false },
      readOnly: true,
      scrollBeyondLastLine: false,
      wordWrap: "on",
      tabSize: 2,
      insertSpaces: true,
      fontSize: 12,
    });

    this.templateEditor.onDidChangeModelContent(() => this.persistEditors());
    this.payloadEditor.onDidChangeModelContent(() => this.persistEditors());
  }

  bindEvents() {
    document.getElementById("btnVelocityParse")?.addEventListener("click", () => this.handleParse());
    document.getElementById("btnVelocityCheck")?.addEventListener("click", () => this.handleCheckSyntax());
    document.getElementById("btnVelocityFormatPayload")?.addEventListener("click", () => this.handleFormatPayload());
    document.getElementById("btnVelocityCopyTemplate")?.addEventListener("click", () => this.copyToClipboard(this.templateEditor.getValue()));
    document.getElementById("btnVelocityClearTemplate")?.addEventListener("click", () => this.templateEditor.setValue(""));
    document.getElementById("btnVelocityCopyPayload")?.addEventListener("click", () => this.copyToClipboard(this.payloadEditor.getValue()));
    document.getElementById("btnVelocityClearPayload")?.addEventListener("click", () => this.payloadEditor.setValue(""));
    document.getElementById("btnVelocityTogglePayload")?.addEventListener("click", () => this.togglePayloadPane(true));
    document.getElementById("velocityPayloadCollapsedTab")?.addEventListener("click", () => this.togglePayloadPane(false));
    document.getElementById("btnVelocityCopyResult")?.addEventListener("click", () => this.copyToClipboard(this.lastResultRaw || this.resultEditor.getValue()));
    document.getElementById("btnVelocityValidateResultJson")?.addEventListener("click", () => this.handleValidateResultJson());
    document.getElementById("btnVelocityShowRendered")?.addEventListener("click", () => this.showHtmlRendered());
    document.getElementById("btnVelocityShowSource")?.addEventListener("click", () => this.showHtmlSource());
  }

  restoreLayoutState() {
    try {
      const layout = document.getElementById("velocityTemplateLayout");
      if (!layout) return;
      const savedLayout = JSON.parse(localStorage.getItem(VELOCITY_LAYOUT_KEY) || "{}");
      const savedWidths = this.constrainPaneWidths({
        payload: Number(savedLayout.payload) || 320,
        template: Number(savedLayout.template) || 420,
        result: Number(savedLayout.result) || 420,
      });
      this.applyPaneWidths(savedWidths);
      this.setPayloadCollapsed(localStorage.getItem(VELOCITY_PAYLOAD_COLLAPSED_KEY) === "true");
    } catch (_) {}
  }

  initializePaneResizing() {
    const layout = document.getElementById("velocityTemplateLayout");
    if (!layout) return;

    const onPointerDown = (event) => {
      const handle = event.target.closest("[data-resize-handle]");
      if (!handle || layout.classList.contains("payload-collapsed") || window.matchMedia("(max-width: 1180px)").matches) return;

      event.preventDefault();
      handle.classList.add("is-dragging");
      const startX = event.clientX;
      const startWidths = this.getPaneWidths();
      const handleType = handle.dataset.resizeHandle;

      const onPointerMove = (moveEvent) => {
        const delta = moveEvent.clientX - startX;
        const next = { ...startWidths };
        if (handleType === "payload") {
          next.payload = startWidths.payload + delta;
          next.template = startWidths.template - delta;
        } else {
          next.template = startWidths.template + delta;
          next.result = startWidths.result - delta;
        }
        this.applyPaneWidths(this.constrainPaneWidths(next));
      };

      const onPointerUp = () => {
        handle.classList.remove("is-dragging");
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
        this.persistPaneWidths();
      };

      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp, { once: true });
    };

    layout.addEventListener("pointerdown", onPointerDown);
    this._resizeCleanup = () => layout.removeEventListener("pointerdown", onPointerDown);
  }

  getPaneWidths() {
    return {
      payload: document.querySelector(".velocity-payload-pane")?.getBoundingClientRect?.().width || 320,
      template: document.querySelector(".velocity-template-pane")?.getBoundingClientRect?.().width || 420,
      result: document.querySelector(".velocity-result-pane")?.getBoundingClientRect?.().width || 420,
    };
  }

  constrainPaneWidths(widths) {
    const min = { payload: 220, template: 280, result: 300 };
    const layout = document.getElementById("velocityTemplateLayout");
    const available = Math.max(900, (layout?.getBoundingClientRect?.().width || 1260) - 12);
    const rawTotal = widths.payload + widths.template + widths.result;
    const scale = rawTotal > available ? available / rawTotal : 1;
    const next = {
      payload: Math.max(min.payload, widths.payload * scale),
      template: Math.max(min.template, widths.template * scale),
      result: Math.max(min.result, widths.result * scale),
    };
    const overflow = next.payload + next.template + next.result - available;
    if (overflow > 0) {
      const largest = Object.entries(next).sort((a, b) => b[1] - a[1])[0][0];
      next[largest] = Math.max(min[largest], next[largest] - overflow);
    }
    return next;
  }

  applyPaneWidths(widths) {
    const layout = document.getElementById("velocityTemplateLayout");
    if (!layout) return;
    layout.style.setProperty("--velocity-payload-width", `${Math.round(widths.payload)}px`);
    layout.style.setProperty("--velocity-template-width", `${Math.round(widths.template)}px`);
    layout.style.setProperty("--velocity-result-width", `${Math.round(widths.result)}px`);
    this.layoutEditors();
  }

  persistPaneWidths() {
    try {
      localStorage.setItem(VELOCITY_LAYOUT_KEY, JSON.stringify(this.getPaneWidths()));
    } catch (_) {}
  }

  togglePayloadPane(collapsed) {
    this.setPayloadCollapsed(collapsed);
    try {
      localStorage.setItem(VELOCITY_PAYLOAD_COLLAPSED_KEY, collapsed ? "true" : "false");
    } catch (_) {}
  }

  setPayloadCollapsed(collapsed) {
    const layout = document.getElementById("velocityTemplateLayout");
    const toggle = document.getElementById("btnVelocityTogglePayload");
    const tab = document.getElementById("velocityPayloadCollapsedTab");
    if (!layout) return;
    layout.classList.toggle("payload-collapsed", collapsed);
    if (toggle) {
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      toggle.title = collapsed ? "Expand payload pane" : "Collapse payload pane";
      toggle.setAttribute("aria-label", collapsed ? "Expand payload pane" : "Collapse payload pane");
    }
    if (tab) tab.style.display = collapsed ? "" : "none";
    this.layoutEditors();
  }

  layoutEditors() {
    requestAnimationFrame(() => {
      this.templateEditor?.layout?.();
      this.payloadEditor?.layout?.();
      this.resultEditor?.layout?.();
    });
  }

  async handleParse() {
    this.clearMarkers();
    this.refreshEndpointLabel();

    const template = this.templateEditor.getValue();
    const syntax = validateVelocitySyntax(template);
    if (!syntax.valid) {
      this.markEditor(this.templateEditor, "velocity-template", syntax.error || "Invalid Velocity syntax", syntax.position);
      this.showStatus(`Velocity syntax error: ${syntax.error}`, "error");
      this.trackAnalytics("parse_blocked", { reason: "syntax_error", ...summarizeText(template, "template") });
      return;
    }

    const payloadResult = parseJsonObject(this.payloadEditor.getValue(), "Payload");
    if (payloadResult.error) {
      this.markEditor(this.payloadEditor, "velocity-payload", payloadResult.error, payloadResult.position);
      this.showStatus(payloadResult.error, "error");
      this.trackAnalytics("parse_blocked", { reason: "payload_error" });
      return;
    }

    const settings = getVelocitySettings();
    const headerResult = parseHeaderSettings(settings.headersRaw);
    if (headerResult.error) {
      this.showStatus(headerResult.error, "error");
      this.trackAnalytics("parse_blocked", { reason: "headers_error" });
      return;
    }

    const parseBtn = document.getElementById("btnVelocityParse");
    if (parseBtn) parseBtn.disabled = true;
    this.showStatus("Parsing template...", "info");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const rendered = await requestVelocityTemplate({
        endpoint: settings.endpoint || DEFAULT_VELOCITY_ENDPOINT,
        headers: headerResult.headers,
        template,
        payload: payloadResult.value,
        signal: controller.signal,
      });
      this.renderResult(rendered);
      this.showSuccess("Template parsed successfully");
      this.trackAnalytics("parse_success", {
        ...summarizeText(template, "template"),
        ...summarizeText(rendered, "result"),
      });
    } catch (error) {
      if (error?.renderedOutput) {
        const renderedOutput = error.renderedOutputTruncated
          ? `${error.renderedOutput}\n\n/* Output truncated by endpoint error response; full rendered template was not returned. */`
          : error.renderedOutput;
        this.renderResult(renderedOutput);
      }
      const message = formatVelocityParseError(error);
      this.showStatus(message, "error");
      this.trackAnalytics("parse_error", { message: String(error?.message || error).slice(0, 180) });
    } finally {
      clearTimeout(timer);
      if (parseBtn) parseBtn.disabled = false;
    }
  }

  handleCheckSyntax() {
    this.clearMarkers();
    const result = validateVelocitySyntax(this.templateEditor.getValue());
    if (result.valid) {
      this.showStatus("Velocity syntax looks valid.", "success");
      this.showSuccess("Velocity syntax looks valid");
      this.trackAnalytics("syntax_check_success");
      return;
    }
    this.markEditor(this.templateEditor, "velocity-template", result.error || "Invalid Velocity syntax", result.position);
    this.showStatus(`Velocity syntax error: ${result.error}`, "error");
    this.trackAnalytics("syntax_check_error");
  }

  async handleFormatPayload() {
    const result = parseJsonObject(this.payloadEditor.getValue(), "Payload");
    if (result.error) {
      this.markEditor(this.payloadEditor, "velocity-payload", result.error, result.position);
      this.showStatus(result.error, "error");
      return;
    }
    this.payloadEditor.setValue(JSON.stringify(result.value, null, 2));
    try {
      await this.payloadEditor.getAction("editor.action.formatDocument")?.run?.();
    } catch (_) {}
    this.showStatus("Payload formatted.", "success");
  }

  handleValidateResultJson() {
    this.clearMarkers();
    const result = classifyResult(this.resultEditor.getValue());
    if (result.type !== "json") {
      this.showStatus("Result is not JSON-shaped.", "error");
      return;
    }
    if (result.valid) {
      this.resultEditor.setValue(result.display);
      this.showStatus("Result is valid JSON.", "success");
      return;
    }
    this.markEditor(this.resultEditor, "velocity-result", `Result JSON syntax error: ${result.error}`, result.position);
    this.showStatus(`Result JSON syntax error: ${result.error}`, "error");
  }

  renderResult(raw) {
    const result = classifyResult(raw);
    this.lastResultRaw = raw;
    const badge = document.getElementById("velocityResultBadge");
    if (badge) {
      badge.textContent = result.type.toUpperCase();
      badge.dataset.type = result.type;
    }

    document.querySelectorAll(".velocity-html-only").forEach((el) => {
      el.style.display = result.type === "html" ? "" : "none";
    });

    const model = this.resultEditor.getModel();
    if (result.type === "json") {
      monaco.editor.setModelLanguage(model, "json");
      this.resultEditor.setValue(result.display);
      this.showResultSource();
      if (result.valid) {
        this.showStatus("Parsed result is valid JSON.", "success");
      } else {
        this.markEditor(this.resultEditor, "velocity-result", `Result JSON syntax error: ${result.error}`, result.position);
        this.showStatus(`Result looks like JSON but has a syntax error: ${result.error}`, "error");
      }
      return;
    }

    if (result.type === "html") {
      monaco.editor.setModelLanguage(model, "html");
      this.resultEditor.setValue(result.display);
      const preview = document.getElementById("velocityHtmlPreview");
      if (preview) preview.srcdoc = result.raw;
      this.showHtmlRendered();
      this.showStatus("Parsed result rendered as HTML.", "success");
      return;
    }

    monaco.editor.setModelLanguage(model, "plaintext");
    this.resultEditor.setValue(result.display);
    this.showResultSource();
    this.showStatus("Parsed result shown as plain text.", "success");
  }

  showHtmlRendered() {
    document.getElementById("velocityResultEditor").style.display = "none";
    document.getElementById("velocityHtmlPreview").style.display = "block";
  }

  showHtmlSource() {
    this.showResultSource();
  }

  showResultSource() {
    document.getElementById("velocityHtmlPreview").style.display = "none";
    document.getElementById("velocityResultEditor").style.display = "block";
    this.resultEditor?.layout?.();
  }

  markEditor(editor, owner, message, position = null) {
    try {
      const model = editor?.getModel?.();
      if (!model) return;
      let line = 1;
      let column = 1;
      if (typeof position === "number" && position >= 0) {
        const location = model.getPositionAt(position);
        line = location.lineNumber;
        column = location.column;
      }
      monaco.editor.setModelMarkers(model, owner, [
        {
          severity: monaco.MarkerSeverity.Error,
          message,
          startLineNumber: line,
          startColumn: column,
          endLineNumber: line,
          endColumn: column + 1,
        },
      ]);
    } catch (_) {}
  }

  clearMarkers() {
    try {
      const templateModel = this.templateEditor?.getModel?.();
      const payloadModel = this.payloadEditor?.getModel?.();
      const resultModel = this.resultEditor?.getModel?.();
      if (templateModel) monaco.editor.setModelMarkers(templateModel, "velocity-template", []);
      if (payloadModel) monaco.editor.setModelMarkers(payloadModel, "velocity-payload", []);
      if (resultModel) monaco.editor.setModelMarkers(resultModel, "velocity-result", []);
    } catch (_) {}
  }

  showStatus(message, state = "info") {
    const status = document.getElementById("velocityStatus");
    if (!status) return;
    status.textContent = message || "";
    status.dataset.state = state;
  }

  refreshEndpointLabel() {
    const label = document.getElementById("velocityEndpointLabel");
    if (!label) return;
    const settings = getVelocitySettings();
    label.textContent = settings.endpoint || DEFAULT_VELOCITY_ENDPOINT;
  }

  persistEditors() {
    clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => {
      try {
        localStorage.setItem(VELOCITY_TEMPLATE_KEY, this.templateEditor?.getValue?.() || "");
        localStorage.setItem(VELOCITY_PAYLOAD_KEY, this.payloadEditor?.getValue?.() || "");
      } catch (_) {}
    }, 250);
  }

  loadSaved(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (_) {
      return fallback;
    }
  }

  async pasteIntoEditor(editor) {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      const model = editor.getModel();
      if (model) {
        editor.executeEdits("paste", [{ range: model.getFullModelRange(), text }]);
      } else {
        editor.setValue(text);
      }
    } catch (_) {
      this.showError("Failed to paste from clipboard");
    }
  }
}

export { VelocityTemplateTool };
