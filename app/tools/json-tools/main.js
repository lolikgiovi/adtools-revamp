class JSONTools extends BaseTool {
  constructor(eventBus) {
    super({
      id: "json-tools",
      name: "JSON Tools",
      description: "Advanced JSON manipulation with Monaco Editor",
      category: "general",
      eventBus: eventBus,
    });
    this.editor = null;
    this.currentTab = "validator";
    this.isErrorPanelCollapsed = false;
  }

  render() {
    return window.JSONToolsTemplate;
  }

  async onMount() {
    await this.initializeMonacoEditor();
    this.bindToolEvents();
    this.setupTabs();
    this.processCurrentTab();
  }

  async initializeMonacoEditor() {
    // Check if require is available
    if (typeof require === "undefined") {
      console.error("AMD loader (require) is not available");
      return;
    }

    // Set Monaco Editor paths and environment - disable web workers to avoid CORS issues
    self.MonacoEnvironment = {
      getWorker: function (moduleId, label) {
        // Return null to disable web workers and fall back to main thread
        return null;
      },
      getWorkerUrl: function (moduleId, label) {
        // Keep the URLs for reference but workers will be disabled
        if (label === "json") {
          return "/libs/monaco-editor/min/vs/language/json/jsonWorker.js";
        }
        if (label === "css" || label === "scss" || label === "less") {
          return "/libs/monaco-editor/min/vs/language/css/cssWorker.js";
        }
        if (label === "html" || label === "handlebars" || label === "razor") {
          return "/libs/monaco-editor/min/vs/language/html/htmlWorker.js";
        }
        if (label === "typescript" || label === "javascript") {
          return "/libs/monaco-editor/min/vs/language/typescript/tsWorker.js";
        }
        return "/libs/monaco-editor/min/vs/base/worker/workerMain.js";
      },
    };

    // Configure AMD loader
    try {
      require.config({
        paths: {
          vs: "/libs/monaco-editor/min/vs",
        },
      });
    } catch (error) {
      console.error("Error configuring AMD loader:", error);
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        require(["vs/editor/editor.main"], () => {
          try {
            // Create Monaco Editor instance
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

            resolve();
          } catch (error) {
            console.error("Error creating Monaco Editor:", error);
            reject(error);
          }
        });
      } catch (error) {
        console.error("Error loading Monaco Editor modules:", error);
        reject(error);
      }
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
    const content = this.editor.getValue().trim();
    const output = document.getElementById("json-output");

    if (!content) {
      this.clearOutput();
      this.clearErrors();
      return;
    }

    const res = window.JSONToolsService.validate(content);
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
    const content = this.editor.getValue().trim();
    const output = document.getElementById("json-output");

    const res = window.JSONToolsService.prettify(content);
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
    const content = this.editor.getValue().trim();
    const output = document.getElementById("json-output");

    const res = window.JSONToolsService.minify(content);
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
    const content = this.editor.getValue().trim();
    const output = document.getElementById("json-output");

    const res = window.JSONToolsService.stringify(content);
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
    const content = this.editor.getValue().trim();
    const output = document.getElementById("json-output");

    const res = window.JSONToolsService.unstringify(content);
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
    const content = this.editor.getValue().trim();
    const output = document.getElementById("json-output");

    const res = window.JSONToolsService.escape(content);
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
    const content = this.editor.getValue().trim();
    const output = document.getElementById("json-output");

    const res = window.JSONToolsService.unescape(content);
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
    const content = this.editor.getValue().trim();
    const output = document.getElementById("json-output");
    const extractType = document.querySelector('input[name="extract-type"]:checked').value;

    const res = window.JSONToolsService.extractKeys(content, extractType === "paths");
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

// Register the tool
window.JSONTools = JSONTools;
