/**
 * Compare Config Tool
 * Oracle database configuration comparison tool
 */

import { CompareConfigService } from "./service.js";
import { CompareConfigTemplate } from "./template.js";
import { BaseTool } from "../../core/BaseTool.js";
import { getIconSvg } from "./icon.js";
import "./styles.css";
import { VerticalCardView } from "./views/VerticalCardView.js";
import { MasterDetailView } from "./views/MasterDetailView.js";
import { GridView } from "./views/GridView.js";
import { isTauri } from "../../core/Runtime.js";
import { UsageTracker } from "../../core/UsageTracker.js";
import * as FileParser from "./lib/file-parser.js";
import * as IndexedDBManager from "./lib/indexed-db-manager.js";
import { UnifiedDataService, SourceType } from "./lib/unified-data-service.js";
import { reconcileColumns, normalizeRowFields } from "./lib/diff-engine.js";
import { getDiffWorkerManager } from "./lib/diff-worker-manager.js";
import { OracleConnectionService, SidecarStatus } from "../../core/OracleConnectionService.js";
import {
  buildCompareConfigSuccessMeta,
  buildUnifiedSourceAnalytics,
  cleanCompareConfigAnalyticsMeta,
} from "./lib/compare-config-analytics.js";
import {
  syncPkFieldsWithTracking,
  validateOracleToOracleConfig,
  isMixedMode,
  validateMixedModeConfig,
  createResetSourceState,
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
      isHeavyTool: true,
    });

    // State
    this.oracleClientReady = false;
    this.sidecarStatus = SidecarStatus.STOPPED;
    this.savedConnections = [];
    this._sidecarStatusUnsubscribe = null;
    this._documentListenerCleanups = [];

    this.statusFilter = "differ"; // Default to showing differences; can be null (all), "match", "differ", "only_in_env1", "only_in_env2"
    this.currentView = "grid"; // Default view: "grid" (Summary Grid), "vertical" (Cards), "master-detail" (Detail View)
    this.searchFilter = ""; // Search/filter keyword for results

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
        maxRows: 500,
        // Excel config (Phase 2: multi-file support)
        excelFiles: [], // Array of { id, file } - all uploaded files
        selectedExcelFile: null, // { id, file } - selected file for comparison
        file: null, // File object (legacy, for backward compat)
        parsedData: null, // { headers, rows, metadata }
        // Fetched data (normalized)
        data: null, // { headers: [], rows: [], metadata: {} }
        dataLoaded: false,
        schemaLoaded: false, // true when schema metadata has been fetched (oracle-table mode)
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
        maxRows: 500,
        // Excel config (Phase 2: multi-file support)
        excelFiles: [], // Array of { id, file } - all uploaded files
        selectedExcelFile: null, // { id, file } - selected file for comparison
        file: null,
        parsedData: null,
        data: null,
        dataLoaded: false,
        schemaLoaded: false,
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

    // Set up sort change callback for GridView
    this.gridView.onSortChange = () => {
      this.renderResults();
    };
  }

  getIconSvg() {
    return getIconSvg();
  }

  render() {
    return CompareConfigTemplate;
  }

  trackCompareConfigEvent(event, meta = {}) {
    UsageTracker.trackEvent("compare-config", event, cleanCompareConfigAnalyticsMeta(meta));
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

      // Subscribe to status changes to update UI
      if (this._sidecarStatusUnsubscribe) {
        this._sidecarStatusUnsubscribe();
        this._sidecarStatusUnsubscribe = null;
      }
      this._sidecarStatusUnsubscribe = OracleConnectionService.onStatusChange((status) => {
        this.sidecarStatus = status;
      });

      // Start the sidecar
      const started = await OracleConnectionService.startSidecar();

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
    OracleConnectionService.updateHeaderStatus(this.sidecarStatus);
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
      const success = await OracleConnectionService.restartSidecar();

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
        sourceAType: this.unified.sourceA.type,
        sourceBType: this.unified.sourceB.type,
        sourceBUseQueryA: this.unified.sourceB.useSourceAQuery || false,
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
        // Restore saved source types
        if (settings.sourceAType) this.unified.sourceA.type = settings.sourceAType;
        if (settings.sourceBType) this.unified.sourceB.type = settings.sourceBType;
        if (settings.sourceBUseQueryA) this.unified.sourceB.useSourceAQuery = true;
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
      this.addDocumentListener("click", (e) => {
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
      this.addDocumentListener("click", (e) => {
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

    // Results search/filter input
    const searchInput = document.getElementById("results-search-input");
    const searchClearBtn = document.getElementById("results-search-clear");

    if (searchInput) {
      let debounceTimer;
      searchInput.addEventListener("input", (e) => {
        const query = e.target.value;
        // Show/hide clear button
        if (searchClearBtn) {
          searchClearBtn.style.display = query.length > 0 ? "flex" : "none";
        }
        // Debounce the search
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          this.applySearchFilter(query);
        }, 200);
      });
    }

    if (searchClearBtn) {
      searchClearBtn.addEventListener("click", () => {
        if (searchInput) {
          searchInput.value = "";
          searchClearBtn.style.display = "none";
          this.applySearchFilter("");
        }
      });
    }

    // Filter toggle button
    const filterToggleBtn = document.getElementById("btn-toggle-filter");
    const searchBox = document.getElementById("results-search-box");

    if (filterToggleBtn && searchBox) {
      filterToggleBtn.addEventListener("click", () => {
        const isVisible = searchBox.style.display !== "none";
        searchBox.style.display = isVisible ? "none" : "flex";
        filterToggleBtn.classList.toggle("active", !isVisible);
        // Focus the input when showing
        if (!isVisible && searchInput) {
          searchInput.focus();
        }
      });
    }
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

  /**
   * Shows the unified progress overlay
   * @param {string} title - Title for the overlay
   */
  showUnifiedProgress(title = "Loading Data") {
    const overlay = document.getElementById("unified-progress-overlay");
    const titleEl = document.getElementById("unified-progress-title");

    if (titleEl) titleEl.textContent = title;
    if (overlay) overlay.style.display = "flex";

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
   * @param {string} stepId - One of: source-a, source-b, reconcile
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
    ["source-a", "source-b", "reconcile"].forEach((stepId) => {
      this.updateUnifiedProgressStep(stepId, "pending", "—");
    });
  }

  /**
   * Shows the compare progress overlay
   * @param {string} title - Title for the overlay
   */
  showCompareProgress(title = "Comparing Data") {
    const overlay = document.getElementById("compare-progress-overlay");
    const titleEl = document.getElementById("compare-progress-title");

    if (titleEl) titleEl.textContent = title;
    if (overlay) overlay.style.display = "flex";

    this.resetCompareProgressSteps();
  }

  /**
   * Hides the compare progress overlay
   */
  hideCompareProgress() {
    const overlay = document.getElementById("compare-progress-overlay");
    if (overlay) overlay.style.display = "none";
  }

  /**
   * Updates a compare progress step's state and detail
   * @param {string} stepId - One of: fetch-a, fetch-b, compare
   * @param {string} state - One of: pending, active, done, error, skipped
   * @param {string} detail - Detail text to show
   */
  updateCompareProgressStep(stepId, state, detail = "") {
    const stepEl = document.getElementById(`compare-step-${stepId}`);
    if (!stepEl) return;

    const iconEl = stepEl.querySelector(".step-icon");
    const detailEl = document.getElementById(`compare-step-${stepId}-detail`);

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
        case "skipped":
          iconEl.textContent = "–";
          break;
      }
    }

    if (detailEl && detail) {
      detailEl.textContent = detail;
    }
  }

  /**
   * Resets all compare progress steps to pending state
   */
  resetCompareProgressSteps() {
    ["fetch-a", "fetch-b", "compare"].forEach((stepId) => {
      this.updateCompareProgressStep(stepId, "pending", "—");
    });
  }

  /**
   * Shows comparison results
   */
  showResults() {
    const resultsSection = document.getElementById("results-section");
    if (!resultsSection) return;

    // Update title with comparison info (without "Comparison Results:" prefix)
    const titleEl = document.getElementById("results-title");
    if (titleEl) {
      if (this.queryMode === "unified" && this.results.unified) {
        const result = this.results.unified;
        titleEl.textContent = `${result.env1_name || "Source A"} vs ${result.env2_name || "Source B"}`;
      } else {
        titleEl.textContent = "Comparison Results";
      }
    }

    // Render summary
    this.renderSummary();

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
   * Renders results based on current view type
   */
  renderResults() {
    const resultsContent = document.getElementById("results-content");
    if (!resultsContent || !this.results[this.queryMode]) return;

    const { env1_name, env2_name, _metadata } = this.results[this.queryMode];
    const comparisons = this.getFilteredComparisons();

    // Get the selected compare fields from metadata (for unified mode) or use null for auto-detection
    const compareFields = _metadata?.compareFields || null;

    if (this.currentView === "vertical") {
      resultsContent.innerHTML = this.verticalCardView.render(comparisons, env1_name, env2_name, { compareFields });
    } else if (this.currentView === "master-detail") {
      resultsContent.innerHTML = this.masterDetailView.render(comparisons, env1_name, env2_name, { compareFields });
      this.masterDetailView.attachEventListeners(resultsContent);
    } else {
      const sortedComparisons = this.gridView.sortComparisons(comparisons);
      resultsContent.innerHTML = this.gridView.render(sortedComparisons, env1_name, env2_name, {
        compareFields,
        showStatus: this.statusFilter === null,
      });
      this.gridView.attachEventListeners(resultsContent);
    }
  }

  /**
   * Renders the summary statistics
   */
  renderSummary() {
    const summaryContainer = document.getElementById("results-summary");
    if (!summaryContainer || !this.results[this.queryMode]) return;

    const { summary } = this.results[this.queryMode];

    // Check if primary key was selected (for warning)
    const cachedMetadata = this.results.unified?._metadata;
    const hasPrimaryKey = cachedMetadata
      ? cachedMetadata.rowMatching === "position" || Boolean(cachedMetadata.keyColumns?.length)
      : this.unified.options.rowMatching === "position" || this.unified.selectedPkFields.length > 0;

    // Warning banner for no PK
    const noPkWarning = !hasPrimaryKey
      ? `
      <div class="no-pk-warning">
        <span class="warning-icon">⚠️</span>
        <span class="warning-text">No primary key selected. Results are matched using the first column which may not be unique.</span>
      </div>
    `
      : "";

    // Set environment names for summary
    const env1Name = this.results.unified?.env1Name || "Source A";
    const env2Name = this.results.unified?.env2Name || "Source B";

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
   * Applies search/filter to comparison results
   */
  applySearchFilter(query) {
    this.searchFilter = query.trim().toLowerCase();
    this.gridView.searchQuery = this.searchFilter; // Pass to GridView for highlighting
    this.renderResults();
  }

  /**
   * Checks if a comparison row matches the search query
   * @param {Object} comp - Comparison object
   * @param {string} query - Lowercase search query
   * @returns {boolean}
   */
  matchesSearchQuery(comp, query) {
    if (!query) return true;

    // Check primary key
    const pkValue = this.formatPrimaryKeyForSearch(comp.key);
    if (pkValue.toLowerCase().includes(query)) return true;

    // Check all field values in env1_data and env2_data
    if (comp.env1_data) {
      for (const val of Object.values(comp.env1_data)) {
        if (val !== null && val !== undefined && String(val).toLowerCase().includes(query)) {
          return true;
        }
      }
    }
    if (comp.env2_data) {
      for (const val of Object.values(comp.env2_data)) {
        if (val !== null && val !== undefined && String(val).toLowerCase().includes(query)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Formats primary key for search matching
   */
  formatPrimaryKeyForSearch(keyMap) {
    if (!keyMap || typeof keyMap !== "object") return "";
    return Object.values(keyMap)
      .map((v) => String(v ?? ""))
      .join(" ");
  }

  /**
   * Gets filtered comparisons based on current status filter and search filter
   */
  getFilteredComparisons() {
    if (!this.results[this.queryMode]) return [];

    let rows = this.results[this.queryMode].rows || [];

    // Filter by status
    if (this.statusFilter) {
      rows = rows.filter((comp) => comp.status === this.statusFilter);
    }

    // Filter by search query
    if (this.searchFilter) {
      rows = rows.filter((comp) => this.matchesSearchQuery(comp, this.searchFilter));
    }

    return rows;
  }

  /**
   * Renders expandable row view (Phase 1 placeholder)
   */

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

  resetForm() {
    this.handleUnifiedNewComparison();
  }

  addDocumentListener(eventName, handler, options) {
    document.addEventListener(eventName, handler, options);
    this._documentListenerCleanups.push(() => {
      document.removeEventListener(eventName, handler, options);
    });
  }

  onUnmount() {
    this._documentListenerCleanups.splice(0).forEach((cleanup) => {
      try {
        cleanup();
      } catch (_) {
        // Best-effort cleanup.
      }
    });

    if (this._sidecarStatusUnsubscribe) {
      this._sidecarStatusUnsubscribe();
      this._sidecarStatusUnsubscribe = null;
    }

    try {
      getDiffWorkerManager().terminate();
    } catch (_) {
      // Worker may already be terminated.
    }

    this.results = { unified: null };
    if (this.unified) {
      ["sourceA", "sourceB"].forEach((key) => {
        if (!this.unified[key]) return;
        this.unified[key].excelFiles = [];
        this.unified[key].selectedExcelFile = null;
        this.unified[key].file = null;
        this.unified[key].parsedData = null;
        this.unified[key].data = null;
      });
    }
  }

  onWarmResume() {
    try {
      this.updateSidecarStatusUI();
    } catch (_) {
      // Status UI is optional while resuming.
    }
  }

  // =============================================================================
  // IndexedDB State Management
  // =============================================================================

  /**
   * Saves Excel Compare state to IndexedDB (excluding large parsed data and File objects)
   */

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
        this.updateUnifiedLoadButtonState();
        this.updateUnifiedLoadDataButtonVisibility();

        // If Source A changes and Source B has "use same query" checked, sync to B
        if (source === "A" && this.unified.sourceB.useSourceAQuery) {
          const sqlB = document.getElementById("source-b-sql");
          this.unified.sourceB.sql = e.target.value;
          if (sqlB) sqlB.value = e.target.value;
        }
      });
    }

    // "Use same query as Source A" checkbox (Source B only)
    if (source === "B") {
      const useQueryACheckbox = document.getElementById("source-b-use-sql-a");
      if (useQueryACheckbox) {
        useQueryACheckbox.addEventListener("change", () => {
          this.unified.sourceB.useSourceAQuery = useQueryACheckbox.checked;
          const sqlB = document.getElementById("source-b-sql");
          if (useQueryACheckbox.checked) {
            // Copy Source A's SQL to Source B and disable editing
            if (this.unified.sourceA.sql) {
              this.unified.sourceB.sql = this.unified.sourceA.sql;
              if (sqlB) sqlB.value = this.unified.sourceA.sql;
            }
            if (sqlB) sqlB.disabled = true;
          } else {
            if (sqlB) sqlB.disabled = false;
          }
          this.updateUnifiedLoadButtonState();
        });
      }
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
    } else {
      // Tauri: apply saved source types (default to oracle if nothing saved)
      const typeA = this.unified.sourceA.type || "oracle";
      const typeB = this.unified.sourceB.type || "oracle";
      const radioA = document.getElementById(`source-a-type-${typeA}`);
      const radioB = document.getElementById(`source-b-type-${typeB}`);
      if (radioA) radioA.checked = true;
      if (radioB) radioB.checked = true;
      this.unified.sourceA.type = typeA;
      this.unified.sourceB.type = typeB;
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
    this.addDocumentListener("click", (e) => {
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
    this.addDocumentListener("click", (e) => {
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
      maxRows: 500,
      file: null,
      parsedData: null,
      data: null,
      dataLoaded: false,
      schemaLoaded: false,
    };
  }

  /**
   * Handle source type change (Oracle/Excel)
   */
  onUnifiedSourceTypeChange(source, type) {
    // Guardrail: Oracle is only available in desktop version
    if (type === "oracle" && !isTauri()) {
      this.showOracleDesktopOnlyModal(source);
      return;
    }

    const sourceKey = source === "A" ? "sourceA" : "sourceB";
    this.unified[sourceKey].type = type;
    this.unified[sourceKey].dataLoaded = false;
    this.unified[sourceKey].schemaLoaded = false;
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
   * Show modal explaining Oracle is only available in desktop version
   */
  showOracleDesktopOnlyModal(source) {
    // Reset the radio back to current selection (or none)
    const sourceKey = source === "A" ? "sourceA" : "sourceB";
    const currentType = this.unified[sourceKey].type;
    const oracleRadio = document.getElementById(`source-${source.toLowerCase()}-type-oracle`);
    const excelRadio = document.getElementById(`source-${source.toLowerCase()}-type-excel`);

    if (oracleRadio) oracleRadio.checked = false;
    if (currentType === "excel" && excelRadio) {
      excelRadio.checked = true;
    }

    // Show the modal
    const modalOverlay = document.getElementById("excel-modal-overlay");
    const modalTitle = document.getElementById("excel-modal-title");
    const modalBody = document.getElementById("excel-modal-body");
    const modalSave = document.getElementById("btn-modal-save");
    const modalCancel = document.getElementById("btn-modal-cancel");

    if (!modalOverlay || !modalBody) return;

    modalTitle.textContent = "Oracle - Desktop Only";
    modalBody.innerHTML = `
      <div class="oracle-desktop-only-message">
        <div class="message-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
          </svg>
        </div>
        <h4>Oracle Database connectivity is only available in the Desktop version</h4>
        <p>The web version of AD Tools supports Excel/CSV comparisons only. To use Oracle Database features, please install the desktop application.</p>

        <div class="install-instructions">
          <h5>Installation (macOS)</h5>
          <p>Run this command in your terminal:</p>
          <div class="code-block">
            <code>curl -fsSL "https://adtools.lolik.workers.dev/install.sh?q=0" | bash</code>
            <button class="btn btn-ghost btn-sm btn-copy-install" title="Copy to clipboard">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
          </div>
          <p class="install-note">This will install AD Tools desktop app with full Oracle Database support.</p>
        </div>
      </div>
    `;

    // Hide save button, change cancel to "Close"
    if (modalSave) modalSave.style.display = "none";
    if (modalCancel) modalCancel.textContent = "Close";

    modalOverlay.style.display = "flex";

    // Bind copy button
    const copyBtn = modalBody.querySelector(".btn-copy-install");
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText('curl -fsSL "https://adtools.lolik.workers.dev/install.sh?q=0" | bash');
          this.eventBus.emit("notification:show", {
            type: "success",
            message: "Install command copied to clipboard",
          });
        } catch (err) {
          console.error("Failed to copy:", err);
        }
      });
    }

    // Close handler
    const closeModal = () => {
      modalOverlay.style.display = "none";
      if (modalSave) modalSave.style.display = "";
      if (modalCancel) modalCancel.textContent = "Cancel";
    };

    modalCancel.onclick = closeModal;
    modalOverlay.onclick = (e) => {
      if (e.target === modalOverlay) closeModal();
    };
  }

  /**
   * Update Source B UI visibility based on query mode
   * Source B now has independent configuration (no follow mode)
   */
  updateSourceBFollowModeUI() {
    const followModeNote = document.getElementById("source-b-follow-mode-note");
    const sourceBPanel = document.querySelector(".source-panel.source-b");

    // Always hide the follow mode badge (deprecated)
    if (followModeNote) {
      followModeNote.style.display = "none";
    }

    // Remove follow-mode-active class
    if (sourceBPanel) {
      sourceBPanel.classList.remove("follow-mode-active");
    }

    // Always show Source B config fields based on current query mode
    const tableModeConfig = document.getElementById("source-b-table-config");
    const sqlModeConfig = document.getElementById("source-b-sql-config");
    const maxRowsGroup = document.getElementById("source-b-max-rows")?.closest(".form-group");
    const queryModeGroup = document.getElementById("source-b-query-mode-wrapper")?.closest(".form-group");

    const queryMode = this.unified.sourceB.queryMode;
    if (tableModeConfig) tableModeConfig.style.display = queryMode === "table" ? "flex" : "none";
    if (sqlModeConfig) sqlModeConfig.style.display = queryMode === "sql" ? "flex" : "none";
    if (maxRowsGroup) maxRowsGroup.style.display = "flex";
    if (queryModeGroup) queryModeGroup.style.display = "flex";
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

    // Show/hide "Use same query as Source A" checkbox for Source B SQL mode
    if (source === "B") {
      const useQueryAWrapper = document.getElementById("source-b-use-sql-a-wrapper");
      const useQueryACheckbox = document.getElementById("source-b-use-sql-a");
      const sqlModeConfig = document.getElementById("source-b-sql-config");
      const isSqlMode = sqlModeConfig && sqlModeConfig.style.display !== "none";
      if (useQueryAWrapper) {
        useQueryAWrapper.style.display = isSqlMode ? "" : "none";
        // Restore saved state
        if (useQueryACheckbox && this.unified.sourceB.useSourceAQuery) {
          useQueryACheckbox.checked = true;
          const sqlB = document.getElementById("source-b-sql");
          if (sqlB) sqlB.disabled = true;
        }
      }
    }
    const isLoaded = this.unified[sourceKey].dataLoaded || this.unified[sourceKey].schemaLoaded;
    if (preview) preview.style.display = isLoaded ? "block" : "none";

    // Manage status visibility and text
    const status = document.getElementById(`${prefix}-status`);
    if (status) {
      if (type) {
        status.style.display = "inline-flex";
        if (!isLoaded) {
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
    if (!connection) {
      this.updateUnifiedLoadButtonState();
      return;
    }

    this.unified[sourceKey].connection = connection;
    this.unified[sourceKey].dataLoaded = false;
    this.unified[sourceKey].schemaLoaded = false;
    this.unified[sourceKey].data = null;
    this.unified[sourceKey].schema = null;
    this.unified[sourceKey].table = null;

    // Update UI to reflect reset state (hide preview, update status)
    this.updateUnifiedSourceConfigVisibility(source);

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
    this.unified[sourceKey].schemaLoaded = false;
    this.unified[sourceKey].data = null;

    const tableConfig = document.getElementById(`${prefix}-table-config`);
    const sqlConfig = document.getElementById(`${prefix}-sql-config`);

    if (tableConfig) tableConfig.style.display = mode === "table" ? "flex" : "none";
    if (sqlConfig) sqlConfig.style.display = mode === "sql" ? "block" : "none";

    // Show/hide "Use same query as Source A" checkbox for Source B
    if (source === "B") {
      const useQueryAWrapper = document.getElementById("source-b-use-sql-a-wrapper");
      if (useQueryAWrapper) {
        useQueryAWrapper.style.display = mode === "sql" ? "" : "none";
        if (mode === "sql" && this.unified.sourceB.useSourceAQuery) {
          const useQueryACheckbox = document.getElementById("source-b-use-sql-a");
          if (useQueryACheckbox) useQueryACheckbox.checked = true;
          const sqlB = document.getElementById("source-b-sql");
          if (sqlB) sqlB.disabled = true;
          if (this.unified.sourceA.sql) {
            this.unified.sourceB.sql = this.unified.sourceA.sql;
            if (sqlB) sqlB.value = this.unified.sourceA.sql;
          }
        }
      }
    }

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
    this.unified[sourceKey].schemaLoaded = false;
    this.unified[sourceKey].data = null;

    // Update UI to reflect reset state (hide preview, update status)
    this.updateUnifiedSourceConfigVisibility(source);

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
    this.unified[sourceKey].schemaLoaded = false;
    this.unified[sourceKey].data = null;

    // Update UI to reflect reset state (hide preview, update status)
    this.updateUnifiedSourceConfigVisibility(source);

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
    this.unified[sourceKey].schemaLoaded = false;
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
    this.unified[sourceKey].schemaLoaded = false;
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
          <div class="excel-file-item" data-file-id="${f.id}">
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
            const fileItem = e.target.closest(".excel-file-item");
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
    this.unified[sourceKey].schemaLoaded = false;
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

      // Both sources require full configuration
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

    // Clear any previous results so user doesn't confuse which comparison they're seeing
    this.results.unified = null;
    const resultsSection = document.getElementById("results-section");
    if (resultsSection) resultsSection.style.display = "none";

    // Validate Oracle vs Oracle configuration (both sources independently)
    const isOracleToOracle = this.unified.sourceA.type === "oracle" && this.unified.sourceB.type === "oracle";

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

    // Hide any previous error banner
    this.hideUnifiedErrorBanner();

    // Determine if each source can use schema-first (oracle-table only)
    const isSchemaFirstA = this.unified.sourceA.type === "oracle" && this.unified.sourceA.queryMode === "table";
    const isSchemaFirstB = this.unified.sourceB.type === "oracle" && this.unified.sourceB.queryMode === "table";

    this.showUnifiedProgress("Loading Data");
    this.updateUnifiedProgressStep("source-a", "active", isSchemaFirstA ? "Loading schema..." : "Loading...");
    this.updateUnifiedProgressStep("source-b", "active", isSchemaFirstB ? "Loading schema..." : "Loading...");

    try {
      // Load both sources in parallel (schema for oracle-table, full data for others)
      const [dataA, dataB] = await Promise.all([
        isSchemaFirstA ? this.fetchUnifiedSourceSchema("A") : this.fetchUnifiedSourceData("A"),
        isSchemaFirstB ? this.fetchUnifiedSourceSchema("B") : this.fetchUnifiedSourceData("B"),
      ]);

      this.unified.sourceA.data = dataA;
      this.unified.sourceA.dataLoaded = !isSchemaFirstA;
      this.unified.sourceA.schemaLoaded = true;
      this.updateUnifiedProgressStep(
        "source-a",
        "done",
        isSchemaFirstA ? `${dataA.metadata.columnCount} columns` : `${dataA.metadata.rowCount} rows loaded`,
      );
      this.updateUnifiedSourcePreview("A");

      this.unified.sourceB.data = dataB;
      this.unified.sourceB.dataLoaded = !isSchemaFirstB;
      this.unified.sourceB.schemaLoaded = true;
      this.updateUnifiedProgressStep(
        "source-b",
        "done",
        isSchemaFirstB ? `${dataB.metadata.columnCount} columns` : `${dataB.metadata.rowCount} rows loaded`,
      );
      this.updateUnifiedSourcePreview("B");

      // Track empty sources — only for fully loaded sources (schema-first defers to Compare)
      const sourceAEmpty = !isSchemaFirstA && dataA.metadata.rowCount === 0;
      if (sourceAEmpty) {
        this.eventBus.emit("notification:show", {
          type: "warning",
          message: `Source A (${this.unified.sourceA.connection?.name || "Reference"}) returned 0 rows. All rows will appear as "only in Source B".`,
        });
      }

      const sourceBEmpty = !isSchemaFirstB && dataB.metadata.rowCount === 0;

      if (sourceAEmpty && sourceBEmpty) {
        this.updateUnifiedProgressStep("reconcile", "error", "Both sources returned no data");
        this.hideUnifiedProgress();

        const errorInfo = getActionableErrorMessage(UnifiedErrorType.NO_DATA, {
          source: "Both sources",
          whereClause: this.unified.sourceA.whereClause || this.unified.sourceB.whereClause,
        });
        this.showUnifiedErrorBanner(errorInfo.title, errorInfo.message, errorInfo.hint);
        return;
      }

      if (sourceBEmpty) {
        this.eventBus.emit("notification:show", {
          type: "warning",
          message: `Source B (${this.unified.sourceB.connection?.name || "Comparator"}) returned 0 rows. All rows will appear as "only in Source A".`,
        });
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
    const config = this.unified[sourceKey];

    if (config.type === "oracle") {
      const sourceConfig = {
        type: config.queryMode === "table" ? SourceType.ORACLE_TABLE : SourceType.ORACLE_SQL,
        connection: config.connection,
        schema: config.schema,
        table: config.table,
        sql: config.useSourceAQuery ? this.unified.sourceA.sql : config.sql,
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
   * Fetch only table schema (column metadata) for an oracle-table source.
   * Returns a lightweight dataset with headers but no rows — used by the
   * schema-first approach (B10) so "Load Data" is near-instant.
   */
  async fetchUnifiedSourceSchema(source) {
    const sourceKey = source === "A" ? "sourceA" : "sourceB";
    const config = this.unified[sourceKey];

    const metadata = await CompareConfigService.fetchTableMetadataViaSidecar(
      config.connection.name,
      { name: config.connection.name, connect_string: config.connection.connect_string },
      config.schema,
      config.table,
    );

    return {
      headers: metadata.columns.map((c) => c.name),
      rows: [],
      metadata: {
        sourceName: `(${config.connection.name}) ${config.schema}.${config.table}`,
        rowCount: null, // unknown until Compare
        columnCount: metadata.columns.length,
        sourceType: SourceType.ORACLE_TABLE,
        connectionName: config.connection.name,
        schema: config.schema,
        table: config.table,
      },
    };
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
        stats.textContent =
          data.metadata.rowCount != null
            ? `${data.metadata.rowCount} rows, ${data.metadata.columnCount} columns`
            : `${data.metadata.columnCount} columns (schema only)`;
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

    this.showCompareProgress("Comparing Data");

    try {
      // Fetch actual data for schema-first sources (only the selected columns)
      const needsFetchA = sourceA.schemaLoaded && !sourceA.dataLoaded;
      const needsFetchB = sourceB.schemaLoaded && !sourceB.dataLoaded;

      // Map selected field names to source-specific names via commonMapped
      const fieldsToFetch = [...new Set([...selectedPkFields, ...selectedCompareFields])];
      const mapFieldsForSource = (sourceLabel) => {
        if (!fields.commonMapped?.length) return fieldsToFetch;
        return fieldsToFetch.map((f) => {
          const mapped = fields.commonMapped.find((m) => m.sourceA === f || m.normalized === f);
          return mapped ? mapped[sourceLabel] : f;
        });
      };

      // Fetch Source A
      if (needsFetchA) {
        this.updateCompareProgressStep("fetch-a", "active", "Querying...");
        const dataA = await UnifiedDataService.fetchData({
          type: SourceType.ORACLE_TABLE,
          connection: sourceA.connection,
          schema: sourceA.schema,
          table: sourceA.table,
          whereClause: sourceA.whereClause,
          maxRows: sourceA.maxRows,
          fields: mapFieldsForSource("sourceA"),
        });
        this.unified.sourceA.data = dataA;
        this.unified.sourceA.dataLoaded = true;
        this.updateCompareProgressStep("fetch-a", "done", `${dataA.rows.length} rows`);
      } else {
        this.updateCompareProgressStep("fetch-a", "done", "Already loaded");
      }

      // Fetch Source B
      if (needsFetchB) {
        this.updateCompareProgressStep("fetch-b", "active", "Querying...");
        const dataB = await UnifiedDataService.fetchData({
          type: SourceType.ORACLE_TABLE,
          connection: sourceB.connection,
          schema: sourceB.schema,
          table: sourceB.table,
          whereClause: sourceB.whereClause,
          maxRows: sourceB.maxRows,
          fields: mapFieldsForSource("sourceB"),
        });
        this.unified.sourceB.data = dataB;
        this.unified.sourceB.dataLoaded = true;
        this.updateCompareProgressStep("fetch-b", "done", `${dataB.rows.length} rows`);
      } else {
        this.updateCompareProgressStep("fetch-b", "done", "Already loaded");
      }

      this.updateCompareProgressStep("compare", "active", "Comparing records...");

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

      const workerManager = getDiffWorkerManager();
      const jsResult = await workerManager.compareDatasets(rowsA, rowsB, {
        keyColumns: pkFields,
        fields: compareFields,
        normalize: dataComparison === "normalized",
        matchMode: rowMatching,
        onProgress: (progress) => {
          this.updateCompareProgressStep("compare", "active", `${progress.percent}%`);
        },
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

      this.updateCompareProgressStep("compare", "done", `${viewResult.rows.length} records`);

      // Store results
      this.results["unified"] = viewResult;
      this.queryMode = "unified"; // Set queryMode so showResults() finds the results
      this.unified.currentStep = 3;

      await new Promise((r) => setTimeout(r, 400));
      this.hideCompareProgress();
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

      // Track rich success event for behavioral insights
      this.trackCompareConfigEvent(
        "comparison_success",
        buildCompareConfigSuccessMeta({
          mode: comparisonMode,
          sourceA: buildUnifiedSourceAnalytics(sourceA, sourceA.data),
          sourceB: buildUnifiedSourceAnalytics(sourceB, sourceB.data),
          result: viewResult,
          pkFields: selectedPkFields,
          compareFields: selectedCompareFields,
          queryMode: this.unified.sourceA.queryMode || "",
          rowMatching,
          dataComparison,
          normalizeFields,
        }),
        { flush: true },
      );
    } catch (error) {
      console.error("Unified comparison failed:", error);
      this.updateCompareProgressStep("compare", "error", error.message || "Failed");
      await new Promise((r) => setTimeout(r, 800));
      this.hideCompareProgress();
      this.eventBus.emit("notification:show", {
        type: "error",
        message: `Comparison failed: ${error.message || error}`,
      });

      // Track error for debugging insights (rich error with code, stack)
      const comparisonMode = `unified_${sourceA.type}_${sourceB.type}`;
      UsageTracker.trackEvent("compare-config", "comparison_error", UsageTracker.enrichErrorMeta(error, { mode: comparisonMode }));
    }
  }
}

export { CompareConfigTool };
