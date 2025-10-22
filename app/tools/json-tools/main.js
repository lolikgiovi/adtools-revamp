import { JSONToolsService } from "./service.js";
import { JSONToolsTemplate } from "./template.js";
import { BaseTool } from "../../core/BaseTool.js";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { getIconSvg } from "./icon.js";
import { UsageTracker } from "../../core/UsageTracker.js";

class JSONTools extends BaseTool {
  constructor(eventBus) {
    super({
      id: "json-tools",
      name: "JSON Tools",
      description: "JSON Tools for validation, formatting, and manipulation",
      icon: "json",
      category: "application",
      eventBus: eventBus,
    });
    this.editor = null;
    this.currentTab = "validator";
    this.isErrorPanelCollapsed = false;
  }

  getIconSvg() {
    return getIconSvg();
  }

  render() {
    return JSONToolsTemplate;
  }

  async onMount() {
    await this.initializeMonacoEditor();
    this.bindToolEvents();
    this.setupTabs();
    this.processCurrentTab();
  }

  async initializeMonacoEditor() {
    // Configure Monaco workers for Vite ESM builds
    self.MonacoEnvironment = {
      getWorker(_, label) {
        switch (label) {
          case "json":
            return new jsonWorker();
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

    // Create Monaco Editor instance via ESM import
    this.editor = monaco.editor.create(document.getElementById("json-editor"), {
      value: "",
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
    });

    // Load saved content from localStorage
    try {
      const key = "tool:json-tools:editor";
      this._jsonStorageKey = key;
      const saved = localStorage.getItem(key);
      if (saved !== null) {
        this.editor.setValue(saved);
      }
    } catch (_) {}

    // Persist content changes with a light debounce
    this._persistTimer = null;
    this.editor.onDidChangeModelContent(() => {
      clearTimeout(this._persistTimer);
      this._persistTimer = setTimeout(() => {
        try {
          localStorage.setItem(this._jsonStorageKey || "tool:json-tools:editor", this.editor.getValue());
        } catch (_) {}
      }, 300);
    });
  }

  bindToolEvents() {
    // Tab switching
    document.querySelectorAll(".json-tab-button").forEach((button) => {
      button.addEventListener("click", (e) => {
        this.switchTab(e.target.dataset.tab);
      });
    });

    // Action buttons
    document.querySelector(".btn-action-primary").addEventListener("click", () => {
      this.clearErrors();
      this.processCurrentTab();
    });

    document.querySelector(".btn-clear").addEventListener("click", () => {
      this.editor.setValue("");
      try {
        localStorage.setItem(this._jsonStorageKey || "tool:json-tools:editor", "");
      } catch (_) {}
      this.clearOutput();
      this.clearErrors();
    });

    document.querySelector(".btn-copy-input").addEventListener("click", () => {
      this.clearErrors();
      this.copyToClipboard(this.editor.getValue());
    });

    document.querySelector(".btn-paste").addEventListener("click", () => {
      this.clearErrors();
      this.pasteFromClipboard();
    });

    document.querySelector(".btn-copy-output").addEventListener("click", () => {
      this.clearErrors();
      const output = document.getElementById("json-output").textContent;
      this.copyToClipboard(output);
    });

    // Extract keys options
    document.querySelectorAll('input[name="extract-type"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        if (this.currentTab === "extract-keys") {
          this.clearErrors();
          this.processCurrentTab();
        }
      });
    });
  }

  setupTabs() {
    this.switchTab("validator");
  }

  switchTab(tabName) {
    document.querySelectorAll(".json-tab-button").forEach((btn) => {
      btn.classList.remove("active");
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add("active");

    // Update current tab
    this.currentTab = tabName;

    // Update action button text
    const actionButton = document.querySelector(".btn-action-primary");
    const buttonTexts = {
      validator: "Validate",
      prettify: "Prettify",
      minify: "Minify",
      stringify: "Stringify",
      unstringify: "Unstringify",
      escape: "Escape",
      unescape: "Unescape",
      "extract-keys": "Extract Keys",
    };
    actionButton.textContent = buttonTexts[tabName] || "Action";

    // Show/hide extract options panel
    const extractOptions = document.getElementById("extract-options");
    if (tabName === "extract-keys") {
      extractOptions.style.display = "block";
    } else {
      extractOptions.style.display = "none";
    }

    // Update output title
    const outputTitle = document.getElementById("output-title");
    const titles = {
      validator: "Validation Result",
      prettify: "Formatted JSON",
      minify: "Minified JSON",
      stringify: "Stringified JSON",
      unstringify: "Parsed JSON",
      escape: "Escaped JSON",
      unescape: "Unescaped JSON",
      "extract-keys": "Extracted Keys",
    };
    outputTitle.textContent = titles[tabName] || "Output";

    // Process current content
    this.processCurrentTab();
  }

  processCurrentTab() {
    const content = this.editor.getValue().trim();

    if (!content) {
      this.clearOutput();
      this.clearErrors();
      return;
    }

    switch (this.currentTab) {
      case "validator":
        this.validateJSON();
        break;
      case "prettify":
        this.prettifyJSON();
        break;
      case "minify":
        this.minifyJSON();
        break;
      case "stringify":
        this.stringifyJSON();
        break;
      case "unstringify":
        this.unstringifyJSON();
        break;
      case "escape":
        this.escapeJSON();
        break;
      case "unescape":
        this.unescapeJSON();
        break;
      case "extract-keys":
        this.extractKeys();
        break;
    }
  }

  validateJSON() {
    UsageTracker.track("json-tools", "validate");
    const content = this.editor.getValue().trim();
    const output = document.getElementById("json-output");

    const res = JSONToolsService.validate(content);
    if (res.error) {
      output.textContent = "❌ Invalid JSON";
      output.className = "json-output error";
      this.showError("JSON Syntax Error", res.error.message, res.error.position);
    } else {
      output.className = "json-output success";
      this.showSuccess("JSON is valid ✅");
      output.textContent = res.result;
    }
  }

  prettifyJSON() {
    UsageTracker.track("json-tools", "prettify");
    const content = this.editor.getValue().trim();
    const output = document.getElementById("json-output");

    const res = JSONToolsService.prettify(content);
    if (res.error) {
      output.textContent = "Error: Invalid JSON";
      output.className = "json-output error";
      this.showError("JSON Syntax Error", res.error.message, res.error.position);
    } else {
      output.textContent = res.result;
      output.className = "json-output success";
    }
  }

  minifyJSON() {
    UsageTracker.track("json-tools", "minify");
    const content = this.editor.getValue().trim();
    const output = document.getElementById("json-output");

    const res = JSONToolsService.minify(content);
    if (res.error) {
      output.textContent = "Error: Invalid JSON";
      output.className = "json-output error";
      this.showError("JSON Syntax Error", res.error.message, res.error.position);
    } else {
      output.textContent = res.result;
      output.className = "json-output success";
    }
  }

  stringifyJSON() {
    UsageTracker.track("json-tools", "stringify");
    const content = this.editor.getValue().trim();
    const output = document.getElementById("json-output");

    const res = JSONToolsService.stringify(content);
    if (res.error) {
      output.textContent = "Error: Invalid JSON";
      output.className = "json-output error";
      this.showError("JSON Syntax Error", res.error.message, res.error.position);
    } else {
      output.textContent = res.result;
      output.className = "json-output success";
    }
  }

  unstringifyJSON() {
    UsageTracker.track("json-tools", "unstringify");
    const content = this.editor.getValue().trim();
    const output = document.getElementById("json-output");

    const res = JSONToolsService.unstringify(content);
    if (res.error) {
      output.textContent = "Error: Invalid JSON string";
      output.className = "json-output error";
      this.showError("JSON Unstringify Error", res.error.message, res.error.position);
    } else {
      output.textContent = res.result;
      output.className = "json-output success";
      this.clearErrors();
    }
  }

  escapeJSON() {
    UsageTracker.track("json-tools", "escape");
    const content = this.editor.getValue().trim();
    const output = document.getElementById("json-output");

    const res = JSONToolsService.escape(content);
    if (res.error) {
      output.textContent = "Error: Invalid JSON";
      output.className = "json-output error";
      this.showError("JSON Syntax Error", res.error.message, res.error.position);
    } else {
      output.textContent = res.result;
      output.className = "json-output success";
    }
  }

  unescapeJSON() {
    UsageTracker.track("json-tools", "unescape");
    const content = this.editor.getValue().trim();
    const output = document.getElementById("json-output");

    const res = JSONToolsService.unescape(content);
    if (res.error) {
      output.textContent = "Error: Invalid escaped JSON string";
      output.className = "json-output error";
      this.showError("JSON Unescape Error", res.error.message, res.error.position);
    } else {
      output.textContent = res.result;
      output.className = "json-output success";
      this.clearErrors();
    }
  }

  extractKeys() {
    UsageTracker.track("json-tools", "extract_keys");
    const content = this.editor.getValue().trim();
    const output = document.getElementById("json-output");
    const extractType = document.querySelector('input[name="extract-type"]:checked').value;

    const res = JSONToolsService.extractKeys(content, extractType === "paths");
    if (res.error) {
      output.textContent = "Error: Invalid JSON";
      output.className = "json-output error";
      this.showError("JSON Syntax Error", res.error.message, res.error.position);
    } else {
      output.textContent = res.result;
      output.className = "json-output success";
    }
  }

  // getAllKeys and getErrorPosition are now provided by JSONToolsService

  showError(title, message, position = null) {
    const outputSection = document.getElementById("json-output");

    let locationText = "";
    if (position !== null) {
      const content = this.editor.getValue();
      const lines = content.substring(0, position).split("\n");
      const line = lines.length;
      const column = lines[lines.length - 1].length + 1;
      locationText = `<div class="error-location">Line ${line}, Column ${column}</div>`;
    }

    outputSection.innerHTML = `
            <div class="error-message">${title}</div>
            ${message ? `<div>${message}</div>` : ""}
            ${locationText}
        `;
  }

  clearErrors() {
    // Only clear output if it contains error messages, not successful results
    const output = document.getElementById("json-output");
    if (output.className.includes("error") || output.innerHTML.includes("error-message")) {
      this.clearOutput();
    }
  }

  clearOutput() {
    const output = document.getElementById("json-output");
    output.textContent = "";
    output.className = "json-output";
  }

  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      this.showSuccess("Copied to clipboard!");
    } catch (error) {
      this.showError("Failed to copy to clipboard");
      console.error("Clipboard error:", error);
    }
  }

  async pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      this.editor.setValue(text);
    } catch (error) {
      this.showError("Failed to paste from clipboard", "Make sure you have granted clipboard permissions.");
      console.error("Clipboard error:", error);
    }
  }
}

export { JSONTools };
