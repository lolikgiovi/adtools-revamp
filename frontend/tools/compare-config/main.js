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

    // Always bind UI events so the installation guide actions work
    this.bindEvents();

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

      // Restore basic state
      this.queryMode = state.queryMode || "schema-table";
      this.schema = state.schema;
      this.table = state.table;
      this.metadata = state.metadata;
      this.customPrimaryKey = state.customPrimaryKey || [];
      this.selectedFields = state.selectedFields || [];
      this.whereClause = state.whereClause || "";
      this.maxRows = state.maxRows || 100;
      this.env2SchemaExists = state.env2SchemaExists || false;
      this.env2TableExists = state.env2TableExists || false;

      this.rawSql = state.rawSql || "";
      this.rawPrimaryKey = state.rawPrimaryKey || "";
      this.rawMaxRows = state.rawMaxRows || 100;

      this.currentView = state.currentView || "expandable";
      this.statusFilter = state.statusFilter;
      this.results = state.results || { "schema-table": null, "raw-sql": null };

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
    if (this.metadata && this.schema && this.table) {
      this.showFieldSelection();
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
    const resultsSection = document.getElementById("results-section");

    if (tab === "schema-table") {
      if (envSelection) envSelection.style.display = "block";
      if (fieldSelection) fieldSelection.style.display = this.metadata ? "block" : "none";
      if (rawSqlMode) rawSqlMode.style.display = "none";
    } else {
      if (envSelection) envSelection.style.display = "none";
      if (fieldSelection) fieldSelection.style.display = "none";
      if (rawSqlMode) rawSqlMode.style.display = "block";
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
          `Schema "${schema}" does not exist in Env 2 (${this.env2.connection.name}). Please select a different schema.`
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
          `⚠️ Table "${this.schema}.${tableName}" does not exist in Env 2 (${this.env2.connection.name}). Please select a different table.`
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
        this.table
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

    // Render PK field checkboxes
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
    this.metadata.columns.forEach((column) => {
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

    // Show field selection section
    fieldSelection.style.display = "block";
  }

  /**
   * Updates custom primary key selection
   */
  updateCustomPrimaryKey() {
    const checkboxes = document.querySelectorAll('#pk-field-list input[type="checkbox"]');
    this.customPrimaryKey = [];

    checkboxes.forEach((checkbox) => {
      if (checkbox.checked) {
        this.customPrimaryKey.push(checkbox.value);
      }
    });
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
   * Executes the comparison
   */
  async executeComparison() {
    // Clear previous results to avoid confusion
    this.resetToEmptyState();

    // Show progress overlay with connection info
    this.showProgress("Comparing Configurations");
    this.updateProgressStep("env1", "active", this.env1.connection?.name || "Env 1");
    this.updateProgressStep("env2", "pending", this.env2.connection?.name || "Env 2");

    // Validate
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
      const result = await CompareConfigService.compareConfigurations(request);

      console.log("[Compare] Result received:", result);
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
    // Clear previous results to avoid confusion
    this.resetToEmptyState();

    // Validate (now async for connection checks)
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
      const result = await CompareConfigService.compareRawSql(request);

      this.results[this.queryMode] = result;

      // Hide loading
      this.hideLoading();

      // Show results
      this.showResults();

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
      } else {
        titleEl.textContent = "Comparison Results";
      }
    }

    // Render summary
    this.renderSummary();

    // Render results content based on current view
    this.renderResults();

    // Show results section
    resultsSection.style.display = "block";

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

    const { summary } = this.results[this.queryMode];

    // Render summary cards as clickable filter buttons
    // Note: Rust CompareSummary uses 'total', 'matches', 'differs'
    summaryContainer.innerHTML = `
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
        <div class="stat-label">Only in ${this.results[this.queryMode].env1_name}</div>
      </button>
      <button class="summary-stat only-env2 ${this.statusFilter === "only_in_env2" ? "selected" : ""}" data-filter="only_in_env2">
        <div class="stat-value">${summary.only_in_env2}</div>
        <div class="stat-label">Only in ${this.results[this.queryMode].env2_name}</div>
      </button>
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

    // Backend returns 'rows' in CompareResult struct
    const rows = this.results[this.queryMode].rows || [];

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
            pkDisplay
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
                this.renderFieldDifferenceSimple(fieldName, env1Data[fieldName], env2Data[fieldName], diffFields.has(fieldName))
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
            `
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
   * Resets the form for a new comparison
   */
  resetForm() {
    // Reset state
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
    this.selectedFields = [];
    this.whereClause = "";
    this.results[this.queryMode] = null;

    // Reset UI
    const env1Connection = document.getElementById("env1-connection");
    const env2Connection = document.getElementById("env2-connection");
    const env1Schema = document.getElementById("env1-schema");
    const env2Schema = document.getElementById("env2-schema");
    const env1Table = document.getElementById("env1-table");
    const env2Table = document.getElementById("env2-table");
    const whereClauseInput = document.getElementById("where-clause");
    const fieldSelection = document.getElementById("field-selection");
    const resultsSection = document.getElementById("results-section");

    if (env1Connection) env1Connection.value = "";
    if (env2Connection) env2Connection.value = "";

    if (env1Schema) {
      env1Schema.disabled = true;
      env1Schema.innerHTML = '<option value="">Select connection first...</option>';
    }

    if (env2Schema) {
      env2Schema.disabled = true;
      env2Schema.innerHTML = '<option value="">Select connection first...</option>';
    }

    if (env1Table) {
      env1Table.disabled = true;
      env1Table.innerHTML = '<option value="">Select schema first...</option>';
    }

    if (env2Table) {
      env2Table.disabled = true;
      env2Table.innerHTML = '<option value="">Select schema first...</option>';
    }

    if (whereClauseInput) whereClauseInput.value = "";
    if (fieldSelection) fieldSelection.style.display = "none";
    if (resultsSection) resultsSection.style.display = "none";

    // Scroll to top
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

      if (activeConnections.length > 0) {
        statusEl.style.display = "flex";
        listEl.innerHTML = activeConnections
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
   * Closes a single connection by connect string and username
   */
  async closeSingleConnection(connectString, username) {
    try {
      await CompareConfigService.closeConnection(connectString, username);
      this.updateConnectionStatus();

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

      if (resultsSection) resultsSection.style.display = "block";
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
}

export { CompareConfigTool };
