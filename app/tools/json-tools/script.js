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

    try {
      const parsed = JSON.parse(content);
      output.className = "json-output success";
      this.showSuccess("JSON is valid ✅");
      const formatted = JSON.stringify(parsed, null, 2);
      output.textContent = formatted;
    } catch (error) {
      output.textContent = "❌ Invalid JSON";
      output.className = "json-output error";
      this.showError("JSON Syntax Error", error.message, this.getErrorPosition(error.message));
    }
  }

  prettifyJSON() {
    const content = this.editor.getValue().trim();
    const output = document.getElementById("json-output");

    try {
      const parsed = JSON.parse(content);
      const formatted = JSON.stringify(parsed, null, 2);
      output.textContent = formatted;
      output.className = "json-output success";
    } catch (error) {
      output.textContent = "Error: Invalid JSON";
      output.className = "json-output error";
      this.showError("JSON Syntax Error", error.message, this.getErrorPosition(error.message));
    }
  }

  minifyJSON() {
    const content = this.editor.getValue().trim();
    const output = document.getElementById("json-output");

    try {
      const parsed = JSON.parse(content);
      const minified = JSON.stringify(parsed);
      output.textContent = minified;
      output.className = "json-output success";
      // Don't call clearErrors() here as it would clear the successful output
    } catch (error) {
      output.textContent = "Error: Invalid JSON";
      output.className = "json-output error";
      this.showError("JSON Syntax Error", error.message, this.getErrorPosition(error.message));
    }
  }

  stringifyJSON() {
    const content = this.editor.getValue().trim();
    const output = document.getElementById("json-output");

    try {
      const parsed = JSON.parse(content);
      const stringified = JSON.stringify(JSON.stringify(parsed, null, 2));
      output.textContent = stringified;
      output.className = "json-output success";
      // Don't call clearErrors() here as it would clear the successful output
    } catch (error) {
      output.textContent = "Error: Invalid JSON";
      output.className = "json-output error";
      this.showError("JSON Syntax Error", error.message, this.getErrorPosition(error.message));
    }
  }

  unstringifyJSON() {
    const content = this.editor.getValue().trim();
    const output = document.getElementById("json-output");

    try {
      // First parse to get the string
      const firstParse = JSON.parse(content);
      if (typeof firstParse !== "string") {
        throw new Error("Input is not a JSON string");
      }

      // Then parse the string to get the actual JSON
      const secondParse = JSON.parse(firstParse);
      const formatted = JSON.stringify(secondParse, null, 2);
      output.textContent = formatted;
      output.className = "json-output success";
      this.clearErrors();
    } catch (error) {
      output.textContent = "Error: Invalid JSON string";
      output.className = "json-output error";
      this.showError("JSON Unstringify Error", error.message);
    }
  }

  escapeJSON() {
    const content = this.editor.getValue().trim();
    const output = document.getElementById("json-output");

    try {
      // Validate JSON first
      JSON.parse(content);

      // Escape the JSON string
      const escaped = content.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");

      output.textContent = `"${escaped}"`;
      output.className = "json-output success";
      // Don't call clearErrors() here as it would clear the successful output
    } catch (error) {
      output.textContent = "Error: Invalid JSON";
      output.className = "json-output error";
      this.showError("JSON Syntax Error", error.message, this.getErrorPosition(error.message));
    }
  }

  unescapeJSON() {
    const content = this.editor.getValue().trim();
    const output = document.getElementById("json-output");

    try {
      // Parse the escaped string
      const unescaped = JSON.parse(content);
      if (typeof unescaped !== "string") {
        throw new Error("Input is not an escaped JSON string");
      }

      // Validate the unescaped content is valid JSON
      const parsed = JSON.parse(unescaped);
      const formatted = JSON.stringify(parsed, null, 2);
      output.textContent = formatted;
      output.className = "json-output success";
      this.clearErrors();
    } catch (error) {
      output.textContent = "Error: Invalid escaped JSON string";
      output.className = "json-output error";
      this.showError("JSON Unescape Error", error.message);
    }
  }

  extractKeys() {
    const content = this.editor.getValue().trim();
    const output = document.getElementById("json-output");
    const extractType = document.querySelector('input[name="extract-type"]:checked').value;

    try {
      const parsed = JSON.parse(content);
      const keys = this.getAllKeys(parsed, extractType === "paths");
      const uniqueKeys = [...new Set(keys)].sort();

      output.textContent = JSON.stringify(uniqueKeys, null, 2);
      output.className = "json-output success";
      // Don't call clearErrors() here as it would clear the successful output
    } catch (error) {
      output.textContent = "Error: Invalid JSON";
      output.className = "json-output error";
      this.showError("JSON Syntax Error", error.message, this.getErrorPosition(error.message));
    }
  }

  getAllKeys(obj, includePaths = false, currentPath = "") {
    const keys = [];

    if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        if (typeof item === "object" && item !== null) {
          const newPath = includePaths ? `${currentPath}[${index}]` : "";
          keys.push(...this.getAllKeys(item, includePaths, newPath));
        }
      });
    } else if (typeof obj === "object" && obj !== null) {
      Object.keys(obj).forEach((key) => {
        const newPath = includePaths ? (currentPath ? `${currentPath}.${key}` : key) : "";

        if (includePaths) {
          keys.push(newPath);
        } else {
          keys.push(key);
        }

        if (typeof obj[key] === "object" && obj[key] !== null) {
          keys.push(...this.getAllKeys(obj[key], includePaths, newPath));
        }
      });
    }

    return keys;
  }

  getErrorPosition(errorMessage) {
    const match = errorMessage.match(/position (\d+)/i);
    return match ? parseInt(match[1]) : null;
  }

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
