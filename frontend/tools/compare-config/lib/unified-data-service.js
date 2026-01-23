/**
 * Unified Data Service
 * Abstracts data fetching from Oracle and Excel sources for mixed comparison.
 *
 * This service provides a consistent interface for fetching data regardless of
 * whether the source is an Oracle database or an Excel/CSV file.
 */

import { CompareConfigService } from '../service.js';
import * as FileParser from './file-parser.js';
import { reconcileColumns, normalizeRowFields } from './diff-engine.js';
import { isTauri } from '../../../core/Runtime.js';

/**
 * Source type constants
 */
export const SourceType = {
  ORACLE_TABLE: 'oracle-table',
  ORACLE_SQL: 'oracle-sql',
  EXCEL: 'excel'
};

/**
 * Normalized dataset format used by both Oracle and Excel sources
 * @typedef {Object} NormalizedDataset
 * @property {string[]} headers - Column names
 * @property {Object[]} rows - Array of row objects { columnName: value }
 * @property {Object} metadata - Source metadata
 * @property {string} metadata.sourceName - Name of the source (connection/file name)
 * @property {number} metadata.rowCount - Number of rows
 * @property {number} metadata.columnCount - Number of columns
 * @property {string} metadata.sourceType - Type of source (oracle-table, oracle-sql, excel)
 */

/**
 * Source configuration for Oracle Table mode
 * @typedef {Object} OracleTableSourceConfig
 * @property {string} type - 'oracle-table'
 * @property {Object} connection - { name: string, connect_string: string }
 * @property {string} schema - Schema/owner name
 * @property {string} table - Table name
 * @property {string} [whereClause] - Optional WHERE clause
 * @property {string[]} [fields] - Optional fields to select
 * @property {number} [maxRows] - Maximum rows to fetch
 */

/**
 * Source configuration for Oracle SQL mode
 * @typedef {Object} OracleSqlSourceConfig
 * @property {string} type - 'oracle-sql'
 * @property {Object} connection - { name: string, connect_string: string }
 * @property {string} sql - SQL query
 * @property {number} [maxRows] - Maximum rows to fetch
 */

/**
 * Source configuration for Excel mode
 * @typedef {Object} ExcelSourceConfig
 * @property {string} type - 'excel'
 * @property {File} file - The Excel/CSV file
 * @property {Object} [parsedData] - Pre-parsed data (optional, for efficiency)
 */

/**
 * Unified Data Service class
 */
export class UnifiedDataService {
  /**
   * Fetch data from any source type
   * @param {OracleTableSourceConfig|OracleSqlSourceConfig|ExcelSourceConfig} sourceConfig
   * @returns {Promise<NormalizedDataset>}
   */
  static async fetchData(sourceConfig) {
    switch (sourceConfig.type) {
      case SourceType.ORACLE_TABLE:
        return this.fetchOracleTableData(sourceConfig);
      case SourceType.ORACLE_SQL:
        return this.fetchOracleSqlData(sourceConfig);
      case SourceType.EXCEL:
        return this.fetchExcelData(sourceConfig);
      default:
        throw new Error(`Unknown source type: ${sourceConfig.type}`);
    }
  }

  /**
   * Fetch data from Oracle using table mode
   * @param {OracleTableSourceConfig} config
   * @returns {Promise<NormalizedDataset>}
   */
  static async fetchOracleTableData(config) {
    if (!isTauri()) {
      throw new Error('Oracle database queries require the desktop application');
    }

    const request = {
      connection_name: config.connection.name,
      config: {
        name: config.connection.name,
        connect_string: config.connection.connect_string,
      },
      mode: 'table',
      owner: config.schema,
      table_name: config.table,
      where_clause: config.whereClause || null,
      fields: config.fields || null,
      max_rows: config.maxRows || 1000,
    };

    const result = await CompareConfigService.fetchOracleData(request);

    return {
      headers: result.headers,
      rows: result.rows,
      metadata: {
        sourceName: result.source_name,
        rowCount: result.row_count,
        columnCount: result.headers.length,
        sourceType: SourceType.ORACLE_TABLE,
        connectionName: config.connection.name,
        schema: config.schema,
        table: config.table,
      },
    };
  }

  /**
   * Fetch data from Oracle using raw SQL mode
   * @param {OracleSqlSourceConfig} config
   * @returns {Promise<NormalizedDataset>}
   */
  static async fetchOracleSqlData(config) {
    if (!isTauri()) {
      throw new Error('Oracle database queries require the desktop application');
    }

    const request = {
      connection_name: config.connection.name,
      config: {
        name: config.connection.name,
        connect_string: config.connection.connect_string,
      },
      mode: 'raw-sql',
      sql: config.sql,
      max_rows: config.maxRows || 1000,
    };

    const result = await CompareConfigService.fetchOracleData(request);

    return {
      headers: result.headers,
      rows: result.rows,
      metadata: {
        sourceName: result.source_name,
        rowCount: result.row_count,
        columnCount: result.headers.length,
        sourceType: SourceType.ORACLE_SQL,
        connectionName: config.connection.name,
        sql: config.sql,
      },
    };
  }

  /**
   * Fetch data from Excel/CSV file
   * @param {ExcelSourceConfig} config
   * @returns {Promise<NormalizedDataset>}
   */
  static async fetchExcelData(config) {
    // If pre-parsed data is provided, use it
    if (config.parsedData) {
      return {
        headers: config.parsedData.headers,
        rows: config.parsedData.rows,
        metadata: {
          sourceName: config.parsedData.metadata.fileName,
          rowCount: config.parsedData.metadata.rowCount,
          columnCount: config.parsedData.metadata.columnCount,
          sourceType: SourceType.EXCEL,
          fileName: config.parsedData.metadata.fileName,
          sheetName: config.parsedData.metadata.sheetName,
        },
      };
    }

    // Parse the file
    const parsed = await FileParser.parseFile(config.file);

    return {
      headers: parsed.headers,
      rows: parsed.rows,
      metadata: {
        sourceName: parsed.metadata.fileName,
        rowCount: parsed.metadata.rowCount,
        columnCount: parsed.metadata.columnCount,
        sourceType: SourceType.EXCEL,
        fileName: parsed.metadata.fileName,
        sheetName: parsed.metadata.sheetName,
      },
    };
  }

  /**
   * Reconcile columns between two datasets
   * @param {NormalizedDataset} datasetA
   * @param {NormalizedDataset} datasetB
   * @returns {Object} Reconciliation result with field mappings
   */
  static reconcileColumns(datasetA, datasetB) {
    return reconcileColumns(datasetA.headers, datasetB.headers);
  }

  /**
   * Normalize both datasets to use consistent field names for comparison.
   * This handles case differences between Oracle (uppercase) and Excel (mixed case).
   *
   * @param {NormalizedDataset} datasetA - Dataset from source A
   * @param {NormalizedDataset} datasetB - Dataset from source B
   * @param {Array<{normalized: string, sourceA: string, sourceB: string}>} fieldMappings
   * @returns {{rowsA: Object[], rowsB: Object[]}} Normalized rows for both datasets
   */
  static normalizeForComparison(datasetA, datasetB, fieldMappings) {
    const rowsA = normalizeRowFields(datasetA.rows, fieldMappings, 'A');
    const rowsB = normalizeRowFields(datasetB.rows, fieldMappings, 'B');

    return { rowsA, rowsB };
  }

  /**
   * Check if Oracle sources are available
   * @returns {boolean}
   */
  static isOracleAvailable() {
    return isTauri();
  }

  /**
   * Get a display label for a source type
   * @param {string} sourceType
   * @returns {string}
   */
  static getSourceTypeLabel(sourceType) {
    switch (sourceType) {
      case SourceType.ORACLE_TABLE:
        return 'Oracle Table';
      case SourceType.ORACLE_SQL:
        return 'Oracle SQL';
      case SourceType.EXCEL:
        return 'Excel/CSV';
      default:
        return sourceType;
    }
  }
}

export default UnifiedDataService;
