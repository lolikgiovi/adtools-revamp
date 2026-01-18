/**
 * Compare Config Tool
 * Oracle database configuration comparison tool
 */

import { CompareConfigService } from "./service.js";
import { CompareConfigTemplate } from "./template.js";
import { BaseTool } from "../../core/BaseTool.js";
import { getIconSvg } from "./icon.js";
import { VerticalCardView } from "./views/VerticalCardView.js";
import { MasterDetailView } from "./views/MasterDetailView.js";
import { GridView } from "./views/GridView.js";
import { getFeatureFlag, FLAGS } from "./lib/feature-flags.js";
import { enhanceWithDetailedDiff } from "./lib/diff-adapter.js";
import { isTauri } from "../../core/Runtime.js";
import * as FileParser from "./lib/file-parser.js";
import * as FileMatcher from "./lib/file-matcher.js";
import { ExcelComparator } from "./lib/excel-comparator.js";
import * as IndexedDBManager from "./lib/indexed-db-manager.js";

class CompareConfigTool extends BaseTool {
  constructor(eventBus) {
    super({
      id: "compare-config",
      name: "Compare Config",
      description: "Compare Oracle database configs between environments",
      icon: "database-compare",
      category: "database",
      eventBus: eventBus,
    });

    // State
    this.oracleClientReady = false;
    this.savedConnections = [];
    this.queryMode = "schema-table"; // "schema-table" or "raw-sql"

    // Schema/Table mode state
    this.env1 = {
      connection: null,
    };
    this.env2 = {
      connection: null,
    };
    this.schema = null;
    this.table = null;
    this.metadata = null;
    this.env2SchemaExists = false;
    this.env2TableExists = false;
    this.customPrimaryKey = []; // Custom PK fields for comparison
    this.selectedFields = [];
    this.whereClause = "";
    this.maxRows = 100; // Max rows to fetch (default: 100)

    // Raw SQL mode state
    this.rawenv1 = {
      connection: null,
    };
    this.rawenv2 = {
      connection: null,
    };
    this.rawSql = ""; // Single SQL query for both environments
    this.rawPrimaryKey = ""; // Optional primary key field(s) for raw SQL mode
    this.rawMaxRows = 100; // Max rows for raw SQL mode (default: 100)

    this.statusFilter = null; // null = show all, or "match", "differ", "only_in_env1", "only_in_env2"

    // Multi-tab results support
    this.results = {
      "schema-table": null,
      "raw-sql": null,
      "excel-compare": null,
    };

    // Excel Compare state (new single-pair flow)
    this.excelCompare = {
      // Step 1: File upload
      refFiles: [], // Array of { id, file }
      compFiles: [], // Array of { id, file }

      // Step 2: File pairing
      selectedRefFile: null, // Selected reference file { id, file }
      selectedCompFile: null, // Selected comparator file { id, file }
      autoMatchedComp: null, // Auto-matched comparator (for UI hint)

      // Step 3: Field configuration
      headers: [], // All detected headers (union)
      commonHeaders: [], // Headers in both files
      refOnlyHeaders: [], // Headers only in reference
      compOnlyHeaders: [], // Headers only in comparator
      selectedPkFields: [], // Selected primary key fields
      selectedFields: [], // Selected comparison fields
      rowMatching: "key", // "key" or "position"
      dataComparison: "strict", // "strict" or "normalized"

      // Cached parsed data
      refParsedData: null,
      compParsedData: null,

      // UI state
      currentStep: 1, // 1=upload, 2=pairing, 3=config, 4=results
    };

    // View instances
    this.verticalCardView = new VerticalCardView();
    this.masterDetailView = new MasterDetailView();
    this.gridView = new GridView();

    // Connection status polling
    this.connectionStatusInterval = null;
  }

  getIconSvg() {
    return getIconSvg();
  }

  render() {
    return CompareConfigTemplate;
  }

  async onMount() {
    // Check if Oracle client is installed
    await this.checkOracleClient();

    // Initialize environment-based visibility (Tauri vs Web)
    this.initEnvironmentVisibility();

    // Always bind UI events so the installation guide actions work
    this.bindEvents();

    // Load Excel Compare cached files from IndexedDB (works in both Tauri and Web)
    // Note: We load files but reset selection state to avoid confusing UI on navigation
    await this.loadExcelCompareFilesOnly();

    if (this.oracleClientReady) {
      // Load saved connections from localStorage
      this.loadSavedConnections();
      // Load last tool state
      this.loadToolState();
      // Start connection status polling
      this.startConnectionStatusPolling();
    }
  }

  /**
   * Checks if Oracle Instant Client is installed
   */
  async checkOracleClient() {
    try {
      this.oracleClientReady = await CompareConfigService.checkOracleClientReady();

      if (this.oracleClientReady) {
        // Prime the client
        await CompareConfigService.primeOracleClient();
        this.showMainInterface();
      } else {
        this.showInstallationGuide();
      }
    } catch (error) {
      console.error("Failed to check Oracle client:", error);
      this.showInstallationGuide();
    }
  }

  /**
   * Shows the installation guide
   */
  showInstallationGuide() {
    const guide = document.getElementById("installation-guide");
    const main = document.getElementById("main-interface");

    if (guide) guide.style.display = "block";
    if (main) main.style.display = "none";
  }

  /**
   * Shows the main interface
   */
  showMainInterface() {
    const guide = document.getElementById("installation-guide");
    const main = document.getElementById("main-interface");

    if (guide) guide.style.display = "none";
    if (main) main.style.display = "block";
  }

  /**
   * Initializes environment-based visibility (Tauri vs Web)
   */
  initEnvironmentVisibility() {
    const tauri = isTauri();

    // Elements that only work in Tauri (database modes)
    const tauriOnlyElements = document.querySelectorAll(".tauri-only");
    tauriOnlyElements.forEach((el) => {
      el.style.display = tauri ? "" : "none";
    });

    // If in web mode, we must use Excel Compare
    if (!tauri) {
      this.queryMode = "excel-compare";
      this.switchTab("excel-compare");
    }
  }

  /**
   * Loads saved Oracle connections from localStorage
   */
  loadSavedConnections() {
    try {
      const connections = localStorage.getItem("config.oracle.connections");
      if (connections) {
        this.savedConnections = JSON.parse(connections);
        this.populateConnectionDropdowns();
      } else {
        this.savedConnections = [];
        this.showNoConnectionsMessage();
      }
    } catch (error) {
      console.error("Failed to load saved connections:", error);
      this.savedConnections = [];
    }
  }

  /**
   * Saves current tool state to localStorage
   */
  saveToolState() {
    try {
      const state = {
        queryMode: this.queryMode,
        env1: this.env1.connection ? this.env1.connection.name : null,
        env2: this.env2.connection ? this.env2.connection.name : null,
        schema: this.schema,
        table: this.table,
        metadata: this.metadata,
        customPrimaryKey: this.customPrimaryKey,
        selectedFields: this.selectedFields,
        whereClause: this.whereClause,
        maxRows: this.maxRows,
        env2SchemaExists: this.env2SchemaExists,
        env2TableExists: this.env2TableExists,

        rawenv1: this.rawenv1.connection ? this.rawenv1.connection.name : null,
        rawenv2: this.rawenv2.connection ? this.rawenv2.connection.name : null,
        rawSql: this.rawSql,
        rawPrimaryKey: this.rawPrimaryKey,
        rawMaxRows: this.rawMaxRows,

        currentView: this.currentView,
        statusFilter: this.statusFilter,
        results: this.results,
      };

      // Try to save to localStorage
      try {
        localStorage.setItem("compare-config.last-state", JSON.stringify(state));
      } catch (e) {
        // If quota exceeded, try saving without large results
        console.warn("Could not save full state to localStorage (likely quota exceeded). Saving without results.");
        state.results = { "schema-table": null, "raw-sql": null };
        localStorage.setItem("compare-config.last-state", JSON.stringify(state));
      }
    } catch (error) {
      console.error("Failed to save tool state:", error);
    }
  }

  /**
   * Loads last tool state from localStorage
   */
  loadToolState() {
    try {
      const saved = localStorage.getItem("compare-config.last-state");
      if (!saved) return;

      const state = JSON.parse(saved);

      // Restore results first to inform clean slate logic
      this.results = state.results || { "schema-table": null, "raw-sql": null, "excel-compare": null };

      // Restore basic state with clean-slate check
      this.queryMode = state.queryMode || "schema-table";

      // If no results for schema-table, clear its selection state
      if (this.results["schema-table"]) {
        this.schema = state.schema;
        this.table = state.table;
        this.metadata = state.metadata;
        this.customPrimaryKey = state.customPrimaryKey || [];
        this.selectedFields = state.selectedFields || [];
        this.env2SchemaExists = state.env2SchemaExists || false;
        this.env2TableExists = state.env2TableExists || false;
      } else {
        this.schema = null;
        this.table = null;
        this.metadata = null;
        this.customPrimaryKey = [];
        this.selectedFields = [];
        this.env2SchemaExists = false;
        this.env2TableExists = false;
      }

      // If no results for raw-sql, clear its selection state
      if (this.results["raw-sql"]) {
        this.rawSql = state.rawSql || "";
        this.rawPrimaryKey = state.rawPrimaryKey || "";
      } else {
        this.rawSql = "";
        this.rawPrimaryKey = "";
      }

      this.whereClause = state.whereClause || "";
      this.maxRows = state.maxRows || 100;
      this.rawMaxRows = state.rawMaxRows || 100;

      // Migrate old "expandable" view to "grid" (expandable removed from dropdown)
      const savedView = state.currentView || "grid";
      this.currentView = savedView === "expandable" ? "grid" : savedView;
      this.statusFilter = state.statusFilter;

      // Restore connections
      if (state.env1) {
        this.env1.connection = this.savedConnections.find((c) => c.name === state.env1) || null;
      }
      if (state.env2) {
        this.env2.connection = this.savedConnections.find((c) => c.name === state.env2) || null;
      }
      if (state.rawenv1) {
        this.rawenv1.connection = this.savedConnections.find((c) => c.name === state.rawenv1) || null;
      }
      if (state.rawenv2) {
        this.rawenv2.connection = this.savedConnections.find((c) => c.name === state.rawenv2) || null;
      }

      // Restore UI
      this.restoreUIFromState();
    } catch (error) {
      console.error("Failed to load tool state:", error);
    }
  }

  /**
   * Restores UI elements from loaded state
   */
  restoreUIFromState() {
    // 1. Set active tab
    this.switchTab(this.queryMode);

    // 2. Set dropdowns and inputs
    const env1Select = document.getElementById("env1-connection");
    const env2Select = document.getElementById("env2-connection");
    const schemaSelect = document.getElementById("schema-select");
    const tableSelect = document.getElementById("table-select");
    const whereClauseInput = document.getElementById("where-clause");
    const maxRowsInput = document.getElementById("max-rows");

    if (env1Select && this.env1.connection) env1Select.value = this.env1.connection.name;
    if (env2Select && this.env2.connection) env2Select.value = this.env2.connection.name;

    // If we have metadata, we can show fields and set schema/table
    // If we have metadata, we can show fields and set schema/table
    if (this.metadata && this.schema && this.table) {
      // Only show field selection UI if we are in schema-table mode
      if (this.queryMode === "schema-table") {
        this.showFieldSelection();
      }
      if (schemaSelect) {
        schemaSelect.innerHTML = `<option value="${this.schema}">${this.schema}</option>`;
        schemaSelect.value = this.schema;
        schemaSelect.disabled = false;
      }
      if (tableSelect) {
        tableSelect.innerHTML = `<option value="${this.table}">${this.table}</option>`;
        tableSelect.value = this.table;
        tableSelect.disabled = false;
      }
    }

    if (whereClauseInput) whereClauseInput.value = this.whereClause;
    if (maxRowsInput) maxRowsInput.value = this.maxRows;

    // 3. Set Raw SQL inputs
    const rawEnv1Select = document.getElementById("raw-env1-connection");
    const rawEnv2Select = document.getElementById("raw-env2-connection");
    const rawSqlInput = document.getElementById("raw-sql");
    const rawPrimaryKeyInput = document.getElementById("raw-primary-key");
    const rawMaxRowsInput = document.getElementById("raw-max-rows");

    if (rawEnv1Select && this.rawenv1.connection) rawEnv1Select.value = this.rawenv1.connection.name;
    if (rawEnv2Select && this.rawenv2.connection) rawEnv2Select.value = this.rawenv2.connection.name;
    if (rawSqlInput) rawSqlInput.value = this.rawSql;
    if (rawPrimaryKeyInput) rawPrimaryKeyInput.value = this.rawPrimaryKey;
    if (rawMaxRowsInput) rawMaxRowsInput.value = this.rawMaxRows;

    // 4. Show results if they exist for current tab
    if (this.results[this.queryMode]) {
      this.showResults();
      // Set view type selector
      const viewTypeSelect = document.getElementById("view-type");
      if (viewTypeSelect) viewTypeSelect.value = this.currentView;
    }
  }

  /**
   * Populates connection dropdowns
   */
  populateConnectionDropdowns() {
    const env1Select = document.getElementById("env1-connection");
    const env2Select = document.getElementById("env2-connection");
    const rawEnv1Select = document.getElementById("raw-env1-connection");
    const rawEnv2Select = document.getElementById("raw-env2-connection");

    // Schema/Table mode dropdowns
    if (env1Select && env2Select) {
      env1Select.innerHTML = '<option value="">Select connection...</option>';
      env2Select.innerHTML = '<option value="">Select connection...</option>';

      this.savedConnections.forEach((conn) => {
        const option1 = document.createElement("option");
        option1.value = conn.name;
        option1.textContent = conn.name;
        env1Select.appendChild(option1);

        const option2 = document.createElement("option");
        option2.value = conn.name;
        option2.textContent = conn.name;
        env2Select.appendChild(option2);
      });
    }

    // Raw SQL mode dropdowns
    if (rawEnv1Select && rawEnv2Select) {
      rawEnv1Select.innerHTML = '<option value="">Select connection...</option>';
      rawEnv2Select.innerHTML = '<option value="">Select connection...</option>';

      this.savedConnections.forEach((conn) => {
        const option1 = document.createElement("option");
        option1.value = conn.name;
        option1.textContent = conn.name;
        rawEnv1Select.appendChild(option1);

        const option2 = document.createElement("option");
        option2.value = conn.name;
        option2.textContent = conn.name;
        rawEnv2Select.appendChild(option2);
      });
    }
  }

  /**
   * Shows a message when no connections are configured
   */
  showNoConnectionsMessage() {
    const main = document.getElementById("main-interface");
    if (!main) return;

    const message = document.createElement("div");
    message.className = "no-connections-message";
    message.innerHTML = `
      <div class="installation-card">
        <h3>No Oracle Connections Configured</h3>
        <p>Please configure Oracle database connections in Settings before using this tool.</p>
        <button class="btn btn-primary" id="btn-go-to-settings">Go to Settings</button>
      </div>
    `;

    // Replace content
    const envSelection = document.querySelector(".environment-selection");
    if (envSelection) {
      envSelection.innerHTML = "";
      envSelection.appendChild(message);

      // Bind event
      const settingsBtn = document.getElementById("btn-go-to-settings");
      if (settingsBtn) {
        settingsBtn.addEventListener("click", () => {
          this.eventBus.emit("navigate", "settings");
        });
      }
    }
  }

  /**
   * Binds event listeners
   */
  bindEvents() {
    // Tab switching events
    const tabButtons = document.querySelectorAll(".tab-button");
    tabButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;
        this.switchTab(tab);
      });
    });

    // Connection status close button
    const closeConnectionsBtn = document.querySelector(".btn-close-connections");
    if (closeConnectionsBtn) {
      closeConnectionsBtn.addEventListener("click", () => this.closeAllConnections());
    }

    // Installation guide events
    const checkAgainBtn = document.getElementById("btn-check-again");
    const copyCommandBtn = document.querySelector(".btn-copy-command");
    const troubleshootingBtn = document.getElementById("btn-troubleshooting");

    if (checkAgainBtn) {
      checkAgainBtn.addEventListener("click", async () => {
        // Provide immediate feedback while checking
        const originalHtml = checkAgainBtn.innerHTML;
        checkAgainBtn.disabled = true;
        checkAgainBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline-block; vertical-align: middle; margin-right: 6px;">
            <circle cx="12" cy="12" r="10" opacity="0.3"/>
            <path d="M12 2 a10 10 0 0 1 0 20"/>
          </svg>
          Checking...`;
        try {
          await this.checkOracleClient();
        } finally {
          checkAgainBtn.disabled = false;
          checkAgainBtn.innerHTML = originalHtml;
        }
      });
    }

    if (copyCommandBtn) {
      copyCommandBtn.addEventListener("click", () => this.copyInstallCommand());
    }

    if (troubleshootingBtn) {
      troubleshootingBtn.addEventListener("click", () => this.showTroubleshootingModal());
    }

    // Environment selection events
    const env1Connection = document.getElementById("env1-connection");
    const env2Connection = document.getElementById("env2-connection");
    const schemaSelect = document.getElementById("schema-select");
    const tableSelect = document.getElementById("table-select");

    if (env1Connection) {
      env1Connection.addEventListener("change", (e) => this.onConnectionSelected("env1", e.target.value));
    }

    if (env2Connection) {
      env2Connection.addEventListener("change", (e) => this.onConnectionSelected("env2", e.target.value));
    }

    if (schemaSelect) {
      schemaSelect.addEventListener("change", (e) => this.onSchemaSelected(e.target.value));
    }

    if (tableSelect) {
      tableSelect.addEventListener("change", (e) => this.onTableSelected(e.target.value));
    }

    // Primary key selection events
    const selectAllPkBtn = document.getElementById("btn-select-all-pk");
    const deselectAllPkBtn = document.getElementById("btn-deselect-all-pk");

    if (selectAllPkBtn) {
      selectAllPkBtn.addEventListener("click", () => this.selectAllPkFields(true));
    }

    if (deselectAllPkBtn) {
      deselectAllPkBtn.addEventListener("click", () => this.selectAllPkFields(false));
    }

    // Field selection events
    const selectAllBtn = document.getElementById("btn-select-all");
    const deselectAllBtn = document.getElementById("btn-deselect-all");
    const compareBtn = document.getElementById("btn-compare");
    const whereClauseInput = document.getElementById("where-clause");

    if (selectAllBtn) {
      selectAllBtn.addEventListener("click", () => this.selectAllFields(true));
    }

    if (deselectAllBtn) {
      deselectAllBtn.addEventListener("click", () => this.selectAllFields(false));
    }

    if (compareBtn) {
      compareBtn.addEventListener("click", () => this.executeComparison());
    }

    if (whereClauseInput) {
      whereClauseInput.addEventListener("input", (e) => {
        this.whereClause = e.target.value.trim();
      });
    }

    const maxRowsInput = document.getElementById("max-rows");
    if (maxRowsInput) {
      maxRowsInput.addEventListener("input", (e) => {
        const value = parseInt(e.target.value, 10);
        this.maxRows = isNaN(value) || value < 1 ? 100 : Math.min(value, 10000);
      });
    }

    // Raw SQL mode events
    const compareRawSqlBtn = document.getElementById("btn-compare-raw-sql");
    const rawSqlInput = document.getElementById("raw-sql");
    const rawPrimaryKeyInput = document.getElementById("raw-primary-key");
    const rawEnv1Connection = document.getElementById("raw-env1-connection");
    const rawEnv2Connection = document.getElementById("raw-env2-connection");
    const rawMaxRowsInput = document.getElementById("raw-max-rows");

    if (compareRawSqlBtn) {
      compareRawSqlBtn.addEventListener("click", () => this.executeRawSqlComparison());
    }

    if (rawSqlInput) {
      rawSqlInput.addEventListener("input", (e) => {
        this.rawSql = e.target.value.trim();
      });
      // Load saved preferences when SQL query input loses focus
      rawSqlInput.addEventListener("blur", () => {
        if (this.rawSql) {
          this.loadRawSqlPrefsFromIndexedDB();
        }
      });
    }

    if (rawPrimaryKeyInput) {
      rawPrimaryKeyInput.addEventListener("input", (e) => {
        this.rawPrimaryKey = e.target.value.trim();
      });
    }

    if (rawMaxRowsInput) {
      rawMaxRowsInput.addEventListener("input", (e) => {
        const value = parseInt(e.target.value, 10);
        this.rawMaxRows = isNaN(value) || value < 1 ? 100 : Math.min(value, 10000);
      });
    }

    if (rawEnv1Connection) {
      rawEnv1Connection.addEventListener("change", (e) => this.onRawConnectionSelected("env1", e.target.value));
    }

    if (rawEnv2Connection) {
      rawEnv2Connection.addEventListener("change", (e) => this.onRawConnectionSelected("env2", e.target.value));
    }

    // Excel Compare mode events
    const refDropzone = document.getElementById("ref-dropzone");
    const compDropzone = document.getElementById("comp-dropzone");
    const refFileInput = document.getElementById("ref-file-input");
    const compFileInput = document.getElementById("comp-file-input");

    // New flow: Clear All buttons
    const refClearAllBtn = document.getElementById("ref-clear-all");
    const compClearAllBtn = document.getElementById("comp-clear-all");

    if (refClearAllBtn) {
      refClearAllBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.clearAllExcelFiles("ref");
      });
    }

    if (compClearAllBtn) {
      compClearAllBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.clearAllExcelFiles("comp");
      });
    }

    // New flow: Excel field selection events
    this.bindExcelFieldSelectionEvents();

    // Legacy elements (kept for backward compatibility but may be unused)
    const rowMatchingRadios = document.querySelectorAll('input[name="row-matching"]');
    const dataComparisonRadios = document.querySelectorAll('input[name="data-comparison"]');
    const excelPkColumnsInput = document.getElementById("excel-pk-columns");

    if (refDropzone) {
      // Handle "browse" click
      const refBrowse = document.getElementById("ref-browse");
      if (refBrowse) {
        refBrowse.addEventListener("click", (e) => {
          e.stopPropagation();
          refFileInput.click();
        });
      }

      // Handle "select folder" click
      const refFolderBrowse = document.getElementById("ref-folder-browse");
      if (refFolderBrowse) {
        refFolderBrowse.addEventListener("click", (e) => {
          e.stopPropagation();
          this.handleFolderSelection("ref");
        });
      }

      refDropzone.addEventListener("click", (e) => {
        // Only trigger generic browse if clicking background, not links
        if (e.target.classList.contains("browse-link")) return;
        refFileInput.click();
      });

      refDropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        refDropzone.classList.add("drag-over");
      });
      refDropzone.addEventListener("dragleave", () => refDropzone.classList.remove("drag-over"));
      refDropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        refDropzone.classList.remove("drag-over");
        this.handleExcelFileSelection("ref", e.dataTransfer.files);
      });
    }

    if (compDropzone) {
      // Handle "browse" click
      const compBrowse = document.getElementById("comp-browse");
      if (compBrowse) {
        compBrowse.addEventListener("click", (e) => {
          e.stopPropagation();
          compFileInput.click();
        });
      }

      // Handle "select folder" click
      const compFolderBrowse = document.getElementById("comp-folder-browse");
      if (compFolderBrowse) {
        compFolderBrowse.addEventListener("click", (e) => {
          e.stopPropagation();
          this.handleFolderSelection("comp");
        });
      }

      compDropzone.addEventListener("click", (e) => {
        // Only trigger generic browse if clicking background, not links
        if (e.target.classList.contains("browse-link")) return;
        compFileInput.click();
      });

      compDropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        compDropzone.classList.add("drag-over");
      });
      compDropzone.addEventListener("dragleave", () => compDropzone.classList.remove("drag-over"));
      compDropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        compDropzone.classList.remove("drag-over");
        this.handleExcelFileSelection("comp", e.dataTransfer.files);
      });
    }

    if (refFileInput) {
      refFileInput.addEventListener("change", (e) => this.handleExcelFileSelection("ref", e.target.files));
    }

    if (compFileInput) {
      compFileInput.addEventListener("change", (e) => this.handleExcelFileSelection("comp", e.target.files));
    }

    const refFolderInput = document.getElementById("ref-folder-input");
    const compFolderInput = document.getElementById("comp-folder-input");

    if (refFolderInput) {
      refFolderInput.addEventListener("change", (e) => this.handleExcelFileSelection("ref", e.target.files));
    }

    if (compFolderInput) {
      compFolderInput.addEventListener("change", (e) => this.handleExcelFileSelection("comp", e.target.files));
    }

    // Legacy radio listeners (kept for backward compatibility)
    rowMatchingRadios.forEach((radio) => {
      radio.addEventListener("change", (e) => {
        this.excelCompare.rowMatching = e.target.value;
        this.saveExcelCompareStateToIndexedDB();
      });
    });

    dataComparisonRadios.forEach((radio) => {
      radio.addEventListener("change", (e) => {
        this.excelCompare.dataComparison = e.target.value;
        this.saveExcelCompareStateToIndexedDB();
      });
    });

    // Modal events
    const modalOverlay = document.getElementById("excel-modal-overlay");
    const closeModalBtn = modalOverlay?.querySelector(".btn-close-modal");
    const modalCancelBtn = document.getElementById("btn-modal-cancel");

    if (closeModalBtn) closeModalBtn.addEventListener("click", () => this.closeExcelModal());
    if (modalCancelBtn) modalCancelBtn.addEventListener("click", () => this.closeExcelModal());

    // Click outside modal to close
    if (modalOverlay) {
      modalOverlay.addEventListener("click", (e) => {
        if (e.target === modalOverlay) this.closeExcelModal();
      });
    }

    // Results events
    const exportJsonBtn = document.getElementById("btn-export-json");
    const exportCsvBtn = document.getElementById("btn-export-csv");
    const newComparisonBtn = document.getElementById("btn-new-comparison");
    const viewTypeSelect = document.getElementById("view-type");

    if (exportJsonBtn) {
      exportJsonBtn.addEventListener("click", () => this.exportResults("json"));
    }

    if (exportCsvBtn) {
      exportCsvBtn.addEventListener("click", () => this.exportResults("csv"));
    }

    if (newComparisonBtn) {
      newComparisonBtn.addEventListener("click", () => this.resetForm());
    }

    if (viewTypeSelect) {
      viewTypeSelect.addEventListener("change", (e) => this.changeView(e.target.value));
    }
  }

  /**
   * Switches between tabs (schema-table vs raw-sql)
   */
  switchTab(tab) {
    this.queryMode = tab;

    // Update tab button states
    const tabButtons = document.querySelectorAll(".tab-button");
    tabButtons.forEach((btn) => {
      if (btn.dataset.tab === tab) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    // Show/hide appropriate UI sections
    const envSelection = document.querySelector(".environment-selection");
    const fieldSelection = document.getElementById("field-selection");
    const rawSqlMode = document.getElementById("raw-sql-mode");
    const excelCompareMode = document.getElementById("excel-compare-mode");
    const resultsSection = document.getElementById("results-section");

    if (tab === "schema-table") {
      if (envSelection) envSelection.style.display = "block";
      if (fieldSelection) fieldSelection.style.display = this.metadata ? "block" : "none";
      if (rawSqlMode) rawSqlMode.style.display = "none";
      if (excelCompareMode) excelCompareMode.style.display = "none";
    } else if (tab === "raw-sql") {
      if (envSelection) envSelection.style.display = "none";
      if (fieldSelection) fieldSelection.style.display = "none";
      if (rawSqlMode) rawSqlMode.style.display = "block";
      if (excelCompareMode) excelCompareMode.style.display = "none";
    } else if (tab === "excel-compare") {
      if (envSelection) envSelection.style.display = "none";
      if (fieldSelection) fieldSelection.style.display = "none";
      if (rawSqlMode) rawSqlMode.style.display = "none";
      if (excelCompareMode) excelCompareMode.style.display = "block";
    }

    // Toggle results visibility based on current tab's results
    if (this.results[tab]) {
      this.showResults();
    } else if (resultsSection) {
      resultsSection.style.display = "none";
    }

    // Save state
    this.saveToolState();
  }

  /**
   * Handler for raw SQL connection selection
   */
  onRawConnectionSelected(envKey, connectionName) {
    if (!connectionName) {
      this[`raw${envKey}`] = { connection: null };
      return;
    }

    const connection = this.savedConnections.find((c) => c.name === connectionName);
    if (!connection) {
      console.error("Connection not found:", connectionName);
      return;
    }

    this[`raw${envKey}`] = { connection };
    this.saveToolState();
  }

  /**
   * Copies the installation command to clipboard
   */
  async copyInstallCommand() {
    const command = document.getElementById("install-command");
    const btn = document.querySelector(".btn-copy-command");

    if (!command) return;

    // Use BaseTool's copyToClipboard method
    await this.copyToClipboard(command.textContent, btn);
  }

  /**
   * Shows the troubleshooting modal
   */
  showTroubleshootingModal() {
    const content = `
      <h2>Oracle Client Troubleshooting</h2>

      <h3>Common Issues and Solutions:</h3>

      <h4>1. Architecture Mismatch</h4>
      <p><strong>Error:</strong> "Library not compatible with architecture"</p>
      <p><strong>Solution:</strong> Ensure you downloaded the correct version:</p>
      <ul>
        <li>Apple Silicon (M1/M2/M3): Download ARM64 version</li>
        <li>Intel Mac: Download x86_64 version</li>
      </ul>
      <p>Check your architecture: <code>uname -m</code></p>

      <h4>2. Library Not Found</h4>
      <p><strong>Error:</strong> "libclntsh.dylib not found"</p>
      <p><strong>Solution:</strong> Verify the library is in the correct location:</p>
      <code>ls -la ~/Documents/adtools_library/oracle_instantclient/libclntsh.dylib</code>

      <h4>3. Permission Denied</h4>
      <p><strong>Error:</strong> "Permission denied"</p>
      <p><strong>Solution:</strong> Set correct permissions:</p>
      <code>chmod -R 755 ~/Documents/adtools_library/oracle_instantclient/</code>

      <h4>4. Feature Still Unavailable After Installation</h4>
      <p><strong>Solution:</strong> Try these steps:</p>
      <ol>
        <li>Click "Check Again" button</li>
        <li>Restart AD Tools</li>
        <li>Verify installation by running the check command manually</li>
      </ol>

      <h4>5. Need More Help?</h4>
      <p>Visit the official Oracle Instant Client documentation:</p>
      <a href="https://www.oracle.com/database/technologies/instant-client.html" target="_blank">Oracle Instant Client Downloads</a>
    `;

    this.eventBus.emit("modal:show", {
      title: "Troubleshooting",
      content: content,
      size: "large",
    });
  }

  /**
   * Handler for connection selection
   */
  async onConnectionSelected(envKey, connectionName) {
    if (!connectionName) {
      // Reset connection
      this[envKey].connection = null;

      // Reset schema/table if both connections are cleared
      if (!this.env1.connection && !this.env2.connection) {
        this.resetSchemaTableSelection();
      } else if (this.env1.connection && this.env2.connection) {
        // One connection changed, validate again
        await this.onBothConnectionsSelected();
      }

      return;
    }

    // Find connection config
    const connection = this.savedConnections.find((c) => c.name === connectionName);
    if (!connection) {
      console.error("Connection not found:", connectionName);
      return;
    }

    this[envKey].connection = connection;

    // If both connections are now selected, fetch schemas from env1
    if (this.env1.connection && this.env2.connection) {
      await this.onBothConnectionsSelected();
    }
    this.saveToolState();
  }

  /**
   * Called when both connections are selected
   */
  async onBothConnectionsSelected() {
    const schemaSelect = document.getElementById("schema-select");
    if (!schemaSelect) return;

    try {
      // Show loading state
      schemaSelect.disabled = true;
      schemaSelect.innerHTML = '<option value="">Loading schemas from Env 1...</option>';

      // Fetch schemas from Env 1
      const schemas = await CompareConfigService.fetchSchemas(this.env1.connection.name, this.env1.connection);

      // Populate dropdown
      schemaSelect.innerHTML = '<option value="">Select schema...</option>';
      schemas.forEach((schema) => {
        const option = document.createElement("option");
        option.value = schema;
        option.textContent = schema;
        schemaSelect.appendChild(option);
      });

      schemaSelect.disabled = false;
    } catch (error) {
      console.error("Failed to fetch schemas:", error);
      schemaSelect.innerHTML = '<option value="">Connection error - retry</option>';

      const friendlyError = this.parseOracleError(error, this.env1.connection.name);
      this.eventBus.emit("notification:show", {
        type: "error",
        message: friendlyError,
      });
    }
  }

  /**
   * Resets schema and table selection
   */
  resetSchemaTableSelection() {
    this.schema = null;
    this.table = null;
    this.metadata = null;
    this.env2SchemaExists = false;
    this.env2TableExists = false;

    const schemaSelect = document.getElementById("schema-select");
    const tableSelect = document.getElementById("table-select");
    const validationMessage = document.getElementById("validation-message");
    const fieldSelection = document.getElementById("field-selection");

    if (schemaSelect) {
      schemaSelect.disabled = true;
      schemaSelect.innerHTML = '<option value="">Select connections first...</option>';
    }

    if (tableSelect) {
      tableSelect.disabled = true;
      tableSelect.innerHTML = '<option value="">Select schema first...</option>';
    }

    if (validationMessage) {
      validationMessage.style.display = "none";
    }

    if (fieldSelection) {
      fieldSelection.style.display = "none";
    }
  }

  /**
   * Handler for schema selection
   */
  async onSchemaSelected(schema) {
    if (!schema) {
      this.schema = null;
      this.table = null;
      this.metadata = null;

      const tableSelect = document.getElementById("table-select");
      const fieldSelection = document.getElementById("field-selection");

      if (tableSelect) {
        tableSelect.disabled = true;
        tableSelect.innerHTML = '<option value="">Select schema first...</option>';
      }

      if (fieldSelection) {
        fieldSelection.style.display = "none";
      }

      this.hideValidationMessage();
      return;
    }

    this.schema = schema;

    // Check if schema exists in Env 2
    await this.validateSchemaInEnv2(schema);

    if (!this.env2SchemaExists) {
      return; // Validation message already shown
    }

    // Fetch tables from Env 1
    await this.fetchTables();
    this.saveToolState();
  }

  /**
   * Validates that schema exists in Env 2
   */
  async validateSchemaInEnv2(schema) {
    try {
      const schemas = await CompareConfigService.fetchSchemas(this.env2.connection.name, this.env2.connection);

      this.env2SchemaExists = schemas.includes(schema);

      if (!this.env2SchemaExists) {
        this.showValidationMessage(
          `error`,
          `Schema "${schema}" does not exist in Env 2 (${this.env2.connection.name}). Please select a different schema.`,
        );

        // Disable table selection
        const tableSelect = document.getElementById("table-select");
        if (tableSelect) {
          tableSelect.disabled = true;
          tableSelect.innerHTML = '<option value="">Schema not available in Env 2</option>';
        }
      }
    } catch (error) {
      console.error("Failed to validate schema in Env 2:", error);
      this.showValidationMessage(`error`, `Failed to validate schema in Env 2: ${error.message || error}`);
    }
  }

  /**
   * Fetches tables from Env 1
   */
  async fetchTables() {
    const tableSelect = document.getElementById("table-select");
    if (!tableSelect) return;

    try {
      // Show loading state
      tableSelect.disabled = true;
      tableSelect.innerHTML = '<option value="">Loading tables from Env 1...</option>';

      // Fetch tables from Env 1
      const tables = await CompareConfigService.fetchTables(this.env1.connection.name, this.env1.connection, this.schema);

      // Populate dropdown
      tableSelect.innerHTML = '<option value="">Select table...</option>';
      tables.forEach((table) => {
        const option = document.createElement("option");
        option.value = table;
        option.textContent = table;
        tableSelect.appendChild(option);
      });

      tableSelect.disabled = false;
    } catch (error) {
      console.error("Failed to fetch tables:", error);
      tableSelect.innerHTML = '<option value="">Error loading tables</option>';

      this.eventBus.emit("notification:show", {
        type: "error",
        message: `Failed to fetch tables from Env 1: ${error.message || error}`,
      });
    }
  }

  /**
   * Handler for table selection
   */
  async onTableSelected(tableName) {
    if (!tableName) {
      this.table = null;
      this.metadata = null;

      const fieldSelection = document.getElementById("field-selection");
      if (fieldSelection) fieldSelection.style.display = "none";

      // Clear validation message when deselecting table
      this.hideValidationMessage();

      return;
    }

    this.table = tableName;

    // Check if table exists in Env 2
    await this.validateTableInEnv2(tableName);

    if (!this.env2TableExists) {
      return; // Validation message already shown
    }

    // Fetch table metadata from Env 1
    await this.fetchTableMetadata();

    // Load saved preferences from IndexedDB before showing field selection
    await this.loadSchemaTablePrefsFromIndexedDB();

    // Show field selection
    this.showFieldSelection();
    this.saveToolState();
  }

  /**
   * Validates that table exists in Env 2
   */
  async validateTableInEnv2(tableName) {
    try {
      const tables = await CompareConfigService.fetchTables(this.env2.connection.name, this.env2.connection, this.schema);

      this.env2TableExists = tables.includes(tableName);

      if (!this.env2TableExists) {
        this.showValidationMessage(
          `error`,
          `⚠️ Table "${this.schema}.${tableName}" does not exist in Env 2 (${this.env2.connection.name}). Please select a different table.`,
        );

        // Hide field selection
        const fieldSelection = document.getElementById("field-selection");
        if (fieldSelection) fieldSelection.style.display = "none";
      } else {
        // Table exists in both environments - hide validation message
        this.hideValidationMessage();
      }
    } catch (error) {
      console.error("Failed to validate table in Env 2:", error);
      this.showValidationMessage(`error`, `Failed to validate table in Env 2: ${error.message || error}`);
    }
  }

  /**
   * Fetches table metadata
   */
  async fetchTableMetadata() {
    try {
      // Show loading
      this.showLoading("Fetching table metadata...");

      // Fetch metadata from Env 1 (credentials retrieved from keychain in backend)
      const metadata = await CompareConfigService.fetchTableMetadata(
        this.env1.connection.name,
        this.env1.connection,
        this.schema,
        this.table,
      );

      // Store metadata
      this.metadata = metadata;

      this.hideLoading();
    } catch (error) {
      console.error("Failed to fetch table metadata:", error);
      this.hideLoading();

      this.eventBus.emit("notification:show", {
        type: "error",
        message: `Failed to fetch table metadata: ${error.message || error}`,
      });
    }
  }

  /**
   * Shows validation message
   */
  showValidationMessage(type, message) {
    const validationMessage = document.getElementById("validation-message");
    if (!validationMessage) return;

    validationMessage.className = `validation-message ${type}`;
    validationMessage.textContent = message;
    validationMessage.style.display = "block";
  }

  /**
   * Hides validation message
   */
  hideValidationMessage() {
    const validationMessage = document.getElementById("validation-message");
    if (validationMessage) {
      validationMessage.style.display = "none";
    }
  }

  /**
   * Shows field selection UI
   */
  showFieldSelection() {
    const fieldSelection = document.getElementById("field-selection");
    const pkFieldList = document.getElementById("pk-field-list");
    const fieldList = document.getElementById("field-list");

    if (!fieldSelection || !pkFieldList || !fieldList || !this.metadata) return;

    // Clear existing fields
    pkFieldList.innerHTML = "";
    fieldList.innerHTML = "";

    // Render PK field checkboxes - keep natural order from database metadata
    this.metadata.columns.forEach((column) => {
      const fieldDiv = document.createElement("div");
      fieldDiv.className = "field-checkbox";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = `pk-${column.name}`;
      checkbox.value = column.name;
      // Use saved state if available, otherwise use metadata default
      if (this.customPrimaryKey && this.customPrimaryKey.length > 0) {
        checkbox.checked = this.customPrimaryKey.includes(column.name);
      } else {
        checkbox.checked = column.is_pk;
      }

      checkbox.addEventListener("change", () => this.updateCustomPrimaryKey());

      const label = document.createElement("label");
      label.htmlFor = `pk-${column.name}`;
      label.textContent = column.name;
      if (column.is_pk) {
        label.textContent += " (Default PK)";
      }

      // Make the whole container clickable (excluding direct clicks on input/label)
      fieldDiv.addEventListener("click", (e) => {
        const targetTag = e.target.tagName;
        if (targetTag === "INPUT" || targetTag === "LABEL") return;
        checkbox.checked = !checkbox.checked;
        this.updateCustomPrimaryKey();
      });

      fieldDiv.appendChild(checkbox);
      fieldDiv.appendChild(label);
      pkFieldList.appendChild(fieldDiv);
    });

    // Initialize custom PK with default PK fields if not already set
    if (!this.customPrimaryKey || this.customPrimaryKey.length === 0) {
      this.customPrimaryKey = this.metadata.primary_key ? this.metadata.primary_key.slice() : [];
    }

    // Render field checkboxes
    sortedColumns.forEach((column) => {
      const fieldDiv = document.createElement("div");
      fieldDiv.className = "field-checkbox";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = `field-${column.name}`;
      checkbox.value = column.name;
      // Use saved state if available, otherwise default to all checked
      if (this.selectedFields && this.selectedFields.length > 0) {
        checkbox.checked = this.selectedFields.includes(column.name);
      } else {
        checkbox.checked = true;
      }

      checkbox.addEventListener("change", () => this.updateSelectedFields());

      const label = document.createElement("label");
      label.htmlFor = `field-${column.name}`;
      label.textContent = column.name;

      // Make the whole container clickable (excluding direct clicks on input/label)
      fieldDiv.addEventListener("click", (e) => {
        const targetTag = e.target.tagName;
        if (targetTag === "INPUT" || targetTag === "LABEL") return;
        checkbox.checked = !checkbox.checked;
        this.updateSelectedFields();
      });

      fieldDiv.appendChild(checkbox);
      fieldDiv.appendChild(label);
      fieldList.appendChild(fieldDiv);
    });

    // Initialize selected fields with all fields
    // Initialize selected fields if not already set
    if (!this.selectedFields || this.selectedFields.length === 0) {
      this.selectedFields = this.metadata.columns.map((c) => c.name);
    }

    // Show field selection section ONLY if we are in schema-table mode
    if (this.queryMode === "schema-table") {
      fieldSelection.style.display = "block";
    } else {
      fieldSelection.style.display = "none";
    }
  }

  /**
   * Updates custom primary key selection.
   * Also auto-includes primary key fields in field selection.
   */
  updateCustomPrimaryKey() {
    const pkCheckboxes = document.querySelectorAll('#pk-field-list input[type="checkbox"]');
    this.customPrimaryKey = [];

    pkCheckboxes.forEach((checkbox) => {
      if (checkbox.checked) {
        this.customPrimaryKey.push(checkbox.value);
      }
    });

    // Auto-include primary key fields in field selection
    this.customPrimaryKey.forEach((pkField) => {
      const fieldCheckbox = document.querySelector(`#field-list input[value="${pkField}"]`);
      if (fieldCheckbox && !fieldCheckbox.checked) {
        fieldCheckbox.checked = true;
      }
    });

    // Update selectedFields to reflect the change
    this.updateSelectedFields();
  }

  /**
   * Updates selected fields list
   */
  updateSelectedFields() {
    const checkboxes = document.querySelectorAll('#field-list input[type="checkbox"]');
    this.selectedFields = [];

    checkboxes.forEach((checkbox) => {
      if (checkbox.checked) {
        this.selectedFields.push(checkbox.value);
      }
    });

    // Save preferences to IndexedDB
    this.saveSchemaTablePrefsToIndexedDB();
  }

  /**
   * Selects/deselects all PK fields
   */
  selectAllPkFields(select) {
    const checkboxes = document.querySelectorAll('#pk-field-list input[type="checkbox"]');

    checkboxes.forEach((checkbox) => {
      checkbox.checked = select;
    });

    this.updateCustomPrimaryKey();
    this.saveToolState();
  }

  /**
   * Selects/deselects all fields
   */
  selectAllFields(select) {
    const checkboxes = document.querySelectorAll('#field-list input[type="checkbox"]');

    checkboxes.forEach((checkbox) => {
      checkbox.checked = select;
    });

    this.updateSelectedFields();
    this.saveToolState();
  }

  /**
   * Handle Folder Selection
   */
  async handleFolderSelection(side) {
    if (isTauri()) {
      await this._handleFolderUploadTauri(side);
    } else {
      // Web: trigger the hidden folder input
      const folderInput = document.getElementById(`${side}-folder-input`);
      if (folderInput) {
        folderInput.click();
      }
    }
  }

  /**
   * Handle folder selection for Tauri (desktop)
   */
  async _handleFolderUploadTauri(side) {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { readDir, readFile } = await import("@tauri-apps/plugin-fs");

      const selected = await open({
        directory: true,
        multiple: false,
        title: `Select ${side === "ref" ? "Reference" : "Comparator"} Folder`,
      });

      if (!selected) return;

      this.showProgress(`Scanning folder...`);

      const files = [];
      await this._recursiveScanTauri(selected, readDir, readFile, files);

      this.hideProgress();

      if (files.length > 0) {
        await this.handleExcelFileSelection(side, files);
        this.eventBus.emit("notification:success", {
          message: `Added ${files.length} supported files from folder`,
        });
      } else {
        this.eventBus.emit("notification:warning", {
          message: "No supported files (.xlsx, .xls, .csv) found in the selected folder.",
        });
      }
    } catch (error) {
      console.error(`Failed to upload folder (Tauri, ${side}):`, error);
      this.hideProgress();
      this.eventBus.emit("notification:show", {
        type: "error",
        message: `Failed to read folder: ${error.message}`,
      });
    }
  }

  /**
   * Recursively scan directory for supported files in Tauri
   */
  async _recursiveScanTauri(dirPath, readDir, readFile, files) {
    const entries = await readDir(dirPath);

    for (const entry of entries) {
      // Manually construct full path as entry.path might be undefined in some plugin versions
      const fullPath = `${dirPath}/${entry.name}`;

      if (entry.isDirectory) {
        // It's a directory
        await this._recursiveScanTauri(fullPath, readDir, readFile, files);
      } else if (entry.isFile) {
        // It's a file, check if supported
        if (FileParser.isSupported(entry.name)) {
          try {
            const fileData = await readFile(fullPath);
            const fileName = entry.name;
            const ext = FileParser.getFileExtension(fileName);

            const mimeTypes = {
              xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              xls: "application/vnd.ms-excel",
              csv: "text/csv",
            };

            const blob = new Blob([fileData], { type: mimeTypes[ext] || "application/octet-stream" });
            const file = new File([blob], fileName, {
              type: mimeTypes[ext] || "application/octet-stream",
              lastModified: Date.now(),
            });

            // We store the path for reference
            file.path = fullPath;
            files.push(file);
          } catch (e) {
            console.error(`Failed to read file ${fullPath}:`, e);
          }
        }
      }
    }
  }

  /**
   * Handle Excel file selection (drop or input) - NEW FLOW
   */
  async handleExcelFileSelection(side, files) {
    const listKey = side === "ref" ? "refFiles" : "compFiles";
    const fileType = side === "ref" ? "ref" : "comp";
    // Convert FileList to Array if needed
    const fileArray = Array.from(files);
    const newFiles = FileParser.filterSupportedFiles(fileArray);

    if (newFiles.length === 0) {
      if (!isTauri()) {
        // Only show warning for manual selection if no files found
        this.eventBus.emit("notification:show", {
          type: "warning",
          message: "No supported files (.xlsx, .xls, .csv) were selected.",
        });
      }
      return;
    }

    // Wrap files with IDs (simplified - no pairedId in new flow)
    const filesWithIds = newFiles.map((file) => ({
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 9),
      file,
    }));

    // Add to existing list
    this.excelCompare[listKey] = [...this.excelCompare[listKey], ...filesWithIds];

    // Save files to IndexedDB for persistence
    if (IndexedDBManager.isIndexedDBAvailable()) {
      for (const fileWrapper of filesWithIds) {
        try {
          const arrayBuffer = await fileWrapper.file.arrayBuffer();
          await IndexedDBManager.saveExcelFile({
            id: fileWrapper.id,
            name: fileWrapper.file.name,
            content: arrayBuffer,
            type: fileType,
          });
        } catch (error) {
          console.warn("Failed to cache file to IndexedDB:", error);
        }
      }
      // Save current state to IndexedDB
      this.saveExcelCompareStateToIndexedDB();
    }

    // Update UI
    this.updateExcelFileList(side);
    this.updateClearAllButtonVisibility(side);
    this.checkAndShowPairingUI();
    this.saveToolState();
  }

  /**
   * Clear all files from a side - NEW FLOW
   */
  async clearAllExcelFiles(side) {
    const listKey = side === "ref" ? "refFiles" : "compFiles";
    const fileType = side === "ref" ? "ref" : "comp";

    // Clear files from IndexedDB
    if (IndexedDBManager.isIndexedDBAvailable()) {
      for (const fileWrapper of this.excelCompare[listKey]) {
        try {
          await IndexedDBManager.deleteExcelFile(fileWrapper.id);
        } catch (error) {
          console.warn("Failed to delete file from IndexedDB:", error);
        }
      }
    }

    this.excelCompare[listKey] = [];

    // Reset dependent state
    if (side === "ref") {
      this.excelCompare.selectedRefFile = null;
    } else {
      this.excelCompare.selectedCompFile = null;
    }

    // Reset field selection state
    this.excelCompare.headers = [];
    this.excelCompare.commonHeaders = [];
    this.excelCompare.selectedPkFields = [];
    this.excelCompare.selectedFields = [];
    this.excelCompare.refParsedData = null;
    this.excelCompare.compParsedData = null;

    // Save state to IndexedDB
    if (IndexedDBManager.isIndexedDBAvailable()) {
      this.saveExcelCompareStateToIndexedDB();
    }

    // Update UI
    this.updateExcelFileList(side);
    this.updateClearAllButtonVisibility(side);
    this.checkAndShowPairingUI();
    this.saveToolState();
  }

  /**
   * Show/hide Clear All button based on file count - NEW FLOW
   */
  updateClearAllButtonVisibility(side) {
    const listKey = side === "ref" ? "refFiles" : "compFiles";
    const btnId = side === "ref" ? "ref-clear-all" : "comp-clear-all";
    const btn = document.getElementById(btnId);

    if (btn) {
      btn.style.display = this.excelCompare[listKey].length > 0 ? "" : "none";
    }
  }

  /**
   * Check conditions and show/hide pairing UI - NEW FLOW
   */
  checkAndShowPairingUI() {
    const hasRefFiles = this.excelCompare.refFiles.length > 0;
    const hasCompFiles = this.excelCompare.compFiles.length > 0;

    const pairingSection = document.getElementById("excel-file-pairing");
    const fieldSection = document.getElementById("excel-field-selection");

    // Hide field selection until file pair is selected
    if (fieldSection) fieldSection.style.display = "none";

    if (hasRefFiles && hasCompFiles) {
      // Show pairing UI
      if (pairingSection) pairingSection.style.display = "block";
      this.populateFilePairingDropdowns();
    } else {
      // Hide pairing UI
      if (pairingSection) pairingSection.style.display = "none";
      // Reset selections
      this.excelCompare.selectedRefFile = null;
      this.excelCompare.selectedCompFile = null;
      this.excelCompare.autoMatchedComp = null;
    }
  }

  /**
   * Populate file pairing dropdowns - NEW FLOW
   */
  populateFilePairingDropdowns() {
    this.setupSearchableDropdown("excel-ref-file", this.excelCompare.refFiles, this.excelCompare.selectedRefFile?.id, (fileId) => {
      this.handleRefFileSelection(fileId);
    });

    this.setupSearchableDropdown("excel-comp-file", this.excelCompare.compFiles, this.excelCompare.selectedCompFile?.id, (fileId) => {
      this.handleCompFileSelection(fileId);
    });
  }

  /**
   * Setup a searchable dropdown - NEW FLOW
   */
  setupSearchableDropdown(prefix, files, selectedId, onSelect) {
    const input = document.getElementById(`${prefix}-search`);
    const dropdown = document.getElementById(`${prefix}-dropdown`);

    if (!input || !dropdown) return;

    let highlightedIndex = -1;
    let filteredFiles = [];

    // Build options
    const renderOptions = (filter = "") => {
      const filterLower = filter.toLowerCase();
      filteredFiles = files.filter((f) => f.file.name.toLowerCase().includes(filterLower));

      if (filteredFiles.length === 0) {
        dropdown.innerHTML = '<div class="searchable-no-results">No matching files</div>';
        highlightedIndex = -1;
        return;
      }

      dropdown.innerHTML = filteredFiles
        .map(
          (f, index) => `
        <div class="searchable-option ${f.id === selectedId ? "selected" : ""} ${index === highlightedIndex ? "highlighted" : ""}"
             data-id="${f.id}" data-index="${index}">
          <svg class="option-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
          <span class="option-text">${f.file.name}</span>
        </div>
      `,
        )
        .join("");

      // Add click handlers
      dropdown.querySelectorAll(".searchable-option").forEach((opt) => {
        opt.addEventListener("click", () => {
          const fileId = opt.dataset.id;
          const file = files.find((f) => f.id === fileId);
          if (file) {
            input.value = file.file.name;
            dropdown.classList.remove("open");
            onSelect(fileId);
          }
        });
      });
    };

    const updateHighlighting = () => {
      dropdown.querySelectorAll(".searchable-option").forEach((opt, index) => {
        if (index === highlightedIndex) {
          opt.classList.add("highlighted");
          opt.scrollIntoView({ block: "nearest" });
        } else {
          opt.classList.remove("highlighted");
        }
      });
    };

    // Set initial value
    const selectedFile = files.find((f) => f.id === selectedId);
    input.value = selectedFile ? selectedFile.file.name : "";

    // Event handlers
    input.addEventListener("focus", () => {
      highlightedIndex = -1;
      renderOptions(input.value);
      dropdown.classList.add("open");
    });

    input.addEventListener("input", () => {
      highlightedIndex = -1;
      renderOptions(input.value);
      dropdown.classList.add("open");
    });

    input.addEventListener("keydown", (e) => {
      if (!dropdown.classList.contains("open")) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          dropdown.classList.add("open");
          renderOptions(input.value);
          e.preventDefault();
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          highlightedIndex = Math.min(highlightedIndex + 1, filteredFiles.length - 1);
          updateHighlighting();
          break;
        case "ArrowUp":
          e.preventDefault();
          highlightedIndex = Math.max(highlightedIndex - 1, 0);
          updateHighlighting();
          break;
        case "Enter":
          if (highlightedIndex >= 0 && highlightedIndex < filteredFiles.length) {
            e.preventDefault();
            const file = filteredFiles[highlightedIndex];
            input.value = file.file.name;
            dropdown.classList.remove("open");
            onSelect(file.id);
          }
          break;
        case "Escape":
          e.preventDefault();
          dropdown.classList.remove("open");
          highlightedIndex = -1;
          break;
        case "Tab":
          dropdown.classList.remove("open");
          highlightedIndex = -1;
          break;
      }
    });

    input.addEventListener("blur", () => {
      // Delay to allow click on option
      setTimeout(() => {
        dropdown.classList.remove("open");
        highlightedIndex = -1;
      }, 200);
    });

    // Initial render
    renderOptions();
  }

  /**
   * Handle reference file selection - NEW FLOW
   */
  handleRefFileSelection(fileId) {
    const refFile = this.excelCompare.refFiles.find((f) => f.id === fileId);
    if (!refFile) return;

    this.excelCompare.selectedRefFile = refFile;

    // Try to auto-match comparator using enhanced matching
    const autoMatch = FileMatcher.findMatchingFile(refFile.file.name, this.excelCompare.compFiles);
    const matchHint = document.getElementById("comp-match-hint");

    if (autoMatch) {
      this.excelCompare.selectedCompFile = autoMatch;
      this.excelCompare.autoMatchedComp = autoMatch;

      // Update comparator dropdown
      const compInput = document.getElementById("excel-comp-file-search");
      if (compInput) compInput.value = autoMatch.file.name;

      // Show match hint
      if (matchHint) {
        matchHint.textContent = autoMatch.matchType === "exact" ? "Auto-matched (exact match)" : "Auto-matched (base name match)";
        matchHint.className = "help-text auto-matched";
      }

      // Load headers and show field selection
      this.loadFileHeadersAndShowFieldSelection();
    } else {
      this.excelCompare.selectedCompFile = null;
      this.excelCompare.autoMatchedComp = null;

      // Clear comparator dropdown
      const compInput = document.getElementById("excel-comp-file-search");
      if (compInput) compInput.value = "";

      // Show no-match hint
      if (matchHint) {
        matchHint.textContent = "No matching file found. Please select manually.";
        matchHint.className = "help-text no-match";
      }

      // Hide field selection
      const fieldSection = document.getElementById("excel-field-selection");
      if (fieldSection) fieldSection.style.display = "none";
    }

    // Save state to IndexedDB
    this.saveExcelCompareStateToIndexedDB();
  }

  /**
   * Handle comparator file selection (manual) - NEW FLOW
   */
  handleCompFileSelection(fileId) {
    const compFile = this.excelCompare.compFiles.find((f) => f.id === fileId);
    if (!compFile) return;

    this.excelCompare.selectedCompFile = compFile;

    // Clear auto-match hint if manually selected
    const matchHint = document.getElementById("comp-match-hint");
    if (matchHint) {
      matchHint.textContent = "";
      matchHint.className = "help-text";
    }

    // If both files selected, load headers
    if (this.excelCompare.selectedRefFile && this.excelCompare.selectedCompFile) {
      this.loadFileHeadersAndShowFieldSelection();
    } else {
      // Save state even if only one file selected
      this.saveExcelCompareStateToIndexedDB();
    }
  }

  /**
   * Load headers from selected files and show field selection UI - NEW FLOW
   */
  async loadFileHeadersAndShowFieldSelection() {
    const { selectedRefFile, selectedCompFile } = this.excelCompare;

    if (!selectedRefFile || !selectedCompFile) return;

    try {
      // Parse both files to get headers
      const [refData, compData] = await Promise.all([
        FileParser.parseFile(selectedRefFile.file),
        FileParser.parseFile(selectedCompFile.file),
      ]);

      // Merge headers (union of both) - keep natural order from reference file
      const allHeaders = new Set([...refData.headers, ...compData.headers]);
      const commonHeaders = refData.headers.filter((h) => compData.headers.includes(h));
      const refOnlyHeaders = refData.headers.filter((h) => !compData.headers.includes(h));
      const compOnlyHeaders = compData.headers.filter((h) => !refData.headers.includes(h));

      // Keep natural order (as they appear in reference file), no alphabetical sorting
      this.excelCompare.headers = Array.from(allHeaders);
      this.excelCompare.commonHeaders = commonHeaders;
      this.excelCompare.refOnlyHeaders = refOnlyHeaders;
      this.excelCompare.compOnlyHeaders = compOnlyHeaders;

      // Default: select all common headers for comparison
      this.excelCompare.selectedFields = [...commonHeaders];

      // Default: first column as PK
      if (commonHeaders.length > 0) {
        this.excelCompare.selectedPkFields = [commonHeaders[0]];
      }

      // Load saved preferences for this reference file if available
      try {
        const savedPrefs = await IndexedDBManager.getExcelFilePrefs(selectedRefFile.file.name);
        if (savedPrefs) {
          // Apply saved preferences, filtering to only include headers that exist
          if (savedPrefs.selectedPkFields && savedPrefs.selectedPkFields.length > 0) {
            const validPkFields = savedPrefs.selectedPkFields.filter((f) => commonHeaders.includes(f));
            if (validPkFields.length > 0) {
              this.excelCompare.selectedPkFields = validPkFields;
            }
          }
          if (savedPrefs.selectedFields && savedPrefs.selectedFields.length > 0) {
            const validFields = savedPrefs.selectedFields.filter((f) => commonHeaders.includes(f));
            if (validFields.length > 0) {
              this.excelCompare.selectedFields = validFields;
            }
          }
          if (savedPrefs.rowMatching) {
            this.excelCompare.rowMatching = savedPrefs.rowMatching;
          }
          if (savedPrefs.dataComparison) {
            this.excelCompare.dataComparison = savedPrefs.dataComparison;
          }
        }
      } catch (e) {
        console.warn("Failed to load Excel file preferences:", e);
      }

      // Cache parsed data for comparison
      this.excelCompare.refParsedData = refData;
      this.excelCompare.compParsedData = compData;

      // Show field selection UI
      this.renderExcelFieldSelection();

      // Show column mismatch warning if applicable
      if (refOnlyHeaders.length > 0 || compOnlyHeaders.length > 0) {
        this.showColumnMismatchWarning(refOnlyHeaders, compOnlyHeaders);
      }

      // Save state to IndexedDB after loading headers
      this.saveExcelCompareStateToIndexedDB();
    } catch (error) {
      console.error("Failed to parse files:", error);
      this.eventBus.emit("notification:show", {
        type: "error",
        message: `Failed to read file headers: ${error.message}`,
      });
    }
  }

  /**
   * Render field selection UI for Excel - NEW FLOW
   */
  renderExcelFieldSelection() {
    const fieldSection = document.getElementById("excel-field-selection");
    if (!fieldSection) return;

    const { selectedRefFile, selectedCompFile, commonHeaders, selectedPkFields, selectedFields } = this.excelCompare;

    // Update file pair info
    const refBadge = document.getElementById("excel-ref-file-badge");
    const compBadge = document.getElementById("excel-comp-file-badge");
    if (refBadge) refBadge.textContent = `📄 ${selectedRefFile.file.name}`;
    if (compBadge) compBadge.textContent = `📄 ${selectedCompFile.file.name}`;

    // Render PK field checkboxes
    const pkListEl = document.getElementById("excel-pk-field-list");
    if (pkListEl) {
      pkListEl.innerHTML = commonHeaders
        .map(
          (header) => `
        <label class="field-checkbox">
          <input type="checkbox" name="excel-pk-field" value="${header}"
                 ${selectedPkFields.includes(header) ? "checked" : ""}>
          <span class="field-name">${header}</span>
        </label>
      `,
        )
        .join("");
    }

    // Render comparison field checkboxes
    const fieldListEl = document.getElementById("excel-field-list");
    if (fieldListEl) {
      fieldListEl.innerHTML = commonHeaders
        .map(
          (header) => `
        <label class="field-checkbox">
          <input type="checkbox" name="excel-compare-field" value="${header}"
                 ${selectedFields.includes(header) ? "checked" : ""}>
          <span class="field-name">${header}</span>
        </label>
      `,
        )
        .join("");
    }

    // Show the section
    fieldSection.style.display = "block";

    // Rebind events for checkboxes
    this.bindExcelFieldCheckboxEvents();
  }

  /**
   * Show column mismatch warning - NEW FLOW
   */
  showColumnMismatchWarning(refOnlyHeaders, compOnlyHeaders) {
    const warningEl = document.getElementById("excel-column-warning");
    if (!warningEl) return;

    let html = '<div class="warning-title">⚠️ Column Mismatch Detected</div>';
    html += '<div class="warning-details">';

    if (refOnlyHeaders.length > 0) {
      html += `<p>Columns only in Reference file:</p><ul class="column-list">`;
      refOnlyHeaders.forEach((h) => (html += `<li>${h}</li>`));
      html += "</ul>";
    }

    if (compOnlyHeaders.length > 0) {
      html += `<p>Columns only in Comparator file:</p><ul class="column-list">`;
      compOnlyHeaders.forEach((h) => (html += `<li>${h}</li>`));
      html += "</ul>";
    }

    html += "<p>Only common columns will be available for comparison.</p>";
    html += "</div>";

    warningEl.innerHTML = html;
    warningEl.style.display = "block";
  }

  /**
   * Bind events for Excel field selection - NEW FLOW
   */
  bindExcelFieldSelectionEvents() {
    // New row matching radios
    const rowMatchingRadios = document.querySelectorAll('input[name="excel-row-matching"]');
    rowMatchingRadios.forEach((radio) => {
      radio.addEventListener("change", (e) => {
        this.excelCompare.rowMatching = e.target.value;
        this.saveExcelCompareStateToIndexedDB();
      });
    });

    // New data comparison radios
    const dataComparisonRadios = document.querySelectorAll('input[name="excel-data-comparison"]');
    dataComparisonRadios.forEach((radio) => {
      radio.addEventListener("change", (e) => {
        this.excelCompare.dataComparison = e.target.value;
        this.saveExcelCompareStateToIndexedDB();
      });
    });

    // New compare button
    const compareBtn = document.getElementById("btn-excel-compare");
    if (compareBtn) {
      compareBtn.addEventListener("click", () => this.executeExcelComparisonNewFlow());
    }

    // Select All / Clear buttons for PK
    const selectAllPkBtn = document.getElementById("btn-excel-select-all-pk");
    const deselectAllPkBtn = document.getElementById("btn-excel-deselect-all-pk");

    if (selectAllPkBtn) {
      selectAllPkBtn.addEventListener("click", () => {
        this.excelCompare.selectedPkFields = [...this.excelCompare.commonHeaders];
        this.renderExcelFieldSelection();
      });
    }

    if (deselectAllPkBtn) {
      deselectAllPkBtn.addEventListener("click", () => {
        this.excelCompare.selectedPkFields = [];
        this.renderExcelFieldSelection();
      });
    }

    // Select All / Clear buttons for fields
    const selectAllFieldsBtn = document.getElementById("btn-excel-select-all-fields");
    const deselectAllFieldsBtn = document.getElementById("btn-excel-deselect-all-fields");

    if (selectAllFieldsBtn) {
      selectAllFieldsBtn.addEventListener("click", () => {
        this.excelCompare.selectedFields = [...this.excelCompare.commonHeaders];
        this.renderExcelFieldSelection();
      });
    }

    if (deselectAllFieldsBtn) {
      deselectAllFieldsBtn.addEventListener("click", () => {
        this.excelCompare.selectedFields = [];
        this.renderExcelFieldSelection();
      });
    }
  }

  /**
   * Bind events for field checkboxes after render - NEW FLOW
   */
  bindExcelFieldCheckboxEvents() {
    // PK checkboxes
    const pkCheckboxes = document.querySelectorAll('input[name="excel-pk-field"]');
    pkCheckboxes.forEach((cb) => {
      cb.addEventListener("change", () => {
        const checked = Array.from(document.querySelectorAll('input[name="excel-pk-field"]:checked')).map((c) => c.value);
        this.excelCompare.selectedPkFields = checked;
        // Save state to IndexedDB
        this.saveExcelCompareStateToIndexedDB();
      });
    });

    // Field checkboxes
    const fieldCheckboxes = document.querySelectorAll('input[name="excel-compare-field"]');
    fieldCheckboxes.forEach((cb) => {
      cb.addEventListener("change", () => {
        const checked = Array.from(document.querySelectorAll('input[name="excel-compare-field"]:checked')).map((c) => c.value);
        this.excelCompare.selectedFields = checked;
        // Save state to IndexedDB
        this.saveExcelCompareStateToIndexedDB();
      });
    });
  }

  /**
   * Execute Excel comparison - NEW SINGLE-PAIR FLOW
   */
  async executeExcelComparisonNewFlow() {
    const {
      selectedRefFile,
      selectedCompFile,
      refParsedData,
      compParsedData,
      selectedPkFields,
      selectedFields,
      rowMatching,
      dataComparison,
    } = this.excelCompare;

    if (!selectedRefFile || !selectedCompFile) {
      this.eventBus.emit("notification:show", {
        type: "warning",
        message: "Please select both Reference and Comparator files.",
      });
      return;
    }

    if (rowMatching === "key" && selectedPkFields.length === 0) {
      this.eventBus.emit("notification:show", {
        type: "warning",
        message: "Please select at least one primary key field.",
      });
      return;
    }

    if (selectedFields.length === 0) {
      this.eventBus.emit("notification:show", {
        type: "warning",
        message: "Please select at least one field to compare.",
      });
      return;
    }

    // Save preferences for this reference file
    try {
      await IndexedDBManager.saveExcelFilePrefs({
        refFilename: selectedRefFile.file.name,
        selectedPkFields,
        selectedFields,
        rowMatching,
        dataComparison,
      });
    } catch (e) {
      console.warn("Failed to save Excel file preferences:", e);
    }

    // Show progress
    this.showProgress("Comparing Files");
    this.updateProgressStep("fetch", "done", "Files parsed");
    this.updateProgressStep("compare", "active", "Comparing records...");

    try {
      // Import diff engine
      const { compareDatasets } = await import("./lib/diff-engine.js");
      const { convertToViewFormat } = await import("./lib/diff-adapter.js");

      const jsResult = compareDatasets(refParsedData.rows, compParsedData.rows, {
        keyColumns: selectedPkFields,
        fields: selectedFields,
        normalize: dataComparison === "normalized",
        matchMode: rowMatching,
      });

      const viewResult = convertToViewFormat(jsResult, {
        env1Name: selectedRefFile.file.name,
        env2Name: selectedCompFile.file.name,
        tableName: `${selectedRefFile.file.name} vs ${selectedCompFile.file.name}`,
        keyColumns: selectedPkFields,
      });

      this.updateProgressStep("compare", "done", `${viewResult.rows.length} records compared`);

      // Store results
      this.results["excel-compare"] = viewResult;
      this.excelCompare.currentStep = 4;

      // Small delay to show completion
      await new Promise((r) => setTimeout(r, 400));

      this.hideProgress();
      this.showResults();

      this.eventBus.emit("comparison:complete", viewResult);
    } catch (error) {
      console.error("[ExcelCompare] Comparison failed:", error);
      this.hideProgress();
      this.eventBus.emit("notification:show", {
        type: "error",
        message: `Comparison failed: ${error.message || error}`,
      });
    }
  }

  /**
   * Remove a file from Excel comparison
   */
  removeExcelFile(side, index) {
    const listKey = side === "ref" ? "refFiles" : "compFiles";
    this.excelCompare[listKey].splice(index, 1);

    // Update UI
    this.updateExcelFileList(side);
    this.updateExcelMatchInfo();
    this.saveToolState();
  }

  /**
   * Automatically pair files between Reference and Comparator
   */
  autoPairFiles() {
    const { refFiles, compFiles, pairs } = this.excelCompare;

    // Build lookup for unpaired files
    const unpairedRef = refFiles.filter((f) => !f.pairedId);
    const unpairedComp = compFiles.filter((f) => !f.pairedId);

    if (unpairedRef.length === 0 || unpairedComp.length === 0) return;

    for (const ref of unpairedRef) {
      // Find matching comparator by name (case-insensitive)
      const match = unpairedComp.find((c) => c.file.name.toLowerCase() === ref.file.name.toLowerCase() && !c.pairedId);

      if (match) {
        this.pairFiles(ref.id, match.id);
      }
    }
  }

  /**
   * Pair two files manually or automatically
   */
  pairFiles(refId, compId) {
    const ref = this.excelCompare.refFiles.find((f) => f.id === refId);
    const comp = this.excelCompare.compFiles.find((f) => f.id === compId);

    if (!ref || !comp) return;

    // Create pair
    const pairId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 9);
    const newPair = {
      id: pairId,
      refId: refId,
      compId: compId,
      settings: {
        mode: this.excelCompare.rowMatching,
        pkColumns: this.excelCompare.pkColumns,
      },
    };

    this.excelCompare.pairs.push(newPair);
    ref.pairedId = pairId;
    comp.pairedId = pairId;

    this.saveToolState();
  }

  /**
   * Unpair a file
   */
  unpairFile(side, fileId) {
    const list = side === "ref" ? this.excelCompare.refFiles : this.excelCompare.compFiles;
    const file = list.find((f) => f.id === fileId);

    if (!file || !file.pairedId) return;

    const pairId = file.pairedId;

    // Find the other file in the pair
    const ref = this.excelCompare.refFiles.find((f) => f.pairedId === pairId);
    const comp = this.excelCompare.compFiles.find((f) => f.pairedId === pairId);

    if (ref) ref.pairedId = null;
    if (comp) comp.pairedId = null;

    // Remove pair from state
    this.excelCompare.pairs = this.excelCompare.pairs.filter((p) => p.id !== pairId);

    // After unpairing, update UI
    this.updateExcelFileList("ref");
    this.updateExcelFileList("comp");
    this.updateExcelMatchInfo();
    this.saveToolState();
  }

  /**
   * Remove a file from Excel comparison
   */
  removeExcelFile(side, fileId) {
    const listKey = side === "ref" ? "refFiles" : "compFiles";
    const index = this.excelCompare[listKey].findIndex((f) => f.id === fileId);
    if (index === -1) return;

    const file = this.excelCompare[listKey][index];

    // If paired, unpair first
    if (file.pairedId) {
      this.unpairFile(side, file.id);
    }

    this.excelCompare[listKey].splice(index, 1);

    // Update UI
    this.updateExcelFileList(side);
    this.updateExcelMatchInfo();
    this.saveToolState();
  }

  /**
   * Show dialog to select a pair for an unpaired file
   */
  showPairingDialog(side, fileId) {
    const isRef = side === "ref";
    const sourceList = isRef ? this.excelCompare.refFiles : this.excelCompare.compFiles;
    const targetList = isRef ? this.excelCompare.compFiles : this.excelCompare.refFiles;
    const file = sourceList.find((f) => f.id === fileId);

    if (!file) return;

    const modalTitle = document.getElementById("excel-modal-title");
    const modalBody = document.getElementById("excel-modal-body");
    const modalSaveBtn = document.getElementById("btn-modal-save");

    modalTitle.textContent = `Link "${file.file.name}" to...`;
    modalSaveBtn.style.display = "none"; // Pairing happens on click

    // Filter only unpaired targets
    const candidates = targetList.filter((f) => !f.pairedId);

    if (candidates.length === 0) {
      modalBody.innerHTML = `
        <div class="pairing-empty">
          <p>No available files on the ${isRef ? "comparator" : "reference"} side to pair with.</p>
          <p class="help-text">Add more files first.</p>
        </div>
      `;
    } else {
      let optionsHtml = '<div class="pairing-list">';
      candidates.forEach((cand) => {
        optionsHtml += `
          <div class="pairing-option" data-id="${cand.id}">
            <div class="file-info">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
              </svg>
              <span>${cand.file.name}</span>
            </div>
            <button class="btn btn-ghost btn-xs">Select</button>
          </div>
        `;
      });
      optionsHtml += "</div>";
      modalBody.innerHTML = optionsHtml;

      // Add click listeners to options
      modalBody.querySelectorAll(".pairing-option").forEach((opt) => {
        opt.addEventListener("click", () => {
          const targetId = opt.dataset.id;
          if (isRef) {
            this.pairFiles(fileId, targetId);
          } else {
            this.pairFiles(targetId, fileId);
          }
          this.closeExcelModal();
          this.updateExcelFileList("ref");
          this.updateExcelFileList("comp");
          this.updateExcelMatchInfo();
        });
      });
    }

    document.getElementById("excel-modal-overlay").style.display = "flex";
  }

  /**
   * Show configuration for a specific pair
   */
  showPairConfig(pairId) {
    const pair = this.excelCompare.pairs.find((p) => p.id === pairId);
    if (!pair) return;

    const ref = this.excelCompare.refFiles.find((f) => f.id === pair.refId);

    const modalTitle = document.getElementById("excel-modal-title");
    const modalBody = document.getElementById("excel-modal-body");
    const modalSaveBtn = document.getElementById("btn-modal-save");

    modalTitle.textContent = `Settings: ${ref.file.name}`;
    modalSaveBtn.style.display = "block";

    modalBody.innerHTML = `
      <div class="config-form">
        <div class="config-item">
          <label>Row Matching Mode</label>
          <div class="radio-group">
            <label class="radio-label">
              <input type="radio" name="modal-row-matching" value="key" ${pair.settings.mode === "key" ? "checked" : ""}>
              <span>By Primary Key</span>
            </label>
            <label class="radio-label">
              <input type="radio" name="modal-row-matching" value="position" ${pair.settings.mode === "position" ? "checked" : ""}>
              <span>By Row Position</span>
            </label>
          </div>
        </div>
        <div class="config-item" id="modal-pk-section" style="${pair.settings.mode === "key" ? "" : "display: none;"}">
          <label for="modal-pk-columns">Primary Key Column(s)</label>
          <input type="text" id="modal-pk-columns" class="form-input" value="${pair.settings.pkColumns || ""}" placeholder="e.g., ID or SCHEMA,TABLE_NAME">
          <p class="help-text">Comma-separated. Auto-detected from first column if empty.</p>
        </div>
      </div>
    `;

    // Toggle PK section in modal
    modalBody.querySelectorAll('input[name="modal-row-matching"]').forEach((radio) => {
      radio.addEventListener("change", (e) => {
        document.getElementById("modal-pk-section").style.display = e.target.value === "key" ? "block" : "none";
      });
    });

    // Handle Save
    const saveHandler = () => {
      const mode = modalBody.querySelector('input[name="modal-row-matching"]:checked').value;
      const pkColumns = document.getElementById("modal-pk-columns").value.trim();

      pair.settings.mode = mode;
      pair.settings.pkColumns = pkColumns;

      this.closeExcelModal();
      this.saveToolState();
      this.eventBus.emit("notification:show", { message: "Settings saved for this pair" });
      modalSaveBtn.removeEventListener("click", saveHandler);
    };

    modalSaveBtn.onclick = saveHandler;

    document.getElementById("excel-modal-overlay").style.display = "flex";
  }

  /**
   * Close the excel modal
   */
  closeExcelModal() {
    document.getElementById("excel-modal-overlay").style.display = "none";
  }

  /**
   * Update file list UI for a side - SIMPLIFIED FOR NEW FLOW
   */
  updateExcelFileList(side) {
    const listKey = side === "ref" ? "refFiles" : "compFiles";
    const listEl = document.getElementById(`${side}-file-list`);
    if (!listEl) return;

    listEl.innerHTML = "";

    // Sort alphabetically
    const sortedFiles = [...this.excelCompare[listKey]].sort((a, b) => a.file.name.localeCompare(b.file.name));

    sortedFiles.forEach((fileWrapper) => {
      const file = fileWrapper.file;
      const item = document.createElement("div");
      item.className = "file-item";

      item.innerHTML = `
        <div class="file-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
        </div>
        <div class="file-name" title="${file.name}">${file.name}</div>
        <div class="file-actions">
          <button class="btn btn-ghost btn-xs btn-remove-file" title="Remove from list">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      `;

      item.querySelector(".btn-remove-file").addEventListener("click", (e) => {
        e.stopPropagation();
        this.removeExcelFileSingle(side, fileWrapper.id);
      });

      listEl.appendChild(item);
    });

    // Toggle compact class on dropzone if files are present
    const dropzone = document.getElementById(`${side}-dropzone`);
    if (dropzone) {
      if (this.excelCompare[listKey].length > 0) {
        dropzone.classList.add("compact");
      } else {
        dropzone.classList.remove("compact");
      }
    }
  }

  /**
   * Remove a single file - NEW FLOW
   */
  removeExcelFileSingle(side, fileId) {
    const listKey = side === "ref" ? "refFiles" : "compFiles";
    const index = this.excelCompare[listKey].findIndex((f) => f.id === fileId);
    if (index === -1) return;

    this.excelCompare[listKey].splice(index, 1);

    // If this was the selected file, clear selection
    if (side === "ref" && this.excelCompare.selectedRefFile?.id === fileId) {
      this.excelCompare.selectedRefFile = null;
      this.excelCompare.selectedCompFile = null;
      this.excelCompare.autoMatchedComp = null;
    } else if (side === "comp" && this.excelCompare.selectedCompFile?.id === fileId) {
      this.excelCompare.selectedCompFile = null;
      this.excelCompare.autoMatchedComp = null;
    }

    // Update UI
    this.updateExcelFileList(side);
    this.updateClearAllButtonVisibility(side);
    this.checkAndShowPairingUI();
    this.saveToolState();
  }

  /**
   * Update match info summary - HIDDEN IN NEW FLOW (using pairing dropdowns instead)
   */
  updateExcelMatchInfo() {
    const infoEl = document.getElementById("excel-match-info");
    if (infoEl) {
      // Hide in new flow - we use pairing dropdowns instead
      infoEl.style.display = "none";
    }
  }

  /**
   * Execute Excel/CSV comparison
   */
  async executeExcelComparison() {
    if (this.excelCompare.pairs.length === 0) {
      this.eventBus.emit("notification:show", {
        type: "warning",
        message: "No pairs linked. Please link at least one reference file to a comparator file.",
      });
      return;
    }

    // Resolve pairs into file objects for comparator
    const preparedPairs = this.excelCompare.pairs.map((p) => {
      const ref = this.excelCompare.refFiles.find((f) => f.id === p.refId);
      const comp = this.excelCompare.compFiles.find((f) => f.id === p.compId);
      return {
        reference: ref.file,
        comparator: comp.file,
        settings: p.settings,
      };
    });

    // Show progress
    this.showProgress("Comparing Excel/CSV Files");
    this.updateProgressStep("fetch", "active", "Parsing files...");

    try {
      const results = await ExcelComparator.compareFileSets(preparedPairs, {
        normalize: this.excelCompare.dataComparison === "normalized",
        onProgress: (p) => {
          if (p.phase === "parsing") {
            this.updateProgressStep("fetch", "active", `Parsing (${p.fileIndex + 1}/${p.totalFiles}): ${p.fileName}`);
          } else if (p.phase.startsWith("Comparing")) {
            this.updateProgressStep("compare", "active", p.phase);
          }
        },
      });

      this.updateProgressStep("fetch", "done", `${preparedPairs.length} pairs parsed`);
      this.updateProgressStep("compare", "done", `${results.rows.length} total records compared`);

      // Store results
      this.results["excel-compare"] = results;

      // Small delay to show completion
      await new Promise((r) => setTimeout(r, 400));

      this.hideProgress();
      this.showResults();

      this.eventBus.emit("comparison:complete", results);
    } catch (error) {
      console.error("[ExcelCompare] Comparison failed:", error);
      this.hideProgress();
      this.eventBus.emit("notification:show", {
        type: "error",
        message: `Excel comparison failed: ${error.message || error}`,
      });
    }
  }

  /**
   * Executes the comparison
   */
  async executeComparison() {
    // Early validation BEFORE showing progress overlay
    // Check connections first (prevents confusing progress state)
    if (!this.env1.connection || !this.env2.connection) {
      this.resetToEmptyState("Please select connections for both environments");
      return;
    }

    // Check if same environment selected for both (warn user)
    if (this.env1.connection.connect_string === this.env2.connection.connect_string) {
      this.resetToEmptyState("Both environments are the same. Please select different environments to compare.");
      return;
    }

    // Check schema and table
    if (!this.schema || !this.table) {
      this.resetToEmptyState("Please select a schema and table to compare");
      return;
    }

    // Check fields selected
    if (!this.selectedFields || this.selectedFields.length === 0) {
      this.resetToEmptyState("Please select at least one field to compare");
      return;
    }

    // Clear previous results
    this.resetToEmptyState();

    // NOW show progress overlay (validation passed basic checks)
    this.showProgress("Comparing Configurations");
    this.updateProgressStep("env1", "active", this.env1.connection.name);
    this.updateProgressStep("env2", "pending", this.env2.connection.name);

    // Full validation (connection liveness, credentials, etc.)
    if (!(await this.validateComparisonRequest())) {
      console.log("[Compare] Validation failed");
      this.hideProgress();
      return;
    }

    // Update progress - connections verified
    this.updateProgressStep("env1", "done", this.env1.connection.name);
    this.updateProgressStep("env2", "done", this.env2.connection.name);
    this.updateProgressStep("fetch", "active", `${this.schema}.${this.table}`);

    try {
      // Build comparison request matching Rust CompareRequest struct
      const request = {
        env1_connection_name: this.env1.connection.name,
        env1_config: this.env1.connection,
        env2_connection_name: this.env2.connection.name,
        env2_config: this.env2.connection,
        owner: this.schema,
        table_name: this.table,
        primary_key: this.customPrimaryKey || [],
        fields: this.selectedFields || [],
        where_clause: this.whereClause || null,
        max_rows: this.maxRows || 100,
      };

      console.log("[Compare] Sending request:", JSON.stringify(request, null, 2));

      // Update to compare step
      this.updateProgressStep("fetch", "done", `${this.schema}.${this.table}`);
      this.updateProgressStep("compare", "active", "Processing...");

      // Execute comparison
      let result = await CompareConfigService.compareConfigurations(request);

      console.log("[Compare] Result received:", result);
      console.log("[Compare] Result rows:", result?.rows?.length || 0);

      // Enhance with detailed character-level diff if feature flag enabled
      if (getFeatureFlag(FLAGS.ENHANCE_DIFF_WITH_JS) && result?.rows?.length > 0) {
        console.log("[Compare] Enhancing with JS diff engine...");
        result = await enhanceWithDetailedDiff(result, { threshold: 0.5 });
        console.log("[Compare] Enhancement complete");
      }

      // Update compare step done
      this.updateProgressStep("compare", "done", `${result?.rows?.length || 0} records compared`);

      this.results[this.queryMode] = result;

      // Small delay to show completed state
      await new Promise((r) => setTimeout(r, 300));

      // Hide loading
      this.hideProgress();

      // Show results
      this.showResults();

      // Emit event
      this.eventBus.emit("comparison:complete", result);
    } catch (error) {
      console.error("[Compare] Comparison failed:", error);
      this.hideLoading();

      // Check if this is a connection error
      const errorStr = String(error.message || error);
      const isConnectionError =
        errorStr.includes("OCI Error") || errorStr.includes("ORA-") || errorStr.includes("connection") || errorStr.includes("timeout");

      if (isConnectionError) {
        // Parse to friendly message
        const friendlyError = this.parseOracleError(error, "Database");
        this.eventBus.emit("notification:show", {
          type: "error",
          message: `${friendlyError}. Please check your connections and try again.`,
        });

        // Update connection status to reflect potential disconnection
        this.updateConnectionStatus();
      } else {
        this.eventBus.emit("notification:show", {
          type: "error",
          message: `Comparison failed: ${error.message || error}`,
        });
      }
    }
  }

  /**
   * Executes comparison using raw SQL queries
   */
  async executeRawSqlComparison() {
    // Early validation BEFORE showing loading
    // Check connections first
    if (!this.rawenv1.connection || !this.rawenv2.connection) {
      this.resetToEmptyState("Please select connections for both environments");
      return;
    }

    // Check if same environment selected for both
    if (this.rawenv1.connection.connect_string === this.rawenv2.connection.connect_string) {
      this.resetToEmptyState("Both environments are the same. Please select different environments to compare.");
      return;
    }

    // Check SQL query
    if (!this.rawSql || !this.rawSql.trim()) {
      this.resetToEmptyState("Please enter a SQL query");
      return;
    }

    // Clear previous results
    this.resetToEmptyState();

    // Validate (SQL syntax and connection liveness)
    if (!(await this.validateRawSqlRequest())) {
      return;
    }

    try {
      // Show loading
      this.showLoading("Executing SQL query and comparing...");

      // Strip trailing semicolon (Oracle OCI doesn't support it)
      const cleanSql = this.rawSql.trim().replace(/;+$/, "");

      // Parse primary key field(s) if provided (comma-separated for composite keys)
      const primaryKeyFields = this.rawPrimaryKey
        ? this.rawPrimaryKey
            .split(",")
            .map((f) => f.trim())
            .filter((f) => f.length > 0)
        : [];

      // Build comparison request matching RawSqlRequest struct
      // Primary key will be auto-detected as the first column from SQL results if not provided
      const request = {
        env1_connection_name: this.rawenv1.connection.name,
        env1_config: this.rawenv1.connection,
        env2_connection_name: this.rawenv2.connection.name,
        env2_config: this.rawenv2.connection,
        sql: cleanSql,
        primary_key: primaryKeyFields.length > 0 ? primaryKeyFields.join(",") : null,
        max_rows: this.rawMaxRows,
      };

      // Execute comparison
      let result = await CompareConfigService.compareRawSql(request);

      // Enhance with detailed character-level diff if feature flag enabled
      if (getFeatureFlag(FLAGS.ENHANCE_DIFF_WITH_JS) && result?.rows?.length > 0) {
        console.log("[Compare] Enhancing raw SQL results with JS diff engine...");
        result = await enhanceWithDetailedDiff(result, { threshold: 0.5 });
        console.log("[Compare] Enhancement complete");
      }

      this.results[this.queryMode] = result;

      // Hide loading
      this.hideLoading();

      // Show results
      this.showResults();

      // Save preferences to IndexedDB after successful comparison
      this.saveRawSqlPrefsToIndexedDB();

      // Emit event
      this.eventBus.emit("comparison:complete", result);
    } catch (error) {
      console.error("Raw SQL comparison failed:", error);
      this.hideLoading();

      // Check if this is a connection error
      const errorStr = String(error.message || error);
      const isConnectionError =
        errorStr.includes("OCI Error") || errorStr.includes("ORA-") || errorStr.includes("connection") || errorStr.includes("timeout");

      if (isConnectionError) {
        const friendlyError = this.parseOracleError(error, "Database");
        this.eventBus.emit("notification:show", {
          type: "error",
          message: `${friendlyError}. Please check your connections and try again.`,
        });
        this.updateConnectionStatus();
      } else {
        this.eventBus.emit("notification:show", {
          type: "error",
          message: `Comparison failed: ${error.message || error}`,
        });
      }
    }
  }

  /**
   * Validates raw SQL comparison request (async for connection checks)
   */
  async validateRawSqlRequest() {
    if (!this.rawenv1.connection || !this.rawenv2.connection) {
      this.eventBus.emit("notification:show", {
        type: "error",
        message: "Please select connections for both environments",
      });
      return false;
    }

    if (!this.rawSql) {
      this.eventBus.emit("notification:show", {
        type: "error",
        message: "Please enter a SQL query",
      });
      return false;
    }

    // Basic SQL validation - must start with SELECT
    const sqlLower = this.rawSql.trim().toLowerCase();

    if (!sqlLower.startsWith("select")) {
      this.eventBus.emit("notification:show", {
        type: "error",
        message: "SQL query must start with SELECT",
      });
      return false;
    }

    // Check connection liveness for raw SQL mode (uses rawenv1/rawenv2)
    const env1Result = await this.ensureRawConnectionAlive("rawenv1");
    if (!env1Result.success) {
      this.eventBus.emit("notification:show", {
        type: "error",
        message: env1Result.message,
      });
      return false;
    }

    const env2Result = await this.ensureRawConnectionAlive("rawenv2");
    if (!env2Result.success) {
      this.eventBus.emit("notification:show", {
        type: "error",
        message: env2Result.message,
      });
      return false;
    }

    return true;
  }

  /**
   * Ensures raw SQL mode connection is alive
   * @param {string} envKey - 'rawenv1' or 'rawenv2'
   */
  async ensureRawConnectionAlive(envKey) {
    const env = this[envKey];
    if (!env?.connection) {
      return { success: false, message: `No connection configured for ${envKey}` };
    }

    const envLabel = envKey === "rawenv1" ? "Env 1" : "Env 2";

    try {
      const activeConnections = await CompareConfigService.getActiveConnections();
      const existingConn = activeConnections.find((c) => c.connect_string === env.connection.connect_string && c.is_alive);

      if (existingConn) {
        return { success: true, message: "Connection active" };
      }

      // Attempt reconnection
      this.eventBus.emit("notification:show", {
        type: "info",
        message: `Reconnecting to ${env.connection.name}...`,
      });

      await CompareConfigService.fetchSchemas(env.connection.name, env.connection);

      const updatedConnections = await CompareConfigService.getActiveConnections();
      const reconnected = updatedConnections.find((c) => c.connect_string === env.connection.connect_string && c.is_alive);

      if (reconnected) {
        this.updateConnectionStatus();
        return { success: true, message: "Reconnected successfully" };
      }

      return { success: false, message: `Failed to reconnect to ${env.connection.name}` };
    } catch (error) {
      const friendlyError = this.parseOracleError(error, env.connection.name);
      return { success: false, message: friendlyError };
    }
  }

  /**
   * Ensures a connection is alive, attempting reconnection if needed.
   * Uses lazy reconnection strategy - only reconnects when actually needed.
   * @param {string} envKey - 'env1' or 'env2'
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async ensureConnectionAlive(envKey) {
    const env = this[envKey];
    if (!env?.connection) {
      return { success: false, message: `No connection configured for ${envKey}` };
    }

    const envLabel = envKey === "env1" ? "Env 1" : "Env 2";

    try {
      // Check if connection is currently alive
      const activeConnections = await CompareConfigService.getActiveConnections();
      const existingConn = activeConnections.find((c) => c.connect_string === env.connection.connect_string && c.is_alive);

      if (existingConn) {
        console.log(`[Connection] ${envLabel} connection is alive`);
        return { success: true, message: "Connection active" };
      }

      // Connection is not alive - attempt reconnection
      console.log(`[Connection] ${envLabel} connection lost, attempting reconnect...`);

      // Show user-friendly feedback
      this.eventBus.emit("notification:show", {
        type: "info",
        message: `Reconnecting to ${env.connection.name}...`,
      });

      // Trigger a simple operation to re-establish connection
      // This will create a new connection if needed (pool reuses by connect_string)
      await CompareConfigService.fetchSchemas(env.connection.name, env.connection);

      // Verify connection is now alive
      const updatedConnections = await CompareConfigService.getActiveConnections();
      const reconnected = updatedConnections.find((c) => c.connect_string === env.connection.connect_string && c.is_alive);

      if (reconnected) {
        this.updateConnectionStatus();
        console.log(`[Connection] ${envLabel} reconnected successfully`);
        return { success: true, message: "Reconnected successfully" };
      }

      return { success: false, message: `Failed to reconnect to ${env.connection.name}` };
    } catch (error) {
      console.error(`[Connection] ${envLabel} reconnection failed:`, error);
      const friendlyError = this.parseOracleError(error, env.connection.name);
      return { success: false, message: friendlyError };
    }
  }

  /**
   * Parses Oracle OCI errors into user-friendly messages
   */
  parseOracleError(error, connectionName) {
    const errorStr = String(error.message || error);

    // Extract ORA code if present
    const oraMatch = errorStr.match(/ORA-(\d+)/);
    const oraCode = oraMatch ? oraMatch[0] : null;

    // Common Oracle errors with friendly messages
    const errorMessages = {
      "ORA-12170": "Connection timeout - database server not reachable",
      "ORA-12541": "No listener - database service not running",
      "ORA-12514": "Service name not found",
      "ORA-01017": "Invalid username or password",
      "ORA-28000": "Account is locked",
      "ORA-28001": "Password has expired",
      "ORA-12154": "TNS name could not be resolved",
      "ORA-03114": "Connection lost - not connected to Oracle",
      "ORA-03113": "End-of-file on communication channel",
    };

    if (oraCode && errorMessages[oraCode]) {
      return `${connectionName}: ${errorMessages[oraCode]}`;
    }

    // For unknown errors, show a shortened version
    if (errorStr.includes("OCI Error:")) {
      // Extract just the main part before "Help:"
      const mainPart = errorStr.split("Help:")[0].replace("OCI Error:", "").trim();
      // Limit length
      const shortMsg = mainPart.length > 80 ? mainPart.substring(0, 80) + "..." : mainPart;
      return `${connectionName}: ${shortMsg}`;
    }

    return `${connectionName}: Connection failed`;
  }

  /**
   * Validates comparison request
   */
  async validateComparisonRequest() {
    console.log("[Validate] Starting validation...");
    console.log("[Validate] Current State:", {
      env1: this.env1.connection?.name,
      env2: this.env2.connection?.name,
      schema: this.schema,
      table: this.table,
      env2SchemaExists: this.env2SchemaExists,
      env2TableExists: this.env2TableExists,
      metadataSet: !!this.metadata,
      selectedFieldsCount: this.selectedFields?.length || 0,
    });

    // Show verification message
    this.showLoading("Verifying connections and configuration...");

    try {
      if (!this.env1.connection || !this.env2.connection) {
        console.warn("[Validate] FAILED: Missing connections");
        this.hideLoading();
        this.eventBus.emit("notification:show", {
          type: "error",
          message: "Please select connections for both environments",
        });
        return false;
      }

      // Check if connections are active - attempt reconnection if needed
      console.log("[Validate] Ensuring connections are alive...");
      const env1Result = await this.ensureConnectionAlive("env1");
      if (!env1Result.success) {
        console.warn("[Validate] FAILED: Env1 connection issue -", env1Result.message);
        this.updateProgressStep("env1", "error", env1Result.message);
        this.hideProgress();
        // Show inline error in results area
        this.resetToEmptyState(env1Result.message);
        return false;
      }
      this.updateProgressStep("env1", "done", this.env1.connection.name);
      this.updateProgressStep("env2", "active", this.env2.connection?.name || "Env 2");

      const env2Result = await this.ensureConnectionAlive("env2");
      if (!env2Result.success) {
        console.warn("[Validate] FAILED: Env2 connection issue -", env2Result.message);
        this.updateProgressStep("env2", "error", env2Result.message);
        this.hideProgress();
        this.resetToEmptyState(env2Result.message);
        return false;
      }
      console.log("[Validate] Both connections verified alive");

      // Check credentials
      console.log("[Validate] Checking credentials...");
      const hasEnv1Creds = await CompareConfigService.hasOracleCredentials(this.env1.connection.name);
      const hasEnv2Creds = await CompareConfigService.hasOracleCredentials(this.env2.connection.name);
      console.log("[Validate] Env1 Creds:", hasEnv1Creds, "Env2 Creds:", hasEnv2Creds);

      if (!hasEnv1Creds) {
        console.warn("[Validate] FAILED: Missing Env1 credentials");
        this.hideLoading();
        this.eventBus.emit("notification:show", {
          type: "error",
          message: `Missing credentials for ${this.env1.connection.name}. Please set them in Settings.`,
        });
        return false;
      }

      if (!hasEnv2Creds) {
        console.warn("[Validate] FAILED: Missing Env2 credentials");
        this.hideLoading();
        this.eventBus.emit("notification:show", {
          type: "error",
          message: `Missing credentials for ${this.env2.connection.name}. Please set them in Settings.`,
        });
        return false;
      }

      if (!this.schema || !this.table) {
        console.warn("[Validate] FAILED: Missing schema or table", { schema: this.schema, table: this.table });
        this.hideLoading();
        this.eventBus.emit("notification:show", {
          type: "error",
          message: "Please select a schema and table",
        });
        return false;
      }

      // Proactive Re-validation if flags are false
      if (!this.env2SchemaExists) {
        console.log("[Validate] Schema not verified in Env2, attempting re-validation...");
        await this.validateSchemaInEnv2(this.schema);
        console.log("[Validate] After validation, env2SchemaExists:", this.env2SchemaExists);
      }

      if (this.env2SchemaExists && !this.env2TableExists) {
        console.log("[Validate] Table not verified in Env2, attempting re-validation...");
        await this.validateTableInEnv2(this.table);
        console.log("[Validate] After validation, env2TableExists:", this.env2TableExists);
      }

      // Final checks
      if (!this.env2SchemaExists) {
        console.warn("[Validate] FAILED: Schema not in Env2");
        this.hideLoading();
        this.eventBus.emit("notification:show", {
          type: "error",
          message: `Schema "${this.schema}" not found or inaccessible in ${this.env2.connection.name}.`,
        });
        return false;
      }

      if (!this.env2TableExists) {
        console.warn("[Validate] FAILED: Table not in Env2");
        this.hideLoading();
        this.eventBus.emit("notification:show", {
          type: "error",
          message: `Table "${this.schema}.${this.table}" not found or inaccessible in ${this.env2.connection.name}.`,
        });
        return false;
      }

      if (!this.metadata) {
        console.log("[Validate] Metadata missing, attempting to fetch...");
        await this.fetchTableMetadata();
        console.log("[Validate] After fetch, metadataSet:", !!this.metadata);
      }

      if (!this.metadata) {
        console.warn("[Validate] FAILED: Failed to load metadata");
        this.hideLoading();
        this.eventBus.emit("notification:show", {
          type: "error",
          message: "Failed to load table metadata.",
        });
        return false;
      }

      if (!this.selectedFields || this.selectedFields.length === 0) {
        console.warn("[Validate] FAILED: No fields selected");
        this.hideLoading();
        this.eventBus.emit("notification:show", {
          type: "error",
          message: "Please select at least one field to compare",
        });
        return false;
      }

      console.log("[Validate] PASSED");
      this.hideLoading();
      return true;
    } catch (error) {
      console.error("[Validate] Error during validation:", error);
      this.hideLoading();
      this.eventBus.emit("notification:show", {
        type: "error",
        message: `Validation failed: ${error.message || error}`,
      });
      return false;
    }
  }

  /**
   * Shows loading state (legacy - for simple operations)
   */
  showLoading(message = "Loading...") {
    const loadingState = document.getElementById("loading-state");
    const loadingMessage = document.getElementById("loading-message");

    if (loadingState) loadingState.style.display = "flex";
    if (loadingMessage) loadingMessage.textContent = message;
  }

  /**
   * Hides loading state (legacy)
   */
  hideLoading() {
    const loadingState = document.getElementById("loading-state");
    if (loadingState) loadingState.style.display = "none";
    // Also hide progress overlay
    this.hideProgress();
  }

  /**
   * Shows the progress overlay with connection details
   */
  showProgress(title = "Comparing Configurations") {
    const overlay = document.getElementById("progress-overlay");
    const titleEl = document.getElementById("progress-title");

    if (titleEl) titleEl.textContent = title;
    if (overlay) overlay.style.display = "flex";

    // Reset all steps to pending
    this.resetProgressSteps();
  }

  /**
   * Hides the progress overlay
   */
  hideProgress() {
    const overlay = document.getElementById("progress-overlay");
    if (overlay) overlay.style.display = "none";
  }

  /**
   * Updates a progress step's state and detail
   * @param {string} stepId - One of: env1, env2, fetch, compare
   * @param {string} state - One of: pending, active, done, error
   * @param {string} detail - Detail text to show
   */
  updateProgressStep(stepId, state, detail = "") {
    const stepEl = document.getElementById(`step-${stepId}`);
    if (!stepEl) return;

    const iconEl = stepEl.querySelector(".step-icon");
    const detailEl = document.getElementById(`step-${stepId}-detail`);

    // Update icon based on state
    if (iconEl) {
      iconEl.className = `step-icon ${state}`;
      switch (state) {
        case "pending":
          iconEl.textContent = "○";
          break;
        case "active":
          iconEl.textContent = "◉";
          break;
        case "done":
          iconEl.textContent = "✓";
          break;
        case "error":
          iconEl.textContent = "✕";
          break;
      }
    }

    // Update detail text
    if (detailEl && detail) {
      detailEl.textContent = detail;
    }
  }

  /**
   * Resets all progress steps to pending state
   */
  resetProgressSteps() {
    ["env1", "env2", "fetch", "compare"].forEach((stepId) => {
      this.updateProgressStep(stepId, "pending", "—");
    });
  }

  /**
   * Shows comparison results
   */
  showResults() {
    const resultsSection = document.getElementById("results-section");
    if (!resultsSection) return;

    // Update title with schema.table name
    const titleEl = document.getElementById("results-title");
    if (titleEl) {
      if (this.queryMode === "schema-table" && this.schema && this.table) {
        titleEl.textContent = `Comparison Results for ${this.schema}.${this.table}`;
      } else if (this.queryMode === "raw-sql") {
        titleEl.textContent = "Comparison Results (Raw SQL)";
      } else if (this.queryMode === "excel-compare") {
        titleEl.textContent = "Comparison Results (Excel/CSV)";
      } else {
        titleEl.textContent = "Comparison Results";
      }
    }

    // Render summary
    this.renderSummary();

    // Render multi-file results selector if in Excel mode
    this.renderResultSelector();

    // Render results content based on current view
    this.renderResults();

    // Enable/disable export buttons based on results
    const exportJsonBtn = document.getElementById("btn-export-json");
    const exportCsvBtn = document.getElementById("btn-export-csv");
    const hasResults = this.results[this.queryMode]?.rows?.length > 0;
    if (exportJsonBtn) exportJsonBtn.disabled = !hasResults;
    if (exportCsvBtn) exportCsvBtn.disabled = !hasResults;

    // Show results section
    resultsSection.style.display = "flex";

    // Scroll to results
    resultsSection.scrollIntoView({ behavior: "smooth" });
    this.saveToolState();
  }

  /**
   * Render selector for multi-file Excel results
   */
  renderResultSelector() {
    const summaryEl = document.getElementById("results-summary");
    if (!summaryEl || this.queryMode !== "excel-compare") return;

    // Remove existing selector if any
    const existing = document.querySelector(".result-file-selector");
    if (existing) existing.remove();

    const results = this.results["excel-compare"];
    if (!results || results.rows.length === 0) return;

    // Extract unique source files
    const sourceFiles = [...new Set(results.rows.map((r) => r._sourceFile).filter(Boolean))];
    if (sourceFiles.length <= 1) return;

    const selectorContainer = document.createElement("div");
    selectorContainer.className = "result-file-selector";

    let html = `
      <div class="result-tabs">
        <button class="result-tab ${this.excelCompare.selectedFileResult === "all" ? "active" : ""}" data-file="all">All Files (${sourceFiles.length})</button>
    `;

    sourceFiles.forEach((file) => {
      const fileRows = results.rows.filter((r) => r._sourceFile === file);
      const diffCount = fileRows.filter((r) => r.status === "differ").length;
      html += `
        <button class="result-tab ${this.excelCompare.selectedFileResult === file ? "active" : ""}" data-file="${file}">
          ${file}
          ${diffCount > 0 ? `<span class="tab-badge badge-destructive">${diffCount}</span>` : ""}
        </button>
      `;
    });

    html += "</div>";
    selectorContainer.innerHTML = html;

    // Prepend to summary
    summaryEl.parentElement.insertBefore(selectorContainer, summaryEl);

    // Add click listeners
    selectorContainer.querySelectorAll(".result-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        this.excelCompare.selectedFileResult = tab.dataset.file;
        this.showResults(); // Re-render everything
      });
    });
  }

  /**
   * Renders results based on current view type
   */
  renderResults() {
    const resultsContent = document.getElementById("results-content");
    if (!resultsContent || !this.results[this.queryMode]) return;

    const { env1_name, env2_name } = this.results[this.queryMode];
    const comparisons = this.getFilteredComparisons();

    let html = "";
    switch (this.currentView) {
      case "expandable":
        // Use inline expandable view rendering
        this.renderExpandableView();
        return; // Exit early since renderExpandableView handles everything

      case "vertical":
        html = this.verticalCardView.render(comparisons, env1_name, env2_name);
        resultsContent.innerHTML = html;
        break;

      case "master-detail":
        html = this.masterDetailView.render(comparisons, env1_name, env2_name);
        resultsContent.innerHTML = html;
        // Attach event listeners for master-detail view
        this.masterDetailView.attachEventListeners(resultsContent);
        break;

      case "grid":
        html = this.gridView.render(comparisons, env1_name, env2_name);
        resultsContent.innerHTML = html;
        // Attach event listeners for lazy loading
        this.gridView.attachEventListeners(resultsContent);
        break;

      default:
        this.renderExpandableView();
    }
  }

  /**
   * Renders the summary statistics
   */
  renderSummary() {
    const summaryContainer = document.getElementById("results-summary");
    if (!summaryContainer || !this.results[this.queryMode]) return;

    let { summary } = this.results[this.queryMode];

    // Recalculate summary if filtered by specific file in Excel mode
    if (this.queryMode === "excel-compare" && this.excelCompare.selectedFileResult !== "all") {
      const filteredRows = this.results[this.queryMode].rows.filter((r) => r._sourceFile === this.excelCompare.selectedFileResult);
      summary = {
        total: filteredRows.length,
        matches: filteredRows.filter((r) => r.status === "match").length,
        differs: filteredRows.filter((r) => r.status === "differ").length,
        only_in_env1: filteredRows.filter((r) => r.status === "only_in_env1").length,
        only_in_env2: filteredRows.filter((r) => r.status === "only_in_env2").length,
      };
    }

    // Check if primary key was selected (for warning)
    let hasPrimaryKey = true;
    if (this.queryMode === "schema-table") {
      hasPrimaryKey = this.customPrimaryKey && this.customPrimaryKey.length > 0;
    } else if (this.queryMode === "raw-sql") {
      hasPrimaryKey = this.rawPrimaryKey && this.rawPrimaryKey.trim().length > 0;
    } else if (this.queryMode === "excel-compare" && this.excelCompare.rowMatching === "key") {
      hasPrimaryKey = this.excelCompare.pkColumns && this.excelCompare.pkColumns.trim().length > 0;
    }

    // Warning banner for no PK
    const noPkWarning =
      !hasPrimaryKey && this.queryMode !== "excel-compare"
        ? `
      <div class="no-pk-warning">
        <span class="warning-icon">⚠️</span>
        <span class="warning-text">No primary key selected. Results are matched using the first column which may not be unique.</span>
      </div>
    `
        : "";

    // Set environment names for summary
    let env1Name = "Env 1";
    let env2Name = "Env 2";

    if (this.queryMode === "schema-table") {
      env1Name = this.env1.connection?.name || "Env 1";
      env2Name = this.env2.connection?.name || "Env 2";
    } else if (this.queryMode === "raw-sql") {
      env1Name = this.rawenv1.connection?.name || "Env 1";
      env2Name = this.rawenv2.connection?.name || "Env 2";
    } else if (this.queryMode === "excel-compare") {
      env1Name = "Reference";
      env2Name = "Comparator";
    }

    // Render summary cards as clickable filter buttons
    // Note: Rust CompareSummary uses 'total', 'matches', 'differs'
    summaryContainer.innerHTML = `
      ${noPkWarning}
      <div class="summary-cards">
        <button class="summary-stat ${this.statusFilter === null ? "selected" : ""}" data-filter="all">
          <div class="stat-value">${summary.total}</div>
          <div class="stat-label">Total Records</div>
        </button>
        <button class="summary-stat matching ${this.statusFilter === "match" ? "selected" : ""}" data-filter="match">
          <div class="stat-value">${summary.matches}</div>
          <div class="stat-label">Matching</div>
        </button>
        <button class="summary-stat differing ${this.statusFilter === "differ" ? "selected" : ""}" data-filter="differ">
          <div class="stat-value">${summary.differs}</div>
          <div class="stat-label">Differing</div>
        </button>
        <button class="summary-stat only-env1 ${this.statusFilter === "only_in_env1" ? "selected" : ""}" data-filter="only_in_env1">
          <div class="stat-value">${summary.only_in_env1}</div>
          <div class="stat-label">Only in ${env1Name}</div>
        </button>
        <button class="summary-stat only-env2 ${this.statusFilter === "only_in_env2" ? "selected" : ""}" data-filter="only_in_env2">
          <div class="stat-value">${summary.only_in_env2}</div>
          <div class="stat-label">Only in ${env2Name}</div>
        </button>
      </div>
    `;

    // Add click event listeners to filter buttons
    const filterButtons = summaryContainer.querySelectorAll(".summary-stat");
    filterButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const filter = btn.dataset.filter;
        this.applyStatusFilter(filter);
      });
    });
  }

  /**
   * Applies status filter to comparison results
   */
  applyStatusFilter(filter) {
    // Set filter (null means show all)
    this.statusFilter = filter === "all" ? null : filter;

    // Re-render the view with filtered results
    this.renderSummary(); // Update selected state
    this.renderResults(); // Re-render results with filter
  }

  /**
   * Gets filtered comparisons based on current status filter
   */
  getFilteredComparisons() {
    if (!this.results[this.queryMode]) return [];

    let rows = this.results[this.queryMode].rows || [];

    // Filter by file if in Excel mode
    if (this.queryMode === "excel-compare" && this.excelCompare.selectedFileResult !== "all") {
      rows = rows.filter((r) => r._sourceFile === this.excelCompare.selectedFileResult);
    }

    // If no filter, return all rows
    if (!this.statusFilter) {
      return rows;
    }

    // Filter by status
    return rows.filter((comp) => comp.status === this.statusFilter);
  }

  /**
   * Renders expandable row view (Phase 1 placeholder)
   */
  renderExpandableView() {
    const resultsContent = document.getElementById("results-content");
    if (!resultsContent || !this.results[this.queryMode]) return;

    const { env1_name, env2_name } = this.results[this.queryMode];
    const comparisons = this.getFilteredComparisons();

    if (comparisons.length === 0) {
      resultsContent.innerHTML = `
        <div class="placeholder-message">
          <p>No records found matching the criteria.</p>
        </div>
      `;
      return;
    }

    // Build expandable rows
    const rowsHtml = comparisons.map((comp, index) => this.renderComparisonRow(comp, index, env1_name, env2_name)).join("");

    resultsContent.innerHTML = `
      <div class="expandable-results">
        <table class="results-table">
          <thead>
            <tr>
              <th width="40"></th>
              <th>Primary Key</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    `;

    // Add event listeners for expand/collapse
    const expandButtons = resultsContent.querySelectorAll(".btn-expand");
    expandButtons.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const rowId = e.target.closest(".btn-expand").dataset.rowId;
        this.toggleRowExpansion(rowId);
      });
    });

    // Add event listeners for copy primary key using BaseTool helper
    const copyPkButtons = resultsContent.querySelectorAll(".btn-copy-pk");
    copyPkButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const pk = btn.dataset.pk || "";
        this.copyToClipboard(pk, btn);
      });
    });
  }

  /**
   * Renders a single comparison row
   */
  renderComparisonRow(comparison, index, env1Name, env2Name) {
    const statusClass = comparison.status.toLowerCase().replace("_", "-");
    const statusLabel = this.getStatusLabel(comparison.status);
    const statusBadge = `<span class="status-badge status-${statusClass}">${statusLabel}</span>`;

    // Format primary key from HashMap (Rust 'key' field)
    const pkDisplay = this.formatPrimaryKey(comparison.key);

    return /*html*/ `
      <tr class="comparison-row" data-row-id="${index}">
        <td>
          <button class="btn btn-ghost btn-icon-only btn-expand" data-row-id="${index}" title="Expand/Collapse">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </td>
        <td class="pk-cell">${this.escapeHtml(pkDisplay)}</td>
        <td>${statusBadge}</td>
        <td>
          <button class="btn btn-outline btn-xs btn-copy-pk" data-pk="${this.escapeHtml(
            pkDisplay,
          )}" title="Copy Primary Key">Copy PK</button>
        </td>
      </tr>
      <tr class="comparison-detail" data-row-id="${index}" style="display: none;">
        <td colspan="4">
          ${this.renderComparisonDetail(comparison, env1Name, env2Name)}
        </td>
      </tr>
    `;
  }

  /**
   * Renders the detailed comparison for an expanded row
   */
  renderComparisonDetail(comparison, env1Name, env2Name) {
    if (comparison.status === "only_in_env1") {
      return `
        <div class="comparison-detail-content">
          <p class="detail-message">This record only exists in <strong>${env1Name}</strong></p>
          ${this.renderDataObject(comparison.env1_data, "Env 1 Data")}
        </div>
      `;
    }

    if (comparison.status === "only_in_env2") {
      return `
        <div class="comparison-detail-content">
          <p class="detail-message">This record only exists in <strong>${env2Name}</strong></p>
          ${this.renderDataObject(comparison.env2_data, "Env 2 Data")}
        </div>
      `;
    }

    if (comparison.status === "match") {
      return `
        <div class="comparison-detail-content">
          <p class="detail-message">✓ Records match perfectly</p>
          ${this.renderDataObject(comparison.env1_data, "Data")}
        </div>
      `;
    }

    // Status is 'differ' - show all fields, highlight differences
    const diffFields = new Set(comparison.differences || []);
    const env1Data = comparison.env1_data || {};
    const env2Data = comparison.env2_data || {};

    // Get all unique field names
    const allFields = Array.from(new Set([...Object.keys(env1Data), ...Object.keys(env2Data)])).sort();

    return `
      <div class="comparison-detail-content">
        <table class="field-comparison-table">
          <thead>
            <tr>
              <th>Field</th>
              <th>${this.escapeHtml(env1Name)}</th>
              <th>${this.escapeHtml(env2Name)}</th>
            </tr>
          </thead>
          <tbody>
            ${allFields
              .map((fieldName) =>
                this.renderFieldDifferenceSimple(fieldName, env1Data[fieldName], env2Data[fieldName], diffFields.has(fieldName)),
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  /**
   * Renders a single field difference with diff highlighting
   */
  renderFieldDifference(diff) {
    const env1ValueHtml = this.renderDiffChunks(diff.env1_diff_chunks);
    const env2ValueHtml = this.renderDiffChunks(diff.env2_diff_chunks);

    return `
      <tr class="field-diff-row">
        <td class="field-name">${this.escapeHtml(diff.field_name)}</td>
        <td class="field-value">${env1ValueHtml}</td>
        <td class="field-value">${env2ValueHtml}</td>
      </tr>
    `;
  }

  /**
   * Renders diff chunks with color highlighting
   */
  renderDiffChunks(chunks) {
    if (!chunks || chunks.length === 0) {
      return '<span class="empty-value">(empty)</span>';
    }

    return chunks
      .map((chunk) => {
        const escapedText = this.escapeHtml(chunk.text);
        switch (chunk.chunk_type) {
          case "same":
            return `<span class="diff-same">${escapedText}</span>`;
          case "added":
            return `<span class="diff-added">${escapedText}</span>`;
          case "removed":
            return `<span class="diff-removed">${escapedText}</span>`;
          case "modified":
            return `<span class="diff-modified">${escapedText}</span>`;
          default:
            return `<span>${escapedText}</span>`;
        }
      })
      .join("");
  }

  /**
   * Formats a primary key HashMap into a display string
   */
  formatPrimaryKey(keyMap) {
    if (!keyMap || typeof keyMap !== "object") return "";
    const entries = Object.entries(keyMap);
    if (entries.length === 0) return "";
    if (entries.length === 1) {
      // Single key - just show the value
      return this.formatValue(entries[0][1]);
    }
    // Composite key - show key=value pairs
    return entries.map(([k, v]) => `${k}=${this.formatValue(v)}`).join(", ");
  }

  /**
   * Formats a value for display (handles JSON values)
   */
  formatValue(value) {
    if (value === null || value === undefined) return "(null)";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  /**
   * Renders a simple field difference (field name + values from each env)
   */
  renderFieldDifferenceSimple(fieldName, env1Value, env2Value, isDifferent) {
    const env1Display = this.formatValue(env1Value);
    const env2Display = this.formatValue(env2Value);

    const env1Class = isDifferent ? "field-value diff-removed" : "field-value";
    const env2Class = isDifferent ? "field-value diff-added" : "field-value";

    return `
      <tr class="field-diff-row ${isDifferent ? "is-different" : ""}">
        <td class="field-name">${this.escapeHtml(fieldName)}</td>
        <td class="${env1Class}">${this.escapeHtml(env1Display)}</td>
        <td class="${env2Class}">${this.escapeHtml(env2Display)}</td>
      </tr>
    `;
  }

  /**
   * Renders a data object as a table
   */
  renderDataObject(data, title) {
    if (!data) return "";

    const entries = Object.entries(data);
    return `
      <div class="data-object">
        <h4>${title}</h4>
        <table class="data-table">
          <tbody>
            ${entries
              .map(
                ([key, value]) => `
              <tr>
                <td class="data-key">${this.escapeHtml(key)}</td>
                <td class="data-value">${this.escapeHtml(JSON.stringify(value))}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  /**
   * Toggles row expansion
   */
  toggleRowExpansion(rowId) {
    const row = document.querySelector(`tr.comparison-row[data-row-id="${rowId}"]`);
    const detail = document.querySelector(`tr.comparison-detail[data-row-id="${rowId}"]`);
    const button = document.querySelector(`.btn-expand[data-row-id="${rowId}"]`);

    if (!row || !detail || !button) return;

    const isExpanded = detail.style.display !== "none";

    if (isExpanded) {
      detail.style.display = "none";
      row.classList.remove("expanded");
      button.classList.remove("expanded");
    } else {
      detail.style.display = "table-row";
      row.classList.add("expanded");
      button.classList.add("expanded");
    }
  }

  /**
   * Gets a human-readable status label
   */
  getStatusLabel(status) {
    switch (status) {
      case "match":
        return "Match";
      case "differ":
        return "Differ";
      case "only_in_env1":
        return "Only in Env 1";
      case "only_in_env2":
        return "Only in Env 2";
      default:
        return status;
    }
  }

  /**
   * Escapes HTML to prevent XSS
   */
  escapeHtml(text) {
    if (text === null || text === undefined) return "";
    const div = document.createElement("div");
    div.textContent = String(text);
    return div.innerHTML;
  }

  /**
   * Changes the results view type
   */
  changeView(viewType) {
    this.currentView = viewType;
    this.renderResults();
    this.saveToolState();
  }

  /**
   * Exports comparison results
   */
  async exportResults(format) {
    if (!this.results[this.queryMode]) {
      this.eventBus.emit("notification:show", {
        type: "error",
        message: "No comparison results to export",
      });
      return;
    }

    try {
      // Get export data from backend
      const exportData = await CompareConfigService.exportComparisonResult(this.results[this.queryMode], format);

      // Create a blob and trigger browser download
      const blob = new Blob([exportData.content], {
        type: format === "json" ? "application/json" : "text/csv",
      });
      const url = URL.createObjectURL(blob);

      // Create temporary download link and click it
      const a = document.createElement("a");
      a.href = url;
      a.download = exportData.filename;
      document.body.appendChild(a);
      a.click();

      // Cleanup
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      this.eventBus.emit("notification:show", {
        type: "success",
        message: `Results exported as ${exportData.filename}`,
      });

      this.eventBus.emit("comparison:exported", { filename: exportData.filename, format });
    } catch (error) {
      console.error("Export failed:", error);

      this.eventBus.emit("notification:show", {
        type: "error",
        message: `Export failed: ${error.message || error}`,
      });
    }
  }

  /**
   * Resets the form for a new comparison (complete clean slate)
   */
  resetForm() {
    // Reset Schema/Table state
    this.env1 = {
      connection: null,
      schema: null,
      table: null,
      metadata: null,
    };
    this.env2 = {
      connection: null,
      schema: null,
      table: null,
      metadata: null,
    };
    this.schema = null;
    this.table = null;
    this.customPrimaryKey = [];
    this.selectedFields = [];
    this.whereClause = "";
    this.maxRows = 100;
    this.metadata = null;
    this.env2SchemaExists = false;
    this.env2TableExists = false;

    // Reset Raw SQL state
    this.rawenv1 = { connection: null };
    this.rawenv2 = { connection: null };
    this.rawSql = "";
    this.rawPrimaryKey = "";
    this.rawMaxRows = 100;

    // Clear results for ALL modes
    this.results["schema-table"] = null;
    this.results["raw-sql"] = null;
    this.results["excel-compare"] = null;

    // Reset Excel Compare state (NEW FLOW)
    if (this.queryMode === "excel-compare") {
      // For Excel mode, go back to file pairing step (not clear files)
      this.excelCompare.selectedRefFile = null;
      this.excelCompare.selectedCompFile = null;
      this.excelCompare.autoMatchedComp = null;
      this.excelCompare.headers = [];
      this.excelCompare.commonHeaders = [];
      this.excelCompare.refOnlyHeaders = [];
      this.excelCompare.compOnlyHeaders = [];
      this.excelCompare.selectedPkFields = [];
      this.excelCompare.selectedFields = [];
      this.excelCompare.refParsedData = null;
      this.excelCompare.compParsedData = null;
      this.excelCompare.currentStep = 1;

      // Save reset state to IndexedDB (keeps files, clears selections)
      this.saveExcelCompareStateToIndexedDB();

      // Reset Excel UI
      const excelFieldSelection = document.getElementById("excel-field-selection");
      const excelColumnWarning = document.getElementById("excel-column-warning");
      const compMatchHint = document.getElementById("comp-match-hint");
      const refFileSearch = document.getElementById("excel-ref-file-search");
      const compFileSearch = document.getElementById("excel-comp-file-search");

      if (excelFieldSelection) excelFieldSelection.style.display = "none";
      if (excelColumnWarning) excelColumnWarning.style.display = "none";
      if (compMatchHint) {
        compMatchHint.textContent = "";
        compMatchHint.className = "help-text";
      }
      if (refFileSearch) refFileSearch.value = "";
      if (compFileSearch) compFileSearch.value = "";

      // Reinitialize pairing dropdowns if files exist
      this.checkAndShowPairingUI();
    }

    // Reset Schema/Table UI
    const env1Connection = document.getElementById("env1-connection");
    const env2Connection = document.getElementById("env2-connection");
    const schemaSelect = document.getElementById("schema-select");
    const tableSelect = document.getElementById("table-select");
    const whereClauseInput = document.getElementById("where-clause");
    const maxRowsInput = document.getElementById("max-rows");
    const pkFieldList = document.getElementById("pk-field-list");
    const fieldList = document.getElementById("field-list");
    const fieldSelection = document.getElementById("field-selection");
    const resultsSection = document.getElementById("results-section");

    if (env1Connection) env1Connection.value = "";
    if (env2Connection) env2Connection.value = "";
    if (schemaSelect) {
      schemaSelect.disabled = true;
      schemaSelect.innerHTML = '<option value="">Select connection first...</option>';
    }
    if (tableSelect) {
      tableSelect.disabled = true;
      tableSelect.innerHTML = '<option value="">Select schema first...</option>';
    }
    if (whereClauseInput) whereClauseInput.value = "";
    if (maxRowsInput) maxRowsInput.value = "100";
    if (pkFieldList) pkFieldList.innerHTML = "";
    if (fieldList) fieldList.innerHTML = "";
    if (fieldSelection) fieldSelection.style.display = "none";
    if (resultsSection) resultsSection.style.display = "none";

    // Reset Raw SQL UI
    const rawEnv1Connection = document.getElementById("raw-env1-connection");
    const rawEnv2Connection = document.getElementById("raw-env2-connection");
    const rawSqlInput = document.getElementById("raw-sql");
    const rawPrimaryKeyInput = document.getElementById("raw-primary-key");
    const rawMaxRowsInput = document.getElementById("raw-max-rows");

    if (rawEnv1Connection) rawEnv1Connection.value = "";
    if (rawEnv2Connection) rawEnv2Connection.value = "";
    if (rawSqlInput) rawSqlInput.value = "";
    if (rawPrimaryKeyInput) rawPrimaryKeyInput.value = "";
    if (rawMaxRowsInput) rawMaxRowsInput.value = "100";

    // Reset results title
    const titleEl = document.getElementById("results-title");
    if (titleEl) titleEl.textContent = "Comparison Results";

    // Scroll to top and save
    window.scrollTo({ top: 0, behavior: "smooth" });
    this.saveToolState();
  }

  /**
   * Starts polling for connection status
   */
  startConnectionStatusPolling() {
    // Update immediately
    this.updateConnectionStatus();

    // Poll every 5 seconds
    this.connectionStatusInterval = setInterval(() => {
      this.updateConnectionStatus();
    }, 5000);
  }

  /**
   * Stops connection status polling
   */
  stopConnectionStatusPolling() {
    if (this.connectionStatusInterval) {
      clearInterval(this.connectionStatusInterval);
      this.connectionStatusInterval = null;
    }
  }

  /**
   * Updates the connection status indicator UI
   */
  async updateConnectionStatus() {
    try {
      const connections = await CompareConfigService.getActiveConnections();
      const statusEl = document.getElementById("connection-status");
      const listEl = statusEl?.querySelector(".connection-list");

      if (!statusEl || !listEl) return;

      const activeConnections = connections.filter((c) => c.is_alive);

      // Filter to only connections with valid display info
      const validConnections = activeConnections.filter((conn) => {
        const savedConn = this.savedConnections.find((sc) => sc.connect_string === conn.connect_string);
        return savedConn?.name || conn.connect_string;
      });

      if (validConnections.length > 0) {
        statusEl.style.display = "flex";
        listEl.innerHTML = validConnections
          .map((conn) => {
            // Look up the saved connection name
            const savedConn = this.savedConnections.find((sc) => sc.connect_string === conn.connect_string);
            const displayName = savedConn?.name || conn.connect_string;
            return `
              <span class="connection-chip" title="${conn.connect_string}">
                <span class="chip-name">${displayName}</span>
                <button class="chip-close" data-connect-string="${conn.connect_string}" data-username="${conn.username}" title="Close connection">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </span>`;
          })
          .join("");

        // Attach click handlers to individual close buttons
        listEl.querySelectorAll(".chip-close").forEach((btn) => {
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const connectString = btn.dataset.connectString;
            const username = btn.dataset.username;
            this.closeSingleConnection(connectString, username);
          });
        });
      } else {
        statusEl.style.display = "none";
        listEl.innerHTML = "";
      }
    } catch (error) {
      console.error("Failed to update connection status:", error);
    }
  }

  /**
   * Closes a single connection by connect string and username.
   * Also syncs dropdown state when a connection is closed.
   */
  async closeSingleConnection(connectString, username) {
    try {
      await CompareConfigService.closeConnection(connectString, username);

      // Sync dropdown state - clear env if it matches the closed connection
      if (this.env1.connection?.connect_string === connectString) {
        this.env1.connection = null;
        const env1Select = document.getElementById("env1-connection");
        if (env1Select) env1Select.value = "";
      }
      if (this.env2.connection?.connect_string === connectString) {
        this.env2.connection = null;
        const env2Select = document.getElementById("env2-connection");
        if (env2Select) env2Select.value = "";
      }
      if (this.rawenv1.connection?.connect_string === connectString) {
        this.rawenv1.connection = null;
        const rawEnv1Select = document.getElementById("raw-env1-connection");
        if (rawEnv1Select) rawEnv1Select.value = "";
      }
      if (this.rawenv2.connection?.connect_string === connectString) {
        this.rawenv2.connection = null;
        const rawEnv2Select = document.getElementById("raw-env2-connection");
        if (rawEnv2Select) rawEnv2Select.value = "";
      }

      this.updateConnectionStatus();
      this.saveToolState();

      this.eventBus.emit("notification:show", {
        type: "info",
        message: "Connection closed",
      });
    } catch (error) {
      console.error("Failed to close connection:", error);
    }
  }

  /**
   * Handles closing all connections
   */
  async closeAllConnections() {
    try {
      await CompareConfigService.closeAllConnections();
      this.updateConnectionStatus();

      // If no comparison results, reset to empty state
      if (!this.results[this.queryMode]) {
        this.resetToEmptyState();
      }
    } catch (error) {
      console.error("Failed to close connections:", error);
    }
  }

  /**
   * Resets the UI to empty state (no results), optionally showing an error
   * @param {string} errorMessage - Optional error message to display
   */
  resetToEmptyState(errorMessage = null) {
    const resultsSection = document.getElementById("results-section");
    const resultsContent = document.getElementById("results-content");
    const resultsSummary = document.getElementById("results-summary");

    // Show error in results section if provided
    if (errorMessage) {
      // Clear results from state so they don't reappear on reload
      this.results[this.queryMode] = null;
      this.saveToolState();

      if (resultsSection) resultsSection.style.display = "flex";
      if (resultsSummary) resultsSummary.innerHTML = "";
      if (resultsContent) {
        resultsContent.innerHTML = `
          <div class="connection-error-banner">
            <div class="error-icon">⚠️</div>
            <div class="error-content">
              <div class="error-title">Connection Failed</div>
              <div class="error-message">${errorMessage}</div>
              <div class="error-hint">Check your VPN connection or verify the database is reachable.</div>
            </div>
          </div>
        `;
      }
    } else {
      // Normal empty state
      if (resultsSection) resultsSection.style.display = "none";
      if (resultsContent) resultsContent.innerHTML = "";
      if (resultsSummary) resultsSummary.innerHTML = "";
    }
  }

  onUnmount() {
    // Stop connection status polling
    this.stopConnectionStatusPolling();
  }

  // =============================================================================
  // IndexedDB State Management
  // =============================================================================

  /**
   * Saves Excel Compare state to IndexedDB (excluding large parsed data and File objects)
   */
  async saveExcelCompareStateToIndexedDB() {
    if (!IndexedDBManager.isIndexedDBAvailable()) return;

    try {
      const state = {
        currentStep: this.excelCompare.currentStep,
        // Store file IDs only (actual files are stored separately)
        refFileIds: this.excelCompare.refFiles.map((f) => f.id),
        compFileIds: this.excelCompare.compFiles.map((f) => f.id),
        // Selected file IDs
        selectedRefFileId: this.excelCompare.selectedRefFile?.id || null,
        selectedCompFileId: this.excelCompare.selectedCompFile?.id || null,
        // Field configuration
        headers: this.excelCompare.headers,
        commonHeaders: this.excelCompare.commonHeaders,
        refOnlyHeaders: this.excelCompare.refOnlyHeaders,
        compOnlyHeaders: this.excelCompare.compOnlyHeaders,
        selectedPkFields: this.excelCompare.selectedPkFields,
        selectedFields: this.excelCompare.selectedFields,
        rowMatching: this.excelCompare.rowMatching,
        dataComparison: this.excelCompare.dataComparison,
        // Note: refParsedData and compParsedData are NOT saved (can be re-parsed from files)
      };

      await IndexedDBManager.saveExcelCompareState(state);
    } catch (error) {
      console.warn("Failed to save Excel Compare state to IndexedDB:", error);
    }
  }

  /**
   * Loads only Excel Compare cached files from IndexedDB (not selection state)
   * This is used on initial navigation to avoid confusing pre-filled UI
   */
  async loadExcelCompareFilesOnly() {
    if (!IndexedDBManager.isIndexedDBAvailable()) return;

    try {
      // Load cached files only
      const cachedFiles = await IndexedDBManager.getAllExcelFiles();
      if (cachedFiles && cachedFiles.length > 0) {
        // Reconstruct file objects from cached data
        const refFiles = [];
        const compFiles = [];

        for (const cached of cachedFiles) {
          // Create a File object from the cached ArrayBuffer
          const blob = new Blob([cached.content], { type: this.getMimeType(cached.name) });
          const file = new File([blob], cached.name, {
            type: this.getMimeType(cached.name),
            lastModified: cached.uploadedAt ? new Date(cached.uploadedAt).getTime() : Date.now(),
          });

          const fileWrapper = { id: cached.id, file };

          if (cached.type === "ref") {
            refFiles.push(fileWrapper);
          } else {
            compFiles.push(fileWrapper);
          }
        }

        this.excelCompare.refFiles = refFiles;
        this.excelCompare.compFiles = compFiles;

        // Update file list UI but don't restore selection
        this.updateExcelFileList("ref");
        this.updateExcelFileList("comp");
        this.updateClearAllButtonVisibility("ref");
        this.updateClearAllButtonVisibility("comp");
      }

      // Don't restore selection state - user needs to select files fresh
      // Clear any previous session state from IndexedDB
      await IndexedDBManager.clearExcelCompareState();

      return true;
    } catch (error) {
      console.warn("Failed to load Excel Compare files from IndexedDB:", error);
      return false;
    }
  }

  /**
   * Loads Excel Compare state from IndexedDB (full state including selection)
   * @deprecated Use loadExcelCompareFilesOnly for initial navigation
   */
  async loadExcelCompareStateFromIndexedDB() {
    if (!IndexedDBManager.isIndexedDBAvailable()) return;

    try {
      // Load cached files
      const cachedFiles = await IndexedDBManager.getAllExcelFiles();
      if (cachedFiles && cachedFiles.length > 0) {
        // Reconstruct file objects from cached data
        const refFiles = [];
        const compFiles = [];

        for (const cached of cachedFiles) {
          // Create a File object from the cached ArrayBuffer
          const blob = new Blob([cached.content], { type: this.getMimeType(cached.name) });
          const file = new File([blob], cached.name, {
            type: this.getMimeType(cached.name),
            lastModified: cached.uploadedAt ? new Date(cached.uploadedAt).getTime() : Date.now(),
          });

          const fileWrapper = { id: cached.id, file };

          if (cached.type === "ref") {
            refFiles.push(fileWrapper);
          } else {
            compFiles.push(fileWrapper);
          }
        }

        this.excelCompare.refFiles = refFiles;
        this.excelCompare.compFiles = compFiles;
      }

      // Load state
      const state = await IndexedDBManager.getExcelCompareState();
      if (state) {
        this.excelCompare.currentStep = state.currentStep || 1;
        this.excelCompare.headers = state.headers || [];
        this.excelCompare.commonHeaders = state.commonHeaders || [];
        this.excelCompare.refOnlyHeaders = state.refOnlyHeaders || [];
        this.excelCompare.compOnlyHeaders = state.compOnlyHeaders || [];
        this.excelCompare.selectedPkFields = state.selectedPkFields || [];
        this.excelCompare.selectedFields = state.selectedFields || [];
        this.excelCompare.rowMatching = state.rowMatching || "key";
        this.excelCompare.dataComparison = state.dataComparison || "strict";

        // Restore selected file references
        if (state.selectedRefFileId) {
          this.excelCompare.selectedRefFile = this.excelCompare.refFiles.find((f) => f.id === state.selectedRefFileId) || null;
        }
        if (state.selectedCompFileId) {
          this.excelCompare.selectedCompFile = this.excelCompare.compFiles.find((f) => f.id === state.selectedCompFileId) || null;
        }
      }

      return true;
    } catch (error) {
      console.warn("Failed to load Excel Compare state from IndexedDB:", error);
      return false;
    }
  }

  /**
   * Clears all Excel Compare data from IndexedDB
   */
  async clearExcelCompareFromIndexedDB() {
    if (!IndexedDBManager.isIndexedDBAvailable()) return;

    try {
      await IndexedDBManager.clearAllExcelCompareData();
    } catch (error) {
      console.warn("Failed to clear Excel Compare data from IndexedDB:", error);
    }
  }

  /**
   * Restores Excel Compare UI from cached state
   */
  restoreExcelCompareUI() {
    const hasRefFiles = this.excelCompare.refFiles.length > 0;
    const hasCompFiles = this.excelCompare.compFiles.length > 0;

    if (!hasRefFiles && !hasCompFiles) {
      return; // Nothing to restore
    }

    // Update file lists UI
    this.updateExcelFileList("ref");
    this.updateExcelFileList("comp");
    this.updateClearAllButtonVisibility("ref");
    this.updateClearAllButtonVisibility("comp");

    // Show pairing UI if both sides have files
    this.checkAndShowPairingUI();

    // If files were selected, restore the pairing dropdowns
    if (this.excelCompare.selectedRefFile || this.excelCompare.selectedCompFile) {
      // Re-populate dropdowns with selections
      this.populateFilePairingDropdowns();

      // Update search inputs to show selected file names
      const refSearchInput = document.getElementById("excel-ref-file-search");
      const compSearchInput = document.getElementById("excel-comp-file-search");

      if (refSearchInput && this.excelCompare.selectedRefFile) {
        refSearchInput.value = this.excelCompare.selectedRefFile.file.name;
      }
      if (compSearchInput && this.excelCompare.selectedCompFile) {
        compSearchInput.value = this.excelCompare.selectedCompFile.file.name;
      }

      // If both files are selected and we have field configuration, show field selection
      if (this.excelCompare.selectedRefFile && this.excelCompare.selectedCompFile) {
        if (this.excelCompare.headers.length > 0) {
          // Restore field selection UI
          this.showExcelFieldSelection();
        }
      }
    }
  }

  /**
   * Gets MIME type from filename extension
   */
  getMimeType(filename) {
    const ext = filename.toLowerCase().split(".").pop();
    const mimeTypes = {
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      xls: "application/vnd.ms-excel",
      csv: "text/csv",
    };
    return mimeTypes[ext] || "application/octet-stream";
  }

  // =============================================================================
  // Schema/Table Preferences (IndexedDB)
  // =============================================================================

  /**
   * Loads saved preferences for the current schema/table from IndexedDB
   */
  async loadSchemaTablePrefsFromIndexedDB() {
    if (!IndexedDBManager.isIndexedDBAvailable()) return;
    if (!this.env1.connection || !this.schema || !this.table) return;

    try {
      const prefs = await IndexedDBManager.getSchemaTablePrefs(this.env1.connection.name, this.schema, this.table);

      if (prefs) {
        // Only apply saved preferences if they are compatible with current metadata
        const currentColumns = this.metadata?.columns?.map((c) => c.name) || [];

        // Filter saved PK fields to only include columns that exist in current metadata
        const validPkFields = prefs.selectedPkFields.filter((f) => currentColumns.includes(f));
        if (validPkFields.length > 0) {
          this.customPrimaryKey = validPkFields;
        }

        // Filter saved fields to only include columns that exist in current metadata
        const validFields = prefs.selectedFields.filter((f) => currentColumns.includes(f));
        if (validFields.length > 0) {
          this.selectedFields = validFields;
        }

        console.log(`Loaded preferences for ${this.schema}.${this.table}:`, {
          pkFields: this.customPrimaryKey.length,
          selectedFields: this.selectedFields.length,
        });
      }
    } catch (error) {
      console.warn("Failed to load schema/table preferences from IndexedDB:", error);
    }
  }

  /**
   * Saves current preferences for the schema/table to IndexedDB
   */
  async saveSchemaTablePrefsToIndexedDB() {
    if (!IndexedDBManager.isIndexedDBAvailable()) return;
    if (!this.env1.connection || !this.schema || !this.table) return;

    try {
      await IndexedDBManager.saveSchemaTablePrefs({
        connectionId: this.env1.connection.name,
        schema: this.schema,
        table: this.table,
        selectedPkFields: this.customPrimaryKey || [],
        selectedFields: this.selectedFields || [],
      });
    } catch (error) {
      console.warn("Failed to save schema/table preferences to IndexedDB:", error);
    }
  }

  // =============================================================================
  // Raw SQL Preferences (IndexedDB)
  // =============================================================================

  /**
   * Loads saved preferences for the current raw SQL query from IndexedDB
   */
  async loadRawSqlPrefsFromIndexedDB() {
    if (!IndexedDBManager.isIndexedDBAvailable()) return;
    if (!this.rawSql) return;

    try {
      const prefs = await IndexedDBManager.getRawSqlPrefs(this.rawSql);

      if (prefs) {
        // Only auto-fill if primary key is not already set by user
        if (!this.rawPrimaryKey && prefs.selectedPkFields.length > 0) {
          this.rawPrimaryKey = prefs.selectedPkFields.join(", ");

          // Update the UI input
          const rawPrimaryKeyInput = document.getElementById("raw-primary-key");
          if (rawPrimaryKeyInput) {
            rawPrimaryKeyInput.value = this.rawPrimaryKey;
          }

          console.log(`Loaded Raw SQL preferences: PK = ${this.rawPrimaryKey}`);
        }
      }
    } catch (error) {
      console.warn("Failed to load raw SQL preferences from IndexedDB:", error);
    }
  }

  /**
   * Saves current preferences for the raw SQL query to IndexedDB
   */
  async saveRawSqlPrefsToIndexedDB() {
    if (!IndexedDBManager.isIndexedDBAvailable()) return;
    if (!this.rawSql) return;

    try {
      // Parse primary key fields from the comma-separated string
      const pkFields = this.rawPrimaryKey
        ? this.rawPrimaryKey
            .split(",")
            .map((f) => f.trim())
            .filter((f) => f.length > 0)
        : [];

      await IndexedDBManager.saveRawSqlPrefs({
        query: this.rawSql,
        selectedPkFields: pkFields,
        selectedFields: [], // Raw SQL mode doesn't have field selection
      });

      console.log(`Saved Raw SQL preferences for query hash`);
    } catch (error) {
      console.warn("Failed to save raw SQL preferences to IndexedDB:", error);
    }
  }
}

export { CompareConfigTool };
