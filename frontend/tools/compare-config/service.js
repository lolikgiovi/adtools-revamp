/**
 * Compare Config Service
 * Handles communication with the Tauri backend for Oracle operations
 *
 * Phase 1: Added sidecar-based methods for Oracle connectivity.
 * The sidecar approach uses Python + oracledb in thin mode,
 * avoiding the need to bundle Oracle Instant Client.
 */

import { invoke } from "@tauri-apps/api/core";
import { OracleConnectionService, OracleSidecarError } from "../../core/OracleConnectionService.js";
import {
  generateQueryCacheKey,
  getQueryCache,
  setQueryCache,
} from './lib/indexed-db-manager.js';

export class CompareConfigService {
  // NOTE: checkOracleClientReady, primeOracleClient, and debugOracleSetup
  // were removed in Phase 4.10. Oracle operations now use the Python sidecar.

  /**
   * Tests an Oracle database connection
   * @param {Object} config - Connection configuration
   * @param {string} username - Database username
   * @param {string} password - Database password
   * @returns {Promise<string>} Success message
   */
  static async testConnection(config, username, password) {
    return await invoke("test_oracle_connection", {
      config,
      username,
      password,
    });
  }

  /**
   * Fetches available schemas from the database
   * @param {string} connectionName - Connection name (for credential lookup)
   * @param {Object} config - Connection configuration
   * @returns {Promise<string[]>} List of schema names
   */
  static async fetchSchemas(connectionName, config) {
    return await invoke("fetch_schemas", {
      connectionName,
      config,
    });
  }

  /**
   * Fetches tables for a specific schema
   * @param {string} connectionName - Connection name (for credential lookup)
   * @param {Object} config - Connection configuration
   * @param {string} owner - Schema/owner name
   * @returns {Promise<string[]>} List of table names
   */
  static async fetchTables(connectionName, config, owner) {
    return await invoke("fetch_tables", {
      connectionName,
      config,
      owner,
    });
  }

  /**
   * Fetches metadata for a specific table
   * @param {string} connectionName - Connection name (for credential lookup)
   * @param {Object} config - Connection configuration
   * @param {string} owner - Schema/owner name
   * @param {string} tableName - Table name
   * @returns {Promise<Object>} Table metadata
   */
  static async fetchTableMetadata(connectionName, config, owner, tableName) {
    return await invoke("fetch_table_metadata", {
      connectionName,
      config,
      owner,
      tableName,
    });
  }

  // Phase 6.4: compareConfigurations and compareRawSql methods removed.
  // Use fetchOracleData + frontend JS compareDatasets() instead.

  /**
   * Fetches Oracle data for unified comparison (data-only, no comparison)
   * This is used for mixed source comparisons (Oracle vs Excel)
   * @param {Object} request - Fetch data request
   * @param {string} request.connection_name - Connection name (for credential lookup)
   * @param {Object} request.config - Connection configuration
   * @param {string} request.mode - "table" or "raw-sql"
   * @param {string} [request.owner] - Schema/owner (table mode)
   * @param {string} [request.table_name] - Table name (table mode)
   * @param {string} [request.where_clause] - WHERE clause (table mode)
   * @param {string[]} [request.fields] - Fields to select (table mode)
   * @param {string} [request.sql] - SQL query (raw-sql mode)
   * @param {number} [request.max_rows] - Maximum rows to fetch
   * @returns {Promise<{headers: string[], rows: Object[], row_count: number, source_name: string}>}
   */
  static async fetchOracleData(request) {
    return await invoke("fetch_oracle_data", {
      request,
    });
  }

  /**
   * Exports comparison results to a file
   * @param {Object} result - Comparison result
   * @param {string} format - Export format (json or csv)
   * @returns {Promise<{filename: string, content: string, format: string}>} Export data
   */
  static async exportComparisonResult(result, format) {
    return await invoke("export_comparison_result", {
      result,
      format,
    });
  }

  // Credential management methods

  /**
   * Stores Oracle credentials in the keychain
   * @param {string} name - Connection name
   * @param {string} username - Database username
   * @param {string} password - Database password
   * @returns {Promise<void>}
   */
  static async setOracleCredentials(name, username, password) {
    return OracleConnectionService.setOracleCredentials(name, username, password);
  }

  /**
   * Retrieves Oracle credentials from the keychain
   * @param {string} name - Connection name
   * @returns {Promise<[string, string]>} [username, password]
   */
  static async getOracleCredentials(name) {
    return OracleConnectionService.getOracleCredentials(name);
  }

  /**
   * Deletes Oracle credentials from the keychain
   * @param {string} name - Connection name
   * @returns {Promise<void>}
   */
  static async deleteOracleCredentials(name) {
    return OracleConnectionService.deleteOracleCredentials(name);
  }

  /**
   * Checks if credentials exist for a connection
   * @param {string} name - Connection name
   * @returns {Promise<boolean>}
   */
  static async hasOracleCredentials(name) {
    return OracleConnectionService.hasOracleCredentials(name);
  }

  // Connection pool management methods

  /**
   * Gets status of all active connections in the pool
   * @returns {Promise<Array<{connect_string: string, username: string, idle_seconds: number, is_alive: boolean}>>}
   */
  static async getActiveConnections() {
    try {
      return await invoke("get_active_connections");
    } catch (error) {
      console.error("Failed to get active connections:", error);
      return [];
    }
  }

  // ==========================================================================
  // Sidecar-based methods (Phase 1: Python Oracle sidecar)
  // ==========================================================================

  /**
   * Get the singleton sidecar client instance
   * @returns {import('./lib/oracle-sidecar-client.js').OracleSidecarClient}
   */
  static getSidecarClient() {
    return OracleConnectionService.getSidecarClient();
  }

  /**
   * Start the Oracle sidecar process
   * @returns {Promise<boolean>} True if sidecar is ready
   */
  static async startSidecar() {
    return OracleConnectionService.startSidecar();
  }

  /**
   * Ensure the sidecar is started (safe to call multiple times)
   * @returns {Promise<boolean>} True if sidecar is ready
   */
  static async ensureSidecarStarted() {
    return OracleConnectionService.ensureSidecarStarted();
  }

  /**
   * Check if the sidecar is ready
   * @returns {boolean}
   */
  static isSidecarReady() {
    return OracleConnectionService.isSidecarReady();
  }

  /**
   * Build a connection object for sidecar queries by retrieving credentials from keychain
   * @param {string} connectionName - Connection name for credential lookup
   * @param {Object} config - Connection config { name, connect_string }
   * @returns {Promise<{name: string, connect_string: string, username: string, password: string}>}
   */
  static async buildSidecarConnection(connectionName, config) {
    return OracleConnectionService.buildSidecarConnection(connectionName, config);
  }

  /**
   * Test Oracle connection via sidecar
   * @param {string} connectionName - Connection name for credential lookup
   * @param {Object} config - Connection config { name, connect_string }
   * @returns {Promise<{success: boolean, message: string}>}
   */
  static async testConnectionViaSidecar(connectionName, config) {
    return OracleConnectionService.testConnectionViaSidecar(connectionName, config);
  }

  /**
   * Execute a SQL query via sidecar
   * @param {string} connectionName - Connection name for credential lookup
   * @param {Object} config - Connection config { name, connect_string }
   * @param {string} sql - SQL query to execute
   * @param {number} [maxRows=1000] - Maximum rows to return
   * @returns {Promise<{columns: string[], rows: any[][], row_count: number, execution_time_ms: number}>}
   */
  static async queryViaSidecar(connectionName, config, sql, maxRows = 1000) {
    return OracleConnectionService.queryViaSidecar(connectionName, config, sql, maxRows);
  }

  /**
   * Execute a SQL query via sidecar and return results as objects
   * @param {string} connectionName - Connection name for credential lookup
   * @param {Object} config - Connection config { name, connect_string }
   * @param {string} sql - SQL query to execute
   * @param {number} [maxRows=1000] - Maximum rows to return
   * @returns {Promise<{columns: string[], rows: Object[], row_count: number, execution_time_ms: number}>}
   */
  static async queryAsDictViaSidecar(connectionName, config, sql, maxRows = 1000) {
    return OracleConnectionService.queryAsDictViaSidecar(connectionName, config, sql, maxRows);
  }

  /**
   * Fetch schemas via sidecar
   * @param {string} connectionName - Connection name for credential lookup
   * @param {Object} config - Connection config { name, connect_string }
   * @returns {Promise<string[]>} List of schema names
   */
  static async fetchSchemasViaSidecar(connectionName, config) {
    const sql = `
      SELECT DISTINCT owner
      FROM all_tables
      WHERE owner NOT IN ('SYS', 'SYSTEM', 'OUTLN', 'DIP', 'ORACLE_OCM', 'DBSNMP', 'APPQOSSYS',
                          'WMSYS', 'EXFSYS', 'CTXSYS', 'XDB', 'ANONYMOUS', 'ORDSYS', 'ORDDATA',
                          'ORDPLUGINS', 'SI_INFORMTN_SCHEMA', 'MDSYS', 'OLAPSYS', 'MDDATA',
                          'SPATIAL_WFS_ADMIN_USR', 'SPATIAL_CSW_ADMIN_USR', 'APEX_PUBLIC_USER',
                          'APEX_040000', 'APEX_040100', 'APEX_040200', 'FLOWS_FILES', 'OWBSYS',
                          'OWBSYS_AUDIT', 'SCOTT', 'HR', 'OE', 'PM', 'SH', 'IX')
      ORDER BY owner
    `;
    const result = await this.queryViaSidecar(connectionName, config, sql, 1000);
    return result.rows.map((row) => row[0]);
  }

  /**
   * Fetch tables for a schema via sidecar
   * @param {string} connectionName - Connection name for credential lookup
   * @param {Object} config - Connection config { name, connect_string }
   * @param {string} owner - Schema/owner name
   * @returns {Promise<string[]>} List of table names
   */
  static async fetchTablesViaSidecar(connectionName, config, owner) {
    const sql = `
      SELECT table_name
      FROM all_tables
      WHERE owner = '${owner.replace(/'/g, "''")}'
      ORDER BY table_name
    `;
    const result = await this.queryViaSidecar(connectionName, config, sql, 5000);
    return result.rows.map((row) => row[0]);
  }

  /**
   * Fetch table metadata (columns) via sidecar
   * @param {string} connectionName - Connection name for credential lookup
   * @param {Object} config - Connection config { name, connect_string }
   * @param {string} owner - Schema/owner name
   * @param {string} tableName - Table name
   * @returns {Promise<{columns: Array<{name: string, data_type: string, nullable: boolean}>}>}
   */
  static async fetchTableMetadataViaSidecar(connectionName, config, owner, tableName) {
    const sql = `
      SELECT column_name, data_type, nullable
      FROM all_tab_columns
      WHERE owner = '${owner.replace(/'/g, "''")}'
        AND table_name = '${tableName.replace(/'/g, "''")}'
      ORDER BY column_id
    `;
    const result = await this.queryViaSidecar(connectionName, config, sql, 1000);
    const columns = result.rows.map((row) => ({
      name: row[0],
      data_type: row[1],
      nullable: row[2] === "Y",
    }));
    return { columns };
  }

  /**
   * Fetch Oracle data via sidecar (compatible with existing fetchOracleData signature)
   * Uses /query (array format) for smaller payload, converts to dicts client-side.
   * @param {Object} request - Fetch data request
   * @param {string} request.connection_name - Connection name (for credential lookup)
   * @param {Object} request.config - Connection configuration { name, connect_string }
   * @param {string} request.mode - "table" or "raw-sql"
   * @param {string} [request.owner] - Schema/owner (table mode)
   * @param {string} [request.table_name] - Table name (table mode)
   * @param {string} [request.where_clause] - WHERE clause (table mode)
   * @param {string[]} [request.fields] - Fields to select (table mode)
   * @param {string} [request.sql] - SQL query (raw-sql mode)
   * @param {number} [request.max_rows] - Maximum rows to fetch
   * @param {Object} [options] - Additional options
   * @param {boolean} [options.bypassCache=false] - Skip cache lookup and force fresh query
   * @returns {Promise<{headers: string[], rows: Object[], row_count: number, source_name: string}>}
   */
  static async fetchOracleDataViaSidecar(request, options = {}) {
    const { bypassCache = false } = options;
    const { connection_name, config, mode, owner, table_name, where_clause, fields, sql, max_rows = 1000 } = request;

    let querySql;
    let sourceName;

    if (mode === "raw-sql") {
      // Strip trailing semicolons - Oracle's programmatic interface doesn't accept them
      querySql = sql.trim().replace(/;+$/, "");
      sourceName = "SQL Query";
    } else {
      // Table mode - build SELECT statement
      const fieldList = fields && fields.length > 0 ? fields.join(", ") : "*";
      const whereClause = where_clause ? ` WHERE ${where_clause}` : "";
      querySql = `SELECT ${fieldList} FROM ${owner}.${table_name}${whereClause}`;
      sourceName = `${owner}.${table_name}`;
    }

    // Generate cache key
    const cacheKey = await generateQueryCacheKey(
      connection_name,
      config.connect_string,
      querySql,
      max_rows
    );

    // Check cache first (unless bypassed)
    if (!bypassCache) {
      const cached = await getQueryCache(cacheKey);
      if (cached) {
        console.debug('[QueryCache] HIT:', cacheKey.slice(0, 16));
        return cached;
      }
    }

    // Use /query (array format) instead of /query-dict — smaller JSON payload
    const result = await this.queryViaSidecar(connection_name, config, querySql, max_rows);

    // Convert to dicts client-side (fast in JS, avoids repeated column names in JSON)
    const columns = result.columns;
    const rows = result.rows.map((row) => Object.fromEntries(columns.map((col, i) => [col, row[i]])));

    const response = {
      headers: columns,
      rows,
      row_count: result.row_count,
      source_name: sourceName,
    };

    // Cache the result
    setQueryCache(cacheKey, response).catch((err) => {
      console.warn('[QueryCache] Failed to cache:', err);
    });

    return response;
  }

  /**
   * Execute multiple queries in a single HTTP request via sidecar batch endpoint.
   * Queries run in parallel on the sidecar and results are returned together.
   * @param {Array<{connection_name: string, config: Object, sql: string, max_rows?: number}>} queries
   * @returns {Promise<Array<{columns: string[], rows: Object[], row_count: number, error?: string}>>}
   */
  static async queryBatchViaSidecar(queries) {
    const batchResult = await OracleConnectionService.queryBatchViaSidecar(queries);

    // Convert array rows to dict rows client-side for each result
    return batchResult.results.map((result) => {
      if (result.error) {
        return { error: result.error, columns: [], rows: [], row_count: 0 };
      }
      const columns = result.columns;
      const rows = result.rows.map((row) => Object.fromEntries(columns.map((col, i) => [col, row[i]])));
      return {
        columns,
        rows,
        row_count: result.row_count,
        execution_time_ms: result.execution_time_ms,
      };
    });
  }
}

export { OracleSidecarError };
