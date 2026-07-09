import { getOracleSidecarClient, OracleSidecarError, SidecarStatus } from "./oracle-sidecar-client.js";

export { OracleSidecarError, SidecarStatus };

export class OracleConnectionService {
  static _headerStatusUnsubscribe = null;

  static getSidecarClient() {
    return getOracleSidecarClient();
  }

  static getSidecarStatus() {
    return this.getSidecarClient().status;
  }

  static onStatusChange(listener, { emitCurrent = true } = {}) {
    const client = this.getSidecarClient();
    if (emitCurrent) {
      listener(client.status);
    }
    return client.onStatusChange(listener);
  }

  static async startSidecar() {
    return this.getSidecarClient().start();
  }

  static async ensureSidecarStarted() {
    return this.getSidecarClient().ensureStarted();
  }

  static isSidecarReady() {
    return this.getSidecarClient().isReady();
  }

  static async restartSidecar() {
    return this.getSidecarClient().restart();
  }

  static async getOracleCredentials(name) {
    return this.invokeTauri("get_oracle_credentials", { name });
  }

  static async setOracleCredentials(name, username, password) {
    return this.invokeTauri("set_oracle_credentials", { name, username, password });
  }

  static async deleteOracleCredentials(name) {
    return this.invokeTauri("delete_oracle_credentials", { name });
  }

  static async hasOracleCredentials(name) {
    return this.invokeTauri("has_oracle_credentials", { name });
  }

  static async invokeTauri(command, args) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke(command, args);
  }

  static async buildSidecarConnection(connectionName, config) {
    const [username, password] = await this.getOracleCredentials(connectionName);
    return {
      name: config.name || connectionName,
      connect_string: config.connect_string,
      username,
      password,
    };
  }

  static async testConnectionWithCredentials(connection) {
    const started = await this.ensureSidecarStarted();
    if (!started) {
      throw new OracleSidecarError("Sidecar not responding");
    }
    return this.getSidecarClient().testConnection(connection);
  }

  static async testConnectionViaSidecar(connectionName, config) {
    const connection = await this.buildSidecarConnection(connectionName, config);
    return this.testConnectionWithCredentials(connection);
  }

  static async queryViaSidecar(connectionName, config, sql, maxRows = 1000) {
    const connection = await this.buildSidecarConnection(connectionName, config);
    return this.queryWithConnection(connection, sql, maxRows);
  }

  static async queryWithConnection(connection, sql, maxRows = 1000) {
    const started = await this.ensureSidecarStarted();
    if (!started) {
      throw new OracleSidecarError("Sidecar not responding");
    }
    return this.getSidecarClient().query({ connection, sql, max_rows: maxRows });
  }

  static async queryAsDictViaSidecar(connectionName, config, sql, maxRows = 1000) {
    const started = await this.ensureSidecarStarted();
    if (!started) {
      throw new OracleSidecarError("Sidecar not responding");
    }
    const connection = await this.buildSidecarConnection(connectionName, config);
    return this.getSidecarClient().queryAsDict({ connection, sql, max_rows: maxRows });
  }

  static async queryBatchViaSidecar(queries) {
    const started = await this.ensureSidecarStarted();
    if (!started) {
      throw new OracleSidecarError("Sidecar not responding");
    }

    const queryRequests = await Promise.all(
      queries.map(async ({ connection_name, config, sql, max_rows = 1000 }) => {
        const connection = await this.buildSidecarConnection(connection_name, config);
        return { connection, sql, max_rows };
      }),
    );

    return this.getSidecarClient().queryBatch(queryRequests);
  }

  static updateHeaderStatus(status = this.getSidecarStatus()) {
    const statusIndicator = document.getElementById("sidecar-status-indicator");
    if (!statusIndicator) return;

    const statusText = statusIndicator.querySelector(".status-text");
    const statusDot = statusIndicator.querySelector(".status-dot");
    const restartBtn = statusIndicator.querySelector("#btn-sidecar-restart");

    if (statusText) {
      switch (status) {
        case SidecarStatus.STARTING:
          statusText.textContent = "Oracle: Starting...";
          break;
        case SidecarStatus.READY:
          statusText.textContent = "Oracle: Connected";
          break;
        case SidecarStatus.ERROR:
          statusText.textContent = "Oracle: Error";
          break;
        default:
          statusText.textContent = "Oracle: Disconnected";
      }
    }

    if (statusDot) {
      statusDot.classList.remove("starting", "ready", "error", "stopped");
      statusDot.classList.add(status || SidecarStatus.STOPPED);
    }

    if (restartBtn) {
      const showRestart = status === SidecarStatus.ERROR || status === SidecarStatus.STOPPED;
      restartBtn.style.display = showRestart ? "flex" : "none";
    }
  }

  static bindHeaderStatus({ eventBus } = {}) {
    this.updateHeaderStatus();

    if (!this._headerStatusUnsubscribe) {
      this._headerStatusUnsubscribe = this.onStatusChange((status) => {
        this.updateHeaderStatus(status);
      }, { emitCurrent: false });
    }

    const restartBtn = document.getElementById("btn-sidecar-restart");
    if (!restartBtn || restartBtn.dataset.oracleStatusBound === "true") return;

    restartBtn.dataset.oracleStatusBound = "true";
    restartBtn.addEventListener("click", async () => {
      restartBtn.disabled = true;
      try {
        const success = await this.restartSidecar();
        eventBus?.emit?.("notification:show", {
          type: success ? "success" : "error",
          message: success ? "Oracle sidecar restarted successfully" : "Failed to restart Oracle sidecar. Try restarting the app.",
        });
      } catch (error) {
        console.error("Sidecar restart error:", error);
        eventBus?.emit?.("notification:show", {
          type: "error",
          message: "Failed to restart Oracle sidecar",
        });
      } finally {
        restartBtn.disabled = false;
      }
    });
  }
}
