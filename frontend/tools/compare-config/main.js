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
import { enhanceWithDetailedDiff, convertToViewFormat } from "./lib/diff-adapter.js";
import { isTauri } from "../../core/Runtime.js";
import { UsageTracker } from "../../core/UsageTracker.js";
import * as FileParser from "./lib/file-parser.js";
import * as FileMatcher from "./lib/file-matcher.js";
import { ExcelComparator } from "./lib/excel-comparator.js";
import * as IndexedDBManager from "./lib/indexed-db-manager.js";
import { UnifiedDataService, SourceType } from "./lib/unified-data-service.js";
import { reconcileColumns, compareDatasets, normalizeRowFields } from "./lib/diff-engine.js";
import { getOracleSidecarClient, SidecarStatus } from "./lib/oracle-sidecar-client.js";
import {
  isSourceBFollowMode,
  syncPkFieldsToCompareFields,
  syncPkFieldsWithTracking,
  validateOracleToOracleConfig,
  createSourceBConfigFromSourceA,
  getSourceBDisabledFieldsForFollowMode,
  isMixedMode,
  validateMixedModeConfig,
  getResetBehaviorForSourceType,
  createResetSourceState,
  getComparisonMode,
  getVisibleStepsForMode,
  UnifiedErrorType,
  getActionableErrorMessage,
  parseOracleError,
  validateSourceConfig,
} from "./lib/unified-compare-utils.js";

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
    this.sidecarStatus = SidecarStatus.STOPPED;
    this.savedConnections = [];

    this.statusFilter = "differ"; // Default to showing differences; can be null (all), "match", "differ", "only_in_env1", "only_in_env2"
    this.currentView = "grid"; // Default view: "grid" (Summary Grid), "vertical" (Cards), "master-detail" (Detail View)

    // Results storage (unified mode only)
    this.results = {
      unified: null,
    };

    // Unified Compare state (for mixed Oracle/Excel comparison)
    this.unified = {
      // Source A (Reference)
      sourceA: {
        type: null, // 'oracle' or 'excel'
        // Oracle config
        connection: null, // { name, connect_string }
        queryMode: "table", // 'table' or 'sql'
        schema: null,
        table: null,
        sql: "",
        whereClause: "",
        maxRows: 100,
        // Excel config (Phase 2: multi-file support)
        excelFiles: [], // Array of { id, file } - all uploaded files
        selectedExcelFile: null, // { id, file } - selected file for comparison
        file: null, // File object (legacy, for backward compat)
        parsedData: null, // { headers, rows, metadata }
        // Fetched data (normalized)
        data: null, // { headers: [], rows: [], metadata: {} }
        dataLoaded: false,
      },

      // Source B (Comparator)
      sourceB: {
        type: null,
        connection: null,
        queryMode: "table",
        schema: null,
        table: null,
        sql: "",
        whereClause: "",
        maxRows: 100,
        // Excel config (Phase 2: multi-file support)
        excelFiles: [], // Array of { id, file } - all uploaded files
        selectedExcelFile: null, // { id, file } - selected file for comparison
        file: null,
        parsedData: null,
        data: null,
        dataLoaded: false,
      },

      // Field reconciliation (computed when both sources have data)
      fields: {
        common: [], // Common field names (from source A)
        commonMapped: [], // [{normalized, sourceA, sourceB}]
        onlyInA: [], // Fields only in source A
        onlyInB: [], // Fields only in source B
      },

      // User selections
      selectedPkFields: [], // Normalized field names
      selectedCompareFields: [], // Normalized field names
      _pkAutoAddedFields: [], // Temporary: fields auto-added from PK sync (for animation)

      // Comparison options
      options: {
        rowMatching: "key", // 'key' or 'position'
        dataComparison: "strict", // 'strict' or 'normalized'
        normalizeFields: false, // Case-insensitive field name matching
      },

      // UI state
      currentStep: 1, // 1=source-config, 2=field-selection, 3=results

      // Config snapshot for detecting changes (to show/hide Load Data button)
      _lastLoadedConfig: null, // { sourceA: {...}, sourceB: {...} }
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

    if (this.oracleClientReady) {
      // Load saved connections from localStorage
      this.loadSavedConnections();
      // Load last tool state (includes view preferences, results from IndexedDB)
      await this.loadToolState();
      // Initialize unified mode UI (populates connection dropdowns, restores cached files)
      this.initUnifiedModeUI();
      // Start connection status polling
      this.startConnectionStatusPolling();
    } else {
      // Web mode: Still load tool state for view preferences and Excel compare results
      await this.loadToolState();
      // Initialize unified mode UI for web (pre-selects Excel mode)
      this.initUnifiedModeUI();
    }
  }

  /**
   * Checks if Oracle connectivity is available (via Python sidecar)
   * In Web mode, this check is skipped as Oracle features are not available
   */
  async checkOracleClient() {
    // In Web mode, skip Oracle client check - just show the main interface
    // Web users can only use Excel Compare which doesn't require Oracle
    if (!isTauri()) {
      this.oracleClientReady = false;
      this.showMainInterface();
      return;
    }

    // Tauri/Desktop mode - start the Python sidecar for Oracle connectivity
    try {
      console.log("[OracleCheck] Starting Oracle sidecar...");

      const sidecarClient = getOracleSidecarClient();

      // Subscribe to status changes to update UI
      sidecarClient.onStatusChange((status) => {
        this.sidecarStatus = status;
        this.updateSidecarStatusUI();
      });

      // Start the sidecar
      const started = await sidecarClient.start();

      if (started) {
        console.log("[OracleCheck] Oracle sidecar started successfully");
        this.oracleClientReady = true;
        this.showMainInterface();
      } else {
        // Sidecar not running in dev mode - still show main interface
        // but Oracle features may not work
        console.warn("[OracleCheck] Oracle sidecar not running - Oracle features may not work");
        console.warn("Start sidecar manually: cd tauri/sidecar && python oracle_sidecar.py");
        this.oracleClientReady = false;
        this.showMainInterface();
      }
    } catch (error) {
      console.error("Failed to start Oracle sidecar:", error);
      // Show main interface anyway - user can still use Excel compare
      this.oracleClientReady = false;
      this.showMainInterface();
    }
  }

  /**
   * Update the sidecar status indicator in the UI
   */
  updateSidecarStatusUI() {
    const statusIndicator = document.getElementById("sidecar-status-indicator");
    if (!statusIndicator) return;

    const statusText = statusIndicator.querySelector(".status-text");
    const statusDot = statusIndicator.querySelector(".status-dot");
    const restartBtn = statusIndicator.querySelector("#btn-sidecar-restart");

    if (statusText) {
      switch (this.sidecarStatus) {
        case SidecarStatus.STARTING:
          statusText.textContent = "Starting...";
          break;
        case SidecarStatus.READY:
          statusText.textContent = "Connected";
          break;
        case SidecarStatus.ERROR:
          statusText.textContent = "Error";
          break;
        default:
          statusText.textContent = "Disconnected";
      }
    }

    if (statusDot) {
      statusDot.classList.remove("starting", "ready", "error", "stopped");
      statusDot.classList.add(this.sidecarStatus);
    }

    // Show restart button when sidecar is in error or stopped state
    if (restartBtn) {
      const showRestart = this.sidecarStatus === SidecarStatus.ERROR || this.sidecarStatus === SidecarStatus.STOPPED;
      restartBtn.style.display = showRestart ? "flex" : "none";
    }
  }

  /**
   * Handle sidecar restart button click
   */
  async handleSidecarRestart() {
    const restartBtn = document.getElementById("btn-sidecar-restart");
    if (restartBtn) {
      restartBtn.disabled = true;
    }

    try {
      const sidecarClient = getOracleSidecarClient();
      const success = await sidecarClient.restart();

      if (success) {
        this.eventBus.emit("notification:show", {
          type: "success",
          message: "Oracle sidecar restarted successfully",
        });
      } else {
        this.eventBus.emit("notification:show", {
          type: "error",
          message: "Failed to restart Oracle sidecar. Try restarting the app.",
        });
      }
    } catch (error) {
      console.error("Sidecar restart error:", error);
      this.eventBus.emit("notification:show", {
        type: "error",
        message: "Failed to restart Oracle sidecar",
      });
    } finally {
      if (restartBtn) {
        restartBtn.disabled = false;
      }
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

    // Elements that only work in Tauri (e.g., connection status indicator)
    const tauriOnlyElements = document.querySelectorAll(".tauri-only");
    tauriOnlyElements.forEach((el) => {
      el.style.display = tauri ? "" : "none";
    });

    // Phase 6.4: Unified mode is now the only mode
    // Show unified mode UI by default
    const unifiedMode = document.getElementById("unified-compare-mode");
    if (unifiedMode) {
      unifiedMode.style.display = "";
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
        // Connection dropdowns are populated by initUnifiedModeUI()
      } else {
        this.savedConnections = [];
        // Note: showNoConnectionsMessage is no longer needed since unified mode
        // supports Excel sources without Oracle connections
      }
    } catch (error) {
      console.error("Failed to load saved connections:", error);
      this.savedConnections = [];
    }
  }

  /**
   * Saves current tool state
   * - Small settings (view, filter) go to localStorage for quick sync access
   * - Large results go to IndexedDB to avoid localStorage quota limits
   */
  saveToolState() {
    try {
      // Save small settings to localStorage (sync, fast)
      const settings = {
        currentView: this.currentView,
        statusFilter: this.statusFilter,
      };
      localStorage.setItem("compare-config.settings", JSON.stringify(settings));

      // Save large results to IndexedDB (async, no size limit)
      if (IndexedDBManager.isIndexedDBAvailable()) {
        IndexedDBManager.saveToolState({ results: this.results }).catch((error) => {
          console.error("Failed to save results to IndexedDB:", error);
        });
      }
    } catch (error) {
      console.error("Failed to save tool state:", error);
    }
  }

  /**
   * Loads last tool state
   * - Settings from localStorage (sync)
   * - Results from IndexedDB (async)
   */
  async loadToolState() {
    try {
      // Load settings from localStorage (sync)
      const savedSettings = localStorage.getItem("compare-config.settings");
      if (savedSettings) {
        const settings = JSON.parse(savedSettings);
        // Migrate old "expandable" view to "grid" (expandable removed from dropdown)
        const savedView = settings.currentView || "grid";
        this.currentView = savedView === "expandable" ? "grid" : savedView;
        // Default to "differ" filter if not set (null means "all")
        this.statusFilter = settings.statusFilter !== undefined ? settings.statusFilter : "differ";
      }

      // Migrate from old localStorage format if present
      const oldState = localStorage.getItem("compare-config.last-state");
      if (oldState) {
        const parsed = JSON.parse(oldState);
        // Migrate settings if not already loaded
        if (!savedSettings) {
          const savedView = parsed.currentView || "grid";
          this.currentView = savedView === "expandable" ? "grid" : savedView;
          this.statusFilter = parsed.statusFilter !== undefined ? parsed.statusFilter : "differ";
        }
        // Migrate results to IndexedDB
        if (parsed.results && IndexedDBManager.isIndexedDBAvailable()) {
          await IndexedDBManager.saveToolState({ results: parsed.results });
        }
        // Remove old format
        localStorage.removeItem("compare-config.last-state");
      }

      // Load results from IndexedDB (async)
      if (IndexedDBManager.isIndexedDBAvailable()) {
        const savedState = await IndexedDBManager.loadToolState();
        if (savedState?.results) {
          this.results = { unified: savedState.results.unified || null };
        }
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
    // Show results if they exist for unified mode and have valid data
    if (this.results.unified && this.results.unified.rows && this.results.unified.rows.length > 0) {
      this.queryMode = "unified"; // Ensure queryMode is set for showResults
      this.showResults();
      // Set view type selector
      const viewTypeSelect = document.getElementById("view-type");
      if (viewTypeSelect) viewTypeSelect.value = this.currentView;
    } else {
      // Clear invalid/stale results
      this.results.unified = null;
    }
  }

  /**
   * Binds event listeners
   */
  bindEvents() {
    // Phase 6.4: Tab switching removed - only unified mode now

    // Connection status close button
    const closeConnectionsBtn = document.querySelector(".btn-close-connections");
    if (closeConnectionsBtn) {
      closeConnectionsBtn.addEventListener("click", () => this.closeAllConnections());
    }

    // Sidecar restart button
    const sidecarRestartBtn = document.getElementById("btn-sidecar-restart");
    if (sidecarRestartBtn) {
      sidecarRestartBtn.addEventListener("click", () => this.handleSidecarRestart());
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
    const refFileInput = document.getElementById("ref-file-input");
    const compFileInput = document.getElementById("comp-file-input");
    const refFolderInput = document.getElementById("ref-folder-input");
    const compFolderInput = document.getElementById("comp-folder-input");

    // Clear All buttons
    const refClearAllBtn = document.getElementById("ref-clear-all");
    const compClearAllBtn = document.getElementById("comp-clear-all");

    if (refClearAllBtn) {
      refClearAllBtn.addEventListener("click", () => this.clearAllExcelFiles("ref"));
    }

    if (compClearAllBtn) {
      compClearAllBtn.addEventListener("click", () => this.clearAllExcelFiles("comp"));
    }

    // Browse files links
    const refBrowse = document.getElementById("ref-browse");
    const compBrowse = document.getElementById("comp-browse");

    if (refBrowse && refFileInput) {
      refBrowse.addEventListener("click", (e) => {
        e.preventDefault();
        refFileInput.click();
      });
    }

    if (compBrowse && compFileInput) {
      compBrowse.addEventListener("click", (e) => {
        e.preventDefault();
        compFileInput.click();
      });
    }

    // Select folder links
    const refFolderBrowse = document.getElementById("ref-folder-browse");
    const compFolderBrowse = document.getElementById("comp-folder-browse");

    if (refFolderBrowse) {
      refFolderBrowse.addEventListener("click", (e) => {
        e.preventDefault();
        this.handleFolderSelection("ref");
      });
    }

    if (compFolderBrowse) {
      compFolderBrowse.addEventListener("click", (e) => {
        e.preventDefault();
        this.handleFolderSelection("comp");
      });
    }

    // File input change handlers
    if (refFileInput) {
      refFileInput.addEventListener("change", (e) => this.handleExcelFileSelection("ref", e.target.files));
    }

    if (compFileInput) {
      compFileInput.addEventListener("change", (e) => this.handleExcelFileSelection("comp", e.target.files));
    }

    if (refFolderInput) {
      refFolderInput.addEventListener("change", (e) => this.handleExcelFileSelection("ref", e.target.files));
    }

    if (compFolderInput) {
      compFolderInput.addEventListener("change", (e) => this.handleExcelFileSelection("comp", e.target.files));
    }

    // Excel field selection events
    this.bindExcelFieldSelectionEvents();

    // Unified Compare mode events
    this.bindUnifiedModeEvents();

    // Excel comparison option radio listeners
    const rowMatchingRadios = document.querySelectorAll('input[name="excel-row-matching"]');
    const dataComparisonRadios = document.querySelectorAll('input[name="excel-data-comparison"]');

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
    const exportBtn = document.getElementById("btn-export");
    const exportDropdownMenu = document.getElementById("export-dropdown-menu");
    const exportJsonBtn = document.getElementById("btn-export-json");
    const exportExcelBtn = document.getElementById("btn-export-excel");
    const exportCsvBtn = document.getElementById("btn-export-csv");
    const newComparisonBtn = document.getElementById("btn-new-comparison");
    // Export dropdown toggle
    if (exportBtn && exportDropdownMenu) {
      exportBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        // Close view dropdown if open
        document.getElementById("view-dropdown-menu")?.classList.remove("show");
        exportDropdownMenu.classList.toggle("show");
      });

      // Close dropdown when clicking outside
      document.addEventListener("click", (e) => {
        if (!e.target.closest(".export-dropdown")) {
          exportDropdownMenu.classList.remove("show");
        }
      });
    }

    if (exportJsonBtn) {
      exportJsonBtn.addEventListener("click", () => {
        exportDropdownMenu?.classList.remove("show");
        this.exportResults("json");
      });
    }

    if (exportExcelBtn) {
      exportExcelBtn.addEventListener("click", () => {
        exportDropdownMenu?.classList.remove("show");
        this.exportResults("excel");
      });
    }

    if (exportCsvBtn) {
      exportCsvBtn.addEventListener("click", () => {
        exportDropdownMenu?.classList.remove("show");
        this.exportResults("csv");
      });
    }

    if (newComparisonBtn) {
      newComparisonBtn.addEventListener("click", () => this.resetForm());
    }

    // View dropdown toggle
    const viewBtn = document.getElementById("btn-view");
    const viewDropdownMenu = document.getElementById("view-dropdown-menu");
    const viewOptions = document.querySelectorAll(".view-option");

    if (viewBtn && viewDropdownMenu) {
      viewBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        // Close export dropdown if open
        exportDropdownMenu?.classList.remove("show");
        viewDropdownMenu.classList.toggle("show");
      });

      // Close dropdown when clicking outside
      document.addEventListener("click", (e) => {
        if (!e.target.closest(".view-dropdown")) {
          viewDropdownMenu.classList.remove("show");
        }
      });
    }

    viewOptions.forEach((option) => {
      option.addEventListener("click", () => {
        const value = option.dataset.value;
        const label = option.textContent.trim();

        // Update button label
        const labelEl = document.getElementById("view-type-label");
        if (labelEl) labelEl.textContent = label;

        // Update active state
        viewOptions.forEach((o) => o.classList.remove("active"));
        option.classList.add("active");

        // Close dropdown
        viewDropdownMenu?.classList.remove("show");

        // Change view
        this.changeView(value);
      });
    });
  }

  // Phase 6.4: switchTab() and onRawConnectionSelected() removed - unified mode only

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

      // Fetch schemas from Env 1 (via sidecar)
      const schemas = await CompareConfigService.fetchSchemasViaSidecar(this.env1.connection.name, this.env1.connection);

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
      const schemas = await CompareConfigService.fetchSchemasViaSidecar(this.env2.connection.name, this.env2.connection);

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

      // Fetch tables from Env 1 (via sidecar)
      const tables = await CompareConfigService.fetchTablesViaSidecar(this.env1.connection.name, this.env1.connection, this.schema);

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
      const tables = await CompareConfigService.fetchTablesViaSidecar(this.env2.connection.name, this.env2.connection, this.schema);

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

      // Show or hide column mismatch warning based on header differences
      const warningEl = document.getElementById("excel-column-warning");
      if (refOnlyHeaders.length > 0 || compOnlyHeaders.length > 0) {
        this.showColumnMismatchWarning(refOnlyHeaders, compOnlyHeaders);
      } else if (warningEl) {
        warningEl.style.display = "none";
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
          <span class="field-name" title="${header}">${header}</span>
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
          <span class="field-name" title="${header}">${header}</span>
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

      // Track feature usage: one comparison = one usage
      UsageTracker.trackFeature("compare-config", "excel", {
        rows_compared: viewResult.rows?.length || 0,
        pk_fields: selectedPkFields.length,
        compare_fields: selectedFields.length,
      });
    } catch (error) {
      console.error("[ExcelCompare] Comparison failed:", error);
      this.hideProgress();
      this.eventBus.emit("notification:show", {
        type: "error",
        message: `Comparison failed: ${error.message || error}`,
      });

      // Track error for debugging insights (rich error with code, stack)
      UsageTracker.trackEvent(
        "compare-config",
        "comparison_error",
        UsageTracker.enrichErrorMeta(error, { mode: "excel" }),
      );
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

      // Track feature usage: one comparison = one usage
      UsageTracker.trackFeature("compare-config", "excel_batch", {
        rows_compared: results?.rows?.length || 0,
        pairs_count: preparedPairs.length,
      });
    } catch (error) {
      console.error("[ExcelCompare] Comparison failed:", error);
      this.hideProgress();
      this.eventBus.emit("notification:show", {
        type: "error",
        message: `Excel comparison failed: ${error.message || error}`,
      });

      // Track error for debugging insights (rich error with code, stack)
      UsageTracker.trackEvent(
        "compare-config",
        "comparison_error",
        UsageTracker.enrichErrorMeta(error, { mode: "excel_batch" }),
      );
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
      // Determine primary key columns to use
      const pkColumns =
        this.customPrimaryKey && this.customPrimaryKey.length > 0 ? this.customPrimaryKey : this.metadata?.primary_key || [];

      console.log("[Compare] Using JS diff engine (Phase 6 refactor)");
      console.log("[Compare] Schema.Table:", `${this.schema}.${this.table}`);
      console.log("[Compare] PK columns:", pkColumns);
      console.log("[Compare] Selected fields:", this.selectedFields);

      // Step 1: Fetch data from Environment 1
      console.log("[Compare] Fetching data from env1:", this.env1.connection.name);
      const dataEnv1 = await CompareConfigService.fetchOracleDataViaSidecar({
        connection_name: this.env1.connection.name,
        config: this.env1.connection,
        mode: "table",
        owner: this.schema,
        table_name: this.table,
        where_clause: this.whereClause || null,
        fields: this.selectedFields || [],
        max_rows: this.maxRows || 100,
      });
      console.log("[Compare] Env1 data received:", dataEnv1.row_count, "rows");

      // Update progress - env1 fetch done, start env2
      this.updateProgressStep("fetch", "active", `Fetching from ${this.env2.connection.name}...`);

      // Step 2: Fetch data from Environment 2
      console.log("[Compare] Fetching data from env2:", this.env2.connection.name);
      const dataEnv2 = await CompareConfigService.fetchOracleDataViaSidecar({
        connection_name: this.env2.connection.name,
        config: this.env2.connection,
        mode: "table",
        owner: this.schema,
        table_name: this.table,
        where_clause: this.whereClause || null,
        fields: this.selectedFields || [],
        max_rows: this.maxRows || 100,
      });
      console.log("[Compare] Env2 data received:", dataEnv2.row_count, "rows");

      // Update to compare step
      this.updateProgressStep("fetch", "done", `${this.schema}.${this.table}`);
      this.updateProgressStep("compare", "active", "Comparing records...");

      // Step 3: Compare using JS diff engine
      const jsResult = compareDatasets(dataEnv1.rows, dataEnv2.rows, {
        keyColumns: pkColumns,
        fields: this.selectedFields || dataEnv1.headers,
        normalize: false,
        matchMode: "key",
      });

      console.log("[Compare] JS diff result:", jsResult.summary);

      // Step 4: Convert to view format (matches Rust backend format for views)
      let result = convertToViewFormat(jsResult, {
        env1Name: this.env1.connection.name,
        env2Name: this.env2.connection.name,
        tableName: `${this.schema}.${this.table}`,
        keyColumns: pkColumns,
      });

      console.log("[Compare] Result converted to view format");
      console.log("[Compare] Result rows:", result?.rows?.length || 0);

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

      // Track feature usage: one comparison = one usage
      UsageTracker.trackFeature("compare-config", "table", {
        rows_compared: result?.rows?.length || 0,
        pk_fields: pkColumns.length,
        compare_fields: this.selectedFields?.length || 0,
      });
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

        // Track connection error (rich error with code, stack)
        UsageTracker.trackEvent(
          "compare-config",
          "comparison_error",
          UsageTracker.enrichErrorMeta(error, { mode: "table", error_type: "connection" }),
        );
      } else {
        this.eventBus.emit("notification:show", {
          type: "error",
          message: `Comparison failed: ${error.message || error}`,
        });

        // Track general error (rich error with code, stack)
        UsageTracker.trackEvent(
          "compare-config",
          "comparison_error",
          UsageTracker.enrichErrorMeta(error, { mode: "table", error_type: "general" }),
        );
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

      console.log("[Compare] Using JS diff engine for Raw SQL (Phase 6 refactor)");
      console.log("[Compare] SQL query:", cleanSql.substring(0, 100) + (cleanSql.length > 100 ? "..." : ""));
      console.log("[Compare] PK fields:", primaryKeyFields);

      // Step 1: Fetch data from Environment 1
      console.log("[Compare] Fetching raw SQL data from env1:", this.rawenv1.connection.name);
      const dataEnv1 = await CompareConfigService.fetchOracleDataViaSidecar({
        connection_name: this.rawenv1.connection.name,
        config: this.rawenv1.connection,
        mode: "raw-sql",
        sql: cleanSql,
        max_rows: this.rawMaxRows,
      });
      console.log("[Compare] Env1 data received:", dataEnv1.row_count, "rows, headers:", dataEnv1.headers);

      // Step 2: Fetch data from Environment 2
      console.log("[Compare] Fetching raw SQL data from env2:", this.rawenv2.connection.name);
      const dataEnv2 = await CompareConfigService.fetchOracleDataViaSidecar({
        connection_name: this.rawenv2.connection.name,
        config: this.rawenv2.connection,
        mode: "raw-sql",
        sql: cleanSql,
        max_rows: this.rawMaxRows,
      });
      console.log("[Compare] Env2 data received:", dataEnv2.row_count, "rows, headers:", dataEnv2.headers);

      // Determine primary key columns (use provided or default to first column)
      const pkColumns = primaryKeyFields.length > 0 ? primaryKeyFields : dataEnv1.headers.length > 0 ? [dataEnv1.headers[0]] : [];
      console.log("[Compare] Using PK columns:", pkColumns);

      // Step 3: Compare using JS diff engine
      const jsResult = compareDatasets(dataEnv1.rows, dataEnv2.rows, {
        keyColumns: pkColumns,
        fields: dataEnv1.headers,
        normalize: false,
        matchMode: "key",
      });

      console.log("[Compare] JS diff result:", jsResult.summary);

      // Step 4: Convert to view format
      let result = convertToViewFormat(jsResult, {
        env1Name: this.rawenv1.connection.name,
        env2Name: this.rawenv2.connection.name,
        tableName: "Raw SQL Query",
        keyColumns: pkColumns,
      });

      console.log("[Compare] Result converted to view format");
      console.log("[Compare] Result rows:", result?.rows?.length || 0);

      this.results[this.queryMode] = result;

      // Hide loading
      this.hideLoading();

      // Show results
      this.showResults();

      // Save preferences to IndexedDB after successful comparison
      this.saveRawSqlPrefsToIndexedDB();

      // Emit event
      this.eventBus.emit("comparison:complete", result);

      // Track feature usage: one comparison = one usage
      UsageTracker.trackFeature("compare-config", "raw_sql", {
        rows_compared: result?.rows?.length || 0,
        pk_fields: pkColumns.length,
      });
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

        // Track connection error (rich error with code, stack)
        UsageTracker.trackEvent(
          "compare-config",
          "comparison_error",
          UsageTracker.enrichErrorMeta(error, { mode: "raw_sql", error_type: "connection" }),
        );
      } else {
        this.eventBus.emit("notification:show", {
          type: "error",
          message: `Comparison failed: ${error.message || error}`,
        });

        // Track general error (rich error with code, stack)
        UsageTracker.trackEvent(
          "compare-config",
          "comparison_error",
          UsageTracker.enrichErrorMeta(error, { mode: "raw_sql", error_type: "general" }),
        );
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

      await CompareConfigService.fetchSchemasViaSidecar(env.connection.name, env.connection);

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
      await CompareConfigService.fetchSchemasViaSidecar(env.connection.name, env.connection);

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
   * Shows the unified progress overlay with dynamic steps based on comparison mode
   * @param {string} title - Title for the overlay
   * @param {'oracle-oracle'|'oracle-excel'|'excel-oracle'|'excel-excel'|null} mode - Comparison mode
   */
  showUnifiedProgress(title = "Loading Data", mode = null) {
    const overlay = document.getElementById("unified-progress-overlay");
    const titleEl = document.getElementById("unified-progress-title");

    if (titleEl) titleEl.textContent = title;
    if (overlay) overlay.style.display = "flex";

    // Configure visible steps based on mode
    const visibleSteps = getVisibleStepsForMode(mode);

    // Show/hide validate-b step based on mode
    const validateBStep = document.getElementById("unified-step-validate-b");
    if (validateBStep) {
      validateBStep.style.display = visibleSteps.includes("validate-b") ? "flex" : "none";
    }

    // Reset all unified steps to pending
    this.resetUnifiedProgressSteps();
  }

  /**
   * Hides the unified progress overlay
   */
  hideUnifiedProgress() {
    const overlay = document.getElementById("unified-progress-overlay");
    if (overlay) overlay.style.display = "none";
  }

  /**
   * Updates a unified progress step's state and detail
   * @param {string} stepId - One of: source-a, validate-b, source-b, reconcile
   * @param {string} state - One of: pending, active, done, error
   * @param {string} detail - Detail text to show
   */
  updateUnifiedProgressStep(stepId, state, detail = "") {
    const stepEl = document.getElementById(`unified-step-${stepId}`);
    if (!stepEl) return;

    const iconEl = stepEl.querySelector(".step-icon");
    const detailEl = document.getElementById(`unified-step-${stepId}-detail`);

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
   * Resets all unified progress steps to pending state
   */
  resetUnifiedProgressSteps() {
    ["source-a", "validate-b", "source-b", "reconcile"].forEach((stepId) => {
      this.updateUnifiedProgressStep(stepId, "pending", "—");
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
      if (this.queryMode === "unified" && this.results.unified) {
        const result = this.results.unified;
        titleEl.textContent = `Comparison Results: ${result.env1_name || "Source A"} vs ${result.env2_name || "Source B"}`;
      } else if (this.queryMode === "schema-table" && this.schema && this.table) {
        titleEl.textContent = `Comparison Results for ${this.schema}.${this.table}`;
      } else if (this.queryMode === "raw-sql") {
        titleEl.textContent = "Comparison Results (Raw SQL)";
      } else if (this.queryMode === "excel-compare") {
        titleEl.textContent = "Comparison Results (Excel/CSV)";
      } else {
        titleEl.textContent = "Comparison Results";
      }
    }

    // Update comparison context (Excel Compare only)
    const contextEl = document.getElementById("comparison-context");
    const contextRefEl = document.getElementById("context-ref-file");
    const contextCompEl = document.getElementById("context-comp-file");

    if (this.queryMode === "excel-compare" && this.results["excel-compare"]) {
      const result = this.results["excel-compare"];
      if (contextEl && contextRefEl && contextCompEl && result.env1Name && result.env2Name) {
        contextRefEl.textContent = result.env1Name;
        contextRefEl.title = result.env1Name;
        contextCompEl.textContent = result.env2Name;
        contextCompEl.title = result.env2Name;
        contextEl.style.display = "flex";
      }
    } else if (contextEl) {
      contextEl.style.display = "none";
    }

    // Render summary
    this.renderSummary();

    // Render multi-file results selector if in Excel mode
    this.renderResultSelector();

    // Render results content based on current view
    this.renderResults();

    // Enable/disable export buttons based on results
    const exportJsonBtn = document.getElementById("btn-export-json");
    const exportExcelBtn = document.getElementById("btn-export-excel");
    const exportCsvBtn = document.getElementById("btn-export-csv");
    const hasResults = this.results[this.queryMode]?.rows?.length > 0;
    if (exportJsonBtn) exportJsonBtn.disabled = !hasResults;
    if (exportExcelBtn) exportExcelBtn.disabled = !hasResults;
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

    const { env1_name, env2_name, _metadata } = this.results[this.queryMode];
    const comparisons = this.getFilteredComparisons();

    // Get the selected compare fields from metadata (for unified mode) or use null for auto-detection
    const compareFields = _metadata?.compareFields || null;

    let html = "";
    switch (this.currentView) {
      case "expandable":
        // Use inline expandable view rendering
        this.renderExpandableView();
        return; // Exit early since renderExpandableView handles everything

      case "vertical":
        html = this.verticalCardView.render(comparisons, env1_name, env2_name, { compareFields });
        resultsContent.innerHTML = html;
        break;

      case "master-detail":
        html = this.masterDetailView.render(comparisons, env1_name, env2_name, { compareFields });
        resultsContent.innerHTML = html;
        // Attach event listeners for master-detail view
        this.masterDetailView.attachEventListeners(resultsContent);
        break;

      case "grid":
        html = this.gridView.render(comparisons, env1_name, env2_name, { compareFields, showStatus: this.statusFilter === null });
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
    if (this.queryMode === "unified") {
      // Unified mode: PK is selected in UI or using position matching
      // Also check cached result metadata when loading from cache (source panels may be empty)
      const cachedMetadata = this.results.unified?._metadata;
      if (cachedMetadata) {
        hasPrimaryKey = cachedMetadata.rowMatching === "position" || (cachedMetadata.keyColumns && cachedMetadata.keyColumns.length > 0);
      } else {
        hasPrimaryKey = this.unified.options.rowMatching === "position" || this.unified.selectedPkFields.length > 0;
      }
    } else if (this.queryMode === "schema-table") {
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

    if (this.queryMode === "unified" && this.results.unified) {
      env1Name = this.results.unified.env1Name || "Source A";
      env2Name = this.results.unified.env2Name || "Source B";
    } else if (this.queryMode === "schema-table") {
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
      this.showError("No comparison results to export");
      return;
    }

    try {
      // Handle Excel export separately (client-side with xlsx library)
      if (format === "excel") {
        await this.exportResultsAsExcel();
        return;
      }

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

      this.showSuccess(`Results exported as ${exportData.filename}`);

      this.eventBus.emit("comparison:exported", { filename: exportData.filename, format });
    } catch (error) {
      console.error("Export failed:", error);

      this.showError(`Export failed: ${error.message || error}`);
    }
  }

  /**
   * Exports comparison results as Excel file
   */
  async exportResultsAsExcel() {
    const result = this.results[this.queryMode];
    if (!result || !result.rows?.length) {
      this.showError("No comparison results to export");
      return;
    }

    try {
      // Dynamic import of xlsx library
      const XLSX = await import("xlsx");

      // Prepare data for Excel
      const headers = result.columns || Object.keys(result.rows[0] || {});
      const wsData = [headers];

      result.rows.forEach((row) => {
        const rowData = headers.map((col) => {
          const value = row[col];
          // Handle objects/arrays by stringifying them
          if (typeof value === "object" && value !== null) {
            return JSON.stringify(value);
          }
          return value ?? "";
        });
        wsData.push(rowData);
      });

      // Create workbook and worksheet
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(wsData);

      // Auto-size columns
      const colWidths = headers.map((h, i) => {
        const maxLen = Math.max(h.length, ...wsData.slice(1).map((row) => String(row[i] || "").length));
        return { wch: Math.min(maxLen + 2, 50) };
      });
      ws["!cols"] = colWidths;

      XLSX.utils.book_append_sheet(wb, ws, "Comparison Results");

      // Generate filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const filename = `comparison_results_${timestamp}.xlsx`;

      // Download
      XLSX.writeFile(wb, filename);

      this.showSuccess(`Results exported as ${filename}`);

      this.eventBus.emit("comparison:exported", { filename, format: "excel" });
    } catch (error) {
      console.error("Excel export failed:", error);
      this.showError(`Excel export failed: ${error.message || error}`);
    }
  }

  /**
   * Resets the form for a new comparison (complete clean slate)
   */
  resetForm() {
    // Phase 4: Handle Unified mode separately
    if (this.queryMode === "unified") {
      this.handleUnifiedNewComparison();
      return;
    }

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

    // Show loading indicator
    const loadingIndicator = document.getElementById("excel-loading-cache");
    if (loadingIndicator) loadingIndicator.style.display = "flex";

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

        // Show file pairing UI if files exist (so user can select files to compare)
        this.checkAndShowPairingUI();
      }

      // Don't restore selection state - user needs to select files fresh
      // Clear any previous session state from IndexedDB
      await IndexedDBManager.clearExcelCompareState();

      // Clear any stale Excel Compare results (user must run comparison fresh)
      this.results["excel-compare"] = null;

      return true;
    } catch (error) {
      console.warn("Failed to load Excel Compare files from IndexedDB:", error);
      return false;
    } finally {
      // Hide loading indicator
      const loadingIndicator = document.getElementById("excel-loading-cache");
      if (loadingIndicator) loadingIndicator.style.display = "none";
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

  // =============================================================================
  // Unified Mode Table Preferences (IndexedDB)
  // =============================================================================

  /**
   * Loads saved preferences for the current unified table from IndexedDB
   * Called after field reconciliation to apply saved PK and field selections
   */
  async loadUnifiedTablePrefsFromIndexedDB() {
    if (!IndexedDBManager.isIndexedDBAvailable()) return;

    const sourceA = this.unified.sourceA;
    if (sourceA.type !== "oracle" || sourceA.queryMode !== "table") return;
    if (!sourceA.schema || !sourceA.table) return;

    try {
      const prefs = await IndexedDBManager.getSchemaTablePrefs(null, sourceA.schema, sourceA.table);

      if (prefs) {
        const commonFields = this.unified.fields.common;

        const validPkFields = (prefs.selectedPkFields || []).filter((f) => commonFields.includes(f));
        if (validPkFields.length > 0) {
          this.unified.selectedPkFields = validPkFields;
        }

        const validFields = (prefs.selectedFields || []).filter((f) => commonFields.includes(f));
        if (validFields.length > 0) {
          this.unified.selectedCompareFields = validFields;
        }

        if (prefs.rowMatching) {
          this.unified.options.rowMatching = prefs.rowMatching;
          const rowMatchingRadio = document.querySelector(`input[name="unified-row-matching"][value="${prefs.rowMatching}"]`);
          if (rowMatchingRadio) rowMatchingRadio.checked = true;
        }

        if (prefs.dataComparison) {
          this.unified.options.dataComparison = prefs.dataComparison;
          const dataCompRadio = document.querySelector(`input[name="unified-data-comparison"][value="${prefs.dataComparison}"]`);
          if (dataCompRadio) dataCompRadio.checked = true;
        }

        console.log(`Loaded unified prefs for ${sourceA.schema}.${sourceA.table}:`, {
          pkFields: this.unified.selectedPkFields.length,
          compareFields: this.unified.selectedCompareFields.length,
        });
      }
    } catch (error) {
      console.warn("Failed to load unified table preferences:", error);
    }
  }

  /**
   * Saves current unified preferences for the schema.table to IndexedDB
   * Called after a successful comparison
   */
  async saveUnifiedTablePrefsToIndexedDB() {
    if (!IndexedDBManager.isIndexedDBAvailable()) return;

    const sourceA = this.unified.sourceA;
    if (sourceA.type !== "oracle" || sourceA.queryMode !== "table") return;
    if (!sourceA.schema || !sourceA.table) return;

    try {
      await IndexedDBManager.saveSchemaTablePrefs({
        connectionId: sourceA.connection?.name || "",
        schema: sourceA.schema,
        table: sourceA.table,
        selectedPkFields: this.unified.selectedPkFields || [],
        selectedFields: this.unified.selectedCompareFields || [],
        rowMatching: this.unified.options.rowMatching,
        dataComparison: this.unified.options.dataComparison,
      });

      console.log(`Saved unified prefs for ${sourceA.schema}.${sourceA.table}`);
    } catch (error) {
      console.warn("Failed to save unified table preferences:", error);
    }
  }

  // =============================================================================
  // Unified Mode Config Change Detection
  // =============================================================================

  /**
   * Creates a snapshot of the current unified config for change detection
   * @returns {Object} Config snapshot
   */
  _getUnifiedConfigSnapshot() {
    const sourceA = this.unified.sourceA;
    const sourceB = this.unified.sourceB;

    return {
      sourceA: {
        type: sourceA.type,
        connection: sourceA.connection?.name || null,
        queryMode: sourceA.queryMode,
        schema: sourceA.schema,
        table: sourceA.table,
        sql: sourceA.sql,
        whereClause: sourceA.whereClause,
        maxRows: sourceA.maxRows,
        selectedExcelFileId: sourceA.selectedExcelFile?.id || null,
      },
      sourceB: {
        type: sourceB.type,
        connection: sourceB.connection?.name || null,
        queryMode: sourceB.queryMode,
        schema: sourceB.schema,
        table: sourceB.table,
        sql: sourceB.sql,
        whereClause: sourceB.whereClause,
        maxRows: sourceB.maxRows,
        selectedExcelFileId: sourceB.selectedExcelFile?.id || null,
      },
    };
  }

  /**
   * Saves the current config as the last loaded config snapshot
   */
  _saveUnifiedConfigSnapshot() {
    this.unified._lastLoadedConfig = this._getUnifiedConfigSnapshot();
  }

  /**
   * Checks if the current config differs from the last loaded config
   * @returns {boolean} True if config has changed
   */
  _hasUnifiedConfigChanged() {
    const lastConfig = this.unified._lastLoadedConfig;
    if (!lastConfig) return true;

    const currentConfig = this._getUnifiedConfigSnapshot();

    const compareSource = (current, last) => {
      if (!current || !last) return current !== last;
      return (
        current.type !== last.type ||
        current.connection !== last.connection ||
        current.queryMode !== last.queryMode ||
        current.schema !== last.schema ||
        current.table !== last.table ||
        current.sql !== last.sql ||
        current.whereClause !== last.whereClause ||
        current.maxRows !== last.maxRows ||
        current.selectedExcelFileId !== last.selectedExcelFileId
      );
    };

    return compareSource(currentConfig.sourceA, lastConfig.sourceA) || compareSource(currentConfig.sourceB, lastConfig.sourceB);
  }

  /**
   * Updates the config changed banner visibility based on config changes
   * Shows a banner with reload button when user changes schema/table/WHERE/maxRows after loading data
   */
  updateUnifiedLoadDataButtonVisibility() {
    const configChangedBanner = document.getElementById("unified-config-changed-banner");
    const fieldReconciliation = document.getElementById("unified-field-reconciliation");

    if (!configChangedBanner) return;

    const configChanged = this._hasUnifiedConfigChanged();
    const canLoad = this.canLoadUnifiedData();
    const isFieldReconciliationVisible = fieldReconciliation?.style.display !== "none";

    if (configChanged && canLoad && isFieldReconciliationVisible) {
      configChangedBanner.style.display = "flex";
    } else {
      configChangedBanner.style.display = "none";
    }
  }

  // =============================================================================
  // Unified Compare Mode Methods
  // =============================================================================

  /**
   * Bind event listeners for the Unified Compare mode
   */
  bindUnifiedModeEvents() {
    // Source A type selection
    const sourceATypeRadios = document.querySelectorAll('input[name="source-a-type"]');
    sourceATypeRadios.forEach((radio) => {
      radio.addEventListener("change", (e) => {
        this.onUnifiedSourceTypeChange("A", e.target.value);
      });
    });

    // Source B type selection
    const sourceBTypeRadios = document.querySelectorAll('input[name="source-b-type"]');
    sourceBTypeRadios.forEach((radio) => {
      radio.addEventListener("change", (e) => {
        this.onUnifiedSourceTypeChange("B", e.target.value);
      });
    });

    // Source A Oracle config
    this.bindUnifiedOracleConfigEvents("A");
    this.bindUnifiedOracleConfigEvents("B");

    // Source A/B Excel file upload
    this.bindUnifiedExcelConfigEvents("A");
    this.bindUnifiedExcelConfigEvents("B");

    // Load Data button
    const loadDataBtn = document.getElementById("btn-unified-load-data");
    if (loadDataBtn) {
      loadDataBtn.addEventListener("click", () => this.loadUnifiedData());
    }

    // Reload Data button (in config changed banner)
    const reloadDataBtn = document.getElementById("btn-unified-reload-data");
    if (reloadDataBtn) {
      reloadDataBtn.addEventListener("click", () => this.loadUnifiedData());
    }

    // Field selection events
    this.bindUnifiedFieldSelectionEvents();

    // Comparison options
    const unifiedRowMatchingRadios = document.querySelectorAll('input[name="unified-row-matching"]');
    unifiedRowMatchingRadios.forEach((radio) => {
      radio.addEventListener("change", (e) => {
        this.unified.options.rowMatching = e.target.value;
      });
    });

    const unifiedDataComparisonRadios = document.querySelectorAll('input[name="unified-data-comparison"]');
    unifiedDataComparisonRadios.forEach((radio) => {
      radio.addEventListener("change", (e) => {
        this.unified.options.dataComparison = e.target.value;
      });
    });

    // Normalize fields checkbox
    const normalizeFieldsCheckbox = document.getElementById("unified-normalize-fields");
    if (normalizeFieldsCheckbox) {
      normalizeFieldsCheckbox.addEventListener("change", (e) => {
        this.unified.options.normalizeFields = e.target.checked;
        console.log("[DEBUG] normalizeFields option changed:", e.target.checked);
      });
    }

    // Compare button
    const compareBtn = document.getElementById("btn-unified-compare");
    if (compareBtn) {
      compareBtn.addEventListener("click", () => this.executeUnifiedComparison());
    }
  }

  /**
   * Bind Oracle config events for a source (A or B)
   */
  bindUnifiedOracleConfigEvents(source) {
    const prefix = `source-${source.toLowerCase()}`;

    // Connection dropdown is set up by populateUnifiedConnectionDropdowns()

    // Query mode dropdown (button-based)
    this.setupUnifiedQueryModeDropdown(source);

    // Schema and Table searchable dropdowns are set up dynamically when schemas/tables are loaded

    // WHERE clause
    const whereInput = document.getElementById(`${prefix}-where`);
    if (whereInput) {
      whereInput.addEventListener("input", (e) => {
        const sourceKey = source === "A" ? "sourceA" : "sourceB";
        this.unified[sourceKey].whereClause = e.target.value.trim();
        this.updateUnifiedLoadDataButtonVisibility();
      });
    }

    // SQL textarea
    const sqlInput = document.getElementById(`${prefix}-sql`);
    if (sqlInput) {
      sqlInput.addEventListener("input", (e) => {
        const sourceKey = source === "A" ? "sourceA" : "sourceB";
        this.unified[sourceKey].sql = e.target.value;
        this.updateUnifiedLoadDataButtonVisibility();
      });
    }

    // Max rows
    const maxRowsInput = document.getElementById(`${prefix}-max-rows`);
    if (maxRowsInput) {
      maxRowsInput.addEventListener("input", (e) => {
        const sourceKey = source === "A" ? "sourceA" : "sourceB";
        const value = parseInt(e.target.value, 10);
        this.unified[sourceKey].maxRows = isNaN(value) || value < 1 ? 100 : Math.min(value, 10000);
        this.updateUnifiedLoadDataButtonVisibility();
      });
    }
  }

  /**
   * Bind Excel config events for a source (A or B)
   */
  /**
   * Bind Excel config events for unified mode (Phase 2: multi-file support)
   */
  bindUnifiedExcelConfigEvents(source) {
    const prefix = `source-${source.toLowerCase()}`;
    const sourceKey = source === "A" ? "sourceA" : "sourceB";

    // Browse files link
    const browseFilesLink = document.getElementById(`${prefix}-browse-files`);
    const fileInput = document.getElementById(`${prefix}-file-input`);

    if (browseFilesLink) {
      browseFilesLink.addEventListener("click", async (e) => {
        e.preventDefault();
        if (isTauri()) {
          await this._handleUnifiedFileBrowseTauri(source, false);
        } else if (fileInput) {
          fileInput.click();
        }
      });
    }

    // Browse folder link
    const browseFolderLink = document.getElementById(`${prefix}-browse-folder`);
    const folderInput = document.getElementById(`${prefix}-folder-input`);

    if (browseFolderLink) {
      browseFolderLink.addEventListener("click", async (e) => {
        e.preventDefault();
        if (isTauri()) {
          await this._handleUnifiedFileBrowseTauri(source, true);
        } else if (folderInput) {
          folderInput.click();
        }
      });
    }

    // File input change (multi-file)
    if (fileInput) {
      fileInput.addEventListener("change", (e) => {
        if (e.target.files.length > 0) {
          this.handleUnifiedExcelFileSelection(sourceKey, e.target.files);
          e.target.value = ""; // Reset for re-selection
        }
      });
    }

    // Folder input change
    if (folderInput) {
      folderInput.addEventListener("change", (e) => {
        if (e.target.files.length > 0) {
          this.handleUnifiedExcelFileSelection(sourceKey, e.target.files);
          e.target.value = "";
        }
      });
    }

    // Clear All button
    const clearAllBtn = document.getElementById(`${prefix}-clear-all`);
    if (clearAllBtn) {
      clearAllBtn.addEventListener("click", () => {
        this.clearUnifiedExcelFiles(sourceKey);
      });
    }

    // Upload zone drag & drop
    const uploadZone = document.getElementById(`${prefix}-upload-zone`);
    if (uploadZone) {
      uploadZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        uploadZone.classList.add("drag-over");
      });

      uploadZone.addEventListener("dragleave", () => {
        uploadZone.classList.remove("drag-over");
      });

      uploadZone.addEventListener("drop", (e) => {
        e.preventDefault();
        uploadZone.classList.remove("drag-over");
        const files = e.dataTransfer.files;
        if (files.length > 0) {
          this.handleUnifiedExcelFileSelection(sourceKey, files);
        }
      });
    }
  }

  /**
   * Handle file/folder browsing in Tauri for unified mode (Phase 2)
   */
  async _handleUnifiedFileBrowseTauri(source, isFolder = false) {
    const sourceKey = source === "A" ? "sourceA" : "sourceB";

    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { readFile, readDir } = await import("@tauri-apps/plugin-fs");

      if (isFolder) {
        // Folder selection
        const selected = await open({
          directory: true,
          multiple: false,
          title: `Select Folder for ${source === "A" ? "Source A" : "Source B"}`,
        });

        if (!selected) return;

        // Show loading indicator during folder scan
        this.showUnifiedUploadLoading(sourceKey, "Scanning folder...");

        // Recursively scan folder for supported files
        const files = [];
        await this._scanFolderForExcelFiles(selected, readDir, readFile, files);

        // Hide loading indicator (handleUnifiedExcelFileSelection will show its own if needed)
        this.hideUnifiedUploadLoading(sourceKey);

        if (files.length > 0) {
          await this.handleUnifiedExcelFileSelection(sourceKey, files);
        } else {
          this.eventBus.emit("notification:show", {
            type: "warning",
            message: "No supported files (.xlsx, .xls, .csv) found in the selected folder.",
          });
        }
      } else {
        // File selection (multiple)
        const selected = await open({
          multiple: true,
          title: `Select Files for ${source === "A" ? "Source A" : "Source B"}`,
          filters: [{ name: "Spreadsheet", extensions: ["xlsx", "xls", "csv"] }],
        });

        if (!selected || selected.length === 0) return;

        const selectedPaths = Array.isArray(selected) ? selected : [selected];
        const files = [];

        for (const filePath of selectedPaths) {
          const path = typeof filePath === "string" ? filePath : filePath.path;
          const fileName = path.split("/").pop() || path.split("\\").pop();
          const ext = FileParser.getFileExtension(fileName);

          if (!FileParser.SUPPORTED_EXTENSIONS.includes(ext)) continue;

          const mimeTypes = {
            xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            xls: "application/vnd.ms-excel",
            csv: "text/csv",
          };

          const fileData = await readFile(path);
          files.push(new File([fileData], fileName, { type: mimeTypes[ext] || "application/octet-stream" }));
        }

        if (files.length > 0) {
          await this.handleUnifiedExcelFileSelection(sourceKey, files);
        }
      }
    } catch (error) {
      console.error(`Failed to browse ${isFolder ? "folder" : "files"} (Tauri, unified ${source}):`, error);
      this.eventBus.emit("notification:show", {
        type: "error",
        message: `Failed to open ${isFolder ? "folder" : "files"}: ${error.message}`,
      });
    }
  }

  /**
   * Recursively scan folder for Excel files (Tauri only)
   */
  async _scanFolderForExcelFiles(folderPath, readDir, readFile, files) {
    try {
      const entries = await readDir(folderPath);

      for (const entry of entries) {
        const entryPath = `${folderPath}/${entry.name}`;

        if (entry.isDirectory) {
          await this._scanFolderForExcelFiles(entryPath, readDir, readFile, files);
        } else if (entry.isFile) {
          const ext = FileParser.getFileExtension(entry.name);
          if (FileParser.SUPPORTED_EXTENSIONS.includes(ext)) {
            const mimeTypes = {
              xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              xls: "application/vnd.ms-excel",
              csv: "text/csv",
            };

            const fileData = await readFile(entryPath);
            files.push(new File([fileData], entry.name, { type: mimeTypes[ext] || "application/octet-stream" }));
          }
        }
      }
    } catch (error) {
      console.warn(`Failed to read directory ${folderPath}:`, error);
    }
  }

  /**
   * Bind field selection events for unified mode
   */
  bindUnifiedFieldSelectionEvents() {
    // Select All / Clear buttons for PK
    const selectAllPkBtn = document.getElementById("btn-unified-select-all-pk");
    const deselectAllPkBtn = document.getElementById("btn-unified-deselect-all-pk");

    if (selectAllPkBtn) {
      selectAllPkBtn.addEventListener("click", () => {
        this.unified.selectedPkFields = [...this.unified.fields.common];
        // Phase 1.3: Auto-sync PK fields to comparison fields with tracking for animation
        const { updatedCompareFields, newlyAddedFields } = syncPkFieldsWithTracking(
          this.unified.selectedPkFields,
          this.unified.selectedCompareFields,
        );
        this.unified.selectedCompareFields = updatedCompareFields;
        this.unified._pkAutoAddedFields = newlyAddedFields;
        this.renderUnifiedFieldSelection();
      });
    }

    if (deselectAllPkBtn) {
      deselectAllPkBtn.addEventListener("click", () => {
        this.unified.selectedPkFields = [];
        this.renderUnifiedFieldSelection();
      });
    }

    // Select All / Clear buttons for compare fields
    const selectAllFieldsBtn = document.getElementById("btn-unified-select-all-fields");
    const deselectAllFieldsBtn = document.getElementById("btn-unified-deselect-all-fields");

    if (selectAllFieldsBtn) {
      selectAllFieldsBtn.addEventListener("click", () => {
        this.unified.selectedCompareFields = [...this.unified.fields.common];
        this.renderUnifiedFieldSelection();
      });
    }

    if (deselectAllFieldsBtn) {
      deselectAllFieldsBtn.addEventListener("click", () => {
        this.unified.selectedCompareFields = [];
        this.renderUnifiedFieldSelection();
      });
    }
  }

  /**
   * Initialize the Unified mode UI
   */
  initUnifiedModeUI() {
    const tauri = isTauri();

    // Populate connection dropdowns if in Tauri mode
    if (tauri && this.savedConnections.length > 0) {
      this.populateUnifiedConnectionDropdowns();
    }

    // In Web mode, hide Oracle options and pre-select Excel
    if (!tauri) {
      const oracleOptions = document.querySelectorAll('.source-type-option:has(input[value="oracle"])');
      oracleOptions.forEach((opt) => (opt.style.display = "none"));

      // Pre-select Excel for both sources
      const excelARadio = document.getElementById("source-a-type-excel");
      const excelBRadio = document.getElementById("source-b-type-excel");
      if (excelARadio) excelARadio.checked = true;
      if (excelBRadio) excelBRadio.checked = true;

      this.unified.sourceA.type = "excel";
      this.unified.sourceB.type = "excel";

      // Show Excel configs
      this.updateUnifiedSourceConfigVisibility("A");
      this.updateUnifiedSourceConfigVisibility("B");
    }

    // Restore cached unified Excel files from IndexedDB
    this.restoreCachedUnifiedExcelFiles();

    // Update Load Data button state
    this.updateUnifiedLoadButtonState();

    // Ensure status pills are initialized correctly
    this.updateUnifiedSourceConfigVisibility("A");
    this.updateUnifiedSourceConfigVisibility("B");
  }

  /**
   * Restore cached unified Excel files from IndexedDB (Phase 2)
   */
  async restoreCachedUnifiedExcelFiles() {
    if (!IndexedDBManager.isIndexedDBAvailable()) return;

    try {
      // Restore Source A files
      const sourceAFiles = await IndexedDBManager.getUnifiedExcelFiles("sourceA");
      if (sourceAFiles && sourceAFiles.length > 0) {
        const filesWithBlobs = sourceAFiles.map((record) => ({
          id: record.id,
          file: new File([record.content], record.name, { type: this._getMimeType(record.name) }),
        }));
        this.unified.sourceA.excelFiles = filesWithBlobs;
        this.updateUnifiedExcelUI("sourceA");
      }

      // Restore Source B files
      const sourceBFiles = await IndexedDBManager.getUnifiedExcelFiles("sourceB");
      if (sourceBFiles && sourceBFiles.length > 0) {
        const filesWithBlobs = sourceBFiles.map((record) => ({
          id: record.id,
          file: new File([record.content], record.name, { type: this._getMimeType(record.name) }),
        }));
        this.unified.sourceB.excelFiles = filesWithBlobs;
        this.updateUnifiedExcelUI("sourceB");
      }

      // Update button state after restoring
      this.updateUnifiedLoadButtonState();
    } catch (error) {
      console.warn("Failed to restore cached unified Excel files:", error);
    }
  }

  /**
   * Get MIME type from filename extension
   * @param {string} filename
   * @returns {string}
   */
  _getMimeType(filename) {
    const ext = FileParser.getFileExtension(filename);
    const mimeTypes = {
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      xls: "application/vnd.ms-excel",
      csv: "text/csv",
    };
    return mimeTypes[ext] || "application/octet-stream";
  }

  /**
   * Populate connection dropdowns for unified mode
   */
  populateUnifiedConnectionDropdowns() {
    this.setupUnifiedConnectionDropdown("A");
    this.setupUnifiedConnectionDropdown("B");
  }

  /**
   * Setup button-based dropdown for unified connection selection
   * @param {string} source - 'A' or 'B'
   */
  setupUnifiedConnectionDropdown(source) {
    const sourceKey = source === "A" ? "sourceA" : "sourceB";
    const prefix = `source-${source.toLowerCase()}`;
    const connections = this.savedConnections;

    const btn = document.getElementById(`${prefix}-connection-btn`);
    const label = document.getElementById(`${prefix}-connection-label`);
    const dropdown = document.getElementById(`${prefix}-connection-dropdown`);

    if (!btn || !dropdown || !label) return;

    // Update label based on current state
    const currentConnection = this.unified[sourceKey].connection;
    label.textContent = currentConnection?.name || (connections.length > 0 ? "Select connection..." : "No connections saved");
    btn.disabled = connections.length === 0;

    // Clone button to remove old event listeners
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    // Get the label inside the cloned button
    const newLabel = newBtn.querySelector(`#${prefix}-connection-label`);

    // Update renderOptions to use the new label reference
    const renderOptionsWithLabel = () => {
      if (connections.length === 0) {
        dropdown.innerHTML = '<div class="config-dropdown-no-results">No connections saved</div>';
        return;
      }

      const selectedName = this.unified[sourceKey].connection?.name;
      dropdown.innerHTML = connections
        .map(
          (conn) => `
        <button class="config-dropdown-option ${conn.name === selectedName ? "active" : ""}" data-value="${conn.name}">
          ${conn.name}
        </button>
      `,
        )
        .join("");

      // Bind click handlers
      dropdown.querySelectorAll(".config-dropdown-option").forEach((opt) => {
        opt.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const value = opt.dataset.value;
          if (newLabel) newLabel.textContent = value;
          dropdown.classList.remove("show");
          // Update active state
          dropdown.querySelectorAll(".config-dropdown-option").forEach((o) => o.classList.remove("active"));
          opt.classList.add("active");
          this.onUnifiedConnectionSelected(source, value);
        });
      });
    };

    // Toggle dropdown on button click
    newBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      renderOptionsWithLabel();
      dropdown.classList.toggle("show");
    });

    // Close dropdown when clicking outside
    document.addEventListener("click", (e) => {
      if (!newBtn.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.remove("show");
      }
    });

    // Initial render
    renderOptionsWithLabel();
  }

  /**
   * Setup button-based dropdown for query mode selection
   * @param {string} source - 'A' or 'B'
   */
  setupUnifiedQueryModeDropdown(source) {
    const sourceKey = source === "A" ? "sourceA" : "sourceB";
    const prefix = `source-${source.toLowerCase()}`;

    const btn = document.getElementById(`${prefix}-query-mode-btn`);
    const label = document.getElementById(`${prefix}-query-mode-label`);
    const dropdown = document.getElementById(`${prefix}-query-mode-dropdown`);

    if (!btn || !dropdown || !label) return;

    // Update label based on current state
    const currentMode = this.unified[sourceKey].queryMode || "table";
    label.textContent = currentMode === "table" ? "By Table" : "By Raw SQL";

    // Update active state in dropdown
    dropdown.querySelectorAll(".config-dropdown-option").forEach((opt) => {
      opt.classList.toggle("active", opt.dataset.value === currentMode);
    });

    // Clone button to remove old event listeners
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    // Get the label inside the cloned button (the old label reference is stale)
    const newLabel = newBtn.querySelector(`#${prefix}-query-mode-label`);

    // Toggle dropdown on button click
    newBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropdown.classList.toggle("show");
    });

    // Bind option click handlers
    dropdown.querySelectorAll(".config-dropdown-option").forEach((opt) => {
      opt.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const value = opt.dataset.value;
        if (newLabel) newLabel.textContent = value === "table" ? "By Table" : "By Raw SQL";
        dropdown.classList.remove("show");
        // Update active state
        dropdown.querySelectorAll(".config-dropdown-option").forEach((o) => o.classList.remove("active"));
        opt.classList.add("active");
        this.onUnifiedQueryModeChange(source, value);
      });
    });

    // Close dropdown when clicking outside
    document.addEventListener("click", (e) => {
      if (!newBtn.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.remove("show");
      }
    });
  }

  /**
   * Reset a unified source configuration
   */
  resetUnifiedSource(source) {
    const sourceKey = source === "A" ? "sourceA" : "sourceB";

    this.unified[sourceKey] = {
      type: null,
      connection: null,
      queryMode: "table",
      schema: null,
      table: null,
      sql: "",
      whereClause: "",
      maxRows: 100,
      file: null,
      parsedData: null,
      data: null,
      dataLoaded: false,
    };
  }

  /**
   * Handle source type change (Oracle/Excel)
   */
  onUnifiedSourceTypeChange(source, type) {
    const sourceKey = source === "A" ? "sourceA" : "sourceB";
    this.unified[sourceKey].type = type;
    this.unified[sourceKey].dataLoaded = false;
    this.unified[sourceKey].data = null;

    this.updateUnifiedSourceConfigVisibility(source);
    this.updateSourceBFollowModeUI();
    this.updateUnifiedLoadButtonState();
    this.updateUnifiedLoadDataButtonVisibility();
    this.hideUnifiedFieldReconciliation();

    // Re-initialize Excel UI when switching to Excel type to ensure dropdown event listeners are set up
    if (type === "excel" && this.unified[sourceKey].excelFiles.length > 0) {
      this.updateUnifiedExcelUI(sourceKey);
    }
  }

  /**
   * Update Source B UI for Oracle vs Oracle "follow mode"
   * In follow mode, Source B only shows Connection; other fields follow Source A
   */
  updateSourceBFollowModeUI() {
    const isFollowMode = isSourceBFollowMode(this.unified.sourceA.type, this.unified.sourceB.type);

    const disabledFields = getSourceBDisabledFieldsForFollowMode();
    const followModeNote = document.getElementById("source-b-follow-mode-note");
    const sourceBPanel = document.querySelector(".source-panel.source-b");

    // Show/hide the follow mode badge
    if (followModeNote) {
      followModeNote.style.display = isFollowMode ? "flex" : "none";
    }

    // Add/remove follow-mode-active class on source panel for visual indicator
    if (sourceBPanel) {
      sourceBPanel.classList.toggle("follow-mode-active", isFollowMode);
    }

    // Enable/disable Source B fields based on follow mode
    for (const fieldId of disabledFields) {
      const element = document.getElementById(fieldId);
      if (element) {
        element.disabled = isFollowMode;
        // Add visual indication
        element.closest(".form-group")?.classList.toggle("disabled-follow-mode", isFollowMode);
      }
    }

    // Hide table/sql config sections in follow mode (only show connection)
    const tableModeConfig = document.getElementById("source-b-table-config");
    const sqlModeConfig = document.getElementById("source-b-sql-config");
    const maxRowsGroup = document.getElementById("source-b-max-rows")?.closest(".form-group");
    const queryModeGroup = document.getElementById("source-b-query-mode-wrapper")?.closest(".form-group");

    if (isFollowMode) {
      if (tableModeConfig) tableModeConfig.style.display = "none";
      if (sqlModeConfig) sqlModeConfig.style.display = "none";
      if (maxRowsGroup) maxRowsGroup.style.display = "none";
      if (queryModeGroup) queryModeGroup.style.display = "none";
    } else {
      // Restore visibility based on current query mode
      const queryMode = this.unified.sourceB.queryMode;
      if (tableModeConfig) tableModeConfig.style.display = queryMode === "table" ? "flex" : "none";
      if (sqlModeConfig) sqlModeConfig.style.display = queryMode === "sql" ? "flex" : "none";
      if (maxRowsGroup) maxRowsGroup.style.display = "flex";
      if (queryModeGroup) queryModeGroup.style.display = "flex";
    }
  }

  /**
   * Update source config visibility based on selected type
   */
  updateUnifiedSourceConfigVisibility(source) {
    const prefix = `source-${source.toLowerCase()}`;
    const sourceKey = source === "A" ? "sourceA" : "sourceB";
    const type = this.unified[sourceKey].type;

    const oracleConfig = document.getElementById(`${prefix}-oracle-config`);
    const excelConfig = document.getElementById(`${prefix}-excel-config`);
    const preview = document.getElementById(`${prefix}-preview`);

    if (oracleConfig) oracleConfig.style.display = type === "oracle" ? "flex" : "none";
    if (excelConfig) excelConfig.style.display = type === "excel" ? "block" : "none";
    if (preview) preview.style.display = this.unified[sourceKey].dataLoaded ? "block" : "none";

    // Manage status visibility and text
    const status = document.getElementById(`${prefix}-status`);
    if (status) {
      if (type) {
        status.style.display = "inline-flex";
        if (!this.unified[sourceKey].dataLoaded) {
          status.textContent = "Not loaded";
          status.className = "source-status";
        } else {
          status.textContent = "Ready";
          status.className = "source-status ready";
        }
      } else {
        status.style.display = "none";
        status.textContent = "Not loaded"; // Reset text but keep hidden
      }
    }
  }

  /**
   * Handle connection selection in unified mode
   */
  async onUnifiedConnectionSelected(source, connectionName) {
    const sourceKey = source === "A" ? "sourceA" : "sourceB";
    const prefix = `source-${source.toLowerCase()}`;

    if (!connectionName) {
      this.unified[sourceKey].connection = null;
      this.updateUnifiedLoadButtonState();
      return;
    }

    const connection = this.savedConnections.find((c) => c.name === connectionName);
    if (!connection) return;

    this.unified[sourceKey].connection = connection;
    this.unified[sourceKey].dataLoaded = false;
    this.unified[sourceKey].data = null;
    this.unified[sourceKey].schema = null;
    this.unified[sourceKey].table = null;

    // Reset table dropdown
    const tableInput = document.getElementById(`${prefix}-table-search`);
    const tableDropdown = document.getElementById(`${prefix}-table-dropdown`);
    if (tableInput) {
      tableInput.value = "";
      tableInput.placeholder = "Select schema first...";
      tableInput.disabled = true;
    }
    if (tableDropdown) tableDropdown.innerHTML = "";

    // Fetch schemas and setup searchable dropdown
    const schemaInput = document.getElementById(`${prefix}-schema-search`);
    const schemaDropdown = document.getElementById(`${prefix}-schema-dropdown`);
    if (schemaInput) {
      schemaInput.value = "";
      schemaInput.placeholder = "Loading schemas...";
      schemaInput.disabled = true;

      try {
        const schemas = await CompareConfigService.fetchSchemasViaSidecar(connection.name, connection);
        this.setupUnifiedSchemaDropdown(source, schemas);
      } catch (error) {
        console.error("Failed to fetch schemas:", error);
        schemaInput.placeholder = "Failed to load schemas";
        if (schemaDropdown) schemaDropdown.innerHTML = "";
      }
    }

    this.updateUnifiedLoadButtonState();
    this.updateUnifiedLoadDataButtonVisibility();
    this.hideUnifiedFieldReconciliation();
  }

  /**
   * Setup searchable dropdown for unified schema selection
   * @param {string} source - 'A' or 'B'
   * @param {string[]} schemas - Array of schema names
   */
  setupUnifiedSchemaDropdown(source, schemas) {
    const sourceKey = source === "A" ? "sourceA" : "sourceB";
    const prefix = `source-${source.toLowerCase()}`;

    const input = document.getElementById(`${prefix}-schema-search`);
    const dropdown = document.getElementById(`${prefix}-schema-dropdown`);

    if (!input || !dropdown) return;

    // Store schemas for this source
    this._schemaOptions = this._schemaOptions || {};
    this._schemaOptions[sourceKey] = schemas;

    // Remove old event listeners by cloning the input
    const newInput = input.cloneNode(true);
    input.parentNode.replaceChild(newInput, input);

    newInput.placeholder = schemas.length > 0 ? "Search or select schema..." : "No schemas found";
    newInput.disabled = schemas.length === 0;
    newInput.value = this.unified[sourceKey].schema || "";

    let highlightedIndex = -1;
    let filteredSchemas = [];

    const renderOptions = (filter = "") => {
      filteredSchemas = schemas.filter((s) => s.toLowerCase().includes(filter.toLowerCase()));
      highlightedIndex = -1;

      if (filteredSchemas.length === 0) {
        dropdown.innerHTML = '<div class="searchable-no-results">No matching schemas</div>';
        return;
      }

      const selectedSchema = this.unified[sourceKey].schema;
      dropdown.innerHTML = filteredSchemas
        .map(
          (schema, i) => `
        <div class="searchable-option ${schema === selectedSchema ? "selected" : ""}" data-value="${schema}" data-index="${i}">
          <svg class="option-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
          </svg>
          <span class="option-text">${schema}</span>
        </div>
      `,
        )
        .join("");

      // Bind click handlers
      dropdown.querySelectorAll(".searchable-option").forEach((opt) => {
        opt.addEventListener("click", () => {
          const value = opt.dataset.value;
          newInput.value = value;
          dropdown.classList.remove("open");
          this.onUnifiedSchemaSelected(source, value);
        });
      });
    };

    const updateHighlighting = () => {
      dropdown.querySelectorAll(".searchable-option").forEach((opt, i) => {
        if (i === highlightedIndex) {
          opt.classList.add("highlighted");
          opt.scrollIntoView({ block: "nearest" });
        } else {
          opt.classList.remove("highlighted");
        }
      });
    };

    // Input events
    newInput.addEventListener("focus", () => {
      renderOptions(newInput.value);
      dropdown.classList.add("open");
    });

    newInput.addEventListener("input", () => {
      renderOptions(newInput.value);
      dropdown.classList.add("open");
    });

    newInput.addEventListener("blur", () => {
      setTimeout(() => {
        dropdown.classList.remove("open");
        highlightedIndex = -1;
      }, 200);
    });

    newInput.addEventListener("keydown", (e) => {
      if (!dropdown.classList.contains("open")) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          renderOptions(newInput.value);
          dropdown.classList.add("open");
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          highlightedIndex = Math.min(highlightedIndex + 1, filteredSchemas.length - 1);
          updateHighlighting();
          break;
        case "ArrowUp":
          e.preventDefault();
          highlightedIndex = Math.max(highlightedIndex - 1, -1);
          updateHighlighting();
          break;
        case "Enter":
          if (highlightedIndex >= 0 && highlightedIndex < filteredSchemas.length) {
            e.preventDefault();
            const schema = filteredSchemas[highlightedIndex];
            newInput.value = schema;
            dropdown.classList.remove("open");
            this.onUnifiedSchemaSelected(source, schema);
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

    // Initial render
    renderOptions();
  }

  /**
   * Handle query mode change in unified mode
   */
  onUnifiedQueryModeChange(source, mode) {
    const sourceKey = source === "A" ? "sourceA" : "sourceB";
    const prefix = `source-${source.toLowerCase()}`;

    this.unified[sourceKey].queryMode = mode;
    this.unified[sourceKey].dataLoaded = false;
    this.unified[sourceKey].data = null;

    const tableConfig = document.getElementById(`${prefix}-table-config`);
    const sqlConfig = document.getElementById(`${prefix}-sql-config`);

    if (tableConfig) tableConfig.style.display = mode === "table" ? "flex" : "none";
    if (sqlConfig) sqlConfig.style.display = mode === "sql" ? "block" : "none";

    this.updateUnifiedLoadButtonState();
    this.updateUnifiedLoadDataButtonVisibility();
    this.hideUnifiedFieldReconciliation();
  }

  /**
   * Handle schema selection in unified mode
   */
  async onUnifiedSchemaSelected(source, schema) {
    const sourceKey = source === "A" ? "sourceA" : "sourceB";
    const prefix = `source-${source.toLowerCase()}`;
    const connection = this.unified[sourceKey].connection;

    this.unified[sourceKey].schema = schema;
    this.unified[sourceKey].table = null;
    this.unified[sourceKey].dataLoaded = false;
    this.unified[sourceKey].data = null;

    const tableInput = document.getElementById(`${prefix}-table-search`);
    const tableDropdown = document.getElementById(`${prefix}-table-dropdown`);

    if (!connection || !schema) {
      if (tableInput) {
        tableInput.value = "";
        tableInput.placeholder = "Select schema first...";
        tableInput.disabled = true;
      }
      if (tableDropdown) tableDropdown.innerHTML = "";
      this.updateUnifiedLoadButtonState();
      return;
    }

    // Fetch tables and setup searchable dropdown
    if (tableInput) {
      tableInput.value = "";
      tableInput.placeholder = "Loading tables...";
      tableInput.disabled = true;
    }

    try {
      const tables = await CompareConfigService.fetchTablesViaSidecar(connection.name, connection, schema);
      this.setupUnifiedTableDropdown(source, tables);
    } catch (error) {
      console.error("Failed to fetch tables:", error);
      if (tableInput) {
        tableInput.placeholder = "Failed to load tables";
      }
      if (tableDropdown) tableDropdown.innerHTML = "";
    }

    this.updateUnifiedLoadButtonState();
    this.updateUnifiedLoadDataButtonVisibility();
    this.hideUnifiedFieldReconciliation();
  }

  /**
   * Setup searchable dropdown for unified table selection
   * @param {string} source - 'A' or 'B'
   * @param {string[]} tables - Array of table names
   */
  setupUnifiedTableDropdown(source, tables) {
    const sourceKey = source === "A" ? "sourceA" : "sourceB";
    const prefix = `source-${source.toLowerCase()}`;

    const input = document.getElementById(`${prefix}-table-search`);
    const dropdown = document.getElementById(`${prefix}-table-dropdown`);

    if (!input || !dropdown) return;

    // Store tables for this source
    this._tableOptions = this._tableOptions || {};
    this._tableOptions[sourceKey] = tables;

    // Remove old event listeners by cloning the input
    const newInput = input.cloneNode(true);
    input.parentNode.replaceChild(newInput, input);

    newInput.placeholder = tables.length > 0 ? "Search or select table..." : "No tables found";
    newInput.disabled = tables.length === 0;
    newInput.value = this.unified[sourceKey].table || "";

    let highlightedIndex = -1;
    let filteredTables = [];

    const renderOptions = (filter = "") => {
      filteredTables = tables.filter((t) => t.toLowerCase().includes(filter.toLowerCase()));
      highlightedIndex = -1;

      if (filteredTables.length === 0) {
        dropdown.innerHTML = '<div class="searchable-no-results">No matching tables</div>';
        return;
      }

      const selectedTable = this.unified[sourceKey].table;
      dropdown.innerHTML = filteredTables
        .map(
          (table, i) => `
        <div class="searchable-option ${table === selectedTable ? "selected" : ""}" data-value="${table}" data-index="${i}">
          <svg class="option-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="3" y1="9" x2="21" y2="9"></line>
            <line x1="9" y1="21" x2="9" y2="9"></line>
          </svg>
          <span class="option-text">${table}</span>
        </div>
      `,
        )
        .join("");

      // Bind click handlers
      dropdown.querySelectorAll(".searchable-option").forEach((opt) => {
        opt.addEventListener("click", () => {
          const value = opt.dataset.value;
          newInput.value = value;
          dropdown.classList.remove("open");
          this.onUnifiedTableSelected(source, value);
        });
      });
    };

    const updateHighlighting = () => {
      dropdown.querySelectorAll(".searchable-option").forEach((opt, i) => {
        if (i === highlightedIndex) {
          opt.classList.add("highlighted");
          opt.scrollIntoView({ block: "nearest" });
        } else {
          opt.classList.remove("highlighted");
        }
      });
    };

    // Input events
    newInput.addEventListener("focus", () => {
      renderOptions(newInput.value);
      dropdown.classList.add("open");
    });

    newInput.addEventListener("input", () => {
      renderOptions(newInput.value);
      dropdown.classList.add("open");
    });

    newInput.addEventListener("blur", () => {
      setTimeout(() => {
        dropdown.classList.remove("open");
        highlightedIndex = -1;
      }, 200);
    });

    newInput.addEventListener("keydown", (e) => {
      if (!dropdown.classList.contains("open")) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          renderOptions(newInput.value);
          dropdown.classList.add("open");
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          highlightedIndex = Math.min(highlightedIndex + 1, filteredTables.length - 1);
          updateHighlighting();
          break;
        case "ArrowUp":
          e.preventDefault();
          highlightedIndex = Math.max(highlightedIndex - 1, -1);
          updateHighlighting();
          break;
        case "Enter":
          if (highlightedIndex >= 0 && highlightedIndex < filteredTables.length) {
            e.preventDefault();
            const table = filteredTables[highlightedIndex];
            newInput.value = table;
            dropdown.classList.remove("open");
            this.onUnifiedTableSelected(source, table);
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

    // Initial render
    renderOptions();
  }

  /**
   * Handle table selection in unified mode
   */
  onUnifiedTableSelected(source, table) {
    const sourceKey = source === "A" ? "sourceA" : "sourceB";

    this.unified[sourceKey].table = table;
    this.unified[sourceKey].dataLoaded = false;
    this.unified[sourceKey].data = null;

    this.updateUnifiedLoadButtonState();
    this.updateUnifiedLoadDataButtonVisibility();
    this.hideUnifiedFieldReconciliation();
  }

  /**
   * Handle file selection in unified mode
   */
  /**
   * Handle Excel file selection for unified mode (Phase 2: multi-file)
   * @param {string} sourceKey - 'sourceA' or 'sourceB'
   * @param {FileList|File[]} files - Selected files
   */
  async handleUnifiedExcelFileSelection(sourceKey, files) {
    const fileArray = Array.from(files);
    const supportedFiles = FileParser.filterSupportedFiles(fileArray);

    if (supportedFiles.length === 0) {
      this.eventBus.emit("notification:show", {
        type: "warning",
        message: "No supported files (.xlsx, .xls, .csv) were selected.",
      });
      return;
    }

    // Show loading indicator for file upload (especially for multiple files)
    const showLoadingIndicator = supportedFiles.length > 1;
    if (showLoadingIndicator) {
      this.showUnifiedUploadLoading(sourceKey, `Processing ${supportedFiles.length} files...`);
    }

    // Wrap files with IDs
    const filesWithIds = supportedFiles.map((file) => ({
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 9),
      file,
    }));

    // Add to existing list
    this.unified[sourceKey].excelFiles = [...this.unified[sourceKey].excelFiles, ...filesWithIds];

    // Reset data loaded state since files changed
    this.unified[sourceKey].dataLoaded = false;
    this.unified[sourceKey].data = null;
    this.unified[sourceKey].parsedData = null;

    // Cache files in IndexedDB
    if (IndexedDBManager.isIndexedDBAvailable()) {
      let cachedCount = 0;
      for (const fileWrapper of filesWithIds) {
        try {
          const arrayBuffer = await fileWrapper.file.arrayBuffer();
          await IndexedDBManager.saveUnifiedExcelFile({
            id: fileWrapper.id,
            name: fileWrapper.file.name,
            content: arrayBuffer,
            source: sourceKey,
          });
          cachedCount++;
          if (showLoadingIndicator) {
            this.showUnifiedUploadLoading(sourceKey, `Caching files (${cachedCount}/${filesWithIds.length})...`);
          }
        } catch (error) {
          console.warn("Failed to cache unified Excel file:", error);
        }
      }
    }

    // Hide loading indicator
    if (showLoadingIndicator) {
      this.hideUnifiedUploadLoading(sourceKey);
    }

    // Update UI
    this.updateUnifiedExcelUI(sourceKey);
    this.updateUnifiedLoadButtonState();
    this.hideUnifiedFieldReconciliation();
  }

  /**
   * Clear all Excel files from a unified source
   * @param {string} sourceKey - 'sourceA' or 'sourceB'
   */
  async clearUnifiedExcelFiles(sourceKey) {
    // Clear from IndexedDB
    if (IndexedDBManager.isIndexedDBAvailable()) {
      for (const fileWrapper of this.unified[sourceKey].excelFiles) {
        try {
          await IndexedDBManager.deleteUnifiedExcelFile(fileWrapper.id);
        } catch (error) {
          console.warn("Failed to delete unified Excel file from IndexedDB:", error);
        }
      }
    }

    // Clear state
    this.unified[sourceKey].excelFiles = [];
    this.unified[sourceKey].selectedExcelFile = null;
    this.unified[sourceKey].file = null;
    this.unified[sourceKey].parsedData = null;
    this.unified[sourceKey].dataLoaded = false;
    this.unified[sourceKey].data = null;

    // Update UI
    this.updateUnifiedExcelUI(sourceKey);
    this.updateUnifiedLoadButtonState();
    this.hideUnifiedFieldReconciliation();
  }

  /**
   * Remove a single Excel file from a unified source
   * @param {string} sourceKey - 'sourceA' or 'sourceB'
   * @param {string} fileId - ID of file to remove
   */
  async removeUnifiedExcelFile(sourceKey, fileId) {
    // Remove from IndexedDB
    if (IndexedDBManager.isIndexedDBAvailable()) {
      try {
        await IndexedDBManager.deleteUnifiedExcelFile(fileId);
      } catch (error) {
        console.warn("Failed to delete unified Excel file from IndexedDB:", error);
      }
    }

    // Remove from list
    this.unified[sourceKey].excelFiles = this.unified[sourceKey].excelFiles.filter((f) => f.id !== fileId);

    // Clear selection if removed file was selected
    if (this.unified[sourceKey].selectedExcelFile?.id === fileId) {
      this.unified[sourceKey].selectedExcelFile = null;
      this.unified[sourceKey].file = null;
      this.unified[sourceKey].parsedData = null;
      this.unified[sourceKey].dataLoaded = false;
      this.unified[sourceKey].data = null;
    }

    // Update UI
    this.updateUnifiedExcelUI(sourceKey);
    this.updateUnifiedLoadButtonState();
    this.hideUnifiedFieldReconciliation();
  }

  /**
   * Shows a loading indicator on the upload zone during file processing
   * @param {string} sourceKey - 'sourceA' or 'sourceB'
   * @param {string} message - Loading message to display
   */
  showUnifiedUploadLoading(sourceKey, message = "Processing files...") {
    const source = sourceKey === "sourceA" ? "a" : "b";
    const uploadZone = document.getElementById(`source-${source}-upload-zone`);
    if (!uploadZone) return;

    uploadZone.classList.add("uploading");

    // Add loading indicator if not present
    let loadingEl = uploadZone.querySelector(".upload-loading-indicator");
    if (!loadingEl) {
      loadingEl = document.createElement("div");
      loadingEl.className = "upload-loading-indicator";
      loadingEl.innerHTML = `
        <div class="loading-spinner-small"></div>
        <span class="upload-loading-text">${message}</span>
      `;
      const uploadArea = uploadZone.querySelector(".upload-area");
      if (uploadArea) {
        uploadArea.insertAdjacentElement("afterend", loadingEl);
      } else {
        uploadZone.appendChild(loadingEl);
      }
    } else {
      const textEl = loadingEl.querySelector(".upload-loading-text");
      if (textEl) textEl.textContent = message;
    }
  }

  /**
   * Hides the loading indicator on the upload zone
   * @param {string} sourceKey - 'sourceA' or 'sourceB'
   */
  hideUnifiedUploadLoading(sourceKey) {
    const source = sourceKey === "sourceA" ? "a" : "b";
    const uploadZone = document.getElementById(`source-${source}-upload-zone`);
    if (!uploadZone) return;

    uploadZone.classList.remove("uploading");

    const loadingEl = uploadZone.querySelector(".upload-loading-indicator");
    if (loadingEl) {
      loadingEl.remove();
    }
  }

  /**
   * Update the Excel UI for a unified source (file list, dropdown, clear button)
   * @param {string} sourceKey - 'sourceA' or 'sourceB'
   */
  updateUnifiedExcelUI(sourceKey) {
    const source = sourceKey === "sourceA" ? "a" : "b";
    const prefix = `source-${source}`;
    const files = this.unified[sourceKey].excelFiles;

    // Update file list
    const fileListEl = document.getElementById(`${prefix}-file-list`);
    if (fileListEl) {
      if (files.length === 0) {
        fileListEl.innerHTML = "";
      } else {
        fileListEl.innerHTML = files
          .sort((a, b) => a.file.name.localeCompare(b.file.name))
          .map(
            (f) => `
          <div class="file-item" data-file-id="${f.id}">
            <span class="file-name">${f.file.name}</span>
            <button class="btn btn-ghost btn-xs btn-remove-file" title="Remove">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        `,
          )
          .join("");

        // Bind remove buttons
        fileListEl.querySelectorAll(".btn-remove-file").forEach((btn) => {
          btn.addEventListener("click", (e) => {
            const fileItem = e.target.closest(".file-item");
            const fileId = fileItem?.dataset.fileId;
            if (fileId) {
              this.removeUnifiedExcelFile(sourceKey, fileId);
            }
          });
        });
      }
    }

    // Show/hide Clear All button
    const clearAllBtn = document.getElementById(`${prefix}-clear-all`);
    if (clearAllBtn) {
      clearAllBtn.style.display = files.length > 0 ? "" : "none";
    }

    // Show/hide file selection dropdown
    const fileSelectionDiv = document.getElementById(`${prefix}-file-selection`);
    if (fileSelectionDiv) {
      fileSelectionDiv.style.display = files.length > 0 ? "block" : "none";

      if (files.length > 0) {
        // Setup searchable dropdown
        this.setupUnifiedExcelFileDropdown(sourceKey);

        // Auto-select if only 1 file
        if (files.length === 1 && !this.unified[sourceKey].selectedExcelFile) {
          this.selectUnifiedExcelFile(sourceKey, files[0].id);
        }
      }
    }
  }

  /**
   * Setup searchable dropdown for unified Excel file selection
   * Uses same pattern as Quick Query schema dropdown for keyboard navigation
   * @param {string} sourceKey - 'sourceA' or 'sourceB'
   */
  setupUnifiedExcelFileDropdown(sourceKey) {
    const source = sourceKey === "sourceA" ? "a" : "b";
    const prefix = `source-${source}`;
    const files = this.unified[sourceKey].excelFiles;
    const selectedId = this.unified[sourceKey].selectedExcelFile?.id;

    const input = document.getElementById(`${prefix}-file-search`);
    const dropdown = document.getElementById(`${prefix}-file-dropdown`);

    if (!input || !dropdown) return;

    // Remove old event listeners by cloning both input and dropdown
    const newInput = input.cloneNode(true);
    input.parentNode.replaceChild(newInput, input);

    const newDropdown = dropdown.cloneNode(false); // shallow clone to clear children and listeners
    dropdown.parentNode.replaceChild(newDropdown, dropdown);

    // Set input value if file is selected
    if (selectedId) {
      const selectedFile = files.find((f) => f.id === selectedId);
      if (selectedFile) {
        newInput.value = selectedFile.file.name;
      }
    } else {
      newInput.value = "";
    }

    let highlightedIndex = -1;
    let filteredFiles = [];

    const renderOptions = (filter = "") => {
      filteredFiles = files.filter((f) => f.file.name.toLowerCase().includes(filter.toLowerCase()));
      highlightedIndex = -1;

      if (filteredFiles.length === 0) {
        newDropdown.innerHTML = '<div class="searchable-no-results">No matching files</div>';
        return;
      }

      newDropdown.innerHTML = filteredFiles
        .map(
          (f, i) => `
        <div class="searchable-option ${f.id === selectedId ? "selected" : ""}" data-file-id="${f.id}" data-index="${i}">
          <svg class="option-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
          <span class="option-text">${f.file.name}</span>
        </div>
      `,
        )
        .join("");
    };

    // Event delegation on dropdown container (more reliable than per-option listeners)
    newDropdown.addEventListener("mousedown", (e) => {
      const opt = e.target.closest(".searchable-option");
      if (opt) {
        e.preventDefault(); // Prevent blur from firing
        e.stopPropagation();
        const fileId = opt.dataset.fileId;
        this.selectUnifiedExcelFile(sourceKey, fileId);
        newDropdown.classList.remove("open");
        newInput.blur();
      }
    });

    const updateHighlighting = () => {
      newDropdown.querySelectorAll(".searchable-option").forEach((opt, i) => {
        if (i === highlightedIndex) {
          opt.classList.add("highlighted");
          opt.scrollIntoView({ block: "nearest" });
        } else {
          opt.classList.remove("highlighted");
        }
      });
    };

    // Input events
    newInput.addEventListener("focus", () => {
      renderOptions(newInput.value);
      newDropdown.classList.add("open");
    });

    newInput.addEventListener("input", () => {
      renderOptions(newInput.value);
      newDropdown.classList.add("open");
    });

    newInput.addEventListener("blur", () => {
      // Delay to allow click on option
      setTimeout(() => {
        newDropdown.classList.remove("open");
        highlightedIndex = -1;
      }, 200);
    });

    newInput.addEventListener("keydown", (e) => {
      // Open dropdown on ArrowDown when closed
      if (!newDropdown.classList.contains("open")) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          renderOptions(newInput.value);
          newDropdown.classList.add("open");
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
          highlightedIndex = Math.max(highlightedIndex - 1, -1);
          updateHighlighting();
          break;
        case "Enter":
          if (highlightedIndex >= 0 && highlightedIndex < filteredFiles.length) {
            e.preventDefault();
            const file = filteredFiles[highlightedIndex];
            newInput.value = file.file.name;
            newDropdown.classList.remove("open");
            this.selectUnifiedExcelFile(sourceKey, file.id);
          }
          break;
        case "Escape":
          e.preventDefault();
          newDropdown.classList.remove("open");
          highlightedIndex = -1;
          break;
        case "Tab":
          newDropdown.classList.remove("open");
          highlightedIndex = -1;
          break;
      }
    });

    // Initial render (hidden)
    renderOptions();
  }

  /**
   * Select a file for comparison in unified mode
   * @param {string} sourceKey - 'sourceA' or 'sourceB'
   * @param {string} fileId - ID of file to select
   */
  selectUnifiedExcelFile(sourceKey, fileId) {
    const file = this.unified[sourceKey].excelFiles.find((f) => f.id === fileId);
    if (!file) return;

    this.unified[sourceKey].selectedExcelFile = file;
    this.unified[sourceKey].file = file.file; // For backward compat
    this.unified[sourceKey].parsedData = null; // Will be parsed on load
    this.unified[sourceKey].dataLoaded = false;
    this.unified[sourceKey].data = null;

    // Update input display
    const source = sourceKey === "sourceA" ? "a" : "b";
    const input = document.getElementById(`source-${source}-file-search`);
    if (input) {
      input.value = file.file.name;
    }

    this.updateUnifiedLoadButtonState();
    this.updateUnifiedLoadDataButtonVisibility();
    this.hideUnifiedFieldReconciliation();
  }

  // Legacy function for backward compatibility
  async handleUnifiedFileSelection(source, file) {
    const sourceKey = source === "A" ? "sourceA" : "sourceB";
    await this.handleUnifiedExcelFileSelection(sourceKey, [file]);
  }

  // Legacy function for backward compatibility
  removeUnifiedFile(source) {
    const sourceKey = source === "A" ? "sourceA" : "sourceB";
    this.clearUnifiedExcelFiles(sourceKey);
  }

  /**
   * Update the Load Data button state
   */
  updateUnifiedLoadButtonState() {
    const loadBtn = document.getElementById("btn-unified-load-data");
    if (!loadBtn) return;

    const canLoad = this.canLoadUnifiedData();
    loadBtn.disabled = !canLoad;
  }

  /**
   * Check if we can load data from both sources
   */
  canLoadUnifiedData() {
    return this.isUnifiedSourceConfigured("A") && this.isUnifiedSourceConfigured("B");
  }

  /**
   * Check if a source is configured
   */
  isUnifiedSourceConfigured(source) {
    const sourceKey = source === "A" ? "sourceA" : "sourceB";
    const config = this.unified[sourceKey];

    if (!config.type) return false;

    if (config.type === "oracle") {
      if (!config.connection) return false;

      // Phase 1.1: In Oracle vs Oracle follow mode, Source B only needs connection
      // (schema/table/sql will be copied from Source A)
      if (source === "B" && isSourceBFollowMode(this.unified.sourceA.type, this.unified.sourceB.type)) {
        return true; // Connection is enough for Source B in follow mode
      }

      if (config.queryMode === "table") {
        return !!config.schema && !!config.table;
      } else {
        return !!config.sql && config.sql.trim().length > 0;
      }
    } else if (config.type === "excel") {
      return !!config.selectedExcelFile;
    }

    return false;
  }

  /**
   * Load data from both sources
   */
  async loadUnifiedData() {
    if (!this.canLoadUnifiedData()) {
      this.eventBus.emit("notification:show", {
        type: "warning",
        message: "Please configure both sources before loading data.",
      });
      return;
    }

    // Phase 1.2: Validate Oracle vs Oracle configuration
    const isOracleToOracle = isSourceBFollowMode(this.unified.sourceA.type, this.unified.sourceB.type);

    if (isOracleToOracle) {
      const validation = validateOracleToOracleConfig(this.unified.sourceA, this.unified.sourceB);
      if (!validation.valid) {
        this.eventBus.emit("notification:show", {
          type: "error",
          message: validation.error,
        });
        return;
      }
    }

    // Determine comparison mode for progress overlay
    const comparisonMode = getComparisonMode(this.unified.sourceA.type, this.unified.sourceB.type);

    // Hide any previous error banner
    this.hideUnifiedErrorBanner();

    this.showUnifiedProgress("Loading Data", comparisonMode);
    this.updateUnifiedProgressStep("source-a", "active", "Loading...");

    try {
      // Load Source A
      const dataA = await this.fetchUnifiedSourceData("A");
      this.unified.sourceA.data = dataA;
      this.unified.sourceA.dataLoaded = true;
      this.updateUnifiedProgressStep("source-a", "done", `${dataA.metadata.rowCount} rows loaded`);
      this.updateUnifiedSourcePreview("A");

      // Check for empty Source A data
      if (dataA.metadata.rowCount === 0) {
        this.updateUnifiedProgressStep("source-b", "error", "Source A returned no data");
        this.hideUnifiedProgress();

        const errorInfo = getActionableErrorMessage(UnifiedErrorType.NO_DATA, {
          source: `Source A (${this.unified.sourceA.connection?.name || "Reference"})`,
          whereClause: this.unified.sourceA.whereClause,
        });
        this.showUnifiedErrorBanner(errorInfo.title, errorInfo.message, errorInfo.hint);
        return;
      }

      // Phase 1.2: For Oracle vs Oracle, validate table exists in Source B before loading
      if (isOracleToOracle && this.unified.sourceA.queryMode === "table") {
        this.updateUnifiedProgressStep("validate-b", "active", "Checking table exists...");
        const tableExists = await this.validateOracleTableExistsInSourceB();
        if (!tableExists) {
          this.updateUnifiedProgressStep("validate-b", "error", "Table not found");
          this.hideUnifiedProgress();
          return; // Error already shown by validateOracleTableExistsInSourceB
        }
        this.updateUnifiedProgressStep("validate-b", "done", "Table verified");
      }

      // Load Source B
      this.updateUnifiedProgressStep("source-b", "active", "Loading...");
      const dataB = await this.fetchUnifiedSourceData("B");
      this.unified.sourceB.data = dataB;
      this.unified.sourceB.dataLoaded = true;
      this.updateUnifiedProgressStep("source-b", "done", `${dataB.metadata.rowCount} rows loaded`);
      this.updateUnifiedSourcePreview("B");

      // Check for empty Source B data (especially important in follow mode with WHERE clause)
      if (dataB.metadata.rowCount === 0) {
        this.updateUnifiedProgressStep("reconcile", "error", "Source B returned no data");
        this.hideUnifiedProgress();

        // In Oracle follow mode, the WHERE clause is inherited from Source A
        const whereClause = isOracleToOracle ? this.unified.sourceA.whereClause : this.unified.sourceB.whereClause;
        const errorInfo = getActionableErrorMessage(UnifiedErrorType.NO_DATA, {
          source: `Source B (${this.unified.sourceB.connection?.name || "Comparator"})`,
          whereClause: whereClause,
        });
        this.showUnifiedErrorBanner(errorInfo.title, errorInfo.message, errorInfo.hint);
        return;
      }

      // Phase 2.3: Validate mixed mode (Oracle + Excel) configuration
      const isMixedModeComparison = isMixedMode(this.unified.sourceA.type, this.unified.sourceB.type);

      if (isMixedModeComparison) {
        this.updateUnifiedProgressStep("reconcile", "active", "Validating field compatibility...");
        const mixedValidation = validateMixedModeConfig(
          { type: this.unified.sourceA.type, headers: dataA.headers },
          { type: this.unified.sourceB.type, headers: dataB.headers },
        );

        if (!mixedValidation.valid) {
          this.updateUnifiedProgressStep("reconcile", "error", "No common fields");
          this.hideUnifiedProgress();
          const errorInfo = getActionableErrorMessage(UnifiedErrorType.NO_COMMON_FIELDS, {
            headersA: dataA.headers,
            headersB: dataB.headers,
          });
          this.showUnifiedErrorBanner(errorInfo.title, errorInfo.message, errorInfo.hint);
          return;
        }

        // Note: Field mismatch warning is handled by the inline "Column Differences Detected"
        // warning in the field reconciliation UI (updateUnifiedColumnWarning), which provides
        // more detailed information with expandable details.
      }

      // Reconcile columns
      this.updateUnifiedProgressStep("reconcile", "active", "Reconciling fields...");
      this.reconcileUnifiedFields();

      // Load saved preferences for this table (if any)
      await this.loadUnifiedTablePrefsFromIndexedDB();

      this.updateUnifiedProgressStep("reconcile", "done", `${this.unified.fields.common.length} common fields`);

      // Save config snapshot so we can detect future changes
      this._saveUnifiedConfigSnapshot();

      // Show field reconciliation UI
      await new Promise((r) => setTimeout(r, 300));
      this.hideUnifiedProgress();
      this.showUnifiedFieldReconciliation();
    } catch (error) {
      console.error("Failed to load unified data:", error);
      this.hideUnifiedProgress();

      // Parse error for better messaging
      const { code, friendlyMessage } = parseOracleError(error.message || error);

      if (code) {
        // Oracle-specific error
        this.showUnifiedErrorBanner("Database Error", friendlyMessage, "Check your connection settings and try again.");
      } else {
        // Generic error with context
        const errorInfo = getActionableErrorMessage(UnifiedErrorType.VALIDATION_ERROR, {
          message: `Failed to load data: ${friendlyMessage}`,
          hint: "Please check your configuration and try again.",
        });
        this.showUnifiedErrorBanner(errorInfo.title, errorInfo.message, errorInfo.hint);
      }

      // Track data loading error (rich error with code, stack)
      const sourceAType = this.unified.sourceA.type || "unknown";
      const sourceBType = this.unified.sourceB.type || "unknown";
      UsageTracker.trackEvent(
        "compare-config",
        "data_load_error",
        UsageTracker.enrichErrorMeta(error, {
          mode: `unified_${sourceAType}_${sourceBType}`,
          oracle_code: code || null,
        }),
      );
    }
  }

  /**
   * Validate that the schema.table from Source A exists in Source B connection
   * Used in Oracle vs Oracle mode before loading data
   * @returns {Promise<boolean>}
   */
  async validateOracleTableExistsInSourceB() {
    const { schema, table } = this.unified.sourceA;
    const sourceBConnection = this.unified.sourceB.connection;

    try {
      // Fetch tables for the schema in Source B (via sidecar)
      const tables = await CompareConfigService.fetchTablesViaSidecar(sourceBConnection.name, sourceBConnection, schema);

      const tableExists = tables.some((t) => t.toLowerCase() === table.toLowerCase());

      if (!tableExists) {
        const errorInfo = getActionableErrorMessage(UnifiedErrorType.TABLE_NOT_FOUND, {
          schema,
          table,
          connectionName: sourceBConnection.name,
        });
        this.showUnifiedErrorBanner(errorInfo.title, errorInfo.message, errorInfo.hint);
        return false;
      }

      return true;
    } catch (error) {
      // Schema might not exist - try to give a helpful error
      const { friendlyMessage } = parseOracleError(error.message || error);
      const errorInfo = getActionableErrorMessage(UnifiedErrorType.SCHEMA_NOT_FOUND, {
        schema,
        connectionName: sourceBConnection.name,
      });
      this.showUnifiedErrorBanner(errorInfo.title, errorInfo.message, `${friendlyMessage}`);
      return false;
    }
  }

  // ============================================
  // Phase 5.3: Error Banner Methods
  // ============================================

  /**
   * Shows the unified error banner with actionable error message
   * @param {string} title - Error title
   * @param {string} message - Error message
   * @param {string} hint - Actionable hint
   * @param {'error'|'warning'} type - Banner type
   */
  showUnifiedErrorBanner(title, message, hint, type = "error") {
    const banner = document.getElementById("unified-error-banner");
    if (!banner) return;

    const titleEl = banner.querySelector(".error-banner-title");
    const messageEl = banner.querySelector(".error-banner-message");
    const hintEl = banner.querySelector(".error-banner-hint");
    const dismissBtn = banner.querySelector(".error-banner-dismiss");

    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;
    if (hintEl) {
      hintEl.textContent = hint || "";
      hintEl.style.display = hint ? "block" : "none";
    }

    banner.className = `unified-error-banner ${type}`;
    banner.style.display = "flex";

    // Bind dismiss handler
    if (dismissBtn) {
      dismissBtn.onclick = () => this.hideUnifiedErrorBanner();
    }
  }

  /**
   * Hides the unified error banner
   */
  hideUnifiedErrorBanner() {
    const banner = document.getElementById("unified-error-banner");
    if (banner) {
      banner.style.display = "none";
    }
  }

  /**
   * Shows inline validation message for a source
   * @param {'A'|'B'} source - Source identifier
   * @param {'info'|'error'|'warning'} type - Message type
   * @param {string} message - Validation message
   * @param {string|null} hint - Optional hint
   */
  showUnifiedSourceValidation(source, type, message, hint = null) {
    const id = `source-${source.toLowerCase()}-validation`;
    const el = document.getElementById(id);
    if (!el) return;

    const messageEl = el.querySelector(".validation-message-text");
    const hintEl = el.querySelector(".validation-hint");

    if (messageEl) messageEl.textContent = message;
    if (hintEl) {
      hintEl.textContent = hint || "";
      hintEl.style.display = hint ? "inline" : "none";
    }

    el.className = `inline-validation ${type}`;
    el.style.display = "flex";
  }

  /**
   * Hides inline validation message for a source
   * @param {'A'|'B'} source - Source identifier
   */
  hideUnifiedSourceValidation(source) {
    const id = `source-${source.toLowerCase()}-validation`;
    const el = document.getElementById(id);
    if (el) {
      el.style.display = "none";
    }
  }

  /**
   * Updates inline validation for both sources based on current config
   */
  updateUnifiedSourceValidation() {
    // Validate Source A
    const validationA = validateSourceConfig(this.unified.sourceA, "A", this.unified.sourceB);
    if (validationA) {
      this.showUnifiedSourceValidation("A", validationA.type, validationA.message, validationA.hint);
    } else {
      this.hideUnifiedSourceValidation("A");
    }

    // Validate Source B
    const validationB = validateSourceConfig(this.unified.sourceB, "B", this.unified.sourceA);
    if (validationB) {
      this.showUnifiedSourceValidation("B", validationB.type, validationB.message, validationB.hint);
    } else {
      this.hideUnifiedSourceValidation("B");
    }
  }

  /**
   * Fetch data from a unified source
   */
  async fetchUnifiedSourceData(source) {
    const sourceKey = source === "A" ? "sourceA" : "sourceB";
    let config = this.unified[sourceKey];

    // Phase 1.1: In Oracle vs Oracle follow mode, Source B uses Source A's config
    // with only the connection being different
    if (source === "B" && isSourceBFollowMode(this.unified.sourceA.type, this.unified.sourceB.type)) {
      config = createSourceBConfigFromSourceA(this.unified.sourceA, this.unified.sourceB.connection);
    }

    if (config.type === "oracle") {
      const sourceConfig = {
        type: config.queryMode === "table" ? SourceType.ORACLE_TABLE : SourceType.ORACLE_SQL,
        connection: config.connection,
        schema: config.schema,
        table: config.table,
        sql: config.sql,
        whereClause: config.whereClause,
        maxRows: config.maxRows,
      };
      return await UnifiedDataService.fetchData(sourceConfig);
    } else if (config.type === "excel") {
      // Phase 2: Use selectedExcelFile from multi-file upload
      const excelFile = config.selectedExcelFile?.file;
      if (!excelFile) {
        throw new Error("No Excel file selected");
      }
      // Parse the file if not already parsed
      if (!config.parsedData) {
        config.parsedData = await FileParser.parseFile(excelFile);
      }
      return await UnifiedDataService.fetchData({
        type: SourceType.EXCEL,
        file: excelFile,
        parsedData: config.parsedData,
      });
    }

    throw new Error(`Unknown source type: ${config.type}`);
  }

  /**
   * Update the source preview after data is loaded
   */
  updateUnifiedSourcePreview(source) {
    const sourceKey = source === "A" ? "sourceA" : "sourceB";
    const prefix = `source-${source.toLowerCase()}`;
    const data = this.unified[sourceKey].data;

    const preview = document.getElementById(`${prefix}-preview`);
    const stats = document.getElementById(`${prefix}-stats`);
    const status = document.getElementById(`${prefix}-status`);

    if (preview && data) {
      preview.style.display = "block";
      if (stats) {
        stats.textContent = `${data.metadata.rowCount} rows, ${data.metadata.columnCount} columns`;
      }
    }

    if (status) {
      status.textContent = "Ready";
      status.className = "source-status ready";
    }
  }

  /**
   * Reconcile fields between the two sources
   */
  reconcileUnifiedFields() {
    const dataA = this.unified.sourceA.data;
    const dataB = this.unified.sourceB.data;

    if (!dataA || !dataB) return;

    const reconciled = reconcileColumns(dataA.headers, dataB.headers);

    this.unified.fields = {
      common: reconciled.common,
      commonMapped: reconciled.commonMapped,
      onlyInA: reconciled.onlyInA,
      onlyInB: reconciled.onlyInB,
    };

    // Default: select all common fields for comparison
    this.unified.selectedPkFields = [];
    this.unified.selectedCompareFields = [...reconciled.common];
  }

  /**
   * Show the field reconciliation UI
   */
  showUnifiedFieldReconciliation() {
    const section = document.getElementById("unified-field-reconciliation");
    const loadActions = document.getElementById("unified-load-actions");
    const configChangedBanner = document.getElementById("unified-config-changed-banner");

    if (section) section.style.display = "block";
    if (loadActions) loadActions.style.display = "none";
    if (configChangedBanner) configChangedBanner.style.display = "none";

    // Show column warning if there are differences
    this.updateUnifiedColumnWarning();

    // Render field selection
    this.renderUnifiedFieldSelection();

    // Update compare button state
    this.updateUnifiedCompareButtonState();
  }

  /**
   * Hide the field reconciliation UI
   */
  hideUnifiedFieldReconciliation() {
    const section = document.getElementById("unified-field-reconciliation");
    const loadActions = document.getElementById("unified-load-actions");

    if (section) section.style.display = "none";
    if (loadActions) loadActions.style.display = "flex";
  }

  /**
   * Handle New Comparison for Unified Compare mode (Phase 4)
   * Resets state based on source types:
   * - Excel sources: keep cached files, clear selection
   * - Oracle sources: reset all config
   */
  handleUnifiedNewComparison() {
    // 1. Always clear results
    this.results.unified = null;
    const resultsSection = document.getElementById("results-section");
    if (resultsSection) resultsSection.style.display = "none";

    // 2. Always hide field reconciliation
    this.hideUnifiedFieldReconciliation();

    // 3. Reset field selections
    this.unified.selectedPkFields = [];
    this.unified.selectedCompareFields = [];

    // 4. Reset fields reconciliation state
    this.unified.fields = {
      common: [],
      commonMapped: [],
      onlyInA: [],
      onlyInB: [],
    };

    // 5. Source-specific resets using utility functions
    const sourceAType = this.unified.sourceA.type;
    const sourceBType = this.unified.sourceB.type;

    // Reset Source A based on type
    this.unified.sourceA = createResetSourceState(sourceAType, this.unified.sourceA.excelFiles);

    // Reset Source B based on type
    this.unified.sourceB = createResetSourceState(sourceBType, this.unified.sourceB.excelFiles);

    // 6. Reset UI elements
    this.resetUnifiedSourceUI("A");
    this.resetUnifiedSourceUI("B");

    // 7. Update button states
    this.updateUnifiedLoadButtonState();
    this.updateSourceBFollowModeUI();

    // 8. Scroll to top and save state
    window.scrollTo({ top: 0, behavior: "smooth" });
    this.saveToolState();
  }

  /**
   * Reset UI elements for a unified source (Phase 4)
   * @param {'A'|'B'} source - The source to reset
   */
  resetUnifiedSourceUI(source) {
    const prefix = `source-${source.toLowerCase()}`;
    const sourceKey = source === "A" ? "sourceA" : "sourceB";
    const sourceType = this.unified[sourceKey].type;

    // Hide preview
    const preview = document.getElementById(`${prefix}-preview`);
    if (preview) preview.style.display = "none";

    // Update status and visibility
    this.updateUnifiedSourceConfigVisibility(source);

    if (sourceType === "oracle") {
      // Reset Oracle UI
      const connectionLabel = document.getElementById(`${prefix}-connection-label`);
      const schemaInput = document.getElementById(`${prefix}-schema-search`);
      const schemaDropdown = document.getElementById(`${prefix}-schema-dropdown`);
      const tableInput = document.getElementById(`${prefix}-table-search`);
      const tableDropdown = document.getElementById(`${prefix}-table-dropdown`);
      const whereInput = document.getElementById(`${prefix}-where`);
      const maxRowsInput = document.getElementById(`${prefix}-max-rows`);
      const sqlInput = document.getElementById(`${prefix}-sql`);

      // Reset connection dropdown
      if (connectionLabel) {
        connectionLabel.textContent = "Select connection...";
      }
      // Re-setup dropdown to reset state
      this.setupUnifiedConnectionDropdown(source);

      if (schemaInput) {
        schemaInput.value = "";
        schemaInput.placeholder = "Select connection first...";
        schemaInput.disabled = true;
      }
      if (schemaDropdown) schemaDropdown.innerHTML = "";
      if (tableInput) {
        tableInput.value = "";
        tableInput.placeholder = "Select schema first...";
        tableInput.disabled = true;
      }
      if (tableDropdown) tableDropdown.innerHTML = "";
      if (whereInput) whereInput.value = "";
      if (maxRowsInput) maxRowsInput.value = "100";
      if (sqlInput) sqlInput.value = "";

      // Reset query mode dropdown to table
      const queryModeLabel = document.getElementById(`${prefix}-query-mode-label`);
      const queryModeDropdown = document.getElementById(`${prefix}-query-mode-dropdown`);
      if (queryModeLabel) queryModeLabel.textContent = "By Table";
      if (queryModeDropdown) {
        queryModeDropdown.querySelectorAll(".config-dropdown-option").forEach((opt) => {
          opt.classList.toggle("active", opt.dataset.value === "table");
        });
      }

      // Show table config, hide SQL config
      const tableConfig = document.getElementById(`${prefix}-table-config`);
      const sqlConfig = document.getElementById(`${prefix}-sql-config`);
      if (tableConfig) tableConfig.style.display = "flex";
      if (sqlConfig) sqlConfig.style.display = "none";
    } else if (sourceType === "excel") {
      // For Excel: keep file list visible, clear selection
      const fileSearchInput = document.getElementById(`${prefix}-file-search`);
      if (fileSearchInput) fileSearchInput.value = "";

      // Update the Excel UI to reflect cleared selection but preserved files
      this.updateUnifiedExcelUI(sourceKey);
    }
  }

  /**
   * Update the column mismatch warning
   */
  updateUnifiedColumnWarning() {
    const warningDiv = document.getElementById("unified-column-warning");
    const onlyInADiv = document.getElementById("unified-columns-only-in-a");
    const onlyInBDiv = document.getElementById("unified-columns-only-in-b");

    if (!warningDiv) return;

    const { onlyInA, onlyInB } = this.unified.fields;

    if (onlyInA.length === 0 && onlyInB.length === 0) {
      warningDiv.style.display = "none";
      return;
    }

    warningDiv.style.display = "flex";

    if (onlyInADiv) {
      if (onlyInA.length > 0) {
        onlyInADiv.innerHTML = `<strong>Only in Source A:</strong> ${onlyInA.join(", ")}`;
      } else {
        onlyInADiv.innerHTML = "";
      }
    }

    if (onlyInBDiv) {
      if (onlyInB.length > 0) {
        onlyInBDiv.innerHTML = `<strong>Only in Source B:</strong> ${onlyInB.join(", ")}`;
      } else {
        onlyInBDiv.innerHTML = "";
      }
    }
  }

  /**
   * Render the field selection checkboxes
   */
  renderUnifiedFieldSelection() {
    const pkFieldList = document.getElementById("unified-pk-field-list");
    const compareFieldList = document.getElementById("unified-compare-field-list");

    if (!pkFieldList || !compareFieldList) return;

    const { common } = this.unified.fields;
    const { selectedPkFields, selectedCompareFields, _pkAutoAddedFields } = this.unified;

    // Render PK fields
    pkFieldList.innerHTML = common
      .map(
        (field) => `
      <label class="field-chip">
        <input type="checkbox" name="unified-pk-field" value="${field}"
               ${selectedPkFields.includes(field) ? "checked" : ""}>
        <span>${field}</span>
      </label>
    `,
      )
      .join("");

    // Render compare fields with animation class for newly auto-added PK fields
    compareFieldList.innerHTML = common
      .map((field) => {
        const isAutoAdded = _pkAutoAddedFields.includes(field);
        const animationClass = isAutoAdded ? "pk-auto-added" : "";
        return `
      <label class="field-chip ${animationClass}">
        <input type="checkbox" name="unified-compare-field" value="${field}"
               ${selectedCompareFields.includes(field) ? "checked" : ""}
               ${isAutoAdded ? 'class="pk-synced"' : ""}>
        <span>${field}</span>
      </label>
    `;
      })
      .join("");

    // Clear the auto-added tracking after render (animation will play once)
    if (_pkAutoAddedFields.length > 0) {
      setTimeout(() => {
        this.unified._pkAutoAddedFields = [];
      }, 600);
    }

    // Bind checkbox events
    this.bindUnifiedFieldCheckboxEvents();

    // Update compare button state
    this.updateUnifiedCompareButtonState();
  }

  /**
   * Bind events to field checkboxes
   */
  bindUnifiedFieldCheckboxEvents() {
    // PK checkboxes
    const pkCheckboxes = document.querySelectorAll('input[name="unified-pk-field"]');
    pkCheckboxes.forEach((cb) => {
      cb.addEventListener("change", () => {
        const checked = Array.from(document.querySelectorAll('input[name="unified-pk-field"]:checked')).map((c) => c.value);
        this.unified.selectedPkFields = checked;

        // Phase 1.3: Auto-sync PK fields to comparison fields with tracking for animation
        const { updatedCompareFields, newlyAddedFields } = syncPkFieldsWithTracking(
          this.unified.selectedPkFields,
          this.unified.selectedCompareFields,
        );
        this.unified.selectedCompareFields = updatedCompareFields;
        this.unified._pkAutoAddedFields = newlyAddedFields;

        // Re-render to update the compare field checkboxes
        this.renderUnifiedFieldSelection();
      });
    });

    // Compare field checkboxes
    const fieldCheckboxes = document.querySelectorAll('input[name="unified-compare-field"]');
    fieldCheckboxes.forEach((cb) => {
      cb.addEventListener("change", () => {
        const checked = Array.from(document.querySelectorAll('input[name="unified-compare-field"]:checked')).map((c) => c.value);
        this.unified.selectedCompareFields = checked;
        this.updateUnifiedCompareButtonState();
      });
    });
  }

  /**
   * Update the compare button state
   */
  updateUnifiedCompareButtonState() {
    const compareBtn = document.getElementById("btn-unified-compare");
    if (!compareBtn) return;

    const { selectedPkFields, selectedCompareFields, options } = this.unified;
    const rowMatching = options.rowMatching;

    // Need PK if key-based matching, and always need at least one compare field
    const hasPk = rowMatching === "position" || selectedPkFields.length > 0;
    const hasFields = selectedCompareFields.length > 0;

    compareBtn.disabled = !hasPk || !hasFields;
  }

  /**
   * Execute the unified comparison
   */
  async executeUnifiedComparison() {
    const { sourceA, sourceB, selectedPkFields, selectedCompareFields, options, fields } = this.unified;
    const { rowMatching, dataComparison, normalizeFields } = options;

    console.log("[DEBUG] executeUnifiedComparison called");
    console.log("[DEBUG] this.unified.selectedPkFields:", this.unified.selectedPkFields);
    console.log("[DEBUG] selectedPkFields (destructured):", selectedPkFields);
    console.log("[DEBUG] selectedCompareFields:", selectedCompareFields);
    console.log("[DEBUG] options:", options);
    console.log("[DEBUG] normalizeFields:", normalizeFields);
    console.log("[DEBUG] fields.common:", fields.common);
    console.log("[DEBUG] fields.commonMapped:", fields.commonMapped);

    if (rowMatching === "key" && selectedPkFields.length === 0) {
      this.eventBus.emit("notification:show", {
        type: "warning",
        message: "Please select at least one primary key field.",
      });
      return;
    }

    if (selectedCompareFields.length === 0) {
      this.eventBus.emit("notification:show", {
        type: "warning",
        message: "Please select at least one field to compare.",
      });
      return;
    }

    this.showProgress("Comparing Data");
    this.updateProgressStep("compare", "active", "Comparing records...");

    try {
      const { commonMapped } = fields;
      let rowsA = sourceA.data.rows;
      let rowsB = sourceB.data.rows;
      let pkFields = selectedPkFields;
      let compareFields = selectedCompareFields;

      if (normalizeFields) {
        // Normalize field names to lowercase for case-insensitive matching
        if (commonMapped && commonMapped.length > 0) {
          rowsA = normalizeRowFields(rowsA, commonMapped, "A");
          rowsB = normalizeRowFields(rowsB, commonMapped, "B");
        }
        pkFields = selectedPkFields.map((f) => f.toLowerCase());
        compareFields = selectedCompareFields.map((f) => f.toLowerCase());
      }

      console.log("[DEBUG] pkFields (for comparison):", pkFields);
      console.log("[DEBUG] compareFields (for comparison):", compareFields);
      console.log("[DEBUG] rowsA sample (first row):", rowsA[0]);
      console.log("[DEBUG] rowsB sample (first row):", rowsB[0]);

      const jsResult = compareDatasets(rowsA, rowsB, {
        keyColumns: pkFields,
        fields: compareFields,
        normalize: dataComparison === "normalized",
        matchMode: rowMatching,
      });

      console.log("[DEBUG] jsResult.summary:", jsResult.summary);
      console.log("[DEBUG] jsResult.rows (first 3):", jsResult.rows.slice(0, 3));

      const { convertToViewFormat } = await import("./lib/diff-adapter.js");

      const viewResult = convertToViewFormat(jsResult, {
        env1Name: sourceA.data.metadata.sourceName,
        env2Name: sourceB.data.metadata.sourceName,
        tableName: `${sourceA.data.metadata.sourceName} vs ${sourceB.data.metadata.sourceName}`,
        keyColumns: pkFields,
      });

      // Store metadata about matching options for cache restoration
      viewResult._metadata = {
        keyColumns: pkFields,
        rowMatching: rowMatching,
        compareFields: compareFields,
      };

      this.updateProgressStep("compare", "done", `${viewResult.rows.length} records compared`);

      // Store results
      this.results["unified"] = viewResult;
      this.queryMode = "unified"; // Set queryMode so showResults() finds the results
      this.unified.currentStep = 3;

      await new Promise((r) => setTimeout(r, 400));
      this.hideProgress();
      this.showResults();

      this.eventBus.emit("comparison:complete", viewResult);

      // Save user preferences for this table (for future comparisons)
      await this.saveUnifiedTablePrefsToIndexedDB();

      // Track feature usage: one comparison = one usage
      const comparisonMode = `unified_${sourceA.type}_${sourceB.type}`;
      UsageTracker.trackFeature("compare-config", comparisonMode, {
        rows_compared: viewResult.rows?.length || 0,
        pk_fields: selectedPkFields.length,
        compare_fields: selectedCompareFields.length,
      });
    } catch (error) {
      console.error("Unified comparison failed:", error);
      this.hideProgress();
      this.eventBus.emit("notification:show", {
        type: "error",
        message: `Comparison failed: ${error.message || error}`,
      });

      // Track error for debugging insights (rich error with code, stack)
      const comparisonMode = `unified_${sourceA.type}_${sourceB.type}`;
      UsageTracker.trackEvent(
        "compare-config",
        "comparison_error",
        UsageTracker.enrichErrorMeta(error, { mode: comparisonMode }),
      );
    }
  }
}

export { CompareConfigTool };
