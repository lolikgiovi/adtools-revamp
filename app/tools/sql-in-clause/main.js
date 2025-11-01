import { BaseTool } from "../../core/BaseTool.js";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { SQLInClauseTemplate } from "./template.js";
import { SQLInClauseService } from "./service.js";
import { getIconSvg } from "./icon.js";
import { UsageTracker } from "../../core/UsageTracker.js";
import "./styles.css";

class SQLInClauseTool extends BaseTool {
  constructor(eventBus) {
    super({
      id: "sql-in-clause",
      name: "SQL IN Clause",
      description: "Convert newline lists into SQL IN clause formats",
      icon: "sql-in",
      category: "config",
      eventBus,
    });
    this.editor = null;
    this.format = "single"; // single | multi | select
    this.tableInput = null;
    this.columnInput = null;
  }

  getIconSvg() {
    return getIconSvg();
  }

  render() {
    return SQLInClauseTemplate;
  }

  async onMount() {
    await this.initializeMonacoEditor();
    this.bindToolEvents();
    this.updateOutput();
    // Track page mount as a feature
    try {
      UsageTracker.trackFeature("sql-in-clause", "mount", "", 5000);
    } catch (_) {}
  }

  onUnmount() {
    if (this.editor) {
      this.editor.dispose();
      this.editor = null;
    }
  }

  async initializeMonacoEditor() {
    self.MonacoEnvironment = {
      getWorker() {
        return new editorWorker();
      },
    };

    const container = document.getElementById("sqlInEditor");
    this.editor = monaco.editor.create(container, {
      value: "",
      language: "plaintext",
      theme: "vs-dark",
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: "on",
      formatOnPaste: true,
      formatOnType: false,
      tabSize: 2,
      insertSpaces: true,
    });

    try {
      const key = "tool:sql-in-clause:editor";
      this._storageKey = key;
      const saved = localStorage.getItem(key);
      if (saved !== null) {
        this.editor.setValue(saved);
      }
    } catch (_) {}

    this._persistTimer = null;
    this.editor.onDidChangeModelContent(() => {
      clearTimeout(this._persistTimer);
      this._persistTimer = setTimeout(() => {
        try {
          localStorage.setItem(this._storageKey || "tool:sql-in-clause:editor", this.editor.getValue());
        } catch (_) {}
      }, 300);
      this.updateOutput();
    });
  }

  bindToolEvents() {
    const container = this.container;

    const formatSelect = container.querySelector("#sqlInFormat");
    if (formatSelect) {
      this.format = formatSelect.value;
      formatSelect.addEventListener("change", (e) => {
        this.format = e.target.value;
        this.toggleSelectDetails();
        this.updateOutput();
      });
    }

    this.tableInput = container.querySelector("#selectTable");
    this.columnInput = container.querySelector("#selectColumn");
    if (this.tableInput) this.tableInput.addEventListener("input", () => this.updateOutput());
    if (this.columnInput) this.columnInput.addEventListener("input", () => this.updateOutput());

    const copyBtn = container.querySelector("#sqlInCopyBtn");
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        const out = container.querySelector("#sqlInOutput");
        const text = out?.value || "";
        if (text) this.copyToClipboard(text, copyBtn);
      });
    }

    const pasteBtn = container.querySelector("#sqlInPasteBtn");
    if (pasteBtn) {
      pasteBtn.addEventListener("click", async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (typeof text === "string" && text.length > 0) {
            this.editor?.setValue(text);
            this.updateOutput();
            this.showSuccess("Pasted from clipboard");
            try {
              UsageTracker.trackFeature("sql-in-clause", "paste", { len: text.length }, 1000);
            } catch (_) {}
          } else {
            this.showError("Clipboard is empty");
          }
        } catch (err) {
          this.showError("Failed to paste from clipboard");
          console.error("Paste error:", err);
        }
      });
    }

    const clearBtn = container.querySelector("#sqlInClearBtn");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        try {
          this.editor?.setValue("");
          this.updateOutput();
          this.showSuccess("Cleared editor");
          try {
            UsageTracker.trackFeature("sql-in-clause", "clear", "", 1000);
          } catch (_) {}
        } catch (err) {
          this.showError("Failed to clear editor");
          console.error("Clear error:", err);
        }
      });
    }

    this.toggleSelectDetails();
  }

  toggleSelectDetails() {
    const configRow = this.container.querySelector(".output-config");
    if (configRow) configRow.style.display = this.format === "select" ? "block" : "none";
  }

  updateOutput() {
    const raw = this.editor?.getValue() || "";
    const table = this.tableInput?.value || "";
    const column = this.columnInput?.value || "";
    const result = SQLInClauseService.format(raw, this.format, { table, column });

    const outputEl = this.container.querySelector("#sqlInOutput");
    if (outputEl) {
      outputEl.value = result;
    }

    const copyBtn = this.container.querySelector("#sqlInCopyBtn");
    if (copyBtn) {
      copyBtn.disabled = !result;
    }
  }
}

export { SQLInClauseTool };
