/**
 * Compare Config Service
 * Handles communication with the Tauri backend for Oracle operations
 */

import { invoke } from "@tauri-apps/api/core";

export class CompareConfigService {
  /**
   * Checks if Oracle Instant Client is installed and ready
   * @returns {Promise<boolean>}
   */
  static async checkOracleClientReady() {
    try {
      return await invoke("check_oracle_client_ready");
    } catch (error) {
      console.error("Failed to check Oracle client:", error);
      return false;
    }
  }

  /**
   * Primes (loads) the Oracle client library
   * @returns {Promise<void>}
   */
  static async primeOracleClient() {
    try {
      await invoke("prime_oracle_client");
    } catch (error) {
      console.error("Failed to prime Oracle client:", error);
      throw error;
    }
  }

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
   * @param {Object} config - Connection configuration
   * @param {string} username - Database username
   * @param {string} password - Database password
   * @returns {Promise<string[]>} List of schema names
   */
  static async fetchSchemas(config, username, password) {
    return await invoke("fetch_schemas", {
      config,
      username,
      password,
    });
  }

  /**
   * Fetches tables for a specific schema
   * @param {Object} config - Connection configuration
   * @param {string} username - Database username
   * @param {string} password - Database password
   * @param {string} owner - Schema/owner name
   * @returns {Promise<string[]>} List of table names
   */
  static async fetchTables(config, username, password, owner) {
    return await invoke("fetch_tables", {
      config,
      username,
      password,
      owner,
    });
  }

  /**
   * Fetches metadata for a specific table
   * @param {Object} config - Connection configuration
   * @param {string} username - Database username
   * @param {string} password - Database password
   * @param {string} owner - Schema/owner name
   * @param {string} tableName - Table name
   * @returns {Promise<Object>} Table metadata
   */
  static async fetchTableMetadata(config, username, password, owner, tableName) {
    return await invoke("fetch_table_metadata", {
      config,
      username,
      password,
      owner,
      tableName,
    });
  }

  /**
   * Compares configurations between two environments
   * @param {Object} request - Comparison request object
   * @returns {Promise<Object>} Comparison result
   */
  static async compareConfigurations(request) {
    return await invoke("compare_configurations", {
      request,
    });
  }

  /**
   * Exports comparison results to a file
   * @param {Object} result - Comparison result
   * @param {string} format - Export format (json or csv)
   * @returns {Promise<string>} File path
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
    return await invoke("set_oracle_credentials", {
      name,
      username,
      password,
    });
  }

  /**
   * Retrieves Oracle credentials from the keychain
   * @param {string} name - Connection name
   * @returns {Promise<[string, string]>} [username, password]
   */
  static async getOracleCredentials(name) {
    return await invoke("get_oracle_credentials", {
      name,
    });
  }

  /**
   * Deletes Oracle credentials from the keychain
   * @param {string} name - Connection name
   * @returns {Promise<void>}
   */
  static async deleteOracleCredentials(name) {
    return await invoke("delete_oracle_credentials", {
      name,
    });
  }

  /**
   * Checks if credentials exist for a connection
   * @param {string} name - Connection name
   * @returns {Promise<boolean>}
   */
  static async hasOracleCredentials(name) {
    return await invoke("has_oracle_credentials", {
      name,
    });
  }
}
