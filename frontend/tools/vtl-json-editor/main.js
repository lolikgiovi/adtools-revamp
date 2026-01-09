/**
 * VTL JSON Editor Tool
 * Editor for VTL JSON templates with validation, preview, and variable extraction
 */

import { VTLJSONEditorService } from "./service.js";
import { VTLJSONEditorTemplate } from "./template.js";
import { BaseTool } from "../../core/BaseTool.js";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import { getIconSvg } from "./icon.js";
import { UsageTracker } from "../../core/UsageTracker.js";

class VTLJSONEditor extends BaseTool {
  constructor(eventBus) {
    super({
      id: "vtl-json-editor",
      name: "VTL JSON Editor",
      description: "Validate and preview VTL JSON templates",
      icon: "vtl-json",
      category: "config",
      eventBus: eventBus,
    });
    this.inputEditor = null;
    this.previewEditor = null;
    this.mockEditor = null;
    this.currentTab = "validate";
    this.isMockPanelCollapsed = true;
  }

  getIconSvg() {
    return getIconSvg();
  }

  render() {
    return VTLJSONEditorTemplate;
  }

  async onMount() {
    await this.initializeMonacoEditors();
    this.bindToolEvents();
    this.setupTabs();
  }

  async initializeMonacoEditors() {
    // Configure Monaco workers
    self.MonacoEnvironment = {
      getWorker(_, label) {
        if (label === "json") {
          return new jsonWorker();
        }
        return new editorWorker();
      },
    };

    // Register VTL language for syntax highlighting
    this.registerVTLLanguage();

    // Input editor for VTL template
    this.inputEditor = monaco.editor.create(document.getElementById("vtl-input-editor"), {
      value: "",
      language: "vtl-json",
      theme: "vs-dark",
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: "on",
      tabSize: 2,
      insertSpaces: true,
      lineNumbers: "on",
      renderLineHighlight: "line",
      folding: true,
    });

    // Preview editor (for rendered output)
    this.previewEditor = monaco.editor.create(document.getElementById("vtl-preview-output"), {
      value: "",
      language: "json",
      theme: "vs-dark",
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: "on",
      readOnly: true,
      tabSize: 2,
    });

    // Mock data editor
    this.mockEditor = monaco.editor.create(document.getElementById("vtl-mock-editor"), {
      value: "{\n  \n}",
      language: "json",
      theme: "vs-dark",
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: "on",
      tabSize: 2,
      lineNumbers: "off",
    });

    // Load saved content
    this.loadSavedContent();

    // Setup auto-save
    this.setupAutoSave();
  }

  registerVTLLanguage() {
    // Register VTL+JSON language
    monaco.languages.register({ id: "vtl-json" });

    // Define tokens for syntax highlighting
    monaco.languages.setMonarchTokensProvider("vtl-json", {
      defaultToken: "",
      tokenPostfix: ".vtl",

      keywords: ["true", "false", "null"],

      operators: ["=", "+", "-", "*", "/", "!", "==", "!=", "<", ">", "<=", ">=", "&&", "||"],

      symbols: /[=><!~?:&|+\-*\/\^%]+/,

      escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,

      tokenizer: {
        root: [
          // VTL block comments
          [/#\*/, "comment", "@blockComment"],

          // VTL line comments
          [/##.*$/, "comment"],

          // VTL directives
          [/#(set|if|else|elseif|end|foreach|include|parse|macro|stop|break)\b/, "keyword"],

          // VTL variables with path
          [/\$!?\{?[a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)*\}?/, "variable"],

          // JSON keys
          [/"([^"\\]|\\.)*"\s*:/, "key"],

          // Strings
          [/"([^"\\]|\\.)*"/, "string"],
          [/'([^'\\]|\\.)*'/, "string"],

          // Numbers
          [/-?\d+(\.\d+)?([eE][+-]?\d+)?/, "number"],

          // Booleans and null
          [/\b(true|false|null)\b/, "keyword"],

          // Brackets
          [/[{}()\[\]]/, "@brackets"],

          // Delimiters
          [/[,:]/, "delimiter"],

          // Whitespace
          [/\s+/, "white"],
        ],

        blockComment: [
          [/[^#*]+/, "comment"],
          [/\*#/, "comment", "@pop"],
          [/[#*]/, "comment"],
        ],
      },
    });

    // Define theme colors
    monaco.editor.defineTheme("vtl-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "keyword.vtl", foreground: "C586C0" },
        { token: "variable.vtl", foreground: "9CDCFE" },
        { token: "key.vtl", foreground: "9CDCFE" },
        { token: "string.vtl", foreground: "CE9178" },
        { token: "number.vtl", foreground: "B5CEA8" },
        { token: "comment.vtl", foreground: "6A9955" },
      ],
      colors: {},
    });
  }

  loadSavedContent() {
    try {
      const savedTemplate = localStorage.getItem("tool:vtl-json-editor:template");
      if (savedTemplate) {
        this.inputEditor.setValue(savedTemplate);
      }

      const savedMock = localStorage.getItem("tool:vtl-json-editor:mock");
      if (savedMock) {
        this.mockEditor.setValue(savedMock);
      }
    } catch (_) {}
  }

  setupAutoSave() {
    let saveTimer = null;
    const debounceSave = (key, getValue) => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        try {
          localStorage.setItem(key, getValue());
        } catch (_) {}
      }, 500);
    };

    this.inputEditor.onDidChangeModelContent(() => {
      debounceSave("tool:vtl-json-editor:template", () => this.inputEditor.getValue());
    });

    this.mockEditor.onDidChangeModelContent(() => {
      debounceSave("tool:vtl-json-editor:mock", () => this.mockEditor.getValue());
    });
  }

  bindToolEvents() {
    // Tab switching
    document.querySelectorAll(".vtl-editor-tabs .tab-button").forEach((button) => {
      button.addEventListener("click", (e) => {
        this.switchTab(e.target.dataset.tab);
      });
    });

    // Action button
    document.querySelector(".btn-action-primary").addEventListener("click", () => {
      this.performAction();
    });

    // Clear button
    document.querySelector(".btn-clear").addEventListener("click", () => {
      this.inputEditor.setValue("");
      this.clearOutput();
      try {
        localStorage.removeItem("tool:vtl-json-editor:template");
      } catch (_) {}
    });

    // Copy input
    document.querySelector(".btn-copy-input").addEventListener("click", () => {
      this.copyToClipboard(this.inputEditor.getValue());
    });

    // Paste
    document.querySelector(".btn-paste").addEventListener("click", () => {
      this.pasteFromClipboard();
    });

    // Copy output
    document.querySelector(".btn-copy-output").addEventListener("click", () => {
      this.copyOutput();
    });

    // Generate mock data
    const generateMockBtn = document.querySelector(".btn-generate-mock");
    if (generateMockBtn) {
      generateMockBtn.addEventListener("click", () => {
        this.generateMockData();
      });
    }

    // Toggle mock panel
    const mockHeader = document.querySelector(".vtl-mock-header");
    if (mockHeader) {
      mockHeader.addEventListener("click", () => {
        this.toggleMockPanel();
      });
    }
  }

  setupTabs() {
    const savedTab = localStorage.getItem("vtl-json-editor-tab") || "validate";
    this.switchTab(savedTab);
  }

  switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll(".vtl-editor-tabs .tab-button").forEach((btn) => {
      btn.classList.remove("active");
    });
    document.querySelector(`.vtl-editor-tabs [data-tab="${tabName}"]`)?.classList.add("active");

    this.currentTab = tabName;
    localStorage.setItem("vtl-json-editor-tab", tabName);

    // Update action button text
    const actionBtn = document.querySelector(".btn-action-primary");
    const buttonTexts = {
      validate: "Validate",
      preview: "Preview",
      variables: "Extract",
    };
    actionBtn.textContent = buttonTexts[tabName] || "Action";

    // Update output title
    const outputTitle = document.getElementById("vtl-output-title");
    const titles = {
      validate: "Validation Results",
      preview: "Preview Output",
      variables: "Variables",
    };
    outputTitle.textContent = titles[tabName] || "Output";

    // Show/hide panels
    const validationOutput = document.getElementById("vtl-validation-output");
    const previewOutput = document.getElementById("vtl-preview-output");
    const variablesOutput = document.getElementById("vtl-variables-output");
    const mockPanel = document.getElementById("vtl-mock-panel");
    const generateMockBtn = document.querySelector(".btn-generate-mock");

    validationOutput.style.display = tabName === "validate" ? "block" : "none";
    previewOutput.style.display = tabName === "preview" ? "block" : "none";
    variablesOutput.style.display = tabName === "variables" ? "block" : "none";

    // Show mock panel and generate button only for preview tab
    mockPanel.style.display = tabName === "preview" ? "block" : "none";
    if (generateMockBtn) {
      generateMockBtn.style.display = tabName === "variables" ? "inline-flex" : "none";
    }
  }

  performAction() {
    const template = this.inputEditor.getValue().trim();

    if (!template) {
      this.showEmptyState();
      return;
    }

    switch (this.currentTab) {
      case "validate":
        UsageTracker.trackFeature("vtl-json-editor", "validate");
        this.validateTemplate();
        break;
      case "preview":
        UsageTracker.trackFeature("vtl-json-editor", "preview");
        this.previewTemplate();
        break;
      case "variables":
        UsageTracker.trackFeature("vtl-json-editor", "extract_variables");
        this.extractVariables();
        break;
    }
  }

  validateTemplate() {
    const template = this.inputEditor.getValue();
    const issues = VTLJSONEditorService.lintTemplate(template);

    const outputEl = document.getElementById("vtl-validation-output");
    const errors = issues.filter((i) => i.severity === "error");
    const warnings = issues.filter((i) => i.severity === "warning");

    // Clear markers
    const model = this.inputEditor.getModel();
    if (model) {
      const markers = issues.map((issue) => ({
        severity: issue.severity === "error" ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
        message: issue.message,
        startLineNumber: issue.line,
        startColumn: 1,
        endLineNumber: issue.line,
        endColumn: 1000,
      }));
      monaco.editor.setModelMarkers(model, "vtl-json-editor", markers);
    }

    if (issues.length === 0) {
      outputEl.innerHTML = `
        <div class="vtl-validation-summary">
          <span class="vtl-summary-stat success">✓ Template is valid</span>
        </div>
        <div class="vtl-validation-list">
          <div class="vtl-validation-item success">
            <span class="vtl-validation-message">No syntax errors or warnings found</span>
          </div>
        </div>
      `;
    } else {
      outputEl.innerHTML = `
        <div class="vtl-validation-summary">
          ${errors.length > 0 ? `<span class="vtl-summary-stat errors">${errors.length} error${errors.length > 1 ? "s" : ""}</span>` : ""}
          ${
            warnings.length > 0
              ? `<span class="vtl-summary-stat warnings">${warnings.length} warning${warnings.length > 1 ? "s" : ""}</span>`
              : ""
          }
        </div>
        <div class="vtl-validation-list">
          ${issues
            .map(
              (issue) => `
            <div class="vtl-validation-item ${issue.severity}">
              <span class="vtl-validation-line">Line ${issue.line}</span>
              <span class="vtl-validation-message">${this.escapeHtml(issue.message)}</span>
            </div>
          `
            )
            .join("")}
        </div>
      `;
    }
  }

  previewTemplate() {
    const template = this.inputEditor.getValue();
    let mockData = {};

    try {
      const mockStr = this.mockEditor.getValue().trim();
      if (mockStr) {
        mockData = JSON.parse(mockStr);
      }
    } catch (e) {
      this.previewEditor.setValue(`Error parsing mock data: ${e.message}`);
      return;
    }

    const result = VTLJSONEditorService.renderPreview(template, mockData);

    if (result.success) {
      this.previewEditor.setValue(result.result);
    } else {
      this.previewEditor.setValue(`Render Error: ${result.error}`);
    }
  }

  extractVariables() {
    const template = this.inputEditor.getValue();
    const variables = VTLJSONEditorService.extractVariables(template);

    const outputEl = document.getElementById("vtl-variables-output");

    if (variables.length === 0) {
      outputEl.innerHTML = `
        <div class="vtl-empty-state">
          <p>No variables found in template</p>
        </div>
      `;
      return;
    }

    // Group by root variable name
    const grouped = {};
    for (const v of variables) {
      if (!grouped[v.name]) {
        grouped[v.name] = [];
      }
      grouped[v.name].push(v);
    }

    outputEl.innerHTML = `
      <table class="vtl-variables-table">
        <thead>
          <tr>
            <th>Variable</th>
            <th>Path</th>
            <th>Line</th>
          </tr>
        </thead>
        <tbody>
          ${variables
            .map(
              (v) => `
            <tr>
              <td>$${v.name}</td>
              <td>$${v.path}</td>
              <td class="vtl-variable-line">${v.line}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  generateMockData() {
    const template = this.inputEditor.getValue();
    const variables = VTLJSONEditorService.extractVariables(template);
    const mockData = VTLJSONEditorService.generateMockDataSkeleton(variables);

    this.mockEditor.setValue(JSON.stringify(mockData, null, 2));

    // Show mock panel if collapsed
    const mockPanel = document.getElementById("vtl-mock-panel");
    if (mockPanel.classList.contains("collapsed")) {
      this.toggleMockPanel();
    }

    // Switch to preview tab
    this.switchTab("preview");

    this.showSuccess("Mock data generated! Switch to Preview tab to test.");
  }

  toggleMockPanel() {
    const mockPanel = document.getElementById("vtl-mock-panel");
    mockPanel.classList.toggle("collapsed");
    this.isMockPanelCollapsed = mockPanel.classList.contains("collapsed");
  }

  showEmptyState() {
    const outputEl = document.getElementById("vtl-validation-output");
    outputEl.innerHTML = `
      <div class="vtl-empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14,2 14,8 20,8"/>
        </svg>
        <p>Enter a VTL template and click Validate</p>
      </div>
    `;
  }

  clearOutput() {
    const validationOutput = document.getElementById("vtl-validation-output");
    validationOutput.innerHTML = "";
    this.previewEditor?.setValue("");

    // Clear markers
    const model = this.inputEditor?.getModel();
    if (model) {
      monaco.editor.setModelMarkers(model, "vtl-json-editor", []);
    }
  }

  copyOutput() {
    let text = "";
    switch (this.currentTab) {
      case "validate":
        text = document.getElementById("vtl-validation-output").innerText;
        break;
      case "preview":
        text = this.previewEditor.getValue();
        break;
      case "variables":
        text = document.getElementById("vtl-variables-output").innerText;
        break;
    }
    this.copyToClipboard(text);
  }

  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      this.showSuccess("Copied to clipboard!");
    } catch (error) {
      console.error("Clipboard error:", error);
    }
  }

  async pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      this.inputEditor.setValue(text);
    } catch (error) {
      console.error("Clipboard error:", error);
    }
  }

  escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  onUnmount() {
    if (this.inputEditor) {
      this.inputEditor.dispose();
      this.inputEditor = null;
    }
    if (this.previewEditor) {
      this.previewEditor.dispose();
      this.previewEditor = null;
    }
    if (this.mockEditor) {
      this.mockEditor.dispose();
      this.mockEditor = null;
    }
  }
}

export { VTLJSONEditor };
