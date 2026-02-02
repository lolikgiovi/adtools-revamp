/**
 * Oracle Sidecar Client
 *
 * Client for communicating with the Python Oracle sidecar.
 * The sidecar provides Oracle database connectivity without requiring
 * Oracle Instant Client to be installed.
 *
 * Usage:
 *   import { OracleSidecarClient } from './lib/oracle-sidecar-client.js';
 *
 *   const client = new OracleSidecarClient();
 *   await client.start();
 *
 *   const result = await client.query({
 *     connection: { name: 'DEV', connect_string: 'host:1521/service', username: 'user', password: 'pass' },
 *     sql: 'SELECT * FROM my_table',
 *     max_rows: 1000
 *   });
 */

const SIDECAR_PORT = 21522;
const SIDECAR_BASE_URL = `http://127.0.0.1:${SIDECAR_PORT}`;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Sidecar status enum
 */
export const SidecarStatus = {
  STOPPED: "stopped",
  STARTING: "starting",
  READY: "ready",
  ERROR: "error",
};

/**
 * Check if we're running in Tauri environment
 */
function isTauri() {
  return typeof window !== "undefined" && window.__TAURI_INTERNALS__;
}

/**
 * Oracle Sidecar Client
 */
export class OracleSidecarClient {
  constructor() {
    this._baseUrl = SIDECAR_BASE_URL;
    this._started = false;
    this._status = SidecarStatus.STOPPED;
    this._statusListeners = [];
    this._idleTimer = null;
  }

  /**
   * Reset the idle auto-shutdown timer.
   * After IDLE_TIMEOUT_MS of inactivity the sidecar is stopped automatically.
   * @private
   */
  _resetIdleTimer() {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
    }
    this._idleTimer = setTimeout(() => {
      if (this._status === SidecarStatus.READY) {
        console.log("[OracleSidecar] Idle timeout reached, stopping sidecar");
        this.stop();
      }
    }, IDLE_TIMEOUT_MS);
  }

  /**
   * Get current sidecar status
   */
  get status() {
    return this._status;
  }

  /**
   * Subscribe to status changes
   * @param {function(string): void} listener - Called with new status
   * @returns {function} Unsubscribe function
   */
  onStatusChange(listener) {
    this._statusListeners.push(listener);
    return () => {
      this._statusListeners = this._statusListeners.filter((l) => l !== listener);
    };
  }

  /**
   * Update status and notify listeners
   * @private
   */
  _setStatus(status) {
    if (this._status !== status) {
      this._status = status;
      this._statusListeners.forEach((listener) => {
        try {
          listener(status);
        } catch (e) {
          console.error("Error in status listener:", e);
        }
      });
    }
  }

  /**
   * Start the sidecar process (Tauri only)
   * In development without Tauri, assumes sidecar is running manually
   */
  async start() {
    this._setStatus(SidecarStatus.STARTING);

    if (isTauri()) {
      const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
      try {
        await tauriInvoke("start_oracle_sidecar");
        this._started = true;
        this._setStatus(SidecarStatus.READY);
        this._resetIdleTimer();
        return true;
      } catch (error) {
        console.warn("Failed to start Oracle sidecar via Tauri:", error);
        // Fall through to check if sidecar is running manually
      }
    }

    // Check if sidecar is already running manually (dev mode or Tauri fallback)
    const isRunning = await this.healthCheck();
    if (isRunning) {
      console.log("Oracle sidecar is running (started manually)");
      this._started = true;
      this._setStatus(SidecarStatus.READY);
      this._resetIdleTimer();
      return true;
    }

    // Sidecar not available
    console.warn("Oracle sidecar not running. Start it manually:\n" + "cd tauri/sidecar && python oracle_sidecar.py");
    this._started = false;
    this._setStatus(SidecarStatus.STOPPED);
    return false;
  }

  /**
   * Ensure the sidecar is started, starting it if needed
   * Safe to call multiple times
   */
  async ensureStarted() {
    if (this._status === SidecarStatus.READY) {
      // Verify it's still responding
      const healthy = await this.healthCheck();
      if (healthy) {
        this._resetIdleTimer();
        return true;
      }
    }

    return this.start();
  }

  /**
   * Stop the sidecar process (Tauri only)
   */
  async stop() {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
    if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        await invoke("stop_oracle_sidecar");
        this._started = false;
        this._setStatus(SidecarStatus.STOPPED);
      } catch (error) {
        console.error("Failed to stop Oracle sidecar:", error);
      }
    }
  }

  /**
   * Restart the sidecar process (stop + start)
   * Useful when sidecar crashes or becomes unresponsive
   * @returns {Promise<boolean>} True if restart succeeded
   */
  async restart() {
    console.log("[OracleSidecar] Restarting sidecar...");
    this._setStatus(SidecarStatus.STARTING);

    try {
      // Stop first (ignore errors - sidecar might already be dead)
      await this.stop().catch(() => {});

      // Small delay to ensure cleanup
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Start fresh
      const success = await this.start();
      if (success) {
        console.log("[OracleSidecar] Restart successful");
      }
      return success;
    } catch (error) {
      console.error("[OracleSidecar] Restart failed:", error);
      this._setStatus(SidecarStatus.ERROR);
      return false;
    }
  }

  /**
   * Check if sidecar is ready for queries
   */
  isReady() {
    return this._status === SidecarStatus.READY;
  }

  /**
   * Check if the sidecar is running and healthy
   */
  async healthCheck() {
    try {
      const response = await fetch(`${this._baseUrl}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get sidecar status including pool info
   */
  async getStatus() {
    const response = await fetch(`${this._baseUrl}/health`);
    if (!response.ok) {
      throw new Error("Sidecar not responding");
    }
    return response.json();
  }

  /**
   * Test a database connection
   * @param {Object} connection - Connection config { name, connect_string, username, password }
   */
  async testConnection(connection) {
    const response = await fetch(`${this._baseUrl}/test-connection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connection }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new OracleSidecarError(error.detail || error);
    }

    const result = await response.json();
    this._resetIdleTimer();
    return result;
  }

  /**
   * Execute a SQL query
   * @param {Object} options - Query options
   * @param {Object} options.connection - Connection config { name, connect_string, username, password }
   * @param {string} options.sql - SQL query to execute
   * @param {number} [options.max_rows=1000] - Maximum rows to return
   * @returns {Promise<{columns: string[], rows: any[][], row_count: number, execution_time_ms: number}>}
   */
  async query({ connection, sql, max_rows = 1000 }) {
    const response = await fetch(`${this._baseUrl}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connection, sql, max_rows }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new OracleSidecarError(error.detail || error);
    }

    const result = await response.json();
    this._resetIdleTimer();
    return result;
  }

  /**
   * Execute a SQL query and return results as array of objects
   * @param {Object} options - Query options
   * @param {Object} options.connection - Connection config { name, connect_string, username, password }
   * @param {string} options.sql - SQL query to execute
   * @param {number} [options.max_rows=1000] - Maximum rows to return
   * @returns {Promise<{columns: string[], rows: Object[], row_count: number, execution_time_ms: number}>}
   */
  async queryAsDict({ connection, sql, max_rows = 1000 }) {
    const response = await fetch(`${this._baseUrl}/query-dict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connection, sql, max_rows }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new OracleSidecarError(error.detail || error);
    }

    const result = await response.json();
    this._resetIdleTimer();
    return result;
  }

  /**
   * Execute multiple queries in a single HTTP request (parallel execution on sidecar).
   * @param {Array<{connection: Object, sql: string, max_rows?: number}>} queries
   * @returns {Promise<{results: Array<{columns: string[], rows: any[][], row_count: number, execution_time_ms: number} | {error: string}>}>}
   */
  async queryBatch(queries) {
    const response = await fetch(`${this._baseUrl}/query-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new OracleSidecarError(error.detail || error);
    }

    const result = await response.json();
    this._resetIdleTimer();
    return result;
  }

  /**
   * List active connection pools (for debugging)
   */
  async listPools() {
    const response = await fetch(`${this._baseUrl}/pools`);
    if (!response.ok) {
      throw new Error("Failed to list pools");
    }
    return response.json();
  }
}

/**
 * Error class for Oracle sidecar errors with user-friendly messages
 */
export class OracleSidecarError extends Error {
  constructor(detail) {
    const rawMessage = typeof detail === "string" ? detail : detail.message || "Unknown error";
    const parsed = parseOracleErrorMessage(rawMessage);
    super(parsed.friendlyMessage);
    this.name = "OracleSidecarError";
    this.code = typeof detail === "object" ? detail.code || parsed.code || 0 : parsed.code || 0;
    this.hint = typeof detail === "object" ? detail.hint || parsed.hint : parsed.hint;
    this.rawMessage = rawMessage;
  }
}

/**
 * Parse Oracle error messages and return user-friendly versions
 * @param {string} errorMessage - Raw error message
 * @returns {{code: string|null, friendlyMessage: string, hint: string|null}}
 */
function parseOracleErrorMessage(errorMessage) {
  if (!errorMessage) {
    return { code: null, friendlyMessage: "An unknown error occurred.", hint: null };
  }

  const errorStr = String(errorMessage);

  // Common Oracle error patterns with hints
  const oracleErrors = {
    "ORA-12154": {
      message: "TNS name could not be resolved",
      hint: "Check the connection host/service name is correct.",
    },
    "ORA-12514": {
      message: "Service name not found",
      hint: "Verify the service name exists on the target database.",
    },
    "ORA-12541": {
      message: "No listener at the specified host/port",
      hint: "Check if the database is running and the port is correct.",
    },
    "ORA-12543": {
      message: "Connection refused",
      hint: "The database may be down or blocked by a firewall.",
    },
    "ORA-01017": {
      message: "Invalid username or password",
      hint: "Check your credentials in Settings → Oracle Connections.",
    },
    "ORA-28000": {
      message: "Account is locked",
      hint: "Contact your DBA to unlock the account.",
    },
    "ORA-00942": {
      message: "Table or view does not exist",
      hint: "Check the schema and table name are correct.",
    },
    "ORA-00904": {
      message: "Invalid column name",
      hint: "Verify the column exists in the table.",
    },
    "ORA-01031": {
      message: "Insufficient privileges",
      hint: "Request access from your DBA.",
    },
    "ORA-12170": {
      message: "Connection timed out",
      hint: "The database may be unreachable or slow. Try again.",
    },
    "DPY-6005": {
      message: "Cannot connect to database",
      hint: "Check network connectivity and connection string format.",
    },
    "DPY-4011": {
      message: "Connection closed",
      hint: "The database connection was lost. Try again.",
    },
  };

  for (const [code, info] of Object.entries(oracleErrors)) {
    if (errorStr.includes(code)) {
      return { code, friendlyMessage: info.message, hint: info.hint };
    }
  }

  // Check for timeout patterns
  if (errorStr.toLowerCase().includes("timeout")) {
    return {
      code: "TIMEOUT",
      friendlyMessage: "Connection timed out",
      hint: "The database may be slow or unreachable.",
    };
  }

  // Check for network patterns
  if (errorStr.toLowerCase().includes("network") || errorStr.toLowerCase().includes("socket")) {
    return {
      code: "NETWORK",
      friendlyMessage: "Network error",
      hint: "Check your connection to the database network.",
    };
  }

  // Check for sidecar-specific errors
  if (errorStr.includes("Sidecar not responding") || errorStr.includes("fetch failed")) {
    return {
      code: "SIDECAR",
      friendlyMessage: "Oracle sidecar is not responding",
      hint: "Try restarting the sidecar using the status indicator.",
    };
  }

  return { code: null, friendlyMessage: errorStr, hint: null };
}

/**
 * Singleton instance for convenience
 */
let _instance = null;

export function getOracleSidecarClient() {
  if (!_instance) {
    _instance = new OracleSidecarClient();
  }
  return _instance;
}

export default OracleSidecarClient;
