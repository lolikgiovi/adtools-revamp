import "./styles.css";
import { BaseTool } from "../../core/BaseTool.js";
import { createOracleEditor, ensureMonacoWorkers, setupMonacoOracle } from "../../core/MonacoOracle.js";
import { isTauri } from "../../core/Runtime.js";
import { UsageTracker } from "../../core/UsageTracker.js";
import { getIconSvg } from "./icon.js";
import { QuerifyService } from "./service.js";
import { QUERIFY_TEMPLATE } from "./template.js";

export class QuerifyTool extends BaseTool {
  constructor(eventBus) {
    super({
      id: "querify",
      name: "Querify",
      description: "Generate SQL in bulk from Excel files using Quick Query schemas",
      icon: "querify",
      category: "config",
      eventBus,
      isHeavyTool: true,
    });

    this.service = new QuerifyService();
    this.files = [];
    this.activeFileId = null;
    this.activeView = "selected";
    this.editor = null;
    this.elements = {};
    this.isGenerating = false;
  }

  getIconSvg() {
    return getIconSvg();
  }

  render() {
    return QUERIFY_TEMPLATE;
  }

  onMount() {
    ensureMonacoWorkers();
    setupMonacoOracle();
    this.bindElements();
    this.initializeEditor();
    this.setupEventListeners();
    this.renderFiles();
    this.refreshEditor();
    this.trackEvent("mount");
  }

  onUnmount() {
    this.editor?.dispose?.();
    this.editor = null;
    this.service.dispose();
  }

  onWarmResume() {
    this.editor?.layout?.();
  }

  disposeHeavyResources() {
    this.onUnmount();
  }

  hasActiveBackgroundWork() {
    return this.isGenerating;
  }

  bindElements() {
    this.elements = {
      addFilesButton: document.getElementById("querify-add-files"),
      clearFilesButton: document.getElementById("querify-clear-files"),
      fileInput: document.getElementById("querify-file-input"),
      fileList: document.getElementById("querify-file-list"),
      generateButton: document.getElementById("querify-generate"),
      queryType: document.getElementById("querify-query-type"),
      copyButton: document.getElementById("querify-copy"),
      downloadButton: document.getElementById("querify-download"),
      message: document.getElementById("querify-message"),
      tabs: Array.from(document.querySelectorAll(".querify-tab")),
      editor: document.getElementById("querify-editor"),
    };
  }

  initializeEditor() {
    if (!this.elements.editor) return;
    this.editor = createOracleEditor(this.elements.editor, {
      fontSize: 13,
      lineNumbers: "on",
      scrollBeyondLastLine: false,
      wordWrap: "on",
      automaticLayout: true,
      readOnly: false,
      padding: { top: 12, bottom: 12 },
    });
  }

  setupEventListeners() {
    this.elements.addFilesButton?.addEventListener("click", () => {
      void this.handleAddFilesClick();
    });
    this.elements.fileInput?.addEventListener("change", (event) => {
      this.addFiles(Array.from(event.target.files || []));
      event.target.value = "";
    });
    this.elements.clearFilesButton?.addEventListener("click", () => this.clearFiles());
    this.elements.generateButton?.addEventListener("click", () => {
      void this.generateAll();
    });
    this.elements.queryType?.addEventListener("change", () => {
      this.files = this.files.map((item) => (item.status === "success" ? { ...item, status: "pending", sql: "", warning: "" } : item));
      this.renderFiles();
      this.refreshEditor();
    });
    this.elements.copyButton?.addEventListener("click", (event) => {
      void this.copyCurrentSql(event.currentTarget);
    });
    this.elements.downloadButton?.addEventListener("click", () => this.downloadCurrentSql());

    this.elements.tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        this.activeView = tab.dataset.view || "selected";
        this.updateTabs();
        this.refreshEditor();
      });
    });

    if (!isTauri()) {
      const dropTarget = this.container?.querySelector(".querify-sidebar");
      dropTarget?.addEventListener("dragover", (event) => {
        event.preventDefault();
        dropTarget.classList.add("drag-over");
      });
      dropTarget?.addEventListener("dragleave", () => dropTarget.classList.remove("drag-over"));
      dropTarget?.addEventListener("drop", (event) => {
        event.preventDefault();
        dropTarget.classList.remove("drag-over");
        this.addFiles(Array.from(event.dataTransfer?.files || []));
      });
    }
  }

  async handleAddFilesClick() {
    if (isTauri()) {
      await this.handleAddFilesTauri();
      return;
    }

    this.elements.fileInput?.click();
  }

  async handleAddFilesTauri() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { readFile } = await import("@tauri-apps/plugin-fs");

      const selected = await open({
        multiple: true,
        title: "Select Querify Excel Files",
        filters: [{ name: "Excel Files", extensions: ["xlsx", "xls"] }],
      });

      if (!selected || (Array.isArray(selected) && selected.length === 0)) {
        return;
      }

      const paths = Array.isArray(selected) ? selected : [selected];
      const files = [];

      for (const selectedPath of paths) {
        const filePath = typeof selectedPath === "string" ? selectedPath : selectedPath?.path;
        if (!filePath) continue;

        const fileName = this.getFileNameFromPath(filePath);
        if (!this.isExcelFile(fileName)) {
          files.push({ name: fileName, path: filePath });
          continue;
        }

        const uint8Array = await readFile(filePath);
        files.push({ name: fileName, path: filePath, uint8Array });
      }

      this.addFiles(files);
    } catch (error) {
      console.error("Failed to select Querify files (Tauri):", error);
      this.setMessage(`Failed to select files: ${error.message || String(error)}`, "error");
    }
  }

  addFiles(fileList) {
    const newItems = fileList.map((file) => {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      try {
        const parsed = this.service.parseExcelFileName(file.name);
        return {
          id,
          file,
          fileName: file.name,
          tableName: parsed.requestedFullName,
          status: "pending",
          error: "",
          warning: "",
          sql: "",
          rowCount: 0,
        };
      } catch (error) {
        return {
          id,
          file,
          fileName: file.name,
          tableName: "",
          status: "failed",
          error: error.message,
          warning: "",
          sql: "",
          rowCount: 0,
        };
      }
    });

    this.files.push(...newItems);
    if (!this.activeFileId && this.files.length > 0) {
      this.activeFileId = this.files[0].id;
    }

    this.renderFiles();
    this.refreshEditor();
  }

  clearFiles() {
    if (this.isGenerating) return;
    this.files = [];
    this.activeFileId = null;
    this.renderFiles();
    this.refreshEditor();
    this.setMessage("");
  }

  async generateAll() {
    if (this.isGenerating || this.files.length === 0) return;

    this.isGenerating = true;
    this.updateControls();
    this.setMessage("Generating...");
    const queryType = this.elements.queryType?.value || "merge";

    try {
      const schemaLookup = await this.service.buildSchemaLookup();

      for (const item of this.files) {
        if (item.status === "failed" && !this.isExcelFile(item.fileName)) continue;
        this.updateFile(item.id, { status: "generating", error: "", warning: "", sql: "", rowCount: 0 });

        try {
          const result = await this.service.generateFile(item.file, queryType, {
            schemaLookup,
            onProgress: (_percent, message) => {
              this.updateFile(item.id, { status: "generating", progress: message || "Generating..." });
            },
          });
          const warning = result.duplicateResult?.hasDuplicates ? result.duplicateResult.warningMessage?.summary || "Duplicate primary keys detected" : "";

          this.updateFile(item.id, {
            status: "success",
            tableName: result.tableName,
            sql: result.sql,
            rowCount: result.rowCount,
            warning,
            error: "",
            progress: "",
          });
        } catch (error) {
          this.updateFile(item.id, {
            status: "failed",
            error: error.message || String(error),
            warning: "",
            sql: "",
            progress: "",
          });
        }
      }

      const successCount = this.files.filter((item) => item.status === "success").length;
      const failedCount = this.files.filter((item) => item.status === "failed").length;
      this.setMessage(`${successCount} generated${failedCount ? `, ${failedCount} failed` : ""}.`, failedCount ? "warning" : "success");
      this.trackEvent("generated", {
        file_count: this.files.length,
        success_count: successCount,
        failed_count: failedCount,
        query_type: queryType,
      });
    } catch (error) {
      this.setMessage(error.message || String(error), "error");
    } finally {
      this.isGenerating = false;
      this.updateControls();
      this.refreshEditor();
    }
  }

  updateFile(id, patch) {
    this.files = this.files.map((item) => (item.id === id ? { ...item, ...patch } : item));
    this.renderFiles();
    if (this.activeFileId === id || this.activeView === "combined") {
      this.refreshEditor();
    }
  }

  renderFiles() {
    if (!this.elements.fileList) return;

    if (this.files.length === 0) {
      this.elements.fileList.innerHTML = `<div class="querify-empty" id="querify-empty-state">No files added</div>`;
      this.updateControls();
      return;
    }

    this.elements.fileList.innerHTML = this.files.map((item) => this.renderFileItem(item)).join("");
    this.elements.fileList.querySelectorAll(".querify-file-item").forEach((button) => {
      button.addEventListener("click", () => {
        this.activeFileId = button.dataset.fileId;
        this.activeView = "selected";
        this.renderFiles();
        this.updateTabs();
        this.refreshEditor();
      });
    });

    this.updateControls();
  }

  renderFileItem(item) {
    const active = item.id === this.activeFileId ? "active" : "";
    const statusLabel = this.getStatusLabel(item);
    const tableName = item.tableName ? `<span class="querify-file-table">${this.escapeHtml(item.tableName)}</span>` : "";

    return /* html */ `
      <button class="querify-file-item ${active}" data-file-id="${this.escapeHtml(item.id)}">
        <span class="querify-file-main">
          <span class="querify-file-name">${this.escapeHtml(item.fileName)}</span>
          ${tableName}
        </span>
        <span class="querify-file-status status-${this.escapeHtml(item.status)}">${this.escapeHtml(statusLabel)}</span>
      </button>
    `;
  }

  getStatusLabel(item) {
    if (item.status === "generating") return "Running";
    if (item.status === "success") return item.warning ? "Warning" : "Ready";
    if (item.status === "failed") return "Failed";
    return "Pending";
  }

  refreshEditor() {
    const sql = this.getCurrentSql();
    this.editor?.setValue(sql);
    this.updateControls();

    if (this.activeView === "selected") {
      const active = this.getActiveFile();
      if (active?.status === "failed") {
        this.setMessage(active.error, "error");
      } else if (active?.warning) {
        this.setMessage(active.warning, "warning");
      } else if (!active) {
        this.setMessage("");
      } else if (active.status === "success") {
        this.setMessage(`${active.rowCount.toLocaleString()} rows generated for ${active.tableName}.`, "success");
      }
    } else {
      const count = this.files.filter((item) => item.status === "success").length;
      this.setMessage(count ? `${count} files in combined SQL.` : "", count ? "success" : "");
    }
  }

  getCurrentSql() {
    if (this.activeView === "combined") {
      return this.service.buildCombinedSql(this.files);
    }
    return this.getActiveFile()?.sql || "";
  }

  getActiveFile() {
    return this.files.find((item) => item.id === this.activeFileId) || null;
  }

  updateControls() {
    const hasFiles = this.files.length > 0;
    const hasSql = Boolean(this.getCurrentSql());
    if (this.elements.clearFilesButton) this.elements.clearFilesButton.disabled = !hasFiles || this.isGenerating;
    if (this.elements.generateButton) this.elements.generateButton.disabled = !hasFiles || this.isGenerating;
    if (this.elements.copyButton) this.elements.copyButton.disabled = !hasSql;
    if (this.elements.downloadButton) this.elements.downloadButton.disabled = !hasSql;
    if (this.elements.queryType) this.elements.queryType.disabled = this.isGenerating;
  }

  updateTabs() {
    this.elements.tabs.forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.view === this.activeView);
    });
  }

  setMessage(message, type = "") {
    if (!this.elements.message) return;
    this.elements.message.textContent = message || "";
    this.elements.message.className = `querify-message ${type ? `message-${type}` : ""}`.trim();
  }

  async copyCurrentSql(targetEl) {
    const sql = this.getCurrentSql();
    if (!sql) return;
    await this.copyToClipboard(sql, targetEl);
  }

  downloadCurrentSql() {
    const sql = this.getCurrentSql();
    if (!sql) return;

    const active = this.getActiveFile();
    const baseName =
      this.activeView === "combined"
        ? "QUERIFY_COMBINED"
        : (active?.tableName || active?.fileName || "QUERIFY").replace(/\.(xlsx|xls)$/i, "");
    const safeName = baseName.replace(/[^a-z0-9_.-]/gi, "_").toUpperCase();

    const blob = new Blob([sql], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeName}.sql`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  isExcelFile(fileName) {
    return /\.(xlsx|xls)$/i.test(fileName || "");
  }

  getFileNameFromPath(filePath) {
    return String(filePath || "")
      .split(/[/\\]/)
      .filter(Boolean)
      .pop();
  }

  escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  trackEvent(event, meta = {}) {
    try {
      UsageTracker.trackEvent("querify", event, meta);
    } catch (_) {}
  }
}
