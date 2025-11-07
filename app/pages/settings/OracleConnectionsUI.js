/**
 * Oracle Connections UI Component
 *
 * Provides UI for managing Oracle database connections in Settings page
 */

import { invoke } from "@tauri-apps/api/core";

export class OracleConnectionsUI {
  constructor({ eventBus }) {
    this.eventBus = eventBus;
    this.connections = [];
  }

  /**
   * Renders the Oracle connections management UI
   * @param {HTMLElement} container - Container element to render into
   * @param {Array} connections - Array of connection configurations
   */
  async render(container, connections = []) {
    this.connections = Array.isArray(connections) ? connections : [];
    this.container = container; // Store container reference

    // Ensure Oracle client is primed before rendering
    // This is critical for connection testing to work
    try {
      await invoke("prime_oracle_client");
      console.log("Oracle client primed successfully");
    } catch (error) {
      console.warn("Failed to prime Oracle client:", error);
    }

    // Remove old event listener before re-rendering
    if (this.clickHandler) {
      container.removeEventListener("click", this.clickHandler);
    }

    container.innerHTML = `
      <div class="oracle-connections-ui">
        <div class="oracle-connections-list">
          ${this.renderConnectionsList()}
        </div>
        <div class="oracle-connection-form" style="display: none;">
          ${this.renderConnectionForm()}
        </div>
      </div>
    `;

    this.attachEventListeners(container);
  }

  renderConnectionsList() {
    if (this.connections.length === 0) {
      return `
        <div class="empty-state">
          <p>No Oracle connections configured.</p>
          <button type="button" class="btn btn-primary" data-action="add-connection">
            + Add New Connection
          </button>
        </div>
      `;
    }

    return `
      <table class="connections-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Host</th>
            <th>Port</th>
            <th>Service</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${this.connections.map((conn, index) => this.renderConnectionRow(conn, index)).join("")}
        </tbody>
      </table>
      <div class="oracle-connections-actions">
        <button type="button" class="btn btn-primary" data-action="add-connection">
          + Add New Connection
        </button>
      </div>
    `;
  }

  renderConnectionRow(conn, index) {
    const hasCredentials = conn.has_credentials || false;
    const statusClass = hasCredentials ? "status-active" : "status-missing";
    const statusText = hasCredentials ? "Saved" : "No Credentials";

    return `
      <tr data-connection-index="${index}">
        <td><strong>${this.escapeHtml(conn.name)}</strong></td>
        <td>${this.escapeHtml(conn.host)}</td>
        <td>${conn.port}</td>
        <td>${this.escapeHtml(conn.service_name)}</td>
        <td><span class="connection-status ${statusClass}">${statusText}</span></td>
        <td class="actions-cell">
          <button type="button" class="btn btn-sm btn-secondary" data-action="test-connection" data-index="${index}">
            Test
          </button>
          <button type="button" class="btn btn-sm btn-secondary" data-action="edit-connection" data-index="${index}">
            Edit
          </button>
          <button type="button" class="btn btn-sm btn-danger" data-action="delete-connection" data-index="${index}">
            Delete
          </button>
        </td>
      </tr>
    `;
  }

  renderConnectionForm() {
    return `
      <h4 class="form-title">Oracle Connection</h4>
      <div class="form-group">
        <label for="oracle-conn-name">Connection Name *</label>
        <input type="text" id="oracle-conn-name" class="form-input" placeholder="e.g., UAT1" required>
        <small>User-friendly name for this connection</small>
      </div>
      <div class="form-group">
        <label for="oracle-conn-host">Host *</label>
        <input type="text" id="oracle-conn-host" class="form-input" placeholder="e.g., db-uat1.company.com" required>
      </div>
      <div class="form-group">
        <label for="oracle-conn-port">Port *</label>
        <input type="number" id="oracle-conn-port" class="form-input" value="1521" required>
      </div>
      <div class="form-group">
        <label for="oracle-conn-service">Service Name *</label>
        <input type="text" id="oracle-conn-service" class="form-input" placeholder="e.g., ORCLPDB1" required>
      </div>
      <div class="form-group">
        <label for="oracle-conn-username">Username *</label>
        <input type="text" id="oracle-conn-username" class="form-input" placeholder="Database username" required>
        <small>Stored securely in macOS Keychain</small>
      </div>
      <div class="form-group">
        <label for="oracle-conn-password">Password *</label>
        <input type="password" id="oracle-conn-password" class="form-input" placeholder="Database password" required>
        <small>Stored securely in macOS Keychain</small>
      </div>
      <div class="form-status" style="display: none;"></div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" data-action="cancel-form">Cancel</button>
        <button type="button" class="btn btn-primary" data-action="save-connection">Save Connection</button>
      </div>
    `;
  }

  attachEventListeners(container) {
    // Store the handler so we can remove it later
    this.clickHandler = async (e) => {
      const action = e.target.getAttribute("data-action");
      if (!action) return;

      const index = parseInt(e.target.getAttribute("data-index"), 10);

      switch (action) {
        case "add-connection":
          this.showConnectionForm(container);
          break;
        case "edit-connection":
          this.showConnectionForm(container, this.connections[index]);
          break;
        case "delete-connection":
          await this.deleteConnection(container, index);
          break;
        case "test-connection":
          await this.testConnection(container, index);
          break;
        case "save-connection":
          await this.saveConnection(container);
          break;
        case "cancel-form":
          this.hideConnectionForm(container);
          break;
      }
    };

    container.addEventListener("click", this.clickHandler);
  }

  showConnectionForm(container, connection = null) {
    const form = container.querySelector(".oracle-connection-form");
    const list = container.querySelector(".oracle-connections-list");

    // Populate form if editing
    if (connection) {
      container.querySelector("#oracle-conn-name").value = connection.name || "";
      container.querySelector("#oracle-conn-host").value = connection.host || "";
      container.querySelector("#oracle-conn-port").value = connection.port || 1521;
      container.querySelector("#oracle-conn-service").value = connection.service_name || "";
      container.querySelector("#oracle-conn-username").value = "";
      container.querySelector("#oracle-conn-password").value = "";
      form.querySelector(".form-title").textContent = `Edit Connection: ${connection.name}`;
    } else {
      container.querySelector("#oracle-conn-name").value = "";
      container.querySelector("#oracle-conn-host").value = "";
      container.querySelector("#oracle-conn-port").value = "1521";
      container.querySelector("#oracle-conn-service").value = "";
      container.querySelector("#oracle-conn-username").value = "";
      container.querySelector("#oracle-conn-password").value = "";
      form.querySelector(".form-title").textContent = "Add New Connection";
    }

    form.style.display = "block";
    list.style.display = "none";
    container.querySelector("#oracle-conn-name").focus();
  }

  hideConnectionForm(container) {
    const form = container.querySelector(".oracle-connection-form");
    const list = container.querySelector(".oracle-connections-list");

    form.style.display = "none";
    list.style.display = "block";

    // Clear status
    const status = form.querySelector(".form-status");
    status.style.display = "none";
    status.textContent = "";
  }

  async saveConnection(container) {
    const name = container.querySelector("#oracle-conn-name").value.trim();
    const host = container.querySelector("#oracle-conn-host").value.trim();
    const port = parseInt(container.querySelector("#oracle-conn-port").value, 10);
    const serviceName = container.querySelector("#oracle-conn-service").value.trim();
    const username = container.querySelector("#oracle-conn-username").value.trim();
    const password = container.querySelector("#oracle-conn-password").value.trim();

    // Validation
    if (!name || !host || !port || !serviceName || !username || !password) {
      this.showFormStatus(container, "error", "All fields are required");
      return;
    }

    // Check if name already exists (for new connections)
    const existing = this.connections.find((c) => c.name === name);
    const isEdit = !!existing;

    try {
      // Save credentials to keychain
      await invoke("set_oracle_credentials", { name, username, password });

      // Save connection config
      const connectionConfig = { name, host, port, service_name: serviceName, has_credentials: true };

      if (isEdit) {
        // Update existing connection
        const index = this.connections.findIndex((c) => c.name === name);
        this.connections[index] = connectionConfig;
      } else {
        // Add new connection
        this.connections.push(connectionConfig);
      }

      // Persist to localStorage
      localStorage.setItem("config.oracle.connections", JSON.stringify(this.connections));

      this.showFormStatus(container, "success", isEdit ? "Connection updated successfully!" : "Connection saved successfully!");

      setTimeout(() => {
        this.hideConnectionForm(container);
        this.render(container, this.connections);
        this.eventBus?.emit?.("notification:success", {
          message: isEdit ? "Oracle connection updated" : "Oracle connection added",
        });
      }, 1000);
    } catch (error) {
      this.showFormStatus(container, "error", `Failed to save connection: ${error}`);
    }
  }

  async deleteConnection(container, index) {
    const connection = this.connections[index];
    if (!connection) return;

    if (!confirm(`Are you sure you want to delete the connection "${connection.name}"?`)) {
      return;
    }

    try {
      // Delete credentials from keychain
      await invoke("delete_oracle_credentials", { name: connection.name });

      // Remove from list
      this.connections.splice(index, 1);

      // Persist to localStorage
      localStorage.setItem("config.oracle.connections", JSON.stringify(this.connections));

      // Re-render
      this.render(container, this.connections);

      this.eventBus?.emit?.("notification:success", { message: `Connection "${connection.name}" deleted` });
    } catch (error) {
      this.eventBus?.emit?.("notification:error", { message: `Failed to delete connection: ${error}` });
    }
  }

  async testConnection(container, index) {
    const connection = this.connections[index];
    if (!connection) return;

    // Find the button - need to re-query in case DOM was updated
    const button = container.querySelector(`[data-action="test-connection"][data-index="${index}"]`);
    if (!button) {
      console.error("Test button not found");
      return;
    }

    const originalText = button.textContent;

    try {
      button.disabled = true;
      button.textContent = "Testing...";

      // Get credentials from keychain
      const [username, password] = await invoke("get_oracle_credentials", { name: connection.name });

      // Build connection config
      const config = {
        name: connection.name,
        host: connection.host,
        port: connection.port,
        service_name: connection.service_name,
      };

      // Test connection
      const result = await invoke("test_oracle_connection", { config, username, password });

      this.eventBus?.emit?.("notification:success", { message: result });

      // Re-query button after potential DOM updates
      const currentButton = container.querySelector(`[data-action="test-connection"][data-index="${index}"]`);
      if (currentButton) {
        currentButton.disabled = false;
        currentButton.textContent = originalText;
      }
    } catch (error) {
      this.eventBus?.emit?.("notification:error", { message: `Connection test failed: ${error}` });

      // Re-query button after potential DOM updates
      const currentButton = container.querySelector(`[data-action="test-connection"][data-index="${index}"]`);
      if (currentButton) {
        currentButton.disabled = false;
        currentButton.textContent = originalText;
      }
    }
  }

  showFormStatus(container, type, message) {
    const status = container.querySelector(".form-status");
    status.textContent = message;
    status.className = `form-status ${type === "error" ? "error" : "success"}`;
    status.style.display = "block";
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Extracts current connections from the UI
   * @returns {Array} Array of connection configurations
   */
  getValue() {
    return this.connections;
  }
}
