import { LocalStorageService } from "./services/LocalStorageService.js";
import { QueryGenerationService } from "./services/QueryGenerationService.js";
import { SchemaValidationService, isDbeaverSchema } from "./services/SchemaValidationService.js";
import { initialSchemaTableSpecification, initialDataTableSpecification } from "./constants.js";
import { AttachmentProcessorService } from "./services/AttachmentProcessorService.js";
import { ExcelImportService } from "./services/ExcelImportService.js";
import { MAIN_TEMPLATE, FILE_BUTTON_TEMPLATE } from "./template.js";
import { BaseTool } from "../../core/BaseTool.js";
import { ensureMonacoWorkers, setupMonacoOracle, createOracleEditor, ORACLE_LANGUAGE_ID, ORACLE_THEME } from "../../core/MonacoOracle.js";
import Handsontable from "handsontable";
import "handsontable/styles/handsontable.css";
import "handsontable/styles/ht-theme-main.css";
import { getIconSvg } from "./icon.js";
import { UsageTracker } from "../../core/UsageTracker.js";
import { isTauri } from "../../core/Runtime.js";
import { openOtpOverlay } from "../../components/OtpOverlay.js";
import { importSchemasPayload } from "./services/SchemaImportService.js";
import { splitSqlStatementsSafely, calcUtf8Bytes, groupBySize, groupByQueryCount, deriveBaseName } from "./services/SplitService.js";
import { QueryWorkerService } from "./services/QueryWorkerService.js";
import { SplitWorkerService } from "./services/SplitWorkerService.js";
import JSZip from "jszip";

// Architecture-compliant tool wrapper preserving existing QuickQueryUI
export class QuickQuery extends BaseTool {
  constructor(eventBus) {
    super({
      id: "quick-query",
      name: "Quick Query",
      description: "Generate Oracle SQL from schema/data with attachments and previews",
      icon: "database",
      category: "application",
      eventBus,
    });
    this.ui = null;
  }

  getIconSvg() {
    return getIconSvg();
  }

  render() {
    return MAIN_TEMPLATE;
  }

  onMount() {
    this.ui = new QuickQueryUI(this.container, () => {}, this.copyToClipboard.bind(this), this.eventBus);
  }
}

export class QuickQueryUI {
  constructor(container, updateHeaderTitle, copyToClipboard, eventBus) {
    this.container = container;
    this.copyToClipboard = copyToClipboard;
    this.eventBus = eventBus;
    this.updateHeaderTitle = updateHeaderTitle;
    this.editor = null;
    this.schemaTable = null;
    this.dataTable = null;
    this.elements = {};
    this.localStorageService = new LocalStorageService();
    this.schemaValidationService = new SchemaValidationService();
    this.queryGenerationService = new QueryGenerationService();
    this.attachmentProcessorService = new AttachmentProcessorService();
    this.excelImportService = new ExcelImportService();
    this.queryWorkerService = new QueryWorkerService();
    this.splitWorkerService = new SplitWorkerService();
    this.isGuideActive = false;
    this.isAttachmentActive = false;
    this.isGenerating = false; // Track async generation state
    this.isSplitting = false; // Track async split state
    this.processedFiles = [];

    this._layoutState = { height: "auto", fixedRowsTop: 0 };
    this._layoutScheduled = false;

    // Initialize search state
    this.searchState = {
      selectedIndex: -1,
      visibleItems: [],
    };

    this.init();
  }

  async init() {
    try {
      // Configure Monaco workers and Oracle SQL language via shared module
      ensureMonacoWorkers();

      // Set HTML content only if not already rendered by the tool wrapper
      if (!this.container.querySelector(".quick-query-content")) {
        this.container.innerHTML = MAIN_TEMPLATE;
      }
      if (this.isGuideActive) {
        const guideContainer = document.getElementById("guideContainer");
        if (guideContainer) {
          guideContainer.innerHTML = GUIDE_TEMPLATE;
        }
      }

      // Initialize UI components
      this.bindElements();

      // Desktop-only: show button but disable it in web, with native tooltip
      try {
        const execBtn = document.getElementById("executeInJenkinsRunner");
        if (execBtn) {
          const isDesktop = isTauri();
          execBtn.disabled = !isDesktop;
          execBtn.title = isDesktop ? "" : "Only available on AD Tools Desktop";
          execBtn.setAttribute("aria-disabled", (!isDesktop).toString());
        }
      } catch (_) {}

      this.clearError();
      // Ensure attachments toolbar visibility reflects initial state
      this.updateAttachmentControlsState();
      setupMonacoOracle();
      await this.initializeComponents();
      this.setupEventListeners();
      this.setupTableNameSearch();
      this.loadMostRecentSchema();
    } catch (error) {
      console.error("Failed to initialize Quick Query:", error);
      this.container.innerHTML = `<div class="error-message">Failed to load: ${error.message}</div>`;
      throw error;
    }
  }

  registerOracleSqlLanguage() {
    // Centralized setup via shared module
    setupMonacoOracle();
  }

  async initializeComponents() {
    try {
      // Ensure container elements exist before initializing
      if (!this.elements.schemaContainer || !this.elements.dataContainer) {
        throw new Error("Required containers not found in DOM");
      }

      this.initializeSpreadsheets();
      this.initializeEditor();

      // Make sure files container is visible initially
      if (this.elements.filesContainer) {
        this.elements.filesContainer.classList.remove("hidden");
      }
    } catch (error) {
      console.error("Failed to initialize components:", error);
      throw error;
    }
  }

  bindElements() {
    this.elements = {
      // Input elements
      tableNameInput: document.getElementById("tableNameInput"),
      queryTypeSelect: document.getElementById("queryTypeSelect"),
      schemaFileInput: document.getElementById("schemaFileInput"),
      savedSchemasSearch: document.getElementById("savedSchemasSearch"),

      // Schema editor elements
      schemaContainer: document.getElementById("spreadsheet-schema"),
      dataContainer: document.getElementById("spreadsheet-data"),

      // Attachments components
      addFilesButton: document.getElementById("addFilesButton"),
      attachmentsInput: document.getElementById("attachmentsInput"),
      filesContainer: document.getElementById("files-container"),
      fileItemsContainer: document.getElementById("file-items"),
      attachmentsControls: document.getElementById("attachments-controls"),
      minifyButton: document.getElementById("minifyButton"),
      deleteAllButton: document.getElementById("deleteAllButton"),
      filesEmpty: document.getElementById("files-empty"),

      // Message and display elements
      errorMessages: document.getElementById("errorMessages"),
      warningMessages: document.getElementById("warningMessages"),
      guide: document.getElementById("guide"),

      // Schema overlay elements
      schemaOverlay: document.getElementById("schemaOverlay"),
      savedSchemasList: document.getElementById("savedSchemasList"),

      // Buttons
      toggleWordWrapButton: document.getElementById("toggleWordWrap"),
      showSavedSchemasButton: document.getElementById("showSavedSchemas"),
      closeSchemaOverlayButton: document.getElementById("closeSchemaOverlay"),
      exportSchemasButton: document.getElementById("exportSchemas"),
      clearAllSchemasButton: document.getElementById("clearAllSchemas"),
      importSchemasButton: document.getElementById("importSchemas"),
      importDefaultSchemaButton: document.getElementById("importDefaultSchema"),

      // Container elements
      tableSearchContainer: null,
      dropdownContainer: null,

      // Attachment Preview Overlay Elements
      filePreviewOverlay: document.getElementById("fileViewerOverlay"),
      closeFilePreviewOverlayButton: document.getElementById("closeFileViewer"),

      // Progress indicator elements
      queryProgress: document.getElementById("queryProgress"),
      progressBar: document.querySelector("#queryProgress .qq-progress-bar"),
      progressText: document.querySelector("#queryProgress .qq-progress-text"),
      cancelGenerationButton: document.getElementById("cancelGeneration"),

      // Excel import elements
      importExcelButton: document.getElementById("importExcel"),
      excelFileInput: document.getElementById("excelFileInput"),
      excelImportInfo: document.getElementById("excelImportInfo"),
      excelImportRowCount: document.getElementById("excelImportRowCount"),
      clearExcelImportButton: document.getElementById("clearExcelImport"),
    };
  }

  setupEventListeners() {
    const eventMap = {
      // Input elements
      tableNameInput: {
        input: (e) => this.handleSearchInput(e),
        keydown: (e) => this.handleSearchKeyDown(e),
      },
      savedSchemasSearch: {
        input: (e) => this.handleSavedSchemasSearchInput(e),
      },
      queryTypeSelect: {
        change: () => this.handleGenerateQuery(),
      },
      schemaFileInput: {
        change: (e) => this.handleSchemaFileInput(e),
      },
      // Query related buttons
      generateQuery: {
        click: () => this.handleGenerateQuery(),
      },
      copySQL: {
        click: (e) => this.copyToClipboard(this.editor.getValue(), e.target),
      },
      clearAll: {
        click: () => this.handleClearAll(),
      },
      downloadSQL: {
        click: () => this.handleDownloadSql(),
      },
      executeInJenkinsRunner: {
        click: () => this.handleExecuteInJenkinsRunner(),
      },
      toggleWordWrapButton: {
        click: () => this.handleToggleWordWrap(),
      },
      splitQuery: {
        click: () => this.handleOpenSplitOptions(),
      },

      // Attachments related (button only; no drag-and-drop)
      addFilesButton: {
        click: () => this.elements.attachmentsInput && this.elements.attachmentsInput.click(),
      },
      filesEmpty: {
        click: () => this.elements.attachmentsInput && this.elements.attachmentsInput.click(),
        keydown: (e) => this.handleEmptyStateKeydown(e),
      },
      attachmentsInput: {
        change: (e) => this.handleAttachmentsInput(e),
      },
      minifyButton: {
        click: () => this.handleMinifyAttachments(),
      },
      deleteAllButton: {
        click: () => this.handleDeleteAllAttachments(),
      },

      // Overlay handlers
      schemaOverlay: {
        click: (e) => {
          if (e.target === this.elements.schemaOverlay) {
            this.elements.schemaOverlay.classList.add("hidden");
          }
        },
      },
      filePreviewOverlay: {
        click: (e) => {
          if (e.target === this.elements.filePreviewOverlay) {
            this.elements.filePreviewOverlay.classList.add("hidden");
          }
        },
      },

      // Data related buttons
      addFieldNames: {
        click: () => this.handleAddFieldNames(),
      },
      addDataRow: {
        click: () => this.handleAddDataRow(),
      },
      removeDataRow: {
        click: () => this.handleRemoveDataRow(),
      },
      clearData: {
        click: () => this.handleClearData(),
      },

      // Excel import buttons
      importExcelButton: {
        click: () => this.handleImportExcelClick(),
      },
      excelFileInput: {
        change: (e) => this.handleExcelFileInput(e),
      },
      clearExcelImportButton: {
        click: () => this.handleClearExcelImport(),
      },

      // Schema related buttons
      addNewSchemaRow: {
        click: () => this.handleAddNewSchemaRow(),
      },
      removeLastSchemaRow: {
        click: () => this.handleRemoveLastSchemaRow(),
      },
      showSavedSchemasButton: {
        click: () => {
          this.elements.schemaOverlay.classList.remove("hidden");
          if (this.elements.savedSchemasSearch) {
            this.elements.savedSchemasSearch.value = "";
          }
          // Ensure latest abbreviations are indexed (e.g., 'svc' for 'service')
          if (this.localStorageService && typeof this.localStorageService.rebuildIndex === "function") {
            this.localStorageService.rebuildIndex();
          }
          this.updateSavedSchemasList();
        },
      },
      closeSchemaOverlayButton: {
        click: () => this.elements.schemaOverlay.classList.add("hidden"),
      },
      exportSchemasButton: {
        click: () => this.handleExportSchemas(),
      },
      importDefaultSchemaButton: {
        click: () => this.handleImportDefaultSchemaFromKv(),
      },
      clearAllSchemasButton: {
        click: () => this.handleClearAllSchemas(),
      },
      importSchemasButton: {
        click: () => this.elements.schemaFileInput.click(),
      },
      cancelGenerationButton: {
        click: () => this.handleCancelGeneration(),
      },
    };

    // Bind all event handlers
    Object.entries(eventMap).forEach(([elementId, events]) => {
      const element = this.elements[elementId] || document.getElementById(elementId);
      if (element) {
        Object.entries(events).forEach(([event, handler]) => {
          element.addEventListener(event, handler);
        });
      } else {
        console.warn(`Element '${elementId}' not found`);
      }
    });
  }

  initializeEditor() {
    this.editor = createOracleEditor(document.getElementById("queryEditor"), {
      value: "",
      automaticLayout: true,
      fontSize: 10.5,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: "off",
      // Disable Monaco suggestions/autocomplete in Quick Query
      quickSuggestions: false,
      suggestOnTriggerCharacters: false,
      wordBasedSuggestions: false,
      snippetSuggestions: "none",
      parameterHints: { enabled: false },
      inlineSuggest: { enabled: false },
      acceptSuggestionOnEnter: "off",
      tabCompletion: "off",
    });
    // Sync initial word wrap label with current editor option
    const wordWrapButton = document.getElementById("toggleWordWrap");
    const currentWrap = this.editor.getRawOptions().wordWrap;
    if (wordWrapButton) {
      wordWrapButton.textContent = `Word Wrap: ${currentWrap === "on" ? "On" : "Off"}`;
    }
  }

  initializeSpreadsheets() {
    const schemaTableConfig = {
      ...initialSchemaTableSpecification,
      afterChange: (changes) => {
        if (changes) {
          this.updateDataSpreadsheet();
          this.handleAddFieldNames();
        }
      },
      afterCreateRow: (index, amount) => {
        console.log(amount, "Row created, for index:", index);
        this.updateDataSpreadsheet();
        this.handleAddFieldNames();
      },
      afterRemoveRow: () => {
        this.updateDataSpreadsheet();
        this.handleAddFieldNames();
      },
      afterGetColHeader: function (col, TH) {
        const header = TH.querySelector(".colHeader");
        if (header) {
          header.style.fontWeight = "bold";
        }
      },
    };
    this.schemaTable = new Handsontable(this.elements.schemaContainer, schemaTableConfig);

    const dataTableConfig = {
      ...initialDataTableSpecification,
      // Constrain the internal viewport height to keep headers visible while scrolling
      height: "auto",
      afterChange: (changes, source) => {
        // Persist data only for user edits (skip loadData)
        if (!changes || source === "loadData") return;

        const tableName = this.elements.tableNameInput.value.trim();
        if (!tableName) return; // Skip if no table name

        if (changes.length > 0) {
          const currentData = this.dataTable.getData();
          this.localStorageService.updateTableData(tableName, currentData);
        }
      },
      // No height recalculation hooks
    };

    this.dataTable = new Handsontable(this.elements.dataContainer, dataTableConfig);
  }

  updateDataSpreadsheet() {
    const schemaData = this.schemaTable.getData().filter((row) => row[0]);
    const columnCount = schemaData.length;
    const currentData = this.dataTable.getData();

    const columnHeaders = Array.from({ length: columnCount }, (_, i) => this.queryGenerationService.columnIndexToLetter(i));

    console.log("Column headers:", columnHeaders);

    this.dataTable.updateSettings({
      colHeaders: columnHeaders,
      columns: Array(columnCount).fill({ type: "text" }),
      minCols: columnCount,
    });

    if (currentData.length < 2) {
      const newData = [Array(columnCount).fill(null), Array(columnCount).fill(null)];
      this.dataTable.loadData(newData);
    } else {
      const newData = currentData.map((row) => {
        return row.slice(0, columnCount).concat(Array(Math.max(0, columnCount - row.length)).fill(null));
      });
      this.dataTable.loadData(newData);
    }
  }

  // Error handling methods
  showError(message) {
    if (this.elements.errorMessages) {
      this.elements.errorMessages.innerHTML = message;
      this.elements.errorMessages.style.display = "block";
      this.elements.errorMessages.style.color = "red";
    }
  }

  showSuccess(message) {
    if (this.elements.warningMessages) {
      this.elements.warningMessages.innerHTML = message;
      this.elements.warningMessages.style.display = "block";
      this.elements.warningMessages.style.color = "green";
    }
  }

  showWarning(message) {
    if (this.elements.warningMessages) {
      // Support both string messages (legacy) and structured warning objects
      if (typeof message === "object" && message.summary) {
        const warningId = `warning-${Date.now()}`;
        this.elements.warningMessages.innerHTML = `
          <div class="qq-warning-collapsible">
            <div class="qq-warning-header" onclick="document.getElementById('${warningId}').classList.toggle('expanded')">
              <span class="qq-warning-toggle">▶</span>
              <span class="qq-warning-summary">${message.summary}</span>
              <span class="qq-warning-hint">(click to expand)</span>
            </div>
            <div id="${warningId}" class="qq-warning-details">
              <div class="qq-warning-details-content">${message.details}</div>
              <div class="qq-warning-note">${message.note}</div>
            </div>
          </div>
        `;
      } else {
        // Legacy string message support
        this.elements.warningMessages.innerHTML = message;
      }
      this.elements.warningMessages.style.display = "block";
      this.elements.warningMessages.style.color = "orange";
    }
  }

  clearError() {
    if (this.elements.errorMessages && this.elements.warningMessages) {
      this.elements.errorMessages.textContent = "";
      this.elements.warningMessages.textContent = "";
      this.elements.errorMessages.style.display = "none";
      this.elements.warningMessages.style.display = "none";
    }
  }

  // Event Handlers
  handleGenerateQuery() {
    // Prevent duplicate generation
    if (this.isGenerating) return;

    try {
      const tableName = this.elements.tableNameInput.value.trim();
      const queryType = this.elements.queryTypeSelect.value;

      const schemaData = this.schemaTable.getData().filter((row) => row[0]);

      // Use imported Excel data if available, otherwise use Handsontable data
      const hasExcelData = this.excelImportService.hasData();
      const inputData = hasExcelData ? this.excelImportService.getDataForQuery() : this.dataTable.getData();

      if (!tableName) {
        throw new Error("Please fill in schema_name.table_name.");
      }

      if (!tableName.includes(".")) {
        throw new Error("Table name format should be 'schema_name.table_name'.");
      }

      if (schemaData.length === 0) {
        throw new Error("Please fill the schema data first");
      }

      if (isDbeaverSchema(schemaData)) {
        this.adjustDbeaverSchema(schemaData);

        throw new Error("Schema data adjusted from DBeaver to SQL Developer format. Please refill the data sheet.");
      }

      // Validate before processing (same for both sync and async)
      this.schemaValidationService.validateSchema(schemaData);
      this.schemaValidationService.matchSchemaWithData(schemaData, inputData);

      // Save schema before processing (only save if not using Excel data to avoid memory issues)
      if (!hasExcelData) {
        this.localStorageService.saveSchema(tableName, schemaData, inputData);
      } else {
        // Just save schema without data for large Excel imports
        this.localStorageService.saveSchema(tableName, schemaData, null);
      }

      // Check if we should use the worker (1000+ rows)
      if (this.queryWorkerService.shouldUseWorker(inputData)) {
        this._generateQueryAsync(tableName, queryType, schemaData, inputData);
      } else {
        this._generateQuerySync(tableName, queryType, schemaData, inputData);
      }
    } catch (error) {
      this.showError(error.message);
      this.editor.setValue("");
    }
  }

  /**
   * Synchronous query generation for small datasets (< 1000 rows)
   */
  _generateQuerySync(tableName, queryType, schemaData, inputData) {
    try {
      const query = this.queryGenerationService.generateQuery(tableName, queryType, schemaData, inputData, this.processedFiles);

      this.editor.setValue(query);
      this.clearError();

      // Check for duplicate primary keys
      const duplicateResult = this.queryGenerationService.detectDuplicatePrimaryKeys(schemaData, inputData, tableName);
      if (duplicateResult.hasDuplicates && duplicateResult.warningMessage) {
        this.showWarning(duplicateResult.warningMessage);
      }

      this._trackQueryGenerated(queryType, tableName, inputData.length, false);
    } catch (error) {
      this.showError(error.message);
      this.editor.setValue("");
    }
  }

  /**
   * Asynchronous query generation using Web Worker for large datasets (1000+ rows)
   */
  async _generateQueryAsync(tableName, queryType, schemaData, inputData) {
    const rowCount = inputData.length - 1; // Exclude header

    try {
      this.isGenerating = true;
      this._showProgress(`Processing ${rowCount.toLocaleString()} rows...`, 0);

      const result = await this.queryWorkerService.generateQuery(
        tableName,
        queryType,
        schemaData,
        inputData,
        this.processedFiles,
        (percent, message) => {
          this._updateProgress(message, percent);
        }
      );

      this._hideProgress();
      this.isGenerating = false;

      this.editor.setValue(result.sql);
      this.clearError();

      // Show duplicate warning if any
      if (result.duplicateResult?.hasDuplicates && result.duplicateResult?.warningMessage) {
        this.showWarning(result.duplicateResult.warningMessage);
      }

      this._trackQueryGenerated(queryType, tableName, rowCount, true);
    } catch (error) {
      this._hideProgress();
      this.isGenerating = false;

      if (error.message === "Generation cancelled") {
        // User cancelled, don't show error
        return;
      }

      this.showError(error.message);
      this.editor.setValue("");
    }
  }

  /**
   * Cancel ongoing async generation
   */
  handleCancelGeneration() {
    if (this.isGenerating) {
      this.queryWorkerService.cancel();
      this._hideProgress();
      this.isGenerating = false;
    }
  }

  /**
   * Show progress indicator
   */
  _showProgress(message, percent = 0) {
    if (this.elements.queryProgress) {
      this.elements.queryProgress.classList.remove("hidden");
    }
    this._updateProgress(message, percent);
  }

  /**
   * Update progress indicator
   */
  _updateProgress(message, percent) {
    if (this.elements.progressBar) {
      this.elements.progressBar.style.width = `${percent}%`;
    }
    if (this.elements.progressText) {
      this.elements.progressText.textContent = message;
    }
  }

  /**
   * Hide progress indicator
   */
  _hideProgress() {
    if (this.elements.queryProgress) {
      this.elements.queryProgress.classList.add("hidden");
    }
    if (this.elements.progressBar) {
      this.elements.progressBar.style.width = "0%";
    }
  }

  /**
   * Track query generation analytics
   */
  _trackQueryGenerated(queryType, tableName, rowCount, usedWorker) {
    UsageTracker.trackFeature("quick-query", queryType);
    UsageTracker.trackEvent("quick-query", "query_generated", {
      queryType,
      tableName,
      rowCount,
      hasAttachments: this.processedFiles.length > 0,
      usedWorker,
    });
  }

  handleClearAll() {
    this.elements.tableNameInput.value = "";

    if (this.schemaTable) {
      this.schemaTable.updateSettings({
        data: [["", "", "", "", "", ""]],
        colHeaders: ["Field Name", "Data Type", "Null", "Default", "Order", "PK"],
      });
    }

    if (this.dataTable) {
      this.dataTable.updateSettings({
        data: [[], []],
        colHeaders: true,
        minCols: 1,
      });
    }

    if (this.editor) {
      this.editor.setValue("");
    }

    this.clearError();
    this.elements.queryTypeSelect.value = "merge";

    // Clear imported Excel data
    this.handleClearExcelImport();
  }

  handleDownloadSql() {
    const sql = this.editor.getValue();
    if (!sql) {
      this.showError("No SQL to download. Please generate a query first.");
      return;
    }

    let tableName = this.elements.tableNameInput.value.trim();
    const sanitizedTableName = tableName.replace(/[^a-z0-9_.]/gi, "_").toUpperCase();
    const filename = `${sanitizedTableName}.sql`;

    const blob = new Blob([sql], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    const displayName = tableName || sanitizedTableName;
    if (this.eventBus) {
      this.eventBus.emit("notification:success", {
        message: `Query ${displayName} downloaded to Download Directory`,
        duration: 2500,
      });
    }
  }

  handleExecuteInJenkinsRunner() {
    try {
      const sql = (this.editor?.getValue() || "").trim();
      if (!sql) {
        this.showError("No SQL to execute. Please generate or write a query first.");
        return;
      }

      // Navigate to Jenkins Runner and pass current SQL via router data
      if (window?.app?.router) {
        window.app.router.navigate("run-query", { sql });
      } else if (window?.app) {
        // Fallback: simple navigation without data
        window.app.navigateToTool("run-query");
        // As a fallback, store SQL in session for Jenkins Runner to consume if implemented
        try {
          sessionStorage.setItem("jenkinsRunner.injectSql", sql);
        } catch (_) {}
      }
    } catch (err) {
      console.error("Failed to execute in Jenkins Runner:", err);
      this.showError("Failed to navigate to Jenkins Runner");
    }
  }

  handleToggleWordWrap() {
    const wordWrapButton = this.elements?.toggleWordWrapButton || document.getElementById("toggleWordWrap");
    const current = this.editor.getRawOptions().wordWrap;
    const next = current === "on" ? "off" : "on";

    this.editor.updateOptions({ wordWrap: next });
    if (wordWrapButton) {
      wordWrapButton.textContent = `Word Wrap: ${next === "on" ? "On" : "Off"}`;
    }
  }

  // ===== Split Query Feature =====
  handleOpenSplitOptions() {
    const sql = (this.editor?.getValue() || "").trim();
    if (!sql) {
      this.showError("No SQL to split. Please generate a query first.");
      return;
    }

    // Reset and show options modal
    const overlay = document.getElementById("splitOptionsOverlay");
    const modal = document.getElementById("splitOptionsModal");
    const sizeRadio = document.querySelector('input[name="splitMode"][value="size"]');
    const valueInput = document.getElementById("splitValue");
    const valueLabel = document.getElementById("splitValueLabel");
    const hint = document.getElementById("splitHint");

    if (sizeRadio) sizeRadio.checked = true;
    if (valueInput) valueInput.value = "90";
    if (valueLabel) valueLabel.textContent = "Max size per chunk (KB):";
    if (hint) hint.textContent = "Each chunk will be max 90 KB. SET DEFINE OFF will be added to each chunk.";

    if (overlay) overlay.classList.remove("hidden");
    if (modal) modal.classList.remove("hidden");

    // Setup event listeners for this modal session
    this._setupSplitOptionsListeners();
  }

  _setupSplitOptionsListeners() {
    const overlay = document.getElementById("splitOptionsOverlay");
    const modal = document.getElementById("splitOptionsModal");
    const closeBtn = document.getElementById("closeSplitOptions");
    const cancelBtn = document.getElementById("cancelSplitOptions");
    const confirmBtn = document.getElementById("confirmSplit");
    const modeRadios = document.querySelectorAll('input[name="splitMode"]');
    const valueInput = document.getElementById("splitValue");
    const valueLabel = document.getElementById("splitValueLabel");
    const hint = document.getElementById("splitHint");

    const closeModal = () => {
      if (overlay) overlay.classList.add("hidden");
      if (modal) modal.classList.add("hidden");
    };

    // Remove previous listeners by cloning
    if (closeBtn) {
      const newClose = closeBtn.cloneNode(true);
      closeBtn.parentNode.replaceChild(newClose, closeBtn);
      newClose.addEventListener("click", closeModal);
    }
    if (cancelBtn) {
      const newCancel = cancelBtn.cloneNode(true);
      cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
      newCancel.addEventListener("click", closeModal);
    }
    if (overlay) {
      overlay.onclick = (e) => {
        if (e.target === overlay) closeModal();
      };
    }

    // Mode change handler
    modeRadios.forEach((radio) => {
      radio.addEventListener("change", () => {
        const mode = document.querySelector('input[name="splitMode"]:checked')?.value;
        if (mode === "size") {
          if (valueLabel) valueLabel.textContent = "Max size per chunk (KB):";
          if (valueInput) valueInput.value = "90";
          if (hint) hint.textContent = "Each chunk will be max 90 KB. SET DEFINE OFF will be added to each chunk.";
        } else {
          if (valueLabel) valueLabel.textContent = "Number of queries per chunk:";
          if (valueInput) valueInput.value = "200";
          if (hint) hint.textContent = "MERGE/INSERT/UPDATE count per chunk. SET DEFINE OFF and SELECT are excluded from count.";
        }
      });
    });

    // Confirm split
    if (confirmBtn) {
      const newConfirm = confirmBtn.cloneNode(true);
      confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
      newConfirm.addEventListener("click", () => {
        const mode = document.querySelector('input[name="splitMode"]:checked')?.value || "size";
        const value = parseInt(document.getElementById("splitValue")?.value || "90", 10);
        closeModal();
        this._performSplit(mode, value);
      });
    }
  }

  _performSplit(mode, value) {
    // Prevent duplicate split
    if (this.isSplitting) return;

    const sql = (this.editor?.getValue() || "").trim();

    // Check if we should use the worker (SQL > 100KB)
    if (this.splitWorkerService.shouldUseWorker(sql)) {
      this._performSplitAsync(sql, mode, value);
    } else {
      this._performSplitSync(sql, mode, value);
    }
  }

  /**
   * Synchronous split for small SQL files
   */
  _performSplitSync(sql, mode, value) {
    const statements = splitSqlStatementsSafely(sql);

    // Filter out SET DEFINE OFF statements for processing
    const filtered = statements.filter((s) => !/^SET\s+DEFINE\s+OFF\s*;?$/i.test(s.trim()));

    let chunks = [];
    let metadata = [];
    const HEADER = "SET DEFINE OFF;\n";

    if (mode === "size") {
      const maxBytes = value * 1024;
      const result = groupBySize(filtered, maxBytes, HEADER);
      chunks = result.chunks;
      metadata = result.metadata;
    } else {
      // For query count mode, pass maxBytes to detect oversized chunks
      const maxBytes = 90 * 1024; // Use 90KB as default limit for oversized detection
      const result = groupByQueryCount(filtered, value, HEADER, maxBytes);
      chunks = result.chunks;
      metadata = result.metadata;
    }

    this._finishSplit(chunks, metadata, mode, value);
  }

  /**
   * Asynchronous split using Web Worker for large SQL files
   */
  async _performSplitAsync(sql, mode, value) {
    try {
      this.isSplitting = true;
      this._showProgress(`Splitting SQL...`, 10);

      const result = await this.splitWorkerService.split(sql, mode, value, (percent, message) => {
        this._updateProgress(message, percent);
      });

      this._hideProgress();
      this.isSplitting = false;

      this._finishSplit(result.chunks, result.metadata, mode, value);
    } catch (error) {
      this._hideProgress();
      this.isSplitting = false;

      if (error.message === "Split cancelled") {
        return;
      }

      this.showError(error.message);
    }
  }

  /**
   * Complete the split operation (shared by sync/async)
   */
  _finishSplit(chunks, metadata, mode, value) {
    if (chunks.length === 0) {
      this.showError("No valid queries to split.");
      return;
    }

    // Store split state with metadata
    this._splitState = {
      chunks,
      metadata,
      mode,
      value,
      currentIndex: 0,
      tableName: this.elements.tableNameInput?.value?.trim() || "QUERY",
    };

    this._openSplitResultsModal();
  }

  _openSplitResultsModal() {
    const overlay = document.getElementById("splitResultsOverlay");
    const modal = document.getElementById("splitResultsModal");

    if (overlay) overlay.classList.remove("hidden");
    if (modal) modal.classList.remove("hidden");

    // Initialize Monaco editor for preview if not already
    if (!this._splitEditor) {
      const container = document.getElementById("qq-split-editor");
      if (container) {
        this._splitEditor = createOracleEditor(container, {
          value: "",
          automaticLayout: true,
          readOnly: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: "on",
          fontSize: 11,
        });
      }
    }

    this._renderSplitResults();
    this._setupSplitResultsListeners();
  }

  _renderSplitResults() {
    const { chunks, metadata, currentIndex, mode, value } = this._splitState;
    const chunksList = document.getElementById("qq-split-chunks-list");
    const chunkLabel = document.getElementById("qq-split-chunk-label");
    const infoEl = document.getElementById("qq-split-info");

    // Update label
    if (chunkLabel) {
      chunkLabel.textContent = `Chunk ${currentIndex + 1} of ${chunks.length}`;
    }

    // Update info
    if (infoEl) {
      const suffix = mode === "size" ? `${value}kb` : `${value}`;
      infoEl.textContent = `Split by ${mode === "size" ? "size" : "query count"}: ${suffix}`;
    }

    // Render chunks list
    if (chunksList) {
      chunksList.innerHTML = "";
      chunks.forEach((chunk, i) => {
        const li = document.createElement("li");
        li.className = i === currentIndex ? "active" : "";

        const chunkMeta = metadata[i];
        const chunkSizeKB = (chunkMeta.size / 1024).toFixed(1);
        const isOversized = chunkMeta.isOversized;

        // Build warning badge HTML if chunk is oversized
        const warningBadge = isOversized
          ? `<span class="qq-chunk-warning" title="Chunk exceeds ${mode === "size" ? value : 90} KB limit">⚠️</span>`
          : "";

        li.innerHTML = `
          <span>Chunk ${i + 1} ${warningBadge}</span>
          <span class="qq-chunk-size">${chunkSizeKB} KB</span>
        `;
        li.addEventListener("click", () => {
          this._splitState.currentIndex = i;
          this._renderSplitResults();
        });
        chunksList.appendChild(li);
      });
    }

    // Update editor
    if (this._splitEditor && chunks[currentIndex]) {
      this._splitEditor.setValue(chunks[currentIndex]);
    }
  }

  _setupSplitResultsListeners() {
    const overlay = document.getElementById("splitResultsOverlay");
    const modal = document.getElementById("splitResultsModal");
    const closeBtn = document.getElementById("closeSplitResults");
    const cancelBtn = document.getElementById("cancelSplitResults");
    const downloadBtn = document.getElementById("downloadAllChunks");
    const prevBtn = document.getElementById("qq-split-prev");
    const nextBtn = document.getElementById("qq-split-next");

    const closeModal = () => {
      if (overlay) overlay.classList.add("hidden");
      if (modal) modal.classList.add("hidden");
    };

    // Clone to remove previous listeners
    [closeBtn, cancelBtn, downloadBtn, prevBtn, nextBtn].forEach((btn) => {
      if (btn) {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
      }
    });

    // Re-query cloned buttons
    document.getElementById("closeSplitResults")?.addEventListener("click", closeModal);
    document.getElementById("cancelSplitResults")?.addEventListener("click", closeModal);

    document.getElementById("qq-split-prev")?.addEventListener("click", () => {
      if (this._splitState.currentIndex > 0) {
        this._splitState.currentIndex--;
        this._renderSplitResults();
      }
    });

    document.getElementById("qq-split-next")?.addEventListener("click", () => {
      if (this._splitState.currentIndex < this._splitState.chunks.length - 1) {
        this._splitState.currentIndex++;
        this._renderSplitResults();
      }
    });

    document.getElementById("downloadAllChunks")?.addEventListener("click", () => {
      this._downloadChunksAsZip();
    });

    if (overlay) {
      overlay.onclick = (e) => {
        if (e.target === overlay) closeModal();
      };
    }
  }

  async _downloadChunksAsZip() {
    const { chunks, mode, value, tableName } = this._splitState;
    const zip = new JSZip();

    // Derive base name from first chunk or table name
    const baseName = deriveBaseName(chunks[0], 0, tableName).replace(/\./g, "_");
    const suffix = mode === "size" ? `${value}kb` : `${value}`;

    chunks.forEach((chunk, i) => {
      const fileName = `${baseName} - ${i + 1} - split_${suffix}.sql`;
      zip.file(fileName, chunk);
    });

    const zipName = `${baseName} - split_${suffix}.zip`;

    try {
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = zipName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      if (this.eventBus) {
        this.eventBus.emit("notification:success", {
          message: `Downloaded ${chunks.length} chunks as ${zipName}`,
          duration: 2500,
        });
      }
    } catch (err) {
      console.error("Failed to create ZIP:", err);
      this.showError("Failed to create ZIP file");
    }
  }

  handleAddFieldNames() {
    const schemaData = this.schemaTable.getData().filter((row) => row[0]);
    const fieldNames = schemaData.map((row) => row[0]);
    const currentData = this.dataTable.getData();

    if (currentData.length > 0) {
      currentData[0] = fieldNames;
    } else {
      currentData.push(fieldNames);
    }

    if (currentData.length < 2) {
      currentData.push(Array(fieldNames.length).fill(null));
    }

    this.dataTable.loadData(currentData);
  }

  handleAddDataRow() {
    const currentData = this.dataTable.getData();
    const schemaData = this.schemaTable.getData().filter((row) => row[0]);
    const columnCount = schemaData.length;
    const newRow = Array(columnCount).fill(null);
    const newData = [...currentData, newRow];
    this.dataTable.loadData(newData);
  }

  handleRemoveDataRow() {
    const currentData = this.dataTable.getData();
    const newData = currentData.slice(0, -1);
    this.dataTable.loadData(newData);
  }

  handleClearData() {
    const schemaData = this.schemaTable.getData().filter((row) => row[0]);
    const fieldNames = schemaData.map((row) => row[0]);
    const newData = [fieldNames, Array(fieldNames.length).fill(null)];

    this.dataTable.loadData(newData);
    // Also clear any imported Excel data
    this.handleClearExcelImport();
  }

  // ===== Excel Import Methods =====

  /**
   * Handle click on Import Excel button
   * Uses Tauri file dialog in desktop, file input in web
   */
  async handleImportExcelClick() {
    if (isTauri()) {
      await this._handleImportExcelTauri();
    } else {
      this._handleImportExcelWeb();
    }
  }

  /**
   * Handle Import Excel for Tauri (desktop)
   * Uses Tauri dialog plugin to open file picker
   */
  async _handleImportExcelTauri() {
    try {
      // Dynamic import of Tauri plugins
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { readFile } = await import("@tauri-apps/plugin-fs");

      // Open file dialog for Excel files
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "Excel Files",
            extensions: ["xlsx", "xls"],
          },
        ],
        title: "Select Excel File",
      });

      if (!selected) {
        // User cancelled
        return;
      }

      // Read file contents
      const fileData = await readFile(selected);

      // Process Excel file
      const result = this.excelImportService.processFromUint8Array(fileData);
      this._onExcelImportSuccess(result);
    } catch (error) {
      console.error("Failed to import Excel (Tauri):", error);
      this.showError(`Failed to import Excel: ${error.message}`);
    }
  }

  /**
   * Handle Import Excel for Web
   * Triggers the hidden file input
   */
  _handleImportExcelWeb() {
    if (this.elements.excelFileInput) {
      this.elements.excelFileInput.click();
    }
  }

  /**
   * Handle file input change event (Web)
   */
  async handleExcelFileInput(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const result = await this.excelImportService.processFromFile(file);
      this._onExcelImportSuccess(result);
    } catch (error) {
      console.error("Failed to import Excel:", error);
      this.showError(`Failed to import Excel: ${error.message}`);
    }

    // Reset file input for subsequent selections
    event.target.value = "";
  }

  /**
   * Called when Excel import is successful
   * Updates UI to show row count without rendering to Handsontable
   */
  _onExcelImportSuccess(result) {
    const { header, rowCount } = result;

    // Validate header matches schema if schema exists
    const schemaData = this.schemaTable.getData().filter((row) => row[0]);
    if (schemaData.length > 0) {
      const schemaFieldNames = schemaData.map((row) => row[0]);
      const headerLower = header.map((h) => (h || "").toLowerCase());
      const schemaLower = schemaFieldNames.map((f) => (f || "").toLowerCase());

      // Check if headers match schema field names
      const mismatches = [];
      for (let i = 0; i < Math.max(headerLower.length, schemaLower.length); i++) {
        if (headerLower[i] !== schemaLower[i]) {
          mismatches.push({
            index: i,
            excel: header[i] || "(empty)",
            schema: schemaFieldNames[i] || "(missing)",
          });
        }
      }

      if (mismatches.length > 0) {
        const mismatchDetails = mismatches
          .slice(0, 5)
          .map((m) => `Column ${m.index + 1}: Excel="${m.excel}" vs Schema="${m.schema}"`)
          .join(", ");
        const suffix = mismatches.length > 5 ? ` and ${mismatches.length - 5} more...` : "";
        this.showWarning(`Header mismatch detected: ${mismatchDetails}${suffix}. Data will be used as-is.`);
      }
    }

    // Update UI to show row count
    this._updateExcelImportUI(rowCount);

    // Show success notification
    if (this.eventBus) {
      this.eventBus.emit("notification:success", {
        message: `Imported ${rowCount.toLocaleString()} rows from Excel`,
        duration: 2500,
      });
    }
  }

  /**
   * Update the Excel import info UI
   */
  _updateExcelImportUI(rowCount) {
    if (this.elements.excelImportInfo) {
      this.elements.excelImportInfo.classList.remove("hidden");
    }
    if (this.elements.excelImportRowCount) {
      this.elements.excelImportRowCount.textContent = `${rowCount.toLocaleString()} rows imported from Excel (will be used for query generation)`;
    }
  }

  /**
   * Clear imported Excel data
   */
  handleClearExcelImport() {
    this.excelImportService.clear();
    if (this.elements.excelImportInfo) {
      this.elements.excelImportInfo.classList.add("hidden");
    }
    if (this.elements.excelImportRowCount) {
      this.elements.excelImportRowCount.textContent = "0 rows imported from Excel";
    }
  }

  handleAddNewSchemaRow() {
    const currentRowCount = this.schemaTable.countRows();
    // Insert a new row with empty cells for all columns
    this.schemaTable.alter("insert_row_below", currentRowCount - 1, 1);
    this.schemaTable.render();
  }

  handleRemoveLastSchemaRow() {
    const lastRowIndex = this.schemaTable.countRows() - 1;
    if (lastRowIndex >= 0) {
      this.schemaTable.alter("remove_row", lastRowIndex);
    }
  }

  handleClearAllSchemas() {
    const allTables = this.localStorageService.getAllTables();
    if (allTables.length === 0) {
      this.showError("No schemas to clear");
      return;
    }

    if (!confirm("Are you sure you want to clear all saved schemas? This cannot be undone.")) {
      return;
    }

    const schemaCleared = this.localStorageService.clearAllSchemas();
    if (schemaCleared) {
      this.showSuccess("All saved schemas have been cleared");
      this.elements.schemaOverlay.classList.add("hidden");
    } else {
      this.showError("Failed to clear all saved schemas");
    }
  }

  // Schema management methods
  updateSavedSchemasList(filteredTables) {
    const allTables = this.localStorageService.getAllTables();
    const tablesToRender = Array.isArray(filteredTables) ? filteredTables : allTables;

    if (tablesToRender.length === 0) {
      const message = Array.isArray(filteredTables) ? "No matching results" : "No saved schemas";
      this.elements.savedSchemasList.innerHTML = `<div class="no-schemas">${message}</div>`;
      return;
    }

    const groupedTables = tablesToRender.reduce((groups, table) => {
      if (!groups[table.schemaName]) {
        groups[table.schemaName] = [];
      }
      groups[table.schemaName].push(table);
      return groups;
    }, {});

    this.elements.savedSchemasList.innerHTML = "";

    Object.entries(groupedTables).forEach(([schemaName, tables]) => {
      const groupDiv = document.createElement("div");
      groupDiv.className = "schema-group";

      const headerDiv = document.createElement("div");
      headerDiv.className = "schema-group-header";
      headerDiv.textContent = schemaName;
      groupDiv.appendChild(headerDiv);

      tables.forEach((table) => {
        const itemDiv = document.createElement("div");
        itemDiv.className = "schema-item";

        const infoDiv = document.createElement("div");
        infoDiv.className = "schema-info";

        const nameDiv = document.createElement("div");
        nameDiv.className = "schema-name";
        nameDiv.textContent = table.tableName;

        const timestampDiv = document.createElement("div");
        timestampDiv.className = "schema-timestamp";
        const ts = table.lastUpdated ? new Date(table.lastUpdated) : null;
        timestampDiv.textContent = ts && !Number.isNaN(ts.getTime()) ? ts.toLocaleString() : "";

        infoDiv.appendChild(nameDiv);
        infoDiv.appendChild(timestampDiv);

        const actionsDiv = document.createElement("div");
        actionsDiv.className = "schema-actions";

        const loadBtn = document.createElement("button");
        loadBtn.textContent = "Load";
        loadBtn.className = "btn-sm-xs";
        loadBtn.addEventListener("click", () => this.handleLoadSchema(table.fullName));

        const deleteBtn = document.createElement("button");
        deleteBtn.textContent = "Delete";
        deleteBtn.className = "btn-sm-xs";
        deleteBtn.addEventListener("click", () => this.handleDeleteSchema(table.fullName));

        actionsDiv.appendChild(loadBtn);
        actionsDiv.appendChild(deleteBtn);

        itemDiv.appendChild(infoDiv);
        itemDiv.appendChild(actionsDiv);
        groupDiv.appendChild(itemDiv);
      });

      this.elements.savedSchemasList.appendChild(groupDiv);
    });
  }

  handleSavedSchemasSearchInput(event) {
    const input = event.target.value.trim();

    // Empty search: show all saved schemas
    if (!input) {
      this.updateSavedSchemasList();
      return;
    }

    // Table-only search when input starts with '.'
    if (input.startsWith(".")) {
      const tableTerm = input.slice(1).trim();
      if (!this.localStorageService.validateOracleName(tableTerm, "table")) {
        return;
      }
      const results = this.localStorageService.searchSavedSchemas(tableTerm);
      this.updateSavedSchemasList(results);
      return;
    }

    // Table-only search when no '.' present
    if (!input.includes(".")) {
      if (!this.localStorageService.validateOracleName(input, "table")) {
        return;
      }
      const results = this.localStorageService.searchSavedSchemas(input);
      this.updateSavedSchemasList(results);
      return;
    }

    // Schema.table search when '.' present
    const parts = input.split(".");
    const schemaPart = parts[0];
    const tablePart = parts[1];
    if (!this.localStorageService.validateOracleName(schemaPart, "schema")) {
      return;
    }
    const tableValidation = tablePart === "" ? undefined : tablePart;
    if (!this.localStorageService.validateOracleName(tableValidation, "table")) {
      return;
    }

    const results = this.localStorageService.searchSavedSchemas(input);
    this.updateSavedSchemasList(results);
  }

  handleLoadSchema(fullName) {
    const result = this.localStorageService.loadSchema(fullName, true);
    if (result) {
      this.elements.tableNameInput.value = fullName;
      this.schemaTable.loadData(result.schema);
      this.updateDataSpreadsheet();

      // Load cached data if available
      if (result.data) {
        this.dataTable.loadData(result.data);
      } else {
        this.handleAddFieldNames();
        this.handleClearData();
      }

      this.elements.schemaOverlay.classList.add("hidden");
      this.clearError();
    } else {
      this.showError(`Failed to load schema for ${fullName}`);
    }
  }

  handleDeleteSchema(fullName) {
    if (confirm(`Delete schema for ${fullName}?`)) {
      const deleted = this.localStorageService.deleteSchema(fullName);
      if (deleted) {
        this.updateSavedSchemasList();

        const currentTable = this.elements.tableNameInput.value;
        if (currentTable === fullName) {
          this.handleClearAll();
        }
      } else {
        this.showError(`Failed to delete schema for ${fullName}`);
      }
    }
  }

  handleExportSchemas() {
    const allTables = this.localStorageService.getAllTables();
    if (allTables.length === 0) {
      this.showError("No schemas to export");
      return;
    }

    const exportData = {};
    allTables.forEach((table) => {
      const schema = this.localStorageService.loadSchema(table.fullName);
      if (schema) {
        if (!exportData[table.schemaName]) {
          exportData[table.schemaName] = {};
        }
        exportData[table.schemaName][table.tableName] = schema;
      }
    });

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "quick_query_saved_schemas.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async handleImportDefaultSchemaFromKv() {
    const email = localStorage.getItem("user.email") || "";
    if (!email) {
      this.showError("No registered email found. Please register first.");
      return;
    }

    const isArraySchema = (schema) => {
      return (
        Array.isArray(schema) &&
        schema.every(
          (row) =>
            Array.isArray(row) && row.length >= 3 && typeof row[0] === "string" && typeof row[1] === "string" && typeof row[2] === "string"
        )
      );
    };

    const convertJsonSchemaToRows = (schemaJson) => {
      try {
        const rows = [];
        const columns = schemaJson?.columns || {};
        const pkSet = new Set(Array.isArray(schemaJson?.pk) ? schemaJson.pk : []);
        Object.entries(columns).forEach(([fieldName, def]) => {
          const dataType = def?.type || "";
          const nullable = def?.nullable || "Yes";
          const defVal = typeof def?.default !== "undefined" ? def.default : null;
          const pkFlag = pkSet.has(fieldName) ? "Yes" : "No";
          rows.push([fieldName, dataType, nullable, defVal, null, pkFlag]);
        });
        return rows;
      } catch (_) {
        return null;
      }
    };

    // Import helper moved to SchemaImportService for testability

    try {
      const BASE = (import.meta?.env?.VITE_WORKER_BASE || "").trim();
      const kvUrl = BASE ? `${BASE}/api/kv/get?key=quick-query-default-schema` : `/api/kv/get?key=quick-query-default-schema`;

      const { token, kvValue } = await openOtpOverlay({
        email,
        requestEndpoint: "/register/request-otp",
        verifyEndpoint: "/register/verify",
        rateLimitMs: 60_000,
        storageScope: "quick-query-default-schema",
        kvKey: "quick-query-default-schema",
        // centralized overlay will try cached token first
        preferCachedToken: true,
      });

      let value = kvValue;
      if (value === undefined && token) {
        const res2 = await fetch(kvUrl, { headers: { Authorization: `Bearer ${token}` } });
        const j2 = await res2.json().catch(() => ({}));
        if (!res2.ok || !j2?.ok) throw new Error(j2?.error || "KV access failure");
        value = j2.value;
      }

      if (typeof value === "string") {
        try {
          value = JSON.parse(value);
        } catch (_) {}
      }
      if (!value) throw new Error("No default schema found in KV");

      const count = importSchemasPayload(value, this.localStorageService);
      this.updateSavedSchemasList();
      if (!count) {
        throw new Error("No default table schemas imported. Verify KV format.");
      }
      this.showSuccess(`Successfully imported ${count} default table schemas`);
      setTimeout(() => this.clearError(), 3000);
    } catch (e) {
      if (String(e?.message || e) !== "Closed") {
        this.showError(`Failed to import default schema: ${String(e?.message || e)}`);
        UsageTracker.trackEvent("quick-query", "ui_error", { type: "kv_import_failed", message: String(e?.message || e) });
      }
    }
  }

  setupTableNameSearch() {
    const tableNameInput = this.elements.tableNameInput;

    // Disable browser's default suggestions
    tableNameInput.setAttribute("autocomplete", "off");
    tableNameInput.setAttribute("autocorrect", "off");
    tableNameInput.setAttribute("autocapitalize", "off");
    tableNameInput.setAttribute("spellcheck", "false");

    // Create a container div and wrap it around the input
    const container = document.createElement("div");
    container.className = "table-search-container";
    tableNameInput.parentNode.insertBefore(container, tableNameInput);
    container.appendChild(tableNameInput);

    // Create dropdown container
    const dropdownContainer = document.createElement("div");
    dropdownContainer.className = "table-search-dropdown";
    dropdownContainer.style.display = "none";
    container.appendChild(dropdownContainer);

    // Store containers in elements
    this.elements.tableSearchContainer = container;
    this.elements.dropdownContainer = dropdownContainer;

    this.setupSearchEventListeners(container, dropdownContainer, tableNameInput);
  }

  setupSearchEventListeners(container, dropdownContainer, tableNameInput) {
    // Close dropdown when clicking outside
    document.addEventListener("click", (event) => {
      if (!container.contains(event.target)) {
        dropdownContainer.style.display = "none";
        this.searchState.selectedIndex = -1;
      }
    });
  }

  // Sanitize table name input to allow only uppercase letters and valid Oracle characters
  // Allowed: A-Z, 0-9, underscore (_), dollar ($), hash (#), single dot (.) as schema/table separator
  sanitizeTableInputValue(value) {
    if (typeof value !== "string") return "";
    let v = value.toUpperCase();
    // Remove all characters not in the allowed set
    v = v.replace(/[^A-Z0-9._$#]/g, "");
    // Ensure only a single dot is present (keep the first dot, remove subsequent ones)
    const dotIndex = v.indexOf(".");
    if (dotIndex !== -1) {
      v = v.slice(0, dotIndex + 1) + v.slice(dotIndex + 1).replace(/\./g, "");
    }
    return v;
  }

  handleSearchInput(event) {
    const el = this.elements.tableNameInput;
    const raw = el.value;
    const sanitized = this.sanitizeTableInputValue(raw);
    if (sanitized !== raw) {
      // Replace the value with sanitized content; caret is moved to end for simplicity
      el.value = sanitized;
    }
    const input = sanitized.trim();
    this.elements.tableNameInput.style.borderColor = "";

    if (!input) {
      const results = this.localStorageService.searchSavedSchemas("").slice(0, 7);
      this.showSearchDropdown(results);
      return;
    }

    // Support table-only searches:
    // - If input starts with '.', treat it as table-only (e.g., '.appc')
    // - If input has no '.', also treat as table-only
    if (input.startsWith(".")) {
      const tableTerm = input.slice(1).trim();
      if (!this.localStorageService.validateOracleName(tableTerm, "table")) {
        return;
      }
      const results = this.localStorageService.searchSavedSchemas(tableTerm);
      this.showSearchDropdown(results);
      return;
    }

    if (!input.includes(".")) {
      if (!this.localStorageService.validateOracleName(input, "table")) {
        return;
      }
      const results = this.localStorageService.searchSavedSchemas(input);
      this.showSearchDropdown(results);
      return;
    }

    const parts = input.split(".");
    const schemaPart = parts[0];
    const tablePart = parts[1];
    if (!this.localStorageService.validateOracleName(schemaPart, "schema")) {
      return;
    }
    const tableValidation = tablePart === "" ? undefined : tablePart; // allow empty table part when dot present
    if (!this.localStorageService.validateOracleName(tableValidation, "table")) {
      return;
    }

    const results = this.localStorageService.searchSavedSchemas(input);
    this.showSearchDropdown(results);
  }

  handleSearchKeyDown(event) {
    if (this.elements.dropdownContainer.style.display === "none" && event.key === "ArrowDown") {
      const results = this.localStorageService.searchSavedSchemas("").slice(0, 7);
      this.showSearchDropdown(results);
      this.searchState.selectedIndex = -1;
      return;
    }

    if (this.elements.dropdownContainer.style.display === "block") {
      this.handleDropdownNavigation(event);
    }
  }

  showSearchDropdown(results) {
    const dropdownContainer = this.elements.dropdownContainer;
    dropdownContainer.innerHTML = "";
    this.searchState.visibleItems = [];
    this.searchState.selectedIndex = -1;

    if (results.length === 0) {
      dropdownContainer.style.display = "none";
      return;
    }

    const groupedResults = results.reduce((groups, table) => {
      if (!groups[table.schemaName]) {
        groups[table.schemaName] = [];
      }
      groups[table.schemaName].push(table);
      return groups;
    }, {});

    Object.entries(groupedResults).forEach(([schemaName, tables]) => {
      const schemaGroup = document.createElement("div");
      schemaGroup.className = "schema-group";

      const schemaHeader = document.createElement("div");
      schemaHeader.className = "schema-header";
      schemaHeader.textContent = schemaName;
      schemaGroup.appendChild(schemaHeader);

      tables.forEach((table) => {
        const item = document.createElement("div");
        item.className = "search-result-item";
        item.textContent = table.tableName;

        // Store the full table name for easy access
        item.dataset.fullName = table.fullName;

        // Add to visible items array for keyboard navigation
        this.searchState.visibleItems.push(item);

        item.addEventListener("click", () => this.selectSearchResult(table.fullName));

        schemaGroup.appendChild(item);
      });

      dropdownContainer.appendChild(schemaGroup);
    });

    dropdownContainer.style.display = "block";
  }

  selectSearchResult(fullName) {
    this.elements.tableNameInput.value = fullName;
    this.elements.dropdownContainer.style.display = "none";
    this.handleLoadSchema(fullName);

    // Reset selection
    this.searchState.selectedIndex = -1;
    this.elements.tableNameInput.focus();
  }

  handleDropdownNavigation(event) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        this.searchState.selectedIndex = Math.min(this.searchState.selectedIndex + 1, this.searchState.visibleItems.length - 1);
        this.updateSearchSelection();
        break;

      case "ArrowUp":
        event.preventDefault();
        this.searchState.selectedIndex = Math.max(this.searchState.selectedIndex - 1, -1);
        this.updateSearchSelection();
        break;

      case "Enter":
        event.preventDefault();
        if (this.searchState.selectedIndex >= 0 && this.searchState.selectedIndex < this.searchState.visibleItems.length) {
          this.selectSearchResult(this.searchState.visibleItems[this.searchState.selectedIndex].dataset.fullName);
        }
        break;

      case "Escape":
        this.elements.dropdownContainer.style.display = "none";
        this.searchState.selectedIndex = -1;
        break;
    }
  }

  updateSearchSelection() {
    this.searchState.visibleItems.forEach((item, index) => {
      if (index === this.searchState.selectedIndex) {
        item.classList.add("selected");
        item.scrollIntoView({ block: "nearest" });
      } else {
        item.classList.remove("selected");
      }
    });
  }

  loadMostRecentSchema() {
    // Prefer last activity from data store to restore the most recent working table
    const recentFromData = this.localStorageService.getMostRecentDataTable();
    if (recentFromData && recentFromData.fullName) {
      this.handleLoadSchema(recentFromData.fullName);
      return;
    }

    // Fallback: choose the most recent by timestamp across all tables
    const allTables = this.localStorageService.getAllTables();
    if (allTables.length > 0) {
      const mostRecent = allTables.reduce((best, t) => {
        const ts = t.lastUpdated ? new Date(t.lastUpdated).getTime() : -1;
        if (!best || ts > best.ts) return { t, ts };
        return best;
      }, null);
      if (mostRecent?.t?.fullName) {
        this.handleLoadSchema(mostRecent.t.fullName);
      }
    }
  }

  async handleSchemaFileInput(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const jsonData = JSON.parse(text);

      if (!this.isValidSchemaFormat(jsonData)) {
        throw new Error("Invalid schema format");
      }

      let importCount = 0;
      Object.entries(jsonData).forEach(([schemaName, tables]) => {
        Object.entries(tables).forEach(([tableName, schema]) => {
          const fullTableName = `${schemaName}.${tableName}`;
          if (this.localStorageService.saveSchema(fullTableName, schema)) {
            importCount++;
          }
        });
      });

      this.updateSavedSchemasList();
      this.showSuccess(`Successfully imported ${importCount} table schemas`);
      setTimeout(() => this.clearError(), 3000);
    } catch (error) {
      this.showError(`Failed to import schemas: ${error.message}`);
      const file = event?.target?.files?.[0];
      UsageTracker.trackEvent("quick-query", "ui_error", { type: "schema_import_failed", message: error.message, filename: file?.name });
    } finally {
      event.target.value = ""; // Reset file input
    }
  }

  isValidSchemaFormat(data) {
    if (!data || typeof data !== "object") return false;

    return Object.entries(data).every(([schemaName, tables]) => {
      if (typeof tables !== "object") return false;

      return Object.entries(tables).every(([tableName, schema]) => {
        return (
          Array.isArray(schema) &&
          schema.every(
            (row) =>
              Array.isArray(row) &&
              row.length >= 3 && // At least name, type, and nullable
              typeof row[0] === "string" &&
              typeof row[1] === "string" &&
              typeof row[2] === "string"
          )
        );
      });
    });
  }

  adjustDbeaverSchema(schemaData) {
    console.log("Adjusting schema data");

    // Remove the header row
    const removedHeader = schemaData.slice(1);

    // Transform the data
    const adjustedSchemaData = removedHeader.map((row, idx) => {
      // Original DBeaver format:
      // [0]: Column Name
      // [1]: Column Type
      // [2]: Type Name
      // [3]: Column Size
      // [4]: Nullable
      // [5]: Default Value
      // [6]: Comments

      // Transform "Not Null" from TRUE/FALSE to our "Null" column (Yes/No)
      // DBeaver's "Not Null = true" means the field is NOT nullable, so our Null = "No"
      // DBeaver's "Not Null = false" means the field IS nullable, so our Null = "Yes"
      const nullable = String(row[4]).toLowerCase() === "true" ? "No" : "Yes";

      // Transform [NULL] to empty string
      const defaultValue = row[5] === "[NULL]" ? "" : row[5];

      return [
        row[0], // [0] Field Name (same as Column Name)
        row[2], // [1] Data Type (use Type Name instead of Column Type)
        nullable, // [2] Null
        defaultValue, // [3] Default Value
        String(idx + 1), // [4] Order
        "No", // [5] PK (default to No; DBeaver export doesn't include PK info)
      ];
    });

    // Update the schemaTable with the new data
    if (this.schemaTable && typeof this.schemaTable.loadData === "function") {
      try {
        // Clear existing data and load new data
        this.handleClearData();
        this.schemaTable.loadData(adjustedSchemaData);
        this.updateDataSpreadsheet();
      } catch (error) {
        console.error("Error updating schema table:", error);
        UsageTracker.trackEvent("quick-query", "ui_error", { type: "schema_update_failed", message: error.message });
      }
    }
  }

  async handleAttachmentsInput(e) {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    try {
      const addedFiles = await this.attachmentProcessorService.processAttachments(files);
      // Merge with existing files while preserving previously added ones
      this.processedFiles = [...this.processedFiles, ...addedFiles];

      // Reset file input for subsequent selections
      this.elements.attachmentsInput.value = "";

      // Clear current file items and re-render full list
      const container = this.elements.fileItemsContainer || this.elements.filesContainer;
      if (container) container.innerHTML = "";

      this.processedFiles.forEach((file) => {
        const fileButton = document.createElement("button");
        fileButton.className = "file-button";
        fileButton.setAttribute("aria-label", `View ${file.name}`);
        fileButton.innerHTML = FILE_BUTTON_TEMPLATE(file);

        const copyBtn = fileButton.querySelector(".copy-filename");
        copyBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          navigator.clipboard.writeText(file.name);
          copyBtn.classList.add("copied");
          setTimeout(() => copyBtn.classList.remove("copied"), 1000);
        });

        const deleteBtn = fileButton.querySelector(".delete-file");
        deleteBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const idx = this.processedFiles.findIndex((f) => f.name === file.name);
          if (idx !== -1) {
            this.processedFiles.splice(idx, 1);
            fileButton.remove();
          }

          // If no files left, return to empty state
          if (this.processedFiles.length === 0) {
            const c = this.elements.fileItemsContainer || this.elements.filesContainer;
            c.innerHTML = "";
            const emptyEl = document.createElement("div");
            emptyEl.id = "files-empty";
            emptyEl.className = "empty-file-button";
            emptyEl.setAttribute("role", "button");
            emptyEl.setAttribute("tabindex", "0");
            emptyEl.setAttribute("aria-label", "No file attached, click to attach file");
            emptyEl.textContent = "No file attached, click to attach file";
            emptyEl.addEventListener("click", () => this.elements.attachmentsInput?.click());
            emptyEl.addEventListener("keydown", (evt) => this.handleEmptyStateKeydown(evt));
            c.appendChild(emptyEl);
            this.elements.filesEmpty = emptyEl;
          }

          this.updateAttachmentControlsState();
        });

        fileButton.addEventListener("click", () => this.showFileViewer(file));
        (this.elements.fileItemsContainer || this.elements.filesContainer).appendChild(fileButton);
      });

      // Update action buttons state
      this.updateAttachmentControlsState();
      this.clearError();
    } catch (error) {
      this.showError(`Error processing attachments: ${error.message}`);
    }
  }

  updateAttachmentControlsState() {
    const hasFiles = this.processedFiles.length > 0;
    const hasTextFile = this.processedFiles.some((file) => {
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      const t = (file.type || "").toLowerCase();
      return ["txt", "html", "json"].includes(ext) || t.includes("text") || t.includes("json") || t.includes("html");
    });

    if (this.elements.deleteAllButton) {
      this.elements.deleteAllButton.disabled = !hasFiles;
      this.elements.deleteAllButton.setAttribute("aria-disabled", String(!hasFiles));
    }

    if (this.elements.minifyButton) {
      this.elements.minifyButton.disabled = !hasTextFile;
      this.elements.minifyButton.setAttribute("aria-disabled", String(!hasTextFile));
    }

    if (this.elements.filesEmpty) {
      this.elements.filesEmpty.style.display = hasFiles ? "none" : "";
    }

    if (this.elements.attachmentsControls) {
      // Show action bar only when files exist
      this.elements.attachmentsControls.style.display = hasFiles ? "" : "none";
    }
  }

  async handleMinifyAttachments() {
    if (!this.processedFiles.length) return;
    const btn = this.elements.minifyButton;
    if (btn) {
      btn.textContent = "Processing...";
      btn.disabled = true;
      btn.setAttribute("aria-disabled", "true");
    }

    this.processedFiles = await Promise.all(
      this.processedFiles.map(async (file) => {
        const ext = (file.name.split(".").pop() || "").toLowerCase();
        const t = (file.type || "").toLowerCase();
        if (["txt", "html", "htm", "json"].includes(ext) || t.includes("text") || t.includes("json") || t.includes("html")) {
          return await this.attachmentProcessorService.minifyContent(file);
        }
        return file;
      })
    );

    // Refresh viewer if it's open
    const fileViewer = document.getElementById("fileViewerOverlay");
    if (fileViewer && !fileViewer.classList.contains("hidden")) {
      const activeFileName = document.getElementById("fileViewerTitle")?.textContent;
      const activeFile = this.processedFiles.find((f) => f.name === activeFileName);
      if (activeFile) {
        this.showFileViewer(activeFile);
      }
    }

    if (btn) {
      btn.textContent = "Minify";
      btn.disabled = false;
      btn.setAttribute("aria-disabled", "false");
    }
    this.updateAttachmentControlsState();
  }

  handleDeleteAllAttachments() {
    this.processedFiles = [];
    const container = this.elements.fileItemsContainer || this.elements.filesContainer;
    if (container) {
      container.innerHTML = "";
      const emptyEl = document.createElement("div");
      emptyEl.id = "files-empty";
      emptyEl.className = "empty-file-button";
      emptyEl.setAttribute("role", "button");
      emptyEl.setAttribute("tabindex", "0");
      emptyEl.setAttribute("aria-label", "No file attached, click to attach file");
      emptyEl.textContent = "No file attached, click to attach file";
      emptyEl.addEventListener("click", () => this.elements.attachmentsInput?.click());
      emptyEl.addEventListener("keydown", (evt) => this.handleEmptyStateKeydown(evt));
      container.appendChild(emptyEl);
      this.elements.filesEmpty = emptyEl;
    }

    this.updateAttachmentControlsState();
  }

  handleEmptyStateKeydown(evt) {
    if (evt.key === "Enter" || evt.key === " ") {
      evt.preventDefault();
      this.elements.attachmentsInput && this.elements.attachmentsInput.click();
    }
  }

  showFileViewer(file) {
    const overlay = document.getElementById("fileViewerOverlay");
    const title = document.getElementById("fileViewerTitle");
    const originalContent = document.getElementById("originalContent");
    const processedContent = document.getElementById("processedContent");
    const metadata = document.getElementById("fileMetadata");
    const processedTab = document.querySelector('.qq-tab-button[data-tab="processed"]');

    console.log("File viewer showing for file:", file);
    title.textContent = file.name;

    // Clear previous content
    originalContent.innerHTML = "";
    processedContent.innerHTML = "";

    const metadataElements = {
      fileType: document.getElementById("fileType"),
      fileSize: document.getElementById("fileSize"),
      base64Size: document.getElementById("base64Size"),
      dimensions: document.getElementById("dimensions"),
      lineCount: document.getElementById("lineCount"),
      charCount: document.getElementById("charCount"),
    };

    // clear previous content
    Object.values(metadataElements).forEach((el) => (el.textContent = ""));
    Object.values(metadataElements).forEach((el) => el.classList.add("hidden"));
    // Set common metadata
    metadataElements.fileType.textContent = `File Type: ${file.type}`;
    metadataElements.fileType.classList.remove("hidden");

    // Handle different file types
    if (file.type.startsWith("image/") || file.type === "application/pdf") {
      // Original content (actual file)
      const viewer = document.createElement("div");
      viewer.className = file.type.startsWith("image/") ? "image-viewer" : "pdf-viewer";

      if (file.type.startsWith("image/")) {
        const img = document.createElement("img");
        img.src = file.processedFormats.base64;
        viewer.appendChild(img);

        // Update metadata once image is loaded
        img.onload = () => {
          metadataElements.fileSize.textContent = `Media Size: ${(file.size / 1024).toFixed(2)} KB`;
          metadataElements.base64Size.textContent = `Base64 Size: ${(file.processedFormats.base64.length / 1024).toFixed(2)} KB`;
          metadataElements.dimensions.textContent = `Dimensions: ${img.naturalWidth} × ${img.naturalHeight}`;

          [metadataElements.fileSize, metadataElements.base64Size, metadataElements.dimensions].forEach((el) =>
            el.classList.remove("hidden")
          );
        };
      } else {
        // PDF viewer
        const obj = document.createElement("object");
        obj.data = file.processedFormats.base64;
        obj.type = "application/pdf";
        obj.width = "100%";
        obj.height = "600px";
        viewer.appendChild(obj);

        metadataElements.fileSize.textContent = `Size: ${(file.size / 1024).toFixed(2)} KB`;
        metadataElements.base64Size.textContent = `Base64 Size: ${(file.processedFormats.base64.length / 1024).toFixed(2)} KB`;
        [metadataElements.fileSize, metadataElements.base64Size].forEach((el) => el.classList.remove("hidden"));
      }

      originalContent.appendChild(viewer);

      // Processed content (base64 string)
      const pre = document.createElement("pre");
      pre.className = "base64-content";
      pre.textContent = file.processedFormats.base64;
      processedContent.appendChild(pre);

      // Show both tabs
      processedTab.style.display = "block";
    } else if (file.processedFormats.contentType?.includes("base64")) {
      // For base64 text files: Original = Base64, Processed = Rendered content

      // Original content (base64 text)
      const pre = document.createElement("pre");
      pre.className = "base64-content";
      pre.textContent = file.processedFormats.original;
      originalContent.appendChild(pre);

      // Processed content (rendered base64)
      const viewer = document.createElement("div");
      viewer.className = "rendered-content";

      if (file.processedFormats.base64.startsWith("data:image/")) {
        const img = document.createElement("img");
        img.src = file.processedFormats.base64;
        viewer.appendChild(img);
      } else if (file.processedFormats.base64.startsWith("data:application/pdf")) {
        const obj = document.createElement("object");
        obj.data = file.processedFormats.base64;
        obj.type = "application/pdf";
        viewer.appendChild(obj);
      }

      processedContent.appendChild(viewer);

      // Show both tabs
      processedTab.style.display = "block";

      metadataElements.fileSize.textContent = `Original Media Size: ${(file.processedFormats.sizes.original / 1024).toFixed(2)} KB`;
      if (file.processedFormats.base64) {
        metadataElements.base64Size.textContent = `Base64 Size: ${(file.processedFormats.base64.length / 1024).toFixed(2)} KB`;
        metadataElements.base64Size.classList.remove("hidden");
      }
      metadataElements.fileSize.classList.remove("hidden");
    } else {
      // For regular text files (txt, json, html): Only show original
      const pre = document.createElement("pre");
      pre.className = "text-content";
      pre.textContent = file.processedFormats.original;
      originalContent.appendChild(pre);

      const textLength = file.processedFormats.original.length;
      const lineCount = (file.processedFormats.original.match(/\n/g) || []).length + 1;

      metadataElements.fileSize.textContent = `Size: ${(textLength / 1024).toFixed(2)} KB`;
      metadataElements.lineCount.textContent = `Lines: ${lineCount}`;
      metadataElements.charCount.textContent = `Characters: ${textLength}`;

      [metadataElements.fileSize, metadataElements.lineCount, metadataElements.charCount].forEach((el) => el.classList.remove("hidden"));

      // Hide processed tab
      processedTab.style.display = "none";
    }

    // Show overlay and set initial state
    overlay.classList.remove("hidden");
    document.querySelector('.qq-tab-button[data-tab="original"]').classList.add("active");
    document.getElementById("originalContent").classList.add("active");

    // Add tab switching functionality
    document.querySelectorAll(".qq-tab-button").forEach((button) => {
      button.onclick = () => {
        document.querySelectorAll(".qq-tab-button").forEach((btn) => btn.classList.remove("active"));
        button.classList.add("active");

        document.querySelectorAll(".tab-content").forEach((content) => content.classList.remove("active"));
        document.getElementById(`${button.dataset.tab}Content`).classList.add("active");
      };
    });

    // Add close button handler
    document.getElementById("closeFileViewer").onclick = () => {
      overlay.classList.add("hidden");
    };
  }

  showFilePreview() {
    this.elements.filePreviewOverlay.classList.remove("hidden");
  }
  closeFilePreview() {
    this.elements.filePreviewOverlay.classList.add("hidden");
  }
}

// Export the main initialization function
export async function initQuickQuery(container) {
  return new QuickQueryUI(container);
}
