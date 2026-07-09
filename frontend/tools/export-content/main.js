import "./styles.css";
import { BaseTool } from "../../core/BaseTool.js";
import { UsageTracker } from "../../core/UsageTracker.js";
import { getIconSvg } from "./icon.js";
import { ExportContentService } from "./service.js";
import { EXPORT_CONTENT_TEMPLATE } from "./template.js";

const SNIPPETS_STORAGE_KEY = "export-content.query-snippets";

export class ExportContentTool extends BaseTool {
  constructor(eventBus) {
    super({
      id: "export-content",
      name: "Export Content",
      description: "Export HTML content from Oracle query results",
      icon: "export-content",
      category: "config",
      eventBus,
      isHeavyTool: true,
    });

    this.service = new ExportContentService();
    this.savedConnections = [];
    this.querySnippets = [];
    this.preview = null;
    this.exportItems = [];
    this.elements = {};
    this.isBusy = false;
  }

  getIconSvg() {
    return getIconSvg();
  }

  render() {
    return EXPORT_CONTENT_TEMPLATE;
  }

  onMount() {
    this.bindElements();
    this.loadSavedConnections();
    this.loadQuerySnippets();
    this.renderConnections();
    this.renderQuerySnippets();
    this.setupEventListeners();
    this.updateExportState();
    UsageTracker.trackEvent("export-content", "mount", {});
    void this.startOracleSidecar();
  }

  bindElements() {
    this.elements = {
      connection: document.getElementById("export-content-connection"),
      maxRows: document.getElementById("export-content-max-rows"),
      sql: document.getElementById("export-content-sql"),
      previewButton: document.getElementById("export-content-preview"),
      exportButton: document.getElementById("export-content-export"),
      status: document.getElementById("export-content-status"),
      snippetName: document.getElementById("export-content-snippet-name"),
      saveSnippetButton: document.getElementById("export-content-save-snippet"),
      snippetList: document.getElementById("export-content-snippet-list"),
      emptyPreview: document.getElementById("export-content-empty-preview"),
      config: document.getElementById("export-content-config"),
      summary: document.getElementById("export-content-preview-summary"),
      estimate: document.getElementById("export-content-estimate"),
      identifierColumns: document.getElementById("export-content-identifier-columns"),
      contentColumns: document.getElementById("export-content-content-columns"),
      previewTable: document.getElementById("export-content-preview-table"),
      htmlFile: document.getElementById("export-content-html-file"),
      htmlFrame: document.getElementById("export-content-html-frame"),
    };
  }

  setupEventListeners() {
    this.elements.previewButton?.addEventListener("click", () => {
      void this.previewQuery();
    });
    this.elements.exportButton?.addEventListener("click", () => {
      void this.exportZip();
    });
    this.elements.saveSnippetButton?.addEventListener("click", () => this.saveCurrentSnippet());
    this.elements.htmlFile?.addEventListener("change", () => this.renderSelectedHtmlPreview());
    this.elements.sql?.addEventListener("input", () => {
      this.preview = null;
      this.exportItems = [];
      if (this.elements.config) this.elements.config.style.display = "none";
      if (this.elements.emptyPreview) this.elements.emptyPreview.style.display = "block";
      this.updateExportState();
    });
    this.elements.connection?.addEventListener("change", () => {
      this.preview = null;
      this.exportItems = [];
      if (this.elements.config) this.elements.config.style.display = "none";
      if (this.elements.emptyPreview) this.elements.emptyPreview.style.display = "block";
      this.updateExportState();
    });
    this.elements.maxRows?.addEventListener("input", () => {
      this.preview = null;
      this.exportItems = [];
      if (this.elements.config) this.elements.config.style.display = "none";
      if (this.elements.emptyPreview) this.elements.emptyPreview.style.display = "block";
      this.updateExportState();
    });
  }

  loadSavedConnections() {
    try {
      this.savedConnections = JSON.parse(localStorage.getItem("config.oracle.connections") || "[]");
    } catch {
      this.savedConnections = [];
    }
  }

  loadQuerySnippets() {
    try {
      const snippets = JSON.parse(localStorage.getItem(SNIPPETS_STORAGE_KEY) || "[]");
      this.querySnippets = Array.isArray(snippets) ? snippets.filter((snippet) => snippet?.id && snippet?.name && snippet?.sql) : [];
    } catch {
      this.querySnippets = [];
    }
  }

  saveQuerySnippets() {
    localStorage.setItem(SNIPPETS_STORAGE_KEY, JSON.stringify(this.querySnippets));
  }

  renderQuerySnippets() {
    const container = this.elements.snippetList;
    if (!container) return;

    if (this.querySnippets.length === 0) {
      container.innerHTML = '<div class="export-content-snippet-empty">No saved snippets</div>';
      return;
    }

    container.innerHTML = this.querySnippets
      .map(
        (snippet) => `
          <div class="export-content-snippet" data-id="${this.escapeHtml(snippet.id)}">
            <button class="export-content-snippet-load" title="${this.escapeHtml(snippet.name)}">${this.escapeHtml(snippet.name)}</button>
            <button class="export-content-snippet-delete" title="Delete snippet">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
                <path d="M10 11v6"></path>
                <path d="M14 11v6"></path>
              </svg>
            </button>
          </div>
        `,
      )
      .join("");

    container.querySelectorAll(".export-content-snippet-load").forEach((button) => {
      button.addEventListener("click", () => this.loadSnippet(button.closest(".export-content-snippet")?.dataset.id));
    });
    container.querySelectorAll(".export-content-snippet-delete").forEach((button) => {
      button.addEventListener("click", () => this.deleteSnippet(button.closest(".export-content-snippet")?.dataset.id));
    });
  }

  saveCurrentSnippet() {
    try {
      const name = this.elements.snippetName?.value || "";
      const sql = this.elements.sql?.value || "";
      const existing = this.querySnippets.find((snippet) => snippet.name.toLowerCase() === name.trim().toLowerCase());
      const snippet = this.service.createSnippet({
        id: existing?.id,
        name,
        sql,
      });

      if (existing) {
        this.querySnippets = this.querySnippets.map((item) => (item.id === existing.id ? snippet : item));
      } else {
        this.querySnippets = [snippet, ...this.querySnippets];
      }

      this.saveQuerySnippets();
      this.renderQuerySnippets();
      this.showSuccess(`Saved snippet "${snippet.name}"`);
      UsageTracker.trackEvent("export-content", "snippet_saved", {});
    } catch (error) {
      this.showError(error.message || String(error));
    }
  }

  loadSnippet(id) {
    const snippet = this.querySnippets.find((item) => item.id === id);
    if (!snippet) return;

    if (this.elements.snippetName) this.elements.snippetName.value = snippet.name;
    if (this.elements.sql) this.elements.sql.value = snippet.sql;
    this.preview = null;
    this.exportItems = [];
    if (this.elements.config) this.elements.config.style.display = "none";
    if (this.elements.emptyPreview) this.elements.emptyPreview.style.display = "block";
    this.updateExportState();
    UsageTracker.trackEvent("export-content", "snippet_loaded", {});
  }

  deleteSnippet(id) {
    const snippet = this.querySnippets.find((item) => item.id === id);
    if (!snippet) return;

    this.querySnippets = this.querySnippets.filter((item) => item.id !== id);
    this.saveQuerySnippets();
    this.renderQuerySnippets();
    this.showSuccess(`Deleted snippet "${snippet.name}"`);
    UsageTracker.trackEvent("export-content", "snippet_deleted", {});
  }

  renderConnections() {
    const select = this.elements.connection;
    if (!select) return;

    if (this.savedConnections.length === 0) {
      select.innerHTML = '<option value="">No Oracle connections saved</option>';
      select.disabled = true;
      return;
    }

    select.disabled = false;
    select.innerHTML = [
      '<option value="">Select connection...</option>',
      ...this.savedConnections.map(
        (connection) => `<option value="${this.escapeHtml(connection.name)}">${this.escapeHtml(connection.name)}</option>`,
      ),
    ].join("");
  }

  getSelectedConnection() {
    const name = this.elements.connection?.value || "";
    return this.savedConnections.find((connection) => connection.name === name) || null;
  }

  getMaxRows() {
    const value = parseInt(this.elements.maxRows?.value || "500", 10);
    return Number.isFinite(value) ? Math.min(Math.max(value, 1), 10000) : 500;
  }

  async startOracleSidecar() {
    if (this.elements.status) this.elements.status.textContent = "Starting Oracle sidecar...";
    try {
      const started = await this.service.ensureSidecarStarted();
      if (this.elements.status) this.elements.status.textContent = started ? "Oracle sidecar ready" : "Oracle sidecar unavailable";
      UsageTracker.trackEvent("export-content", started ? "sidecar_ready" : "sidecar_unavailable", {});
    } catch (error) {
      console.warn("Export Content sidecar startup failed:", error);
      if (this.elements.status) this.elements.status.textContent = "Oracle sidecar unavailable";
      UsageTracker.trackEvent("export-content", "sidecar_error", UsageTracker.enrichErrorMeta(error, {}));
    }
  }

  async previewQuery() {
    const connection = this.getSelectedConnection();
    const sql = this.elements.sql?.value || "";
    const maxRows = this.getMaxRows();

    this.setBusy(true, "Querying...");
    try {
      this.preview = await this.service.previewQuery({ connection, sql, maxRows });
      this.renderPreview();
      this.showSuccess(`Loaded ${this.preview.rows.length} row${this.preview.rows.length === 1 ? "" : "s"}`);
      UsageTracker.trackEvent("export-content", "preview_success", {
        connection: connection?.name || "",
        columns: this.preview.columns.length,
        rows: this.preview.rows.length,
      });
    } catch (error) {
      console.error("Export Content preview failed:", error);
      this.preview = null;
      if (this.elements.config) this.elements.config.style.display = "none";
      this.showError(error.message || String(error));
      UsageTracker.trackEvent("export-content", "preview_error", UsageTracker.enrichErrorMeta(error, {}));
    } finally {
      this.setBusy(false, "Ready");
      this.updateExportState();
    }
  }

  renderPreview() {
    if (!this.preview) return;
    const { columns, rows, executionTimeMs } = this.preview;
    const contentColumns = this.service.detectContentColumns(columns);
    const identifierColumns = this.service.detectIdentifierColumns(columns, contentColumns);

    if (this.elements.config) this.elements.config.style.display = "block";
    if (this.elements.emptyPreview) this.elements.emptyPreview.style.display = "none";
    if (this.elements.summary) {
      this.elements.summary.textContent =
        `${this.preview.sourceName}: ${rows.length} row${rows.length === 1 ? "" : "s"}, ${columns.length} columns, ${executionTimeMs} ms`;
    }

    this.renderColumnChecks(this.elements.identifierColumns, "identifier", columns, identifierColumns);
    this.renderColumnChecks(this.elements.contentColumns, "content", columns, contentColumns);
    this.renderPreviewTable(columns, rows.slice(0, 10));
    this.renderExportPreview();
    this.updateExportState();
  }

  renderColumnChecks(container, groupName, columns, selectedColumns) {
    if (!container) return;
    const selected = new Set(selectedColumns);
    container.innerHTML = columns
      .map(
        (column) => `
          <label class="export-content-check">
            <input
              type="checkbox"
              name="export-content-${groupName}"
              value="${this.escapeHtml(column)}"
              ${selected.has(column) ? "checked" : ""}
            >
            <span>${this.escapeHtml(column)}</span>
          </label>
        `,
      )
      .join("");

    container.querySelectorAll("input").forEach((input) => {
      input.addEventListener("change", () => {
        this.renderExportPreview();
        this.updateExportState();
      });
    });
  }

  renderPreviewTable(columns, rows) {
    if (!this.elements.previewTable) return;
    if (!rows.length) {
      this.elements.previewTable.innerHTML = '<div class="form-hint" style="padding: 0.75rem;">No rows returned.</div>';
      return;
    }

    this.elements.previewTable.innerHTML = `
      <table>
        <thead>
          <tr>${columns.map((column) => `<th title="${this.escapeHtml(column)}">${this.escapeHtml(column)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  ${columns
                    .map((column) => {
                      const displayValue = this.formatPreviewValue(row[column]);
                      return `<td title="${this.escapeHtml(displayValue)}">${this.escapeHtml(displayValue)}</td>`;
                    })
                    .join("")}
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  formatPreviewValue(value) {
    if (this.service.isOracleBlobValue(value)) {
      return `[BLOB ${value.byte_length ?? 0} bytes]`;
    }
    return value;
  }

  getCheckedColumns(groupName) {
    return Array.from(document.querySelectorAll(`input[name="export-content-${groupName}"]:checked`)).map((input) => input.value);
  }

  buildCurrentExportItems() {
    if (!this.preview) return { items: [], skippedEmpty: 0 };
    return this.service.buildExportItems({
      rows: this.preview.rows,
      identifierColumns: this.getCheckedColumns("identifier"),
      contentColumns: this.getCheckedColumns("content"),
      timestamp: this.service.formatTimestamp(),
    });
  }

  renderExportPreview() {
    const { items } = this.buildCurrentExportItems();
    this.exportItems = items;
    this.renderHtmlFileOptions();
    this.renderSelectedHtmlPreview();
  }

  renderHtmlFileOptions() {
    if (!this.elements.htmlFile) return;

    if (this.exportItems.length === 0) {
      this.elements.htmlFile.innerHTML = '<option value="">No HTML files</option>';
      this.elements.htmlFile.disabled = true;
      return;
    }

    const selected = this.elements.htmlFile.value;
    this.elements.htmlFile.disabled = false;
    this.elements.htmlFile.innerHTML = this.exportItems
      .map((item, index) => `<option value="${index}">${this.escapeHtml(item.filename)}</option>`)
      .join("");

    if (selected && Number(selected) < this.exportItems.length) {
      this.elements.htmlFile.value = selected;
    }
  }

  renderSelectedHtmlPreview() {
    if (!this.elements.htmlFrame) return;

    const index = parseInt(this.elements.htmlFile?.value || "0", 10);
    const item = this.exportItems[index];
    if (!item) {
      this.elements.htmlFrame.srcdoc = "";
      return;
    }

    this.elements.htmlFrame.srcdoc = this.service.contentToPreviewText(item.content, item.contentType);
  }

  updateExportState() {
    const hasPreview = !!this.preview;
    const identifierColumns = this.getCheckedColumns("identifier");
    const contentColumns = this.getCheckedColumns("content");
    const canExport = hasPreview && identifierColumns.length > 0 && contentColumns.length > 0 && !this.isBusy;
    if (this.elements.exportButton) this.elements.exportButton.disabled = !canExport;

    if (this.elements.estimate && hasPreview) {
      const { items, skippedEmpty } = this.buildCurrentExportItems();
      const fileLabel = `${items.length} file${items.length === 1 ? "" : "s"}`;
      this.elements.estimate.textContent = `${fileLabel}${skippedEmpty ? `, ${skippedEmpty} skipped` : ""}`;
    }
  }

  async exportZip() {
    const timestamp = this.service.formatTimestamp();
    const { items, skippedEmpty } = this.service.buildExportItems({
      rows: this.preview?.rows || [],
      identifierColumns: this.getCheckedColumns("identifier"),
      contentColumns: this.getCheckedColumns("content"),
      timestamp,
    });

    if (items.length === 0) {
      this.showError("No non-empty HTML content found for the selected columns.");
      return;
    }

    this.setBusy(true, "Building zip...");
    try {
      const blob = await this.service.buildZipBlob(items);
      const zipName = this.service.buildZipFilename({ sourceName: this.preview?.sourceName, timestamp });
      this.downloadBlob(blob, zipName);
      this.showSuccess(`Downloaded ${items.length} HTML file${items.length === 1 ? "" : "s"} as ${zipName}`);
      UsageTracker.trackEvent("export-content", "export_success", {
        source: this.preview?.sourceName || "",
        file_count: items.length,
        skipped_empty: skippedEmpty,
        zip_size: blob.size,
      });
    } catch (error) {
      console.error("Export Content zip failed:", error);
      this.showError(`Export failed: ${error.message || error}`);
      UsageTracker.trackEvent("export-content", "export_error", UsageTracker.enrichErrorMeta(error, {}));
    } finally {
      this.setBusy(false, "Ready");
      this.updateExportState();
    }
  }

  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  setBusy(isBusy, status) {
    this.isBusy = isBusy;
    if (this.elements.previewButton) this.elements.previewButton.disabled = isBusy;
    if (this.elements.status) this.elements.status.textContent = status;
    this.updateExportState();
  }

  escapeHtml(value) {
    if (value === null || value === undefined) return "";
    const div = document.createElement("div");
    div.textContent = String(value);
    return div.innerHTML;
  }
}
