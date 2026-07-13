import "./styles.css";
import { BaseTool } from "../../core/BaseTool.js";
import { UsageTracker } from "../../core/UsageTracker.js";
import { getIconSvg } from "./icon.js";
import { ExportContentService } from "./service.js";
import { ExportContentComparisonService } from "./comparison-service.js";
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
    this.comparisonService = new ExportContentComparisonService();
    this.savedConnections = [];
    this.querySnippets = [];
    this.preview = null;
    this.exportItems = [];
    this.elements = {};
    this.isBusy = false;
    this.isQueryCollapsed = false;
    this.activeFileIndex = -1;
    this.previewMode = "text";
    this.fileSearch = "";
    this.lastQuerySummary = null;
    this.lastExportBuild = { items: [], skippedEmpty: 0 };
    this.candidate = null;
    this.excelWorkbook = null;
    this.candidateInputTimer = null;
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
      previewButtonLabel: document.getElementById("export-content-preview-label"),
      runAgainButton: document.getElementById("export-content-run-again"),
      exportButton: document.getElementById("export-content-export"),
      manifestButton: document.getElementById("export-content-download-manifest"),
      status: document.getElementById("export-content-status"),
      snippetName: document.getElementById("export-content-snippet-name"),
      saveSnippetButton: document.getElementById("export-content-save-snippet"),
      snippetList: document.getElementById("export-content-snippet-list"),
      queryPanel: document.getElementById("export-content-query-panel"),
      queryExpanded: document.getElementById("export-content-query-expanded"),
      queryCollapsed: document.getElementById("export-content-query-collapsed"),
      collapseQueryButton: document.getElementById("export-content-collapse-query"),
      expandQueryButton: document.getElementById("export-content-expand-query"),
      querySummary: document.getElementById("export-content-query-summary"),
      queryError: document.getElementById("export-content-query-error"),
      estimate: document.getElementById("export-content-estimate"),
      identifierSelect: document.getElementById("export-content-identifier-select"),
      contentSelect: document.getElementById("export-content-content-select"),
      filesTitle: document.getElementById("export-content-files-title"),
      fileSearch: document.getElementById("export-content-file-search"),
      fileList: document.getElementById("export-content-file-list"),
      htmlFile: document.getElementById("export-content-html-file"),
      htmlFrame: document.getElementById("export-content-html-frame"),
      candidateFrame: document.getElementById("export-content-candidate-frame"),
      previewEmpty: document.getElementById("export-content-preview-empty"),
      previewSurface: document.getElementById("export-content-preview-surface"),
      renderedTab: document.getElementById("export-content-rendered-tab"),
      textDiffTab: document.getElementById("export-content-text-diff-tab"),
      sourceDiffTab: document.getElementById("export-content-source-diff-tab"),
      diffView: document.getElementById("export-content-diff-view"),
      renderedComparison: document.getElementById("export-content-rendered-comparison"),
      compareSummary: document.getElementById("export-content-compare-summary"),
      normalizeWhitespace: document.getElementById("export-content-normalize-whitespace"),
      candidateEditor: document.getElementById("export-content-candidate-editor"),
      candidateLabel: document.getElementById("export-content-candidate-label"),
      uploadMarkupButton: document.getElementById("export-content-upload-markup"),
      uploadExcelButton: document.getElementById("export-content-upload-excel"),
      clearCandidateButton: document.getElementById("export-content-clear-candidate"),
      markupFile: document.getElementById("export-content-markup-file"),
      excelFile: document.getElementById("export-content-excel-file"),
      excelMapping: document.getElementById("export-content-excel-mapping"),
      excelSheet: document.getElementById("export-content-excel-sheet"),
      excelRow: document.getElementById("export-content-excel-row"),
      excelColumn: document.getElementById("export-content-excel-column"),
    };
  }

  setupEventListeners() {
    this.elements.previewButton?.addEventListener("click", () => {
      void this.previewQuery();
    });
    this.elements.exportButton?.addEventListener("click", () => {
      void this.exportZip();
    });
    this.elements.manifestButton?.addEventListener("click", () => this.downloadManifest());
    this.elements.runAgainButton?.addEventListener("click", () => {
      void this.previewQuery();
    });
    this.elements.collapseQueryButton?.addEventListener("click", () => this.setQueryCollapsed(true));
    this.elements.expandQueryButton?.addEventListener("click", () => this.setQueryCollapsed(false));
    this.elements.saveSnippetButton?.addEventListener("click", () => this.saveCurrentSnippet());
    this.elements.htmlFile?.addEventListener("change", () => {
      this.renderSelectedHtmlPreview();
      this.renderGeneratedFiles();
    });
    this.elements.identifierSelect?.addEventListener("change", () => this.renderExportPreview());
    this.elements.fileSearch?.addEventListener("input", () => {
      this.fileSearch = this.elements.fileSearch.value || "";
      this.renderGeneratedFiles();
    });
    this.elements.textDiffTab?.addEventListener("click", () => this.setPreviewMode("text"));
    this.elements.sourceDiffTab?.addEventListener("click", () => this.setPreviewMode("source"));
    this.elements.renderedTab?.addEventListener("click", () => this.setPreviewMode("rendered"));
    this.elements.normalizeWhitespace?.addEventListener("change", () => this.renderComparison());
    this.elements.uploadMarkupButton?.addEventListener("click", () => this.elements.markupFile?.click());
    this.elements.uploadExcelButton?.addEventListener("click", () => this.elements.excelFile?.click());
    this.elements.clearCandidateButton?.addEventListener("click", () => this.clearCandidate());
    this.elements.markupFile?.addEventListener("change", () => void this.importMarkupCandidate());
    this.elements.excelFile?.addEventListener("change", () => void this.importExcelCandidate());
    this.elements.excelSheet?.addEventListener("change", () => this.renderExcelMapping({ suggest: true }));
    this.elements.excelRow?.addEventListener("change", () => this.applyExcelCandidate());
    this.elements.excelColumn?.addEventListener("change", () => this.applyExcelCandidate());
    this.elements.candidateEditor?.addEventListener("input", () => {
      clearTimeout(this.candidateInputTimer);
      this.candidateInputTimer = setTimeout(() => this.applyPastedCandidate(), 120);
    });
    this.elements.sql?.addEventListener("input", () => {
      this.resetPreviewState();
    });
    this.elements.connection?.addEventListener("change", () => {
      this.resetPreviewState();
    });
    this.elements.maxRows?.addEventListener("input", () => {
      this.resetPreviewState();
    });
  }

  resetPreviewState() {
    this.preview = null;
    this.exportItems = [];
    this.activeFileIndex = -1;
    this.lastQuerySummary = null;
    this.lastExportBuild = { items: [], skippedEmpty: 0 };
    this.clearCandidate({ keepEditor: false, render: false });
    this.clearQueryError();
    this.setQueryCollapsed(false);
    this.renderExportConfiguration();
    this.renderGeneratedFiles();
    this.renderHtmlFileOptions();
    this.renderPreviewEmpty(
      "Run a query to select the Oracle baseline.",
      "Then paste content or import an HTML/XML/XHTML or Excel candidate to compare.",
    );
    this.updateExportState();
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
    this.resetPreviewState();
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
      this.exportItems = [];
      this.activeFileIndex = -1;
      this.lastExportBuild = { items: [], skippedEmpty: 0 };
      this.renderExportConfiguration();
      this.renderGeneratedFiles();
      this.renderHtmlFileOptions();
      this.showQueryError(error.message || String(error));
      this.renderPreviewEmpty("Preview unavailable", "Preview will be available once the query succeeds.", true);
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

    this.clearQueryError();
    this.lastQuerySummary = {
      environment: this.getSelectedConnection()?.name || "-",
      savedQuery: this.elements.snippetName?.value?.trim() || "Ad hoc query",
      rows: rows.length,
      columns: columns.length,
      executionTimeMs,
    };
    if (this.elements.querySummary) this.elements.querySummary.textContent = this.formatQuerySummary();

    this.renderExportConfiguration({ identifierColumns, contentColumns });
    this.renderExportPreview();
    this.updateExportState();
  }

  formatPreviewValue(value) {
    if (this.service.isOracleBlobValue(value)) {
      return `[BLOB ${value.byte_length ?? 0} bytes]`;
    }
    return value;
  }

  getCheckedColumns(groupName) {
    if (groupName === "identifier") {
      return this.elements.identifierSelect?.value ? [this.elements.identifierSelect.value] : [];
    }
    if (groupName === "content") {
      return Array.from(document.querySelectorAll('input[name="export-content-content"]:checked')).map((input) => input.value);
    }
    return [];
  }

  renderExportConfiguration(defaults = {}) {
    const columns = this.preview?.columns || [];
    const hasPreview = !!this.preview;
    const identifierDefaults = defaults.identifierColumns || [];
    const contentDefaults = defaults.contentColumns || [];

    if (this.elements.identifierSelect) {
      this.elements.identifierSelect.disabled = !hasPreview;
      if (!hasPreview) {
        this.elements.identifierSelect.innerHTML = '<option value="">Run a query to configure</option>';
      } else {
        const current = this.elements.identifierSelect.value || identifierDefaults[0] || "";
        this.elements.identifierSelect.innerHTML = columns
          .map((column) => `<option value="${this.escapeHtml(column)}">${this.escapeHtml(column)}</option>`)
          .join("");
        this.elements.identifierSelect.value = columns.includes(current) ? current : identifierDefaults[0] || columns[0] || "";
      }
    }

    if (this.elements.contentSelect) {
      this.elements.contentSelect.classList.toggle("export-content-disabled", !hasPreview);
      if (!hasPreview) {
        this.elements.contentSelect.innerHTML = "<span>Run a query to configure</span>";
      } else {
        const selected = new Set(contentDefaults.length ? contentDefaults : this.getCheckedColumns("content"));
        this.elements.contentSelect.innerHTML = columns
          .map(
            (column) => `
              <label class="export-content-content-chip">
                <input type="checkbox" name="export-content-content" value="${this.escapeHtml(column)}" ${selected.has(column) ? "checked" : ""}>
                <span>${this.escapeHtml(column)}</span>
              </label>
            `,
          )
          .join("");
        this.elements.contentSelect.querySelectorAll("input").forEach((input) => {
          input.addEventListener("change", () => this.renderExportPreview());
        });
      }
    }
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
    const previousFilename =
      this.exportItems[this.activeFileIndex]?.filename || this.elements.htmlFile?.selectedOptions?.[0]?.textContent || "";
    const { items, skippedEmpty } = this.buildCurrentExportItems();
    this.exportItems = items;
    this.lastExportBuild = { items, skippedEmpty };
    this.activeFileIndex = items.findIndex((item) => item.filename === previousFilename);
    if (this.activeFileIndex < 0) this.activeFileIndex = items.length ? 0 : -1;
    this.renderGeneratedFiles();
    this.renderHtmlFileOptions();
    this.renderSelectedHtmlPreview();
    this.updateExportState();
  }

  renderHtmlFileOptions() {
    if (!this.elements.htmlFile) return;

    if (this.exportItems.length === 0) {
      this.elements.htmlFile.innerHTML = '<option value="">-</option>';
      this.elements.htmlFile.disabled = true;
      return;
    }

    this.elements.htmlFile.disabled = false;
    this.elements.htmlFile.innerHTML = this.exportItems
      .map((item, index) => `<option value="${index}">${this.escapeHtml(item.filename)}</option>`)
      .join("");
    this.elements.htmlFile.value = String(Math.max(this.activeFileIndex, 0));
  }

  renderGeneratedFiles() {
    if (this.elements.filesTitle) {
      this.elements.filesTitle.textContent = this.exportItems.length ? `Generated Files (${this.exportItems.length})` : "Generated Files";
    }
    if (this.elements.fileSearch) this.elements.fileSearch.disabled = this.exportItems.length === 0;
    if (!this.elements.fileList) return;

    if (!this.preview) {
      this.elements.fileList.className = "export-content-file-list export-content-file-list-empty";
      this.elements.fileList.innerHTML = '<div class="export-content-file-empty">Run a query to configure export and generate files.</div>';
      return;
    }

    if (this.exportItems.length === 0) {
      this.elements.fileList.className = "export-content-file-list export-content-file-list-empty";
      this.elements.fileList.innerHTML = '<div class="export-content-file-empty">No non-empty HTML files for the selected columns.</div>';
      return;
    }

    const search = this.fileSearch.trim().toLowerCase();
    const visibleItems = this.exportItems
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !search || item.filename.toLowerCase().includes(search));

    this.elements.fileList.className = "export-content-file-list";
    this.elements.fileList.innerHTML =
      visibleItems
        .map(
          ({ item, index }) => `
            <button class="export-content-file-row ${index === this.activeFileIndex ? "is-active" : ""}" type="button" data-index="${index}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <path d="M14 2v6h6"></path>
              </svg>
              <span title="${this.escapeHtml(item.filename)}">${this.escapeHtml(item.filename)}</span>
              ${index === this.activeFileIndex ? '<span class="export-content-file-check">✓</span>' : ""}
            </button>
          `,
        )
        .join("") || '<div class="export-content-file-empty">No files match the search.</div>';

    this.elements.fileList.querySelectorAll(".export-content-file-row").forEach((button) => {
      button.addEventListener("click", () => {
        this.activeFileIndex = parseInt(button.dataset.index || "0", 10);
        this.renderGeneratedFiles();
        this.renderHtmlFileOptions();
        this.renderSelectedHtmlPreview();
      });
    });
  }

  renderSelectedHtmlPreview() {
    if (!this.elements.htmlFrame) return;

    const index = parseInt(this.elements.htmlFile?.value || String(this.activeFileIndex), 10);
    if (Number.isFinite(index)) this.activeFileIndex = index;
    const item = this.exportItems[index];
    if (!item) {
      if (this.preview) {
        this.renderPreviewEmpty(
          "Select Oracle content to compare.",
          "Choose a generated file from the list, then add a candidate.",
        );
      }
      return;
    }

    if (this.excelWorkbook) this.renderExcelMapping({ suggest: true });
    this.renderComparison();
  }

  getActiveOracleContent() {
    const item = this.exportItems[this.activeFileIndex];
    if (!item) return null;
    return {
      item,
      content: this.service.contentToPreviewText(item.content, item.contentType),
      identifierColumn: this.getCheckedColumns("identifier")[0] || "",
      identifierValue: item.identifierValues?.[0] ?? "",
    };
  }

  async importMarkupCandidate() {
    const file = this.elements.markupFile?.files?.[0];
    if (!file) return;
    try {
      const candidate = await this.comparisonService.readMarkupFile(file);
      this.excelWorkbook = null;
      if (this.elements.excelMapping) this.elements.excelMapping.hidden = true;
      this.setCandidate({ ...candidate, source: "file" });
      UsageTracker.trackEvent("export-content", "candidate_imported", { source: "markup_file" });
    } catch (error) {
      this.showError(error.message || String(error));
    } finally {
      this.elements.markupFile.value = "";
    }
  }

  async importExcelCandidate() {
    const file = this.elements.excelFile?.files?.[0];
    if (!file) return;
    try {
      this.excelWorkbook = await this.comparisonService.parseExcelFile(file);
      if (this.elements.excelMapping) this.elements.excelMapping.hidden = false;
      if (this.elements.excelSheet) {
        this.elements.excelSheet.innerHTML = this.excelWorkbook.sheets
          .map((sheet) => `<option value="${this.escapeHtml(sheet.name)}">${this.escapeHtml(sheet.name)}</option>`)
          .join("");
      }
      this.renderExcelMapping({ suggest: true });
      UsageTracker.trackEvent("export-content", "candidate_imported", { source: "excel" });
    } catch (error) {
      this.excelWorkbook = null;
      if (this.elements.excelMapping) this.elements.excelMapping.hidden = true;
      this.showError(error.message || String(error));
    } finally {
      this.elements.excelFile.value = "";
    }
  }

  renderExcelMapping({ suggest = false } = {}) {
    if (!this.excelWorkbook || !this.elements.excelSheet) return;
    const sheet = this.excelWorkbook.sheets.find((item) => item.name === this.elements.excelSheet.value) || this.excelWorkbook.sheets[0];
    if (!sheet) return;
    this.elements.excelSheet.value = sheet.name;

    const oracle = this.getActiveOracleContent();
    const suggestion = this.comparisonService.suggestExcelMapping({
      sheet,
      oracleIdentifierColumn: oracle?.identifierColumn,
      oracleIdentifierValue: oracle?.identifierValue,
      oracleContentColumn: oracle?.item.column,
    });
    const currentColumn = suggest ? suggestion.contentColumn : this.elements.excelColumn?.value;
    const currentRow = suggest ? suggestion.rowIndex : parseInt(this.elements.excelRow?.value || "0", 10);

    if (this.elements.excelColumn) {
      this.elements.excelColumn.innerHTML = sheet.headers
        .map((header) => `<option value="${this.escapeHtml(header)}">${this.escapeHtml(header)}</option>`)
        .join("");
      this.elements.excelColumn.value = sheet.headers.includes(currentColumn) ? currentColumn : sheet.headers[0] || "";
    }
    if (this.elements.excelRow) {
      const labelColumn = suggestion.identifierColumn || sheet.headers[0];
      this.elements.excelRow.innerHTML = sheet.rows
        .map((row, index) => {
          const labelValue = String(row.values[labelColumn] ?? "").trim();
          const label = `Row ${row.excelRowNumber}${labelValue ? ` · ${labelColumn}: ${labelValue}` : ""}`;
          return `<option value="${index}">${this.escapeHtml(label)}</option>`;
        })
        .join("");
      this.elements.excelRow.value = String(Math.max(0, Math.min(currentRow, sheet.rows.length - 1)));
    }
    this.applyExcelCandidate();
  }

  applyExcelCandidate() {
    if (!this.excelWorkbook) return;
    try {
      const candidate = this.comparisonService.getExcelCandidate({
        workbook: this.excelWorkbook,
        sheetName: this.elements.excelSheet?.value,
        rowIndex: parseInt(this.elements.excelRow?.value || "0", 10),
        contentColumn: this.elements.excelColumn?.value,
      });
      this.setCandidate({ ...candidate, source: "excel" });
    } catch (error) {
      this.candidate = null;
      if (this.elements.candidateEditor) this.elements.candidateEditor.value = "";
      if (this.elements.candidateLabel) this.elements.candidateLabel.textContent = error.message || String(error);
      this.renderComparison();
    }
  }

  applyPastedCandidate() {
    const content = this.elements.candidateEditor?.value || "";
    if (!content.trim()) {
      this.candidate = null;
      this.renderComparison();
      this.updateCandidateState();
      return;
    }
    const previousLabel = this.candidate?.label || "Pasted candidate";
    this.excelWorkbook = null;
    if (this.elements.excelMapping) this.elements.excelMapping.hidden = true;
    this.candidate = {
      content,
      label: this.candidate?.source === "excel" || this.candidate?.source === "file" ? `Edited · ${previousLabel}` : "Pasted candidate",
      mediaType: this.comparisonService.inferMediaType(content),
      source: "paste",
    };
    this.updateCandidateState();
    this.renderComparison();
  }

  setCandidate(candidate) {
    this.candidate = candidate;
    if (this.elements.candidateEditor) this.elements.candidateEditor.value = candidate.content;
    this.updateCandidateState();
    this.renderComparison();
  }

  clearCandidate({ keepEditor = false, render = true } = {}) {
    this.candidate = null;
    this.excelWorkbook = null;
    clearTimeout(this.candidateInputTimer);
    if (!keepEditor && this.elements.candidateEditor) this.elements.candidateEditor.value = "";
    if (this.elements.excelMapping) this.elements.excelMapping.hidden = true;
    if (this.elements.markupFile) this.elements.markupFile.value = "";
    if (this.elements.excelFile) this.elements.excelFile.value = "";
    this.updateCandidateState();
    if (render) this.renderComparison();
  }

  updateCandidateState() {
    if (this.elements.candidateLabel) {
      this.elements.candidateLabel.textContent = this.candidate?.label || "Paste content below or choose a candidate file.";
    }
    if (this.elements.clearCandidateButton) this.elements.clearCandidateButton.disabled = !this.candidate && !this.excelWorkbook;
  }

  renderComparison() {
    const oracle = this.getActiveOracleContent();
    if (!oracle) {
      this.renderPreviewEmpty("Run a query to select the Oracle baseline.", "Then add an HTML/XML/XHTML or Excel candidate to compare.");
      return;
    }

    if (!this.candidate) {
      if (this.previewMode === "rendered") {
        this.showRenderedComparison(oracle.content, "");
        this.renderCompareSummary("Oracle content is ready. Add a candidate to compare.", "is-neutral");
      } else {
        this.renderPreviewEmpty("Add candidate content to compare.", "Paste markup or import an HTML/XML/XHTML or Excel file.");
      }
      return;
    }

    try {
      const result = this.comparisonService.compare(oracle.content, this.candidate.content, {
        normalizeWhitespace: this.elements.normalizeWhitespace?.checked !== false,
        candidateMediaType: this.candidate.mediaType,
      });
      this.renderCompareSummary(
        result.changed
          ? `${result.stats.added} word${result.stats.added === 1 ? "" : "s"} added · ${result.stats.removed} removed${result.textChanged ? "" : " · visible text unchanged"}`
          : "Candidate matches the Oracle source exactly.",
        result.changed ? "is-changed" : "is-match",
      );

      if (this.previewMode === "rendered") {
        this.showRenderedComparison(oracle.content, this.candidate.content);
      } else {
        this.showDiff(result[this.previewMode === "source" ? "sourceSegments" : "textSegments"], this.previewMode);
      }
    } catch (error) {
      this.renderPreviewEmpty("Candidate could not be compared.", error.message || String(error), true);
      this.renderCompareSummary(error.message || String(error), "is-error");
    }
  }

  showDiff(segments, mode) {
    if (this.elements.previewEmpty) this.elements.previewEmpty.hidden = true;
    if (this.elements.renderedComparison) this.elements.renderedComparison.hidden = true;
    if (!this.elements.diffView) return;
    this.elements.diffView.hidden = false;
    this.elements.diffView.className = `export-content-diff-view is-${mode}`;
    this.elements.diffView.innerHTML = segments
      .map((segment) => `<span class="export-content-diff-${segment.type}">${this.escapeHtml(segment.value)}</span>`)
      .join("");
  }

  showRenderedComparison(original, candidate) {
    if (this.elements.previewEmpty) this.elements.previewEmpty.hidden = true;
    if (this.elements.diffView) this.elements.diffView.hidden = true;
    if (this.elements.renderedComparison) this.elements.renderedComparison.hidden = false;
    if (this.elements.htmlFrame) {
      this.elements.htmlFrame.hidden = false;
      this.elements.htmlFrame.srcdoc = original;
    }
    if (this.elements.candidateFrame) {
      this.elements.candidateFrame.hidden = false;
      this.elements.candidateFrame.srcdoc = candidate;
    }
  }

  renderCompareSummary(message, stateClass) {
    if (!this.elements.compareSummary) return;
    this.elements.compareSummary.hidden = false;
    this.elements.compareSummary.className = `export-content-compare-summary ${stateClass}`;
    this.elements.compareSummary.textContent = message;
  }

  renderPreviewEmpty(title, description, isError = false) {
    if (this.elements.previewEmpty) {
      this.elements.previewEmpty.hidden = false;
      this.elements.previewEmpty.classList.toggle("is-error", isError);
      const titleNode = this.elements.previewEmpty.querySelector("h3");
      const descriptionNode = this.elements.previewEmpty.querySelector("p");
      if (titleNode) titleNode.textContent = title;
      if (descriptionNode) descriptionNode.textContent = description;
    }
    if (this.elements.htmlFrame) {
      this.elements.htmlFrame.hidden = true;
      this.elements.htmlFrame.srcdoc = "";
    }
    if (this.elements.candidateFrame) this.elements.candidateFrame.srcdoc = "";
    if (this.elements.diffView) this.elements.diffView.hidden = true;
    if (this.elements.renderedComparison) this.elements.renderedComparison.hidden = true;
    if (this.elements.compareSummary && !isError) this.elements.compareSummary.hidden = true;
  }

  setPreviewMode(mode) {
    this.previewMode = ["text", "source", "rendered"].includes(mode) ? mode : "text";
    if (this.elements.textDiffTab) this.elements.textDiffTab.classList.toggle("is-active", this.previewMode === "text");
    if (this.elements.sourceDiffTab) this.elements.sourceDiffTab.classList.toggle("is-active", this.previewMode === "source");
    if (this.elements.renderedTab) this.elements.renderedTab.classList.toggle("is-active", this.previewMode === "rendered");
    this.renderComparison();
  }

  setQueryCollapsed(isCollapsed) {
    this.isQueryCollapsed = Boolean(isCollapsed && this.preview);
    if (this.elements.queryExpanded) this.elements.queryExpanded.hidden = this.isQueryCollapsed;
    if (this.elements.queryCollapsed) this.elements.queryCollapsed.hidden = !this.isQueryCollapsed;
    if (this.elements.queryPanel) this.elements.queryPanel.classList.toggle("is-collapsed", this.isQueryCollapsed);
    if (this.elements.querySummary) this.elements.querySummary.textContent = this.formatQuerySummary();
  }

  formatQuerySummary() {
    if (!this.lastQuerySummary) return "No query has been run.";
    const summary = this.lastQuerySummary;
    return `${summary.environment} · ${summary.savedQuery} · ${summary.rows} row${summary.rows === 1 ? "" : "s"} · ${summary.columns} columns · ${summary.executionTimeMs} ms`;
  }

  showQueryError(message) {
    if (!this.elements.queryError) return;
    this.elements.queryError.hidden = false;
    this.elements.queryError.innerHTML = `
      <strong>Query failed:</strong> ${this.escapeHtml(message)}
      <span>Review syntax and try again.</span>
    `;
  }

  clearQueryError() {
    if (!this.elements.queryError) return;
    this.elements.queryError.hidden = true;
    this.elements.queryError.textContent = "";
  }

  updateExportState() {
    const hasPreview = !!this.preview;
    const identifierColumns = this.getCheckedColumns("identifier");
    const contentColumns = this.getCheckedColumns("content");
    const canExport =
      hasPreview && identifierColumns.length > 0 && contentColumns.length > 0 && this.exportItems.length > 0 && !this.isBusy;
    if (this.elements.exportButton) this.elements.exportButton.disabled = !canExport;
    if (this.elements.manifestButton) this.elements.manifestButton.disabled = !canExport;
    if (this.elements.collapseQueryButton) this.elements.collapseQueryButton.disabled = !hasPreview || this.isBusy;
    if (this.elements.previewButtonLabel) this.elements.previewButtonLabel.textContent = hasPreview ? "Run Again" : "Run Query";

    if (this.elements.estimate && hasPreview) {
      const { items, skippedEmpty } =
        this.lastExportBuild.items.length || this.preview ? this.lastExportBuild : this.buildCurrentExportItems();
      const fileLabel = `${items.length} file${items.length === 1 ? "" : "s"}`;
      const rowLabel = `${this.preview.rows.length} record${this.preview.rows.length === 1 ? "" : "s"}`;
      const contentLabel = `${contentColumns.length} content column${contentColumns.length === 1 ? "" : "s"}`;
      this.elements.estimate.textContent = `${rowLabel} × ${contentLabel} = ${fileLabel}${skippedEmpty ? `, ${skippedEmpty} skipped` : ""}`;
      this.elements.estimate.classList.remove("export-content-estimate-muted");
    } else if (this.elements.estimate) {
      this.elements.estimate.textContent = "Run a query to configure export and generate files.";
      this.elements.estimate.classList.add("export-content-estimate-muted");
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

  downloadManifest() {
    if (!this.preview || this.exportItems.length === 0) {
      this.showError("No generated files are available for a manifest.");
      return;
    }

    const manifest = this.service.buildManifest({
      preview: this.preview,
      environment: this.getSelectedConnection()?.name || "",
      savedQueryName: this.elements.snippetName?.value?.trim() || "",
      identifierColumns: this.getCheckedColumns("identifier"),
      contentColumns: this.getCheckedColumns("content"),
      items: this.exportItems,
      skippedEmpty: this.lastExportBuild.skippedEmpty || 0,
    });
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
    const filename = `${this.service.sanitizeFilenamePart(this.preview.sourceName)}-manifest-${this.service.formatTimestamp()}.json`;
    this.downloadBlob(blob, filename);
    this.showSuccess(`Downloaded manifest ${filename}`);
    UsageTracker.trackEvent("export-content", "manifest_downloaded", {
      source: this.preview.sourceName || "",
      file_count: this.exportItems.length,
    });
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
