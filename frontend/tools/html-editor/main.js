import { BaseTool } from "../../core/BaseTool.js";
import * as monaco from "monaco-editor/esm/vs/editor/editor.main.js";
import "monaco-editor/esm/vs/basic-languages/html/html.contribution.js";
import "monaco-editor/esm/vs/language/html/monaco.contribution.js";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import { configureMonacoWorkers } from "../../core/MonacoWorkers.js";
import { HTMLTemplateToolTemplate } from "./template.js";
import { HtmlDocumentStore } from "./documentStore.js";
import { analyzeHtmlEncoding, convertHtmlForToad, decodeHtmlBytes, listEncodingCharacters, markEncodingPreview, simulateWindows1252Import } from "./encoding.js";
import MinifyWorker from "./minify.worker.js?worker";
import { buildVtlValuesExport, deleteVtlValue, extractVtlVariables, getPreviewContent, getVtlValue, setVtlValue } from "./service.js";
import { getIconSvg } from "./icon.js";
import { UsageTracker } from "../../core/UsageTracker.js";
import { bucketSize, cleanAnalyticsMeta, summarizeText } from "../../core/AnalyticsMeta.js";
import { isTauri } from "../../core/Runtime.js";
import "./styles.css";

const PREVIEW_VIEWPORT_MIN_WIDTH = 240;
const PREVIEW_VIEWPORT_MAX_WIDTH = 1440;
const VTL_DIRECTIVES = [
  ["#if", "#if(${1:condition})\n$0\n#end"],
  ["#elseif", "#elseif(${1:condition})"],
  ["#else", "#else"],
  ["#end", "#end"],
  ["#set", "#set($${1:name} = ${2:value})"],
  ["#foreach", "#foreach($${1:item} in $${2:items})\n$0\n#end"],
];

function vtlValuePaths(value, prefix = "", depth = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 4) return [];
  return Object.entries(value).flatMap(([key, nested]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return [];
    const path = prefix ? `${prefix}.${key}` : key;
    return [path, ...vtlValuePaths(nested, path, depth + 1)];
  });
}
const DEFAULT_HTML = `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>Preview</title>\n  <style>\n    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 1rem; }\n    h1 { color: #333; }\n  </style>\n</head>\n<body>\n  <h1>Hello, \${username}!</h1>\n  <script>\n    console.log('Inline script running');\n  </script>\n</body>\n</html>`;
// Representative CSS viewport widths; hardware pixel resolution is a separate device property.
const PREVIEW_VIEWPORT_PRESETS = [
  { value: "responsive", label: "Fit · Responsive", width: null },
  { value: "iphone-se", label: "iPhone SE (1st) · 320px", width: 320 },
  { value: "android-compact", label: "Android compact · 360px", width: 360 },
  { value: "iphone-standard", label: "iPhone 7/8/X/SE · 375px", width: 375 },
  { value: "iphone-modern", label: "iPhone 12–16 · 390px", width: 390 },
  { value: "android-standard", label: "Pixel / Android · 393px", width: 393 },
  { value: "iphone-latest", label: "Modern iPhone · 402px", width: 402 },
  { value: "android-large", label: "Android large · 412px", width: 412 },
  { value: "iphone-plus", label: "iPhone Plus · 414px", width: 414 },
  { value: "iphone-large", label: "iPhone Plus / Max · 430px", width: 430 },
  { value: "custom", label: "Custom width…", width: null },
];

class HTMLTemplateTool extends BaseTool {
  constructor(eventBus) {
    super({ id: "html-template", eventBus, isHeavyTool: true });

    this.editor = null;
    this._velocityCompletionProvider = null;
    this.minifyWorker = null;
    this.minifierAvailable = false;
    this.lastRenderedHTML = "";
    this.sandboxSameOriginAllowed = false; // default disabled for safer preview
    // VTL values state and storage key
    this.vtlValues = {};
    this._vtlValuesStorageKey = "tool:html-template:vtl-values";
    this.baseUrls = [];
    this._envStorageKey = "tool:html-template:env";
    this._previewBackgroundStorageKey = "tool:html-template:preview-background";
    this.previewWhiteBackground = false;
    this._previewVtlModeStorageKey = "tool:html-template:preview-vtl-mode";
    this.previewVtlMode = "rendered";
    this._previewViewportStorageKey = "tool:html-template:preview-viewport";
    this.previewViewportMode = "responsive";
    this.previewViewportWidth = 390;
    this._splitStorageKey = "tool:html-template:split-ratio";
    this._resizerCleanup = null;
    this.analyticsSessionId = this.createAnalyticsId();
    this.inputSource = "default";
    this.programmaticEditorChange = false;
    this.lastHtmlOperation = null;
    this.vtlAnalyticsTimer = null;
    this.documentStore = null;
    this.documents = [];
    this.activeDocumentId = null;
    this._documentWriteQueue = Promise.resolve();
    this._tabTransition = false;
    this._closedDocuments = null;
    this._undoTimer = null;
    this._tabMenu = null;
    this._tabMenuTrigger = null;
    this._handleTabMenuPointerDown = (event) => {
      if (!this._tabMenu?.contains(event.target)) this.closeDocumentMenu();
    };
    this._handleTabMenuKeyDown = (event) => {
      if (event.key === "Escape" && this._tabMenu) {
        event.preventDefault();
        this.closeDocumentMenu(true);
      }
    };
    this._mountSequence = 0;
    this._pendingFormat = null;
    this._encodingDecorations = null;
    this._encodingDiffEditor = null;
    this._encodingDiffModels = [];
    this._encodingReviewSource = null;
    this._encodingReviewSafe = null;
    this._encodingReviewDocumentId = null;
    this.previewEncodingMode = "original";
    this._encodingPreviewFinding = null;
    this._handlePageHide = () => void this.flushActiveDocument().catch(() => {});
    this._handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") void this.flushActiveDocument().catch(() => {});
    };
  }

  getIconSvg() {
    return getIconSvg();
  }

  render() {
    return HTMLTemplateToolTemplate;
  }

  trackAnalytics(event, meta = {}) {
    try {
      const cleanMeta = cleanAnalyticsMeta(meta);
      UsageTracker.trackEvent("html-template", event, cleanMeta);
      const usageActions = { format_action: "format", minify_action: "minify", copy_html: "copy", vtl_extract: "vtl_extract" };
      if (usageActions[event]) UsageTracker.trackToolUse("html-template", usageActions[event], cleanMeta);
    } catch (_) {}
  }

  createAnalyticsId() {
    const now = Date.now();
    return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${now}-${Math.random().toString(36).slice(2)}`;
  }

  getVtlAnalyticsMeta(html = this.editor?.getValue?.() || "") {
    try {
      const variables = extractVtlVariables(html).filter((variable) => variable !== "baseUrl");
      const resolved = variables.filter((variable) => {
        const value = getVtlValue(this.vtlValues, variable);
        return value !== undefined && value !== null && String(value).length > 0;
      }).length;
      return {
        variable_count: variables.length,
        variables_resolved: resolved,
        variables_unresolved: Math.max(0, variables.length - resolved),
        vtl_completion_pct: variables.length ? Math.round((100 * resolved) / variables.length) : 100,
        has_environment: Boolean(document.getElementById("envSelector")?.value),
      };
    } catch (_) {
      return { variable_count: 0, variables_resolved: 0, variables_unresolved: 0, vtl_completion_pct: 0 };
    }
  }

  buildHtmlProcessMeta(input, output, startedAt, attemptId, extra = {}) {
    const inputSize = String(input || "").length;
    const outputSize = String(output || "").length;
    return {
      ...summarizeText(input, "input"),
      ...summarizeText(output, "output"),
      input_size_bucket: bucketSize(inputSize),
      reduction_pct: inputSize > 0 ? Math.round((1000 * (inputSize - outputSize)) / inputSize) / 10 : 0,
      duration_ms: Math.max(0, Date.now() - startedAt),
      attempt_id: attemptId,
      session_id: this.analyticsSessionId,
      input_source: this.inputSource,
      ...this.getVtlAnalyticsMeta(output || input),
      ...extra,
    };
  }

  trackHtmlProcessSuccess(event, operation, input, output, startedAt, attemptId, extra = {}) {
    const meta = this.buildHtmlProcessMeta(input, output, startedAt, attemptId, { operation, ...extra });
    this.trackAnalytics(event, meta);
    this.lastHtmlOperation = meta;
  }

  trackHtmlProcessError(operation, input, startedAt, attemptId, errorType) {
    this.trackAnalytics("process_error", {
      operation,
      error_type: String(errorType || "operation_error").slice(0, 80),
      ...summarizeText(input, "input"),
      input_size_bucket: bucketSize(String(input || "").length),
      duration_ms: Math.max(0, Date.now() - startedAt),
      attempt_id: attemptId,
      session_id: this.analyticsSessionId,
      input_source: this.inputSource,
      ...this.getVtlAnalyticsMeta(input),
    });
  }

  async onMount() {
    const sequence = ++this._mountSequence;
    configureMonacoWorkers(self, { editor: editorWorker, html: htmlWorker });
    await this.initializeDocuments();
    if (sequence !== this._mountSequence || !this.container) {
      this.documents.forEach((document) => document.model?.dispose());
      this.documents = [];
      this.documentStore?.close();
      return;
    }
    await this.initializeMonacoEditor();
    if (sequence !== this._mountSequence || !this.container) return;
    this.registerVelocityCompletions();
    try {
      this.previewWhiteBackground = localStorage.getItem(this._previewBackgroundStorageKey) === "white";
    } catch (_) {}
    this.initializeWorker();
    this.bindDocumentEvents();
    this.bindToolEvents();
    window.addEventListener("pagehide", this._handlePageHide);
    document.addEventListener("visibilitychange", this._handleVisibilityChange);
    // Setup ENV dropdown and baseUrl special handling
    this.setupEnvDropdown();
    this.setupPreviewVtlMode();
    this.setupPreviewViewport();
    this.initializeResizer();
    this.renderPreview(this.editor.getValue());
    try {
      UsageTracker.trackFeature("html-template", "mount", "", 5000);
    } catch (_) {}
  }

  onUnmount() {
    this._mountSequence += 1;
    window.removeEventListener("pagehide", this._handlePageHide);
    document.removeEventListener("visibilitychange", this._handleVisibilityChange);
    this.closeDocumentMenu();
    const finalSave = this.flushActiveDocument().catch(() => {});
    const store = this.documentStore;
    this.cleanupResizer();
    clearTimeout(this._previewTimer);
    clearTimeout(this._undoTimer);
    clearTimeout(this.vtlAnalyticsTimer);
    this.vtlAnalyticsTimer = null;
    this._velocityCompletionProvider?.dispose();
    this._velocityCompletionProvider = null;
    this.clearEncodingReview();
    this._encodingDecorations?.dispose();
    this._encodingDecorations = null;
    if (this.editor) {
      this.editor.dispose();
      this.editor = null;
    }
    this.documents.forEach((document) => document.model?.dispose());
    this.documents = [];
    void Promise.allSettled([finalSave, this._documentWriteQueue]).then(() => store?.close());
    if (this.minifyWorker) {
      this.minifyWorker.terminate();
      this.minifyWorker = null;
    }
  }

  onWarmResume() {
    try {
      this.editor?.layout?.();
      if (!this._resizerCleanup) this.initializeResizer();
    } catch (_) {}
  }

  onSoftDeactivate() {
    this.cleanupResizer();
  }

  get activeDocument() {
    return this.documents.find((document) => document.id === this.activeDocumentId);
  }

  createDocumentModel(document) {
    document.html = typeof document.html === "string" ? document.html : "";
    document.vtlValues = document.vtlValues && typeof document.vtlValues === "object" ? document.vtlValues : {};
    document.model = monaco.editor.createModel(document.html, "html", monaco.Uri.parse(`inmemory://html-template/${document.id}.html`));
    return document;
  }

  documentRecord(document) {
    return {
      id: document.id,
      name: document.name,
      html: document.model?.getValue() ?? document.html,
      vtlValues: structuredClone(document.vtlValues || {}),
      createdAt: document.createdAt,
      updatedAt: Date.now(),
    };
  }

  async initializeDocuments() {
    this.documentStore = new HtmlDocumentStore();
    try {
      await this.documentStore.open();
      const saved = await this.documentStore.load(DEFAULT_HTML, () => this.createAnalyticsId());
      this.documents = saved.documents.map((document) => this.createDocumentModel(document));
      this.activeDocumentId = saved.activeId;
    } catch (error) {
      console.error("Could not open HTML document storage:", error);
      this.documentStore?.close();
      this.documentStore = null;
      let html = DEFAULT_HTML;
      let vtlValues = {};
      try {
        html = localStorage.getItem("tool:html-template:editor") ?? DEFAULT_HTML;
        vtlValues = JSON.parse(localStorage.getItem(this._vtlValuesStorageKey) || "{}") || {};
      } catch (_) {}
      const document = { id: this.createAnalyticsId(), name: "Untitled 1", html, vtlValues, createdAt: Date.now() };
      this.documents = [this.createDocumentModel(document)];
      this.activeDocumentId = document.id;
      this.showError("HTML drafts could not be saved on this device. Check browser storage, then reload.");
    }
    this.vtlValues = this.activeDocument.vtlValues || {};
    this.renderDocumentTabs();
  }

  writeDocumentStore(operation) {
    if (!this.documentStore) return Promise.resolve();
    const task = this._documentWriteQueue.then(operation);
    this._documentWriteQueue = task.catch((error) => {
      console.error("Could not save HTML document:", error);
      this.showError("HTML draft was not saved. Check available storage before closing this page.");
    });
    return task;
  }

  scheduleDocumentSave() {
    clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => void this.flushActiveDocument().catch(() => {}), 300);
  }

  async flushActiveDocument() {
    clearTimeout(this._persistTimer);
    this._persistTimer = null;
    if (this._pendingFormat) await this._pendingFormat.catch(() => {});
    const document = this.activeDocument;
    if (!document) return;
    const record = this.documentRecord(document);
    document.html = record.html;
    document.updatedAt = record.updatedAt;
    await this.writeDocumentStore(() => this.documentStore.saveDocument(record));
  }

  renderDocumentTabs() {
    const strip = this.container?.querySelector("#htmlDocumentTabs");
    if (!strip) return;
    strip.replaceChildren();
    this.documents.forEach((document) => {
      const tab = globalThis.document.createElement("div");
      tab.className = `html-document-tab${document.id === this.activeDocumentId ? " active" : ""}`;
      tab.dataset.documentId = document.id;
      const select = globalThis.document.createElement("button");
      select.type = "button";
      select.className = "html-document-tab-select";
      select.id = `html-document-tab-${document.id}`;
      select.role = "tab";
      select.setAttribute("aria-selected", String(document.id === this.activeDocumentId));
      select.setAttribute("aria-controls", "htmlDocumentPanel");
      select.tabIndex = document.id === this.activeDocumentId ? 0 : -1;
      select.title = `${document.name} · Double-click to rename`;
      select.textContent = document.name;
      const close = globalThis.document.createElement("button");
      close.type = "button";
      close.className = "html-document-tab-close";
      close.setAttribute("aria-label", `Close ${document.name}`);
      close.title = `Close ${document.name}`;
      close.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>';
      close.disabled = this.documents.length === 1;
      tab.append(select, close);
      strip.appendChild(tab);
    });
    const panel = this.container?.querySelector("#htmlDocumentPanel");
    panel?.setAttribute("aria-labelledby", `html-document-tab-${this.activeDocumentId}`);
  }

  bindDocumentEvents() {
    const strip = this.container.querySelector("#htmlDocumentTabs");
    strip.addEventListener("click", (event) => {
      const tab = event.target.closest(".html-document-tab");
      if (!tab) return;
      if (event.target.closest(".html-document-tab-close")) void this.closeDocument(tab.dataset.documentId);
      else if (event.target.closest(".html-document-tab-select")) void this.switchDocument(tab.dataset.documentId, true);
    });
    strip.addEventListener("dblclick", (event) => {
      const select = event.target.closest(".html-document-tab-select");
      if (select) this.renameDocument(select.closest(".html-document-tab").dataset.documentId);
    });
    strip.addEventListener("contextmenu", (event) => {
      const tab = event.target.closest(".html-document-tab");
      if (!tab) return;
      event.preventDefault();
      event.stopPropagation();
      this.openDocumentMenu(tab.dataset.documentId, event.clientX, event.clientY, tab.querySelector(".html-document-tab-select"));
    });
    strip.addEventListener("keydown", (event) => {
      if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
        const tab = event.target.closest(".html-document-tab");
        if (!tab) return;
        event.preventDefault();
        const rect = tab.getBoundingClientRect();
        this.openDocumentMenu(tab.dataset.documentId, rect.left, rect.bottom + 4, tab.querySelector(".html-document-tab-select"));
        return;
      }
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const current = this.documents.findIndex((document) => document.id === this.activeDocumentId);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? this.documents.length - 1
            : (current + (event.key === "ArrowRight" ? 1 : -1) + this.documents.length) % this.documents.length;
      event.preventDefault();
      void this.switchDocument(this.documents[next].id, true);
    });
    this.container.querySelector("#btnNewHtmlDocument").addEventListener("click", () => void this.newDocument());
    this.container.querySelector("#btnUndoCloseHtmlDocument").addEventListener("click", () => void this.undoCloseDocument());
  }

  openDocumentMenu(id, x, y, trigger) {
    const index = this.documents.findIndex((document) => document.id === id);
    if (this._tabTransition || index < 0) return;
    this.closeDocumentMenu();
    const menu = document.createElement("div");
    menu.id = "htmlDocumentTabMenu";
    menu.className = "html-document-tab-menu app-popover-surface";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", `Options for ${this.documents[index].name}`);
    const actions = [
      { label: "Rename", run: () => this.renameDocument(id) },
      { label: "Duplicate", run: () => this.duplicateDocument(id) },
      { separator: true },
      { label: "Close", run: () => this.closeDocument(id), disabled: this.documents.length <= 1 },
      { label: "Close Other Tabs", run: () => this.closeOtherDocuments(id), disabled: this.documents.length <= 1 },
      { label: "Close Tabs to the Left", run: () => this.closeDocumentsToLeft(id), disabled: index === 0 },
      { label: "Close Tabs to the Right", run: () => this.closeDocumentsToRight(id), disabled: index === this.documents.length - 1 },
      { label: "Close All Tabs", run: () => this.closeAllDocuments() },
    ];
    actions.forEach((action) => {
      if (action.separator) {
        const separator = document.createElement("div");
        separator.className = "html-document-tab-menu-separator";
        separator.setAttribute("role", "separator");
        menu.appendChild(separator);
        return;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.textContent = action.label;
      button.disabled = Boolean(action.disabled);
      button.addEventListener("click", () => {
        this.closeDocumentMenu();
        void action.run();
      });
      menu.appendChild(button);
    });
    menu.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const enabled = [...menu.querySelectorAll("button:not(:disabled)")];
      const current = enabled.indexOf(document.activeElement);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? enabled.length - 1
            : (current + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length;
      event.preventDefault();
      enabled[next]?.focus();
    });
    document.body.appendChild(menu);
    const margin = 8;
    menu.style.left = `${Math.min(Math.max(x, margin), Math.max(margin, window.innerWidth - menu.offsetWidth - margin))}px`;
    menu.style.top = `${Math.min(Math.max(y, margin), Math.max(margin, window.innerHeight - menu.offsetHeight - margin))}px`;
    this._tabMenu = menu;
    this._tabMenuTrigger = trigger;
    document.addEventListener("pointerdown", this._handleTabMenuPointerDown);
    document.addEventListener("keydown", this._handleTabMenuKeyDown);
    menu.querySelector("button:not(:disabled)")?.focus();
  }

  closeDocumentMenu(restoreFocus = false) {
    const trigger = this._tabMenuTrigger;
    this._tabMenu?.remove();
    this._tabMenu = null;
    this._tabMenuTrigger = null;
    document.removeEventListener("pointerdown", this._handleTabMenuPointerDown);
    document.removeEventListener("keydown", this._handleTabMenuKeyDown);
    if (restoreFocus && trigger?.isConnected) trigger.focus();
  }

  duplicateDocument(id) {
    const document = this.documents.find((item) => item.id === id);
    if (!document) return;
    return this.newDocument(`${document.name} copy`, document.model.getValue(), structuredClone(document.vtlValues));
  }

  async switchDocument(id, focusTab = false) {
    if (this._tabTransition || id === this.activeDocumentId) return;
    const next = this.documents.find((document) => document.id === id);
    if (!next) return;
    this._tabTransition = true;
    try {
      await this.flushActiveDocument();
      clearTimeout(this._previewTimer);
      clearTimeout(this.vtlAnalyticsTimer);
      this.container.querySelector("#vtlModal").style.display = "none";
      this.activeDocument.viewState = this.editor.saveViewState();
      this.activeDocumentId = id;
      this.vtlValues = next.vtlValues || {};
      const envKey = this.container.querySelector("#envSelector")?.value;
      const url = this.baseUrls.find((pair) => pair.key === envKey)?.value;
      if (url !== undefined) this.vtlValues.baseUrl = url;
      this.editor.setModel(next.model);
      if (next.viewState) this.editor.restoreViewState(next.viewState);
      this.lastRenderedHTML = "";
      this.renderDocumentTabs();
      this.renderPreview(next.model.getValue(), true);
      this.editor.layout();
      await this.writeDocumentStore(() =>
        this.documentStore.saveWorkspace(
          this.documents.map((document) => document.id),
          id,
        ),
      );
      if (focusTab) this.container.querySelector(`#html-document-tab-${id}`)?.focus();
    } catch (_) {
      // Storage errors are shown by writeDocumentStore; the visible tab remains usable.
    } finally {
      this._tabTransition = false;
    }
  }

  async newDocument(name = null, html = "", vtlValues = {}) {
    if (this._tabTransition) return;
    this._tabTransition = true;
    let document = null;
    try {
      await this.flushActiveDocument();
      const numbers = this.documents
        .map((document) => /^Untitled (\d+)$/.exec(document.name)?.[1])
        .filter(Boolean)
        .map(Number);
      const nextNumber = Math.max(0, ...numbers) + 1;
      const now = Date.now();
      document = this.createDocumentModel({
        id: this.createAnalyticsId(),
        name: name || `Untitled ${nextNumber}`,
        html,
        vtlValues,
        createdAt: now,
        updatedAt: now,
      });
      const order = [...this.documents.map((item) => item.id), document.id];
      await this.writeDocumentStore(() =>
        this.documentStore.saveWorkspaceAndDocument(this.documentRecord(document), {
          order,
          activeId: document.id,
        }),
      );
      this.activeDocument.viewState = this.editor.saveViewState();
      this.documents.push(document);
      this.activeDocumentId = document.id;
      this.vtlValues = document.vtlValues;
      const envKey = this.container.querySelector("#envSelector")?.value;
      const url = this.baseUrls.find((pair) => pair.key === envKey)?.value;
      if (url !== undefined) this.vtlValues.baseUrl = url;
      clearTimeout(this._previewTimer);
      this.container.querySelector("#vtlModal").style.display = "none";
      this.editor.setModel(document.model);
      this.lastRenderedHTML = "";
      this.renderDocumentTabs();
      this.renderPreview(html, true);
      this.editor.focus();
      this.editor.layout();
      return document;
    } catch (_) {
      document?.model.dispose();
      return null;
    } finally {
      this._tabTransition = false;
    }
  }

  renameDocument(id) {
    const document = this.documents.find((item) => item.id === id);
    const tab = [...this.container.querySelectorAll(".html-document-tab")].find((item) => item.dataset.documentId === id);
    const select = tab?.querySelector(".html-document-tab-select");
    if (!document || !select) return;
    const input = globalThis.document.createElement("input");
    input.className = "html-document-name";
    input.setAttribute("aria-label", "Document name");
    input.value = document.name;
    select.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const finish = (save) => {
      if (finished) return;
      finished = true;
      const name = input.value.trim().slice(0, 120);
      if (save && name) {
        document.name = name;
        void this.writeDocumentStore(() => this.documentStore.saveDocument(this.documentRecord(document)));
      }
      this.renderDocumentTabs();
      this.container.querySelector(`#html-document-tab-${id}`)?.focus();
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") finish(true);
      if (event.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
  }

  closeDocument(id) {
    if (this.documents.length <= 1) return;
    return this.closeDocuments([id]);
  }

  closeOtherDocuments(id) {
    return this.closeDocuments(
      this.documents.filter((document) => document.id !== id).map((document) => document.id),
      id,
    );
  }

  closeDocumentsToLeft(id) {
    const index = this.documents.findIndex((document) => document.id === id);
    return this.closeDocuments(
      this.documents.slice(0, index).map((document) => document.id),
      id,
    );
  }

  closeDocumentsToRight(id) {
    const index = this.documents.findIndex((document) => document.id === id);
    return this.closeDocuments(
      this.documents.slice(index + 1).map((document) => document.id),
      id,
    );
  }

  closeAllDocuments() {
    return this.closeDocuments(this.documents.map((document) => document.id));
  }

  async closeDocuments(ids, preferredActiveId = null) {
    if (this._tabTransition) return;
    const idsToClose = new Set(ids.filter((id) => this.documents.some((document) => document.id === id)));
    if (!idsToClose.size) return;
    this._tabTransition = true;
    let replacement = null;
    let committed = false;
    try {
      await this.flushActiveDocument();
      const previousActiveId = this.activeDocumentId;
      this.activeDocument.viewState = this.editor.saveViewState();
      const closed = this.documents.flatMap((document, index) =>
        idsToClose.has(document.id) ? [{ record: this.documentRecord(document), index, viewState: document.viewState }] : [],
      );
      const remaining = this.documents.filter((document) => !idsToClose.has(document.id));
      if (!remaining.length) {
        const now = Date.now();
        replacement = this.createDocumentModel({
          id: this.createAnalyticsId(),
          name: "Untitled 1",
          html: "",
          vtlValues: {},
          createdAt: now,
          updatedAt: now,
        });
        remaining.push(replacement);
      }
      const originalIndex = this.documents.findIndex((document) => document.id === previousActiveId);
      const nextId = remaining.some((document) => document.id === preferredActiveId)
        ? preferredActiveId
        : remaining.some((document) => document.id === previousActiveId)
          ? previousActiveId
          : remaining[Math.min(originalIndex, remaining.length - 1)].id;
      await this.writeDocumentStore(() =>
        this.documentStore.updateDocuments({
          deleteIds: [...idsToClose],
          documents: replacement ? [this.documentRecord(replacement)] : [],
          order: remaining.map((document) => document.id),
          activeId: nextId,
        }),
      );
      committed = true;
      const oldDocuments = this.documents;
      this.documents = remaining;
      this.activeDocumentId = nextId;
      if (nextId !== previousActiveId) {
        clearTimeout(this._previewTimer);
        clearTimeout(this.vtlAnalyticsTimer);
        this.container.querySelector("#vtlModal").style.display = "none";
        this.vtlValues = this.activeDocument.vtlValues;
        const envKey = this.container.querySelector("#envSelector")?.value;
        const url = this.baseUrls.find((pair) => pair.key === envKey)?.value;
        if (url !== undefined) this.vtlValues.baseUrl = url;
        this.editor.setModel(this.activeDocument.model);
        if (this.activeDocument.viewState) this.editor.restoreViewState(this.activeDocument.viewState);
        this.lastRenderedHTML = "";
        this.renderPreview(this.editor.getValue(), true);
        this.editor.layout();
      }
      oldDocuments.filter((document) => idsToClose.has(document.id)).forEach((document) => document.model.dispose());
      this._closedDocuments = { closed, previousActiveId, replacementId: replacement?.id || null };
      clearTimeout(this._undoTimer);
      this.container.querySelector("#htmlDocumentUndoMessage").textContent = `${closed.length} tab${closed.length === 1 ? "" : "s"} closed`;
      this.container.querySelector("#htmlDocumentUndo").hidden = false;
      this._undoTimer = setTimeout(() => {
        this._closedDocuments = null;
        this.container?.querySelector("#htmlDocumentUndo")?.setAttribute("hidden", "");
      }, 8000);
      this.renderDocumentTabs();
      this.container.querySelector(`#html-document-tab-${nextId}`)?.focus();
    } catch (_) {
      if (!committed) replacement?.model.dispose();
      // Keep the original tabs visible if the storage transaction fails.
    } finally {
      this._tabTransition = false;
    }
  }

  async undoCloseDocument() {
    if (this._tabTransition || !this._closedDocuments) return;
    this._tabTransition = true;
    const restored = [];
    let committed = false;
    try {
      await this.flushActiveDocument();
      const { closed, previousActiveId, replacementId } = this._closedDocuments;
      const replacement = this.documents.find((document) => document.id === replacementId);
      const dropReplacement =
        replacement &&
        replacement.name === "Untitled 1" &&
        replacement.model.getValue() === "" &&
        Object.keys(replacement.vtlValues).every((key) => key === "baseUrl");
      const order = this.documents.filter((document) => !dropReplacement || document.id !== replacementId);
      closed.forEach(({ record, index, viewState }) => {
        const document = this.createDocumentModel({ ...record });
        document.viewState = viewState;
        restored.push(document);
        order.splice(Math.min(index, order.length), 0, document);
      });
      const nextId = order.some((document) => document.id === previousActiveId) ? previousActiveId : this.activeDocumentId;
      await this.writeDocumentStore(() =>
        this.documentStore.updateDocuments({
          deleteIds: dropReplacement ? [replacementId] : [],
          documents: closed.map(({ record }) => record),
          order: order.map((document) => document.id),
          activeId: nextId,
        }),
      );
      committed = true;
      this.activeDocument.viewState = this.editor.saveViewState();
      this.documents = order;
      this.activeDocumentId = nextId;
      this.vtlValues = this.activeDocument.vtlValues;
      const envKey = this.container.querySelector("#envSelector")?.value;
      const url = this.baseUrls.find((pair) => pair.key === envKey)?.value;
      if (url !== undefined) this.vtlValues.baseUrl = url;
      if (this.editor.getModel() !== this.activeDocument.model) {
        this.editor.setModel(this.activeDocument.model);
        if (this.activeDocument.viewState) this.editor.restoreViewState(this.activeDocument.viewState);
        this.lastRenderedHTML = "";
        this.renderPreview(this.editor.getValue(), true);
        this.editor.layout();
      }
      if (dropReplacement) replacement.model.dispose();
      this._closedDocuments = null;
      clearTimeout(this._undoTimer);
      this.container.querySelector("#htmlDocumentUndo").hidden = true;
      this.renderDocumentTabs();
      this.container.querySelector(`#html-document-tab-${nextId}`)?.focus();
    } catch (_) {
      if (!committed) restored.forEach((document) => document.model.dispose());
      // The Undo control stays available if the storage transaction fails.
    } finally {
      this._tabTransition = false;
    }
  }

  async initializeMonacoEditor() {
    const container = document.getElementById("htmlEditor");
    this.editor = monaco.editor.create(container, {
      model: this.activeDocument.model,
      language: "html",
      theme: "vs-dark",
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      scrollbar: { alwaysConsumeMouseWheel: false },
      wordWrap: "on",
      formatOnPaste: true,
      formatOnType: true,
      tabSize: 2,
      insertSpaces: true,
      quickSuggestions: { other: true, comments: false, strings: true },
      suggestOnTriggerCharacters: true,
      wordBasedSuggestions: "off",
    });

    this._encodingDecorations = this.editor.createDecorationsCollection();
    this.editor.onDidChangeModel(() => this.clearEncodingReview());

    this.inputSource = "restored";
  }

  registerVelocityCompletions() {
    this._velocityCompletionProvider?.dispose();
    this._velocityCompletionProvider = monaco.languages.registerCompletionItemProvider("html", {
      triggerCharacters: ["$", "#"],
      provideCompletionItems: (model, position) => {
        if (!model.uri.toString().startsWith("inmemory://html-template/")) return { suggestions: [] };
        const linePrefix = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
        const directive = linePrefix.match(/#[A-Za-z]*$/);
        const variable = linePrefix.match(/\$!?\{?[A-Za-z_][A-Za-z0-9_.]*$|\$!?\{?$/);
        const match = directive || variable;
        if (!match) return { suggestions: [] };
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column - match[0].length,
          endColumn: position.column,
        };
        if (directive) {
          return {
            suggestions: VTL_DIRECTIVES.map(([label, insertText]) => ({
              label,
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            })),
          };
        }
        const quiet = variable[0].startsWith("$!");
        const wrapped = variable[0].includes("{");
        const paths = new Set(["baseUrl", ...extractVtlVariables(model.getValue()), ...vtlValuePaths(this.vtlValues)]);
        return {
          suggestions: [...paths].map((path) => ({
            label: `$${path}`,
            kind: monaco.languages.CompletionItemKind.Variable,
            insertText: `$${quiet ? "!" : ""}${wrapped ? "{" : ""}${path}${wrapped ? "}" : ""}`,
            range,
          })),
        };
      },
    });
  }

  initializeWorker() {
    const btn = document.getElementById("btnMinifyHtml");
    const unavailableMessage = "HTML minifier could not be loaded. Your HTML was left unchanged.";

    if (btn) {
      btn.disabled = true;
      btn.title = "Checking HTML minifier...";
    }

    const markUnavailable = (message = unavailableMessage) => {
      this.minifierAvailable = false;
      if (btn) {
        btn.disabled = true;
        btn.title = message;
      }
      this.showError(message);
    };

    try {
      this.minifyWorker = new MinifyWorker();
    } catch (err) {
      markUnavailable(err?.message ? `${unavailableMessage} ${err.message}` : unavailableMessage);
      return;
    }

    this.minifyWorker.onmessage = (e) => {
      const { type, success, result, error } = e.data || {};

      if (type === "probe") {
        this.minifierAvailable = Boolean(success);
        if (btn) {
          btn.disabled = !success;
          btn.title = success ? "Minify HTML" : error || "HTML minifier is unavailable";
        }
        if (!success && error) {
          this.showError(error);
        }
        return;
      }

      if (btn) btn.disabled = !this.minifierAvailable;

      if (success && typeof result === "string") {
        const pending = this.pendingMinifyMeta;
        const target = this.documents.find((document) => document.id === pending?.documentId);
        if (!target || target.model.getAlternativeVersionId() !== pending?.versionId) {
          this.pendingMinifyMeta = null;
          return;
        }
        this.programmaticEditorChange = true;
        target.model.setValue(result);
        this.programmaticEditorChange = false;
        void this.writeDocumentStore(() => this.documentStore.saveDocument(this.documentRecord(target)));
        if (target.id === this.activeDocumentId) this.renderPreview(result);
        this.trackHtmlProcessSuccess("minify_action", "minify", pending.input, result, pending.startedAt, pending.attemptId);
        this.pendingMinifyMeta = null;
      } else if (!success && error) {
        const pending = this.pendingMinifyMeta;
        if (pending) this.trackHtmlProcessError("minify", pending.input, pending.startedAt, pending.attemptId, "minify_failed");
        this.pendingMinifyMeta = null;
        this.showError(`Minify failed. Your HTML was left unchanged. ${error}`);
      }
    };
    this.minifyWorker.onerror = (err) => {
      const pending = this.pendingMinifyMeta;
      if (pending) this.trackHtmlProcessError("minify", pending.input, pending.startedAt, pending.attemptId, "worker_error");
      this.pendingMinifyMeta = null;
      markUnavailable(err?.message ? `${unavailableMessage} ${err.message}` : unavailableMessage);
    };
    this.minifyWorker.onmessageerror = () => {
      const pending = this.pendingMinifyMeta;
      if (pending) this.trackHtmlProcessError("minify", pending.input, pending.startedAt, pending.attemptId, "worker_message_error");
      this.pendingMinifyMeta = null;
      markUnavailable("HTML minifier returned an unreadable response. Your HTML was left unchanged.");
    };
    // Probe worker for engine status on load
    this.minifyWorker.postMessage({ type: "probe" });
  }

  bindToolEvents() {
    const btnFormat = document.getElementById("btnFormatHtml");
    const btnMinify = document.getElementById("btnMinifyHtml");
    const btnExtract = document.getElementById("btnExtractVtl");
    const btnCopy = document.getElementById("btnCopyHtml");
    const btnPaste = document.getElementById("btnPasteHtml");
    const btnClear = document.getElementById("btnClearHtml");
    const btnReload = document.getElementById("btnReloadPreview");
    const btnWhitePreviewBg = document.getElementById("btnWhitePreviewBg");
    const btnCloseVtl = document.getElementById("btnCloseVtl");
    const btnResetVtl = document.getElementById("btnResetVtl");
    const btnImport = document.getElementById("btnImportHtml");
    const btnSaveAs = document.getElementById("btnSaveAsHtml");
    const btnCheckEncoding = document.getElementById("btnCheckHtmlEncoding");
    const htmlFileInput = document.getElementById("htmlFileInput");

    // Import button
    if (btnImport) {
      btnImport.addEventListener("click", () => this.handleImportClick());
    }

    if (btnSaveAs) {
      btnSaveAs.addEventListener("click", () => void this.handleSaveAsClick());
    }
    btnCheckEncoding?.addEventListener("click", () => this.showEncodingReport());
    this.container.querySelectorAll("[data-encoding-preview]").forEach((button) => {
      button.addEventListener("click", () => this.setEncodingPreviewMode(button.dataset.encodingPreview));
    });

    // File input change handler (web)
    if (htmlFileInput) {
      htmlFileInput.addEventListener("change", (e) => this.handleFileInputChange(e));
    }

    if (btnFormat) {
      btnFormat.addEventListener("click", async () => {
        const action = this.editor.getAction("editor.action.formatDocument");
        const input = this.editor.getValue();
        const startedAt = Date.now();
        const attemptId = this.createAnalyticsId();
        if (action) {
          try {
            this.programmaticEditorChange = true;
            this._pendingFormat = action.run();
            await this._pendingFormat;
            const output = this.editor.getValue();
            this.renderPreview(output);
            this.trackHtmlProcessSuccess("format_action", "format", input, output, startedAt, attemptId);
          } catch (error) {
            this.trackHtmlProcessError("format", input, startedAt, attemptId, error?.name || "format_error");
            this.showError("Format failed. Your HTML was left unchanged.");
          } finally {
            this._pendingFormat = null;
            this.programmaticEditorChange = false;
          }
        } else {
          this.trackHtmlProcessError("format", input, startedAt, attemptId, "formatter_unavailable");
        }
      });
    }

    if (btnMinify) {
      btnMinify.addEventListener("click", async () => {
        if (!this.minifyWorker || !this.minifierAvailable) {
          this.trackHtmlProcessError("minify", this.editor.getValue(), Date.now(), this.createAnalyticsId(), "minifier_unavailable");
          this.showError("HTML minifier is unavailable. Your HTML was left unchanged.");
          return;
        }
        const html = this.editor.getValue();
        btnMinify.disabled = true;
        this.pendingMinifyMeta = {
          input: html,
          startedAt: Date.now(),
          attemptId: this.createAnalyticsId(),
          documentId: this.activeDocumentId,
          versionId: this.editor.getModel().getAlternativeVersionId(),
        };
        this.minifyWorker.postMessage({ type: "minify", html });
      });
    }

    if (btnExtract) {
      btnExtract.addEventListener("click", () => {
        const startedAt = Date.now();
        const attemptId = this.createAnalyticsId();
        const html = this.editor.getValue();
        const allVars = extractVtlVariables(html);
        const vars = allVars.filter((v) => v !== "baseUrl");
        const modal = document.getElementById("vtlModal");
        const content = document.getElementById("vtlModalBody");
        if (content) {
          content.innerHTML = "";
          if (!vars.length) {
            content.textContent = "No VTL variables found.";
          } else {
            const info = document.createElement("div");
            info.className = "vtl-info";
            info.textContent = `${vars.length} external variable${vars.length === 1 ? "" : "s"} detected. Paste a JSON object or edit values below.`;
            info.style.margin = "0 0 .5rem 0";
            info.style.fontSize = "13px";
            info.style.color = "#8aa";
            content.appendChild(info);

            const jsonInput = document.createElement("textarea");
            jsonInput.id = "vtlJsonInput";
            jsonInput.className = "vtl-json-input";
            jsonInput.rows = 5;
            jsonInput.spellcheck = false;
            jsonInput.placeholder = '{\n  "customer": { "name": "Dewi" },\n  "items": ["one", "two"]\n}';
            jsonInput.value = JSON.stringify(buildVtlValuesExport(html, this.vtlValues), null, 2);
            content.appendChild(jsonInput);

            const actions = document.createElement("div");
            actions.className = "vtl-actions";
            const applyJson = document.createElement("button");
            applyJson.type = "button";
            applyJson.className = "btn btn-primary btn-sm";
            applyJson.textContent = "Apply JSON";
            const copyNames = document.createElement("button");
            copyNames.type = "button";
            copyNames.className = "btn btn-secondary btn-sm";
            copyNames.textContent = "Copy Names";
            const exportJson = document.createElement("button");
            exportJson.type = "button";
            exportJson.className = "btn btn-secondary btn-sm";
            exportJson.textContent = "Export JSON";
            actions.append(applyJson, copyNames, exportJson);
            content.appendChild(actions);

            applyJson.addEventListener("click", () => {
              try {
                const parsed = JSON.parse(jsonInput.value);
                if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Values must be a JSON object");
                const baseUrl = this.vtlValues?.baseUrl;
                this.vtlValues = { ...parsed };
                if (baseUrl !== undefined && this.vtlValues.baseUrl === undefined) this.vtlValues.baseUrl = baseUrl;
                this.activeDocument.vtlValues = this.vtlValues;
                this.scheduleDocumentSave();
                vars.forEach((variable) => {
                  const field = document.getElementById(`vtl_${variable.replace(/\./g, "__")}`);
                  const value = getVtlValue(this.vtlValues, variable);
                  if (field) field.value = value && typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
                });
                this.renderPreview(this.editor.getValue(), true);
                this.showSuccess("VTL values applied from JSON");
              } catch (error) {
                this.showError(error instanceof SyntaxError ? `Invalid JSON: ${error.message}` : error.message);
              }
            });

            copyNames.addEventListener("click", async () => {
              try {
                await navigator.clipboard.writeText(vars.join("\n"));
                this.showSuccess("VTL variable names copied");
              } catch (_) {
                this.showError("Could not copy VTL variable names");
              }
            });

            exportJson.addEventListener("click", () => {
              const output = JSON.stringify(buildVtlValuesExport(html, this.vtlValues), null, 2);
              const url = URL.createObjectURL(new Blob([output], { type: "application/json" }));
              const link = document.createElement("a");
              link.href = url;
              link.download = "vtl-values.json";
              link.click();
              URL.revokeObjectURL(url);
              this.showSuccess("VTL values exported");
            });

            vars.forEach((v) => {
              const row = document.createElement("div");
              row.className = "vtl-field-row";
              row.style.display = "grid";
              row.style.gridTemplateColumns = "160px 1fr";
              row.style.alignItems = "center";
              row.style.gap = ".5rem";
              row.style.margin = "0 0 .5rem 0";

              const label = document.createElement("label");
              label.setAttribute("for", `vtl_${v.replace(/\./g, "__")}`);
              label.textContent = v;
              label.style.fontWeight = "600";
              label.style.fontSize = "13px";

              const input = document.createElement("input");
              input.type = "text";
              input.id = `vtl_${v.replace(/\./g, "__")}`;
              input.className = "vtl-input";
              input.placeholder = "Enter value";
              const currentValue = getVtlValue(this.vtlValues, v);
              input.value = currentValue && typeof currentValue === "object" ? JSON.stringify(currentValue) : String(currentValue ?? "");
              input.style.width = "100%";
              input.style.padding = ".375rem .5rem";
              input.style.border = "1px solid rgba(255,255,255,0.18)";
              input.style.borderRadius = "6px";
              input.style.fontSize = "13px";

              input.addEventListener("input", (e) => {
                setVtlValue(this.vtlValues, v, e.target.value);
                this.scheduleDocumentSave();
                // Force re-render to apply latest substitutions
                this.renderPreview(this.editor.getValue(), true);
                clearTimeout(this.vtlAnalyticsTimer);
                this.vtlAnalyticsTimer = setTimeout(() => {
                  this.trackAnalytics("vtl_values_updated", {
                    session_id: this.analyticsSessionId,
                    input_source: this.inputSource,
                    ...this.getVtlAnalyticsMeta(this.editor.getValue()),
                  });
                }, 1000);
              });

              row.appendChild(label);
              row.appendChild(input);
              content.appendChild(row);
            });
          }
        }
        if (modal) modal.style.display = "block";
        const meta = this.buildHtmlProcessMeta(html, html, startedAt, attemptId, { operation: "vtl_extract" });
        this.trackAnalytics("vtl_extract", meta);
        this.lastHtmlOperation = meta;
      });
    }

    if (btnCloseVtl) {
      btnCloseVtl.addEventListener("click", () => {
        const modal = document.getElementById("vtlModal");
        if (modal) modal.style.display = "none";
      });
    }

    if (btnResetVtl) {
      btnResetVtl.addEventListener("click", () => {
        const html = this.editor.getValue();
        const vars = extractVtlVariables(html).filter((v) => v !== "baseUrl");
        // Unset stored values so rendering falls back to variable names
        vars.forEach((v) => deleteVtlValue(this.vtlValues, v));
        const inputs = document.querySelectorAll("#vtlModalBody .vtl-input");
        inputs.forEach((input) => {
          input.value = "";
        });
        this.scheduleDocumentSave();
        // Re-render preview to show default variable tokens again
        this.renderPreview(this.editor.getValue(), true);
      });
    }

    if (btnCopy) {
      btnCopy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(this.editor.getValue());
          this.showSuccess("HTML copied");
          const html = this.editor.getValue();
          const meta = {
            operation: "copy",
            source_operation: this.lastHtmlOperation?.operation || "manual",
            source_attempt_id: this.lastHtmlOperation?.attempt_id || null,
            session_id: this.analyticsSessionId,
            input_source: this.inputSource,
            ...summarizeText(html, "output"),
            ...this.getVtlAnalyticsMeta(html),
          };
          this.trackAnalytics("copy_html", meta);
          this.trackAnalytics("output_used", meta);
        } catch (e) {
          this.trackAnalytics("output_error", { operation: "copy", error_type: e?.name || "clipboard_error" });
          this.showError("Copy failed");
        }
      });
    }

    if (btnPaste) {
      btnPaste.addEventListener("click", async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (text) {
            const model = this.editor.getModel();
            if (model) {
              const fullRange = model.getFullModelRange();
              this.editor.executeEdits("paste", [{ range: fullRange, text }]);
            } else {
              this.editor.setValue(text);
            }
            this.renderPreview(this.editor.getValue());
            this.inputSource = "paste";
            this.trackAnalytics("input_acquired", {
              source: "paste",
              session_id: this.analyticsSessionId,
              ...summarizeText(text, "input"),
            });
          }
        } catch (e) {
          this.trackAnalytics("input_error", { source: "paste", error_type: e?.name || "clipboard_error" });
          this.showError("Paste failed");
        }
      });
    }

    if (btnClear) {
      btnClear.addEventListener("click", () => {
        this.editor.setValue("");
        this.inputSource = "empty";
        this.renderPreview("");
        this.trackAnalytics("clear_html");
      });
    }

    if (btnReload) {
      btnReload.addEventListener("click", () => {
        const html = this.editor.getValue();
        const startedAt = Date.now();
        this.renderPreview(html, true);
        this.trackAnalytics("preview_reload", {
          duration_ms: Math.max(0, Date.now() - startedAt),
          preview_mode: this.previewVtlMode,
          session_id: this.analyticsSessionId,
          input_source: this.inputSource,
          ...summarizeText(html, "input"),
          ...this.getVtlAnalyticsMeta(html),
        });
      });
    }

    if (btnWhitePreviewBg) {
      btnWhitePreviewBg.addEventListener("click", () => {
        this.previewWhiteBackground = !this.previewWhiteBackground;
        try {
          localStorage.setItem(this._previewBackgroundStorageKey, this.previewWhiteBackground ? "white" : "transparent");
        } catch (_) {}
        this.applyPreviewBackground();
        this.trackAnalytics("preview_background_toggle", { background: this.previewWhiteBackground ? "white" : "transparent" });
      });
    }

    // Render and autosave only the active document.
    this.editor.onDidChangeModelContent(() => {
      this.clearEncodingReview();
      const value = this.editor.getValue();
      if (!this.programmaticEditorChange) this.inputSource = "manual";
      clearTimeout(this._previewTimer);
      const id = this.activeDocumentId;
      this._previewTimer = setTimeout(() => {
        if (id === this.activeDocumentId && value !== this.lastRenderedHTML) this.renderPreview(value);
      }, 300);
      this.scheduleDocumentSave();
    });
  }

  setupPreviewVtlMode() {
    const select = document.getElementById("previewVtlModeSelect");
    if (!select) return;

    try {
      const saved = localStorage.getItem(this._previewVtlModeStorageKey);
      if (saved === "plain" || saved === "rendered") this.previewVtlMode = saved;
    } catch (_) {}

    const syncControl = () => {
      select.value = this.previewVtlMode;
      select.title =
        this.previewVtlMode === "plain" ? "Show the HTML template without rendering VTL" : "Render VTL using the current values";
    };

    select.addEventListener("change", () => {
      this.previewVtlMode = select.value === "plain" ? "plain" : "rendered";
      syncControl();
      try {
        localStorage.setItem(this._previewVtlModeStorageKey, this.previewVtlMode);
      } catch (_) {}
      this.renderPreview(this.editor?.getValue?.() || "", true);
      this.trackAnalytics("preview_vtl_mode_change", {
        mode: this.previewVtlMode,
        ...this.getVtlAnalyticsMeta(this.editor?.getValue?.() || ""),
      });
    });

    syncControl();
  }

  applyIframeSandbox() {
    const iframe = document.getElementById("htmlRenderer");
    if (!iframe) return;
    const base = ["allow-scripts", "allow-forms"]; // keep safe
    if (this.sandboxSameOriginAllowed) base.push("allow-same-origin");
    iframe.setAttribute("sandbox", base.join(" "));
  }

  applyPreviewBackground() {
    const iframe = document.getElementById("htmlRenderer");
    const surface = document.getElementById("rendererSurface");
    const button = document.getElementById("btnWhitePreviewBg");
    if (iframe) iframe.style.backgroundColor = this.previewWhiteBackground ? "#ffffff" : "transparent";
    if (surface) surface.style.backgroundColor = this.previewWhiteBackground ? "#ffffff" : "";
    if (button) {
      button.setAttribute("aria-pressed", String(this.previewWhiteBackground));
      button.title = this.previewWhiteBackground
        ? "Use a transparent preview background"
        : "Show a white background behind transparent HTML";
    }
  }

  setupPreviewViewport() {
    const select = document.getElementById("previewViewportSelect");
    const widthInput = document.getElementById("previewViewportWidth");
    if (!select || !widthInput) return;

    try {
      const saved = localStorage.getItem(this._previewViewportStorageKey);
      const parsed = saved ? JSON.parse(saved) : null;
      const isKnownMode = PREVIEW_VIEWPORT_PRESETS.some((preset) => preset.value === parsed?.mode);
      if (isKnownMode) this.previewViewportMode = parsed.mode;
      if (this.previewViewportMode === "custom" && parsed?.width !== undefined) {
        this.previewViewportWidth = this.normalizePreviewViewportWidth(parsed.width, this.previewViewportWidth);
      }
    } catch (_) {}

    PREVIEW_VIEWPORT_PRESETS.forEach((preset) => {
      const option = document.createElement("option");
      option.value = preset.value;
      option.textContent = preset.label;
      select.appendChild(option);
    });

    const syncControls = () => {
      select.value = this.previewViewportMode;
      const isCustom = this.previewViewportMode === "custom";
      widthInput.hidden = !isCustom;
      if (isCustom) widthInput.value = String(this.previewViewportWidth);
    };

    const persistAndApply = () => {
      try {
        localStorage.setItem(
          this._previewViewportStorageKey,
          JSON.stringify({ mode: this.previewViewportMode, width: this.previewViewportWidth }),
        );
      } catch (_) {}
      this.applyPreviewViewport();
      const width = this.getPreviewViewportWidth();
      this.trackAnalytics("preview_viewport_change", {
        viewport: this.previewViewportMode,
        viewport_width: width || "responsive",
      });
    };

    select.addEventListener("change", () => {
      this.previewViewportMode = PREVIEW_VIEWPORT_PRESETS.some((preset) => preset.value === select.value) ? select.value : "responsive";
      syncControls();
      persistAndApply();
    });

    widthInput.addEventListener("change", () => {
      this.previewViewportWidth = this.normalizePreviewViewportWidth(widthInput.value, this.previewViewportWidth);
      syncControls();
      persistAndApply();
    });

    syncControls();
    this.applyPreviewViewport();
  }

  normalizePreviewViewportWidth(value, fallback = 390) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(PREVIEW_VIEWPORT_MAX_WIDTH, Math.max(PREVIEW_VIEWPORT_MIN_WIDTH, parsed));
  }

  getPreviewViewportWidth() {
    const preset = PREVIEW_VIEWPORT_PRESETS.find((candidate) => candidate.value === this.previewViewportMode);
    if (preset?.width) return preset.width;
    if (this.previewViewportMode === "custom") {
      return this.normalizePreviewViewportWidth(this.previewViewportWidth);
    }
    return null;
  }

  applyPreviewViewport() {
    const iframe = document.getElementById("htmlRenderer");
    if (!iframe) return;

    const width = this.getPreviewViewportWidth();
    if (width) {
      iframe.classList.add("is-fixed-viewport");
      iframe.style.width = `${width}px`;
      iframe.style.maxWidth = "none";
      iframe.style.flex = "0 0 auto";
      iframe.style.marginInline = "auto";
      return;
    }

    iframe.classList.remove("is-fixed-viewport");
    iframe.style.width = "100%";
    iframe.style.maxWidth = "100%";
    iframe.style.flex = "1";
    iframe.style.marginInline = "0";
  }

  renderPreview(html, force = false) {
    const iframe = document.getElementById("htmlRenderer");
    if (!iframe) return;

    if (!force && html === this.lastRenderedHTML) return;
    this.lastRenderedHTML = html;

    // Ensure sandbox set
    this.applyIframeSandbox();
    this.applyPreviewBackground();

    // Apply VTL substitutions only when the preview is in rendered mode.
    try {
      const previewHtml = this.previewEncodingMode === "windows"
        ? simulateWindows1252Import(html)
        : this.previewEncodingMode === "safe" ? convertHtmlForToad(html) : html;
      const rendered = getPreviewContent(previewHtml, this.vtlValues, this.previewVtlMode);
      const selected = this._encodingPreviewFinding;
      const needle = selected
        ? this.previewEncodingMode === "windows" ? selected.simulated : this.previewEncodingMode === "safe" ? selected.replacement : selected.character
        : null;
      let preview = rendered;
      if (needle) {
        try { preview = markEncodingPreview(rendered, needle); } catch (_) { /* Keep the rendered preview when source markup is incomplete. */ }
      }

      // Use srcdoc for atomic update and secure context
      iframe.hidden = !preview.trim();
      iframe.srcdoc = preview || "";
    } catch (error) {
      UsageTracker.trackEvent(
        "html-template",
        "preview_error",
        {
          error_type: error?.name || "render_error",
          session_id: this.analyticsSessionId,
          ...summarizeText(html, "input"),
        },
        2000,
      );
    }
  }

  setupEnvDropdown() {
    const select = document.getElementById("envSelector");
    const controls = document.getElementById("envControls");
    if (!select) return;

    // Load config.baseUrls from localStorage (kvlist of { key, value })
    let pairs = [];
    try {
      const raw = localStorage.getItem("config.baseUrls");
      const parsed = raw ? JSON.parse(raw) : [];
      pairs = Array.isArray(parsed) ? parsed.filter((p) => p && p.key && p.value) : [];
    } catch (_) {
      pairs = [];
    }
    this.baseUrls = pairs;

    // Hide controls if no environments configured
    if (!this.baseUrls.length) {
      if (controls) controls.style.display = "none";
      return;
    } else {
      if (controls) controls.style.display = "inline-flex";
    }

    // Populate options
    select.innerHTML = "";
    this.baseUrls.forEach(({ key }) => {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = key;
      select.appendChild(opt);
    });

    // Restore last selection or default to first
    let selectedKey = null;
    try {
      const savedEnv = localStorage.getItem(this._envStorageKey);
      const keys = new Set(this.baseUrls.map((p) => p.key));
      selectedKey = savedEnv && keys.has(savedEnv) ? savedEnv : this.baseUrls[0]?.key || null;
    } catch (_) {
      selectedKey = this.baseUrls[0]?.key || null;
    }
    if (selectedKey) {
      select.value = selectedKey;
      this.updateVtlBaseUrlFromEnv(selectedKey);
    }

    // Bind change
    select.addEventListener("change", (e) => {
      const envKey = e.target.value;
      this.updateVtlBaseUrlFromEnv(envKey);

      // Track env switch for behavior analysis
      UsageTracker.trackEvent("html-template", "env_switch", {
        env: envKey,
      });
    });
  }

  updateVtlBaseUrlFromEnv(envKey) {
    const pair = this.baseUrls.find((p) => p.key === envKey);
    const url = pair?.value || "";

    // Update the active document's VTL context; the environment selection is shared.
    this.vtlValues = { ...this.vtlValues, baseUrl: url };
    if (this.activeDocument) this.activeDocument.vtlValues = this.vtlValues;
    this.scheduleDocumentSave();
    try {
      localStorage.setItem(this._envStorageKey, envKey || "");
    } catch (_) {}

    // Reflect in VTL panel input if present
    const baseUrlInput = document.getElementById("vtl_baseUrl");
    if (baseUrlInput) baseUrlInput.value = url;

    // Re-render preview with updated substitution
    this.renderPreview(this.editor.getValue(), true);
  }

  // ===== Import HTML Methods =====

  getHtmlSaveFileName() {
    const documentName = String(this.activeDocument?.name || "Untitled").trim();
    const safeName = documentName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/, "") || "Untitled";
    return /\.html?$/i.test(safeName) ? safeName : `${safeName}.html`;
  }

  clearEncodingReview() {
    this._encodingDiffEditor?.dispose();
    this._encodingDiffEditor = null;
    this._encodingDiffModels.forEach((model) => model.dispose());
    this._encodingDiffModels = [];
    this._encodingDecorations?.clear();
    this._encodingReviewSource = null;
    this._encodingReviewSafe = null;
    this._encodingReviewDocumentId = null;
    this.previewEncodingMode = "original";
    this._encodingPreviewFinding = null;
    const previewModes = this.container?.querySelector("#htmlEncodingPreviewModes");
    if (previewModes) previewModes.hidden = true;
    const report = this.container?.querySelector("#htmlEncodingReport");
    if (report) report.hidden = true;
  }

  setEncodingPreviewMode(mode, finding = this._encodingPreviewFinding) {
    if (!["original", "windows", "safe"].includes(mode) || !this.editor) return;
    this.previewEncodingMode = mode;
    this._encodingPreviewFinding = finding;
    this.container?.querySelectorAll("[data-encoding-preview]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.encodingPreview === mode));
    });
    this.renderPreview(this.editor.getValue(), true);
  }

  showEncodingDiff(host) {
    if (!host || !this._encodingReviewSource || !this._encodingReviewSafe) return;
    if (this._encodingDiffEditor) {
      host.hidden = !host.hidden;
      if (!host.hidden) this._encodingDiffEditor.layout();
      return;
    }
    host.hidden = false;
    this._encodingDiffModels = [
      monaco.editor.createModel(this._encodingReviewSource, "html"),
      monaco.editor.createModel(this._encodingReviewSafe, "html"),
    ];
    this._encodingDiffEditor = monaco.editor.createDiffEditor(host, {
      readOnly: true,
      originalEditable: false,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: "on",
      diffWordWrap: "on",
      renderSideBySide: host.clientWidth >= 650,
      useInlineViewWhenSpaceIsLimited: false,
      renderOverviewRuler: false,
      fontSize: 12,
    });
    this._encodingDiffEditor.setModel({ original: this._encodingDiffModels[0], modified: this._encodingDiffModels[1] });
    this._encodingDiffEditor.layout();
  }

  showEncodingReport(importEncoding = null) {
    const report = this.container?.querySelector("#htmlEncodingReport");
    if (!report || !this.editor) return;
    this.clearEncodingReview();
    const source = this.editor.getValue();
    const { charset, issues } = analyzeHtmlEncoding(source);
    const findings = listEncodingCharacters(source);
    const model = this.editor.getModel();
    this._encodingDecorations?.set(findings.flatMap((finding) => finding.offsets.map((offset) => ({
      range: new monaco.Range(
        model.getPositionAt(offset).lineNumber, model.getPositionAt(offset).column,
        model.getPositionAt(offset + finding.character.length).lineNumber, model.getPositionAt(offset + finding.character.length).column,
      ),
      options: { inlineClassName: "html-encoding-risk", hoverMessage: { value: `${finding.name} (${finding.codePoint})` } },
    }))));
    report.replaceChildren();
    const summary = document.createElement("p");
    summary.textContent = `${importEncoding ? `Imported as ${importEncoding.toUpperCase()}. ` : ""}HTML charset: ${charset || "not declared"}. ` +
      (findings.length ? `${findings.reduce((total, finding) => total + finding.count, 0)} highlighted characters in ${findings.length} group${findings.length === 1 ? "" : "s"}.` : "No non-ASCII characters found.");
    report.appendChild(summary);
    issues.filter((issue) => issue.code !== "non_ascii").forEach((issue) => {
      const item = document.createElement("p");
      item.textContent = issue.message;
      report.appendChild(item);
    });
    let safeAvailable = true;
    if (findings.length) {
      const explanation = document.createElement("p");
      explanation.textContent = "Choose a finding to jump to the source and highlight it in the rendered Windows example. Switch preview modes on the right to compare.";
      report.appendChild(explanation);
      const list = document.createElement("div");
      list.className = "html-encoding-findings";
      findings.forEach((finding) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "html-encoding-finding";
        const visible = (value) => value.replaceAll(" ", "␣");
        const heading = document.createElement("strong");
        heading.textContent = `${finding.name} · ${finding.codePoint} · ${finding.count}× · first at line ${finding.firstLine}`;
        const comparison = document.createElement("span");
        comparison.className = "html-encoding-comparison";
        [
          ["Original", visible(finding.character)],
          ["Windows example", visible(finding.simulated)],
          ["Fixed source", finding.replacement],
        ].forEach(([label, value]) => {
          const cell = document.createElement("span");
          cell.className = "html-encoding-comparison-cell";
          const caption = document.createElement("small");
          caption.textContent = label;
          const sample = document.createElement("code");
          sample.textContent = value;
          cell.append(caption, sample);
          comparison.appendChild(cell);
        });
        button.append(heading, comparison);
        button.addEventListener("click", () => {
          const position = model.getPositionAt(finding.offsets[0]);
          this.editor.setSelection(new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column + finding.character.length));
          this.editor.revealLineInCenter(position.lineNumber);
          this.setEncodingPreviewMode("windows", finding);
        });
        list.appendChild(button);
      });
      report.appendChild(list);
      try {
        const safe = convertHtmlForToad(source);
        if (safe !== source) {
          this._encodingReviewSource = source;
          this._encodingReviewSafe = safe;
          this._encodingReviewDocumentId = this.activeDocumentId;
          const actions = document.createElement("div");
          actions.className = "html-encoding-actions";
          const diffButton = document.createElement("button");
          diffButton.type = "button";
          diffButton.className = "btn btn-secondary btn-sm";
          diffButton.textContent = "Review source diff";
          const diffHost = document.createElement("div");
          diffHost.className = "html-encoding-diff";
          diffHost.setAttribute("aria-label", "Original and ASCII-safe HTML source diff");
          diffHost.hidden = true;
          diffButton.addEventListener("click", () => this.showEncodingDiff(diffHost));
          const replaceButton = document.createElement("button");
          replaceButton.type = "button";
          replaceButton.className = "btn btn-primary btn-sm";
          replaceButton.textContent = `Replace all ${findings.reduce((total, finding) => total + finding.count, 0)} in editor`;
          replaceButton.addEventListener("click", () => {
            if (this.activeDocumentId !== this._encodingReviewDocumentId || this.editor.getValue() !== this._encodingReviewSource) {
              this.showEncodingReport();
              return;
            }
            this.editor.pushUndoStop();
            this.editor.executeEdits("toad-safe-html", [{ range: this.editor.getModel().getFullModelRange(), text: safe }]);
            this.editor.pushUndoStop();
            this.showEncodingReport();
            this.setEncodingPreviewMode("windows", null);
            this.showSuccess("Replaced upload-sensitive characters. Undo is available in the editor.");
          });
          actions.append(diffButton, replaceButton);
          report.append(actions, diffHost);
        }
      } catch (error) {
        safeAvailable = false;
        const warning = document.createElement("p");
        warning.textContent = error.message;
        report.appendChild(warning);
      }
    }
    const guidance = document.createElement("p");
    guidance.textContent = "Windows example simulates UTF-8 decoded as Windows-1252. Toad settings may differ. After replacing, use Save As and verify the stored BLOB or CLOB in the WebView.";
    report.appendChild(guidance);
    report.hidden = false;
    const previewModes = this.container?.querySelector("#htmlEncodingPreviewModes");
    if (previewModes) previewModes.hidden = false;
    const safeButton = previewModes?.querySelector('[data-encoding-preview="safe"]');
    if (safeButton) safeButton.disabled = !safeAvailable;
    this.setEncodingPreviewMode("original", null);
  }

  async handleSaveAsClick() {
    if (!this.editor) return;

    const content = this.editor.getValue();
    const fileName = this.getHtmlSaveFileName();
    try {
      if (isTauri()) {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const { writeTextFile } = await import("@tauri-apps/plugin-fs");
        const selected = await save({
          filters: [{ name: "HTML Files", extensions: ["html", "htm"] }],
          defaultPath: fileName,
          title: "Save HTML File As",
        });
        if (!selected) return;
        await writeTextFile(selected, content);
        this.showSuccess(`Saved ${selected.split(/[\\/]/).pop()}`);
        return;
      }

      if (typeof window.showSaveFilePicker === "function") {
        const fileHandle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [{ description: "HTML document", accept: { "text/html": [".html", ".htm"] } }],
        });
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
        this.showSuccess(`Saved ${fileHandle.name}`);
        return;
      }

      const blob = new Blob([content], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.showSuccess(`Downloaded ${fileName}`);
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.error("Failed to save HTML:", error);
      this.showError("Failed to save HTML file");
    }
  }

  /**
   * Handle Import button click
   * Uses Tauri file dialog in desktop, file input in web
   */
  async handleImportClick() {
    if (isTauri()) {
      await this._handleImportTauri();
    } else {
      // Web: trigger the hidden file input
      const fileInput = document.getElementById("htmlFileInput");
      if (fileInput) {
        fileInput.click();
      }
    }
  }

  /**
   * Handle Import for Tauri (desktop)
   */
  async _handleImportTauri() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { readFile } = await import("@tauri-apps/plugin-fs");

      const selected = await open({
        multiple: false,
        filters: [{ name: "HTML Files", extensions: ["html", "htm"] }],
        title: "Select HTML File to Import",
      });

      if (!selected) {
        return; // User cancelled
      }

      const { html, encoding } = decodeHtmlBytes(await readFile(selected));
      await this._loadHtmlContent(html, selected.split(/[\\/]/).pop(), encoding);
    } catch (error) {
      console.error("Failed to import HTML (Tauri):", error);
      this.trackAnalytics("input_error", { source: "import", error_type: error?.name || "file_read_error" });
      this.showError(`Failed to import HTML: ${error.message}`);
    }
  }

  /**
   * Handle file input change (web)
   */
  async handleFileInputChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const { html, encoding } = decodeHtmlBytes(await file.arrayBuffer());
      await this._loadHtmlContent(html, file.name, encoding);
    } catch (error) {
      this.trackAnalytics("input_error", { source: "import", error_type: "file_read_error" });
      this.showError(error.message || "Failed to read HTML file");
    }
  }

  /**
   * Load HTML content into the editor
   */
  async _loadHtmlContent(content, name = null, encoding = null) {
    const document = await this.newDocument(name, content);
    if (!document) return;
    this.inputSource = "import";
    this.showSuccess("HTML file opened in a new tab");
    this.showEncodingReport(encoding);
    this.trackAnalytics("input_acquired", {
      source: "import",
      session_id: this.analyticsSessionId,
      ...summarizeText(content, "input"),
    });
  }

  initializeResizer() {
    const layout = this.container?.querySelector(".html-template-layout");
    const resizer = this.container?.querySelector("#splitResizer");
    if (!layout || !resizer || this._resizerCleanup) return;

    const RESIZER_W = 6;
    const MIN_LEFT = 240;
    const MIN_RIGHT = 240;
    let dragging = false;
    let activePointerId = null;

    const getMetrics = () => {
      const rect = layout.getBoundingClientRect();
      const styles = getComputedStyle(layout);
      const gap = Number.parseFloat(styles.columnGap || styles.gap || "0") || 0;
      const total = rect.width - RESIZER_W - gap * 2;
      return { rect, gap, total };
    };

    const updateAria = (left, total) => {
      resizer.setAttribute("aria-valuemin", String(MIN_LEFT));
      resizer.setAttribute("aria-valuemax", String(Math.max(MIN_LEFT, Math.round(total - MIN_RIGHT))));
      resizer.setAttribute("aria-valuenow", String(Math.round(left)));
    };

    const getCurrentLeft = () => {
      const firstColumn = getComputedStyle(layout).gridTemplateColumns.split(" ")[0];
      const current = Number.parseFloat(firstColumn);
      return Number.isFinite(current) ? current : MIN_LEFT;
    };

    const applyLeft = (requestedLeft, persist = true) => {
      const { total } = getMetrics();
      const maxLeft = total - MIN_RIGHT;
      if (maxLeft < MIN_LEFT) return;

      const left = Math.round(Math.max(MIN_LEFT, Math.min(requestedLeft, maxLeft)));
      const right = Math.max(MIN_RIGHT, Math.round(total - left));
      layout.style.gridTemplateColumns = `${left}px ${RESIZER_W}px ${right}px`;
      updateAria(left, total);
      if (persist) {
        try {
          localStorage.setItem(this._splitStorageKey, String(left / total));
        } catch (_) {}
      }
      this.editor?.layout?.();
    };

    const onMove = (event) => {
      if (!dragging || (activePointerId !== null && event.pointerId !== activePointerId)) return;
      const { rect, gap } = getMetrics();
      applyLeft(event.clientX - rect.left - gap - RESIZER_W / 2);
      event.preventDefault();
    };

    const onUp = (event) => {
      if (!dragging || (activePointerId !== null && event?.pointerId !== activePointerId)) return;
      if (activePointerId !== null && resizer.hasPointerCapture?.(activePointerId)) {
        resizer.releasePointerCapture?.(activePointerId);
      }
      dragging = false;
      activePointerId = null;
      resizer.classList.remove("is-dragging");
      document.body.classList.remove("is-resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    const onDown = (event) => {
      if (window.innerWidth <= 900) return;
      dragging = true;
      activePointerId = event.pointerId;
      resizer.setPointerCapture?.(activePointerId);
      resizer.classList.add("is-dragging");
      document.body.classList.add("is-resizing");
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      event.preventDefault();
    };

    const onKeyDown = (event) => {
      if (window.innerWidth <= 900) return;
      const step = event.shiftKey ? 48 : 16;
      const current = getCurrentLeft();
      if (event.key === "ArrowLeft") applyLeft(current - step);
      else if (event.key === "ArrowRight") applyLeft(current + step);
      else if (event.key === "Home") applyLeft(MIN_LEFT);
      else if (event.key === "End") applyLeft(getMetrics().total - MIN_RIGHT);
      else return;
      event.preventDefault();
    };

    const metrics = getMetrics();
    let savedRatio = null;
    try {
      const parsedRatio = Number.parseFloat(localStorage.getItem(this._splitStorageKey) || "");
      if (Number.isFinite(parsedRatio) && parsedRatio > 0 && parsedRatio < 1) savedRatio = parsedRatio;
    } catch (_) {}
    if (savedRatio !== null) applyLeft(metrics.total * savedRatio, false);
    updateAria(getCurrentLeft(), getMetrics().total);
    resizer.addEventListener("pointerdown", onDown);
    resizer.addEventListener("keydown", onKeyDown);

    this._resizerCleanup = () => {
      onUp({ pointerId: activePointerId });
      resizer.removeEventListener("pointerdown", onDown);
      resizer.removeEventListener("keydown", onKeyDown);
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

export { HTMLTemplateTool };
