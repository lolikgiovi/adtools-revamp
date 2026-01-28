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

const SIDECAR_PORT = 21521;
const SIDECAR_BASE_URL = `http://127.0.0.1:${SIDECAR_PORT}`;

/**
 * Check if we're running in Tauri environment
 */
function isTauri() {
  return typeof window !== 'undefined' && window.__TAURI_INTERNALS__;
}

/**
 * Oracle Sidecar Client
 */
export class OracleSidecarClient {
  constructor() {
    this._baseUrl = SIDECAR_BASE_URL;
    this._started = false;
  }

  /**
   * Start the sidecar process (Tauri only)
   * In development without Tauri, assumes sidecar is running manually
   */
  async start() {
    if (isTauri()) {
      const { invoke } = await import('@anthropic-ai/anthropic-sdk/internal/shim/web-runtime/fetch.mjs');
      const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
      try {
        await tauriInvoke('start_oracle_sidecar');
        this._started = true;
      } catch (error) {
        console.error('Failed to start Oracle sidecar:', error);
        throw new Error(`Failed to start Oracle sidecar: ${error}`);
      }
    } else {
      // In dev mode without Tauri, check if sidecar is already running
      const isRunning = await this.healthCheck();
      if (!isRunning) {
        console.warn(
          'Oracle sidecar not running. Start it manually:\n' +
            'cd tauri/sidecar && python oracle_sidecar.py'
        );
      }
      this._started = isRunning;
    }
    return this._started;
  }

  /**
   * Stop the sidecar process (Tauri only)
   */
  async stop() {
    if (isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      try {
        await invoke('stop_oracle_sidecar');
        this._started = false;
      } catch (error) {
        console.error('Failed to stop Oracle sidecar:', error);
      }
    }
  }

  /**
   * Check if the sidecar is running and healthy
   */
  async healthCheck() {
    try {
      const response = await fetch(`${this._baseUrl}/health`, {
        method: 'GET',
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
      throw new Error('Sidecar not responding');
    }
    return response.json();
  }

  /**
   * Test a database connection
   * @param {Object} connection - Connection config { name, connect_string, username, password }
   */
  async testConnection(connection) {
    const response = await fetch(`${this._baseUrl}/test-connection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connection }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new OracleSidecarError(error.detail || error);
    }

    return response.json();
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connection, sql, max_rows }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new OracleSidecarError(error.detail || error);
    }

    return response.json();
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connection, sql, max_rows }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new OracleSidecarError(error.detail || error);
    }

    return response.json();
  }

  /**
   * List active connection pools (for debugging)
   */
  async listPools() {
    const response = await fetch(`${this._baseUrl}/pools`);
    if (!response.ok) {
      throw new Error('Failed to list pools');
    }
    return response.json();
  }
}

/**
 * Error class for Oracle sidecar errors
 */
export class OracleSidecarError extends Error {
  constructor(detail) {
    const message = typeof detail === 'string' ? detail : detail.message || 'Unknown error';
    super(message);
    this.name = 'OracleSidecarError';
    this.code = typeof detail === 'object' ? detail.code || 0 : 0;
    this.hint = typeof detail === 'object' ? detail.hint : null;
  }
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
