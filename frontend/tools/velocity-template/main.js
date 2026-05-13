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
    this.templateEditor = null;
    this.payloadEditor = null;
    this.resultEditor = null;
  }

  onWarmResume() {
    try {
      this.templateEditor?.layout?.();
      this.payloadEditor?.layout?.();
      this.resultEditor?.layout?.();
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
            [/"([^"\\]|\\.)*"/, "string"],
            [/'([^'\\]|\\.)*'/, "string"],
            [/#(if|elseif|else|end|set|foreach|macro|parse|include|define|stop|break|evaluate)\b/, "keyword"],
            [/\$!?\{[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*(?:\([^)]*\))?)*\}/, "variable"],
            [/\$!?[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*(?:\([^)]*\))?)*/, "variable"],
            [/\.[A-Za-z_][\w]*(?=\()/, "predefined"],
            [/[{}()[\]]/, "delimiter.bracket"],
            [/[=><!?:+\-*/%&|]+/, "operator"],
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
          { token: "string", foreground: "c3e88d" },
          { token: "number", foreground: "f78c6c" },
          { token: "comment", foreground: "697098" },
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
    document.getElementById("btnVelocityPasteTemplate")?.addEventListener("click", () => this.pasteIntoEditor(this.templateEditor));
    document.getElementById("btnVelocityClearTemplate")?.addEventListener("click", () => this.templateEditor.setValue(""));
    document.getElementById("btnVelocityCopyPayload")?.addEventListener("click", () => this.copyToClipboard(this.payloadEditor.getValue()));
    document.getElementById("btnVelocityPastePayload")?.addEventListener("click", () => this.pasteIntoEditor(this.payloadEditor));
    document.getElementById("btnVelocityClearPayload")?.addEventListener("click", () => this.payloadEditor.setValue(""));
    document.getElementById("btnVelocityCopyResult")?.addEventListener("click", () => this.copyToClipboard(this.lastResultRaw || this.resultEditor.getValue()));
    document.getElementById("btnVelocityShowRendered")?.addEventListener("click", () => this.showHtmlRendered());
    document.getElementById("btnVelocityShowSource")?.addEventListener("click", () => this.showHtmlSource());
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
        this.renderResult(error.renderedOutput);
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
