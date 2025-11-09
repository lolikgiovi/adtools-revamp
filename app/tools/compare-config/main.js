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

class CompareConfigTool extends BaseTool {
  constructor(eventBus) {
    super({
      id: "compare-config",
      name: "Compare Config",
      description: "Compare Oracle database configurations between environments",
      icon: "database-compare",
      category: "database",
      eventBus: eventBus,
    });

    // State
    this.oracleClientReady = false;
    this.savedConnections = [];
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
    this.comparisonResult = null;
    this.currentView = "expandable"; // Default view
    this.statusFilter = null; // null = show all, or "match", "differ", "only_in_env1", "only_in_env2"

    // View instances
    this.verticalCardView = new VerticalCardView();
    this.masterDetailView = new MasterDetailView();
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
   * Populates connection dropdowns
   */
  populateConnectionDropdowns() {
    const env1Select = document.getElementById("env1-connection");
    const env2Select = document.getElementById("env2-connection");

    if (!env1Select || !env2Select) return;

    // Clear existing options (except placeholder)
    env1Select.innerHTML = '<option value="">Select connection...</option>';
    env2Select.innerHTML = '<option value="">Select connection...</option>';

    // Add connections
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
        <button class="btn-primary" id="btn-go-to-settings">Go to Settings</button>
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
      schemaSelect.innerHTML = '<option value="">Error loading schemas</option>';

      this.eventBus.emit("notification:show", {
        type: "error",
        message: `Failed to fetch schemas from Env 1: ${error.message || error}`,
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
      checkbox.checked = column.is_pk; // Pre-check default PK fields

      checkbox.addEventListener("change", () => this.updateCustomPrimaryKey());

      const label = document.createElement("label");
      label.htmlFor = `pk-${column.name}`;
      label.textContent = column.name;
      if (column.is_pk) {
        label.textContent += " (Default PK)";
      }

      fieldDiv.appendChild(checkbox);
      fieldDiv.appendChild(label);
      pkFieldList.appendChild(fieldDiv);
    });

    // Initialize custom PK with default PK fields
    this.customPrimaryKey = this.metadata.primary_key.slice();

    // Render field checkboxes
    this.metadata.columns.forEach((column) => {
      const fieldDiv = document.createElement("div");
      fieldDiv.className = "field-checkbox";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = `field-${column.name}`;
      checkbox.value = column.name;
      checkbox.checked = true; // Pre-check all fields

      checkbox.addEventListener("change", () => this.updateSelectedFields());

      const label = document.createElement("label");
      label.htmlFor = `field-${column.name}`;
      label.textContent = column.name;

      fieldDiv.appendChild(checkbox);
      fieldDiv.appendChild(label);
      fieldList.appendChild(fieldDiv);
    });

    // Initialize selected fields with all fields
    this.selectedFields = this.metadata.columns.map((c) => c.name);

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
  }

  /**
   * Executes the comparison
   */
  async executeComparison() {
    // Validate
    if (!this.validateComparisonRequest()) {
      return;
    }

    try {
      // Show loading
      this.showLoading("Comparing configurations...");

      // Build comparison request
      const request = {
        env1_name: this.env1.connection.name,
        env1_connection: this.env1.connection,
        env1_schema: this.schema,
        env2_name: this.env2.connection.name,
        env2_connection: this.env2.connection,
        env2_schema: this.schema,
        table_name: this.table,
        where_clause: this.whereClause || null,
        custom_primary_key: this.customPrimaryKey,
        fields: this.selectedFields,
      };

      // Execute comparison
      const result = await CompareConfigService.compareConfigurations(request);

      this.comparisonResult = result;

      // Hide loading
      this.hideLoading();

      // Show results
      this.showResults();

      // Emit event
      this.eventBus.emit("comparison:complete", result);
    } catch (error) {
      console.error("Comparison failed:", error);
      this.hideLoading();

      this.eventBus.emit("notification:show", {
        type: "error",
        message: `Comparison failed: ${error.message || error}`,
      });
    }
  }

  /**
   * Validates comparison request
   */
  validateComparisonRequest() {
    if (!this.env1.connection || !this.env2.connection) {
      this.eventBus.emit("notification:show", {
        type: "error",
        message: "Please select connections for both environments",
      });
      return false;
    }

    if (!this.schema) {
      this.eventBus.emit("notification:show", {
        type: "error",
        message: "Please select a schema",
      });
      return false;
    }

    if (!this.table) {
      this.eventBus.emit("notification:show", {
        type: "error",
        message: "Please select a table",
      });
      return false;
    }

    if (!this.env2SchemaExists) {
      this.eventBus.emit("notification:show", {
        type: "error",
        message: `Schema "${this.schema}" does not exist in Env 2`,
      });
      return false;
    }

    if (!this.env2TableExists) {
      this.eventBus.emit("notification:show", {
        type: "error",
        message: `Table "${this.schema}.${this.table}" does not exist in Env 2`,
      });
      return false;
    }

    if (!this.metadata) {
      this.eventBus.emit("notification:show", {
        type: "error",
        message: "Table metadata not loaded",
      });
      return false;
    }

    if (this.selectedFields.length === 0) {
      this.eventBus.emit("notification:show", {
        type: "error",
        message: "Please select at least one field to compare",
      });
      return false;
    }

    return true;
  }

  /**
   * Shows loading state
   */
  showLoading(message = "Loading...") {
    const loadingState = document.getElementById("loading-state");
    const loadingMessage = document.getElementById("loading-message");

    if (loadingState) loadingState.style.display = "flex";
    if (loadingMessage) loadingMessage.textContent = message;
  }

  /**
   * Hides loading state
   */
  hideLoading() {
    const loadingState = document.getElementById("loading-state");
    if (loadingState) loadingState.style.display = "none";
  }

  /**
   * Shows comparison results
   */
  showResults() {
    const resultsSection = document.getElementById("results-section");
    if (!resultsSection) return;

    // Render summary
    this.renderSummary();

    // Render results content based on current view
    this.renderResults();

    // Show results section
    resultsSection.style.display = "block";

    // Scroll to results
    resultsSection.scrollIntoView({ behavior: "smooth" });
  }

  /**
   * Renders results based on current view type
   */
  renderResults() {
    const resultsContent = document.getElementById("results-content");
    if (!resultsContent || !this.comparisonResult) return;

    const { env1_name, env2_name } = this.comparisonResult;
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

      default:
        this.renderExpandableView();
    }
  }

  /**
   * Renders the summary statistics
   */
  renderSummary() {
    const summaryContainer = document.getElementById("results-summary");
    if (!summaryContainer || !this.comparisonResult) return;

    const { summary } = this.comparisonResult;

    // Render summary cards as clickable filter buttons
    summaryContainer.innerHTML = `
      <button class="summary-stat ${this.statusFilter === null ? "selected" : ""}" data-filter="all">
        <div class="stat-value">${summary.total_records}</div>
        <div class="stat-label">Total Records</div>
      </button>
      <button class="summary-stat matching ${this.statusFilter === "match" ? "selected" : ""}" data-filter="match">
        <div class="stat-value">${summary.matching}</div>
        <div class="stat-label">Matching</div>
      </button>
      <button class="summary-stat differing ${this.statusFilter === "differ" ? "selected" : ""}" data-filter="differ">
        <div class="stat-value">${summary.differing}</div>
        <div class="stat-label">Differing</div>
      </button>
      <button class="summary-stat only-env1 ${this.statusFilter === "only_in_env1" ? "selected" : ""}" data-filter="only_in_env1">
        <div class="stat-value">${summary.only_in_env1}</div>
        <div class="stat-label">Only in ${this.comparisonResult.env1_name}</div>
      </button>
      <button class="summary-stat only-env2 ${this.statusFilter === "only_in_env2" ? "selected" : ""}" data-filter="only_in_env2">
        <div class="stat-value">${summary.only_in_env2}</div>
        <div class="stat-label">Only in ${this.comparisonResult.env2_name}</div>
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
    if (!this.comparisonResult) return [];

    const { comparisons } = this.comparisonResult;

    // If no filter, return all comparisons
    if (!this.statusFilter) {
      return comparisons;
    }

    // Filter by status
    return comparisons.filter((comp) => comp.status === this.statusFilter);
  }

  /**
   * Renders expandable row view (Phase 1 placeholder)
   */
  renderExpandableView() {
    const resultsContent = document.getElementById("results-content");
    if (!resultsContent || !this.comparisonResult) return;

    const { env1_name, env2_name } = this.comparisonResult;
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
              <th>Actions</th>
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
  }

  /**
   * Renders a single comparison row
   */
  renderComparisonRow(comparison, index, env1Name, env2Name) {
    const statusClass = comparison.status.toLowerCase().replace("_", "-");
    const statusLabel = this.getStatusLabel(comparison.status);
    const statusBadge = `<span class="status-badge status-${statusClass}">${statusLabel}</span>`;

    return `
      <tr class="comparison-row" data-row-id="${index}">
        <td>
          <button class="btn-expand" data-row-id="${index}" title="Expand/Collapse">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </td>
        <td class="pk-cell">${this.escapeHtml(comparison.primary_key)}</td>
        <td>${statusBadge}</td>
        <td>
          <button class="btn-icon" onclick="navigator.clipboard.writeText('${this.escapeHtml(comparison.primary_key)}')" title="Copy PK">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
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

    // Status is 'differ' - show field-by-field comparison
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
            ${comparison.differences.map((diff) => this.renderFieldDifference(diff)).join("")}
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
  }

  /**
   * Exports comparison results
   */
  async exportResults(format) {
    if (!this.comparisonResult) {
      this.eventBus.emit("notification:show", {
        type: "error",
        message: "No comparison results to export",
      });
      return;
    }

    try {
      const filepath = await CompareConfigService.exportComparisonResult(this.comparisonResult, format);

      this.eventBus.emit("notification:show", {
        type: "success",
        message: `Results exported to: ${filepath}`,
      });

      this.eventBus.emit("comparison:exported", { filepath, format });
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
    this.comparisonResult = null;

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
  }

  onUnmount() {
    // Cleanup if needed
  }
}

export { CompareConfigTool };
