import { getOracleSidecarClient } from "../../compare-config/lib/oracle-sidecar-client.js";
import { invoke } from "@tauri-apps/api/core";

const SYSTEM_SCHEMAS = [
  "SYS",
  "SYSTEM",
  "OUTLN",
  "DIP",
  "ORACLE_OCM",
  "DBSNMP",
  "APPQOSSYS",
  "WMSYS",
  "EXFSYS",
  "CTXSYS",
  "XDB",
  "ANONYMOUS",
  "ORDSYS",
  "ORDDATA",
  "ORDPLUGINS",
  "SI_INFORMTN_SCHEMA",
  "MDSYS",
  "OLAPSYS",
  "MDDATA",
  "SPATIAL_WFS_ADMIN_USR",
  "SPATIAL_CSW_ADMIN_USR",
  "APEX_PUBLIC_USER",
  "APEX_040000",
  "APEX_040100",
  "APEX_040200",
  "FLOWS_FILES",
  "OWBSYS",
  "OWBSYS_AUDIT",
  "SCOTT",
  "HR",
  "OE",
  "PM",
  "SH",
  "IX",
  "GSMADMIN_INTERNAL",
  "XS$NULL",
  "OJVMSYS",
  "LBACSYS",
  "DVSYS",
  "DVF",
  "AUDSYS",
  "DBSFWUSER",
  "REMOTE_SCHEDULER_AGENT",
];

export class OracleEnvImportService {
  /**
   * Load saved Oracle connections from localStorage.
   * @returns {{ name: string, connect_string: string }[]}
   */
  static loadConnections() {
    try {
      const raw = localStorage.getItem("config.oracle.connections");
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((c) => c && c.name && c.connect_string);
    } catch {
      return [];
    }
  }

  /**
   * Build a full connection object by fetching credentials from the keychain.
   * @param {string} name - Connection name
   * @param {{ name: string, connect_string: string }} config
   * @returns {Promise<{ name: string, connect_string: string, username: string, password: string }>}
   */
  static async buildConnection(name, config) {
    const [username, password] = await invoke("get_oracle_credentials", { name });
    return {
      name: config.name || name,
      connect_string: config.connect_string,
      username,
      password,
    };
  }

  /**
   * Ensure the Oracle sidecar is started and healthy.
   * @returns {Promise<boolean>}
   */
  static async ensureSidecarStarted() {
    const client = getOracleSidecarClient();
    return client.ensureStarted();
  }

  /**
   * Fetch the list of non-system schemas from the database.
   * @param {string} name - Connection name
   * @param {{ name: string, connect_string: string }} config
   * @returns {Promise<string[]>}
   */
  static async fetchSchemas(name, config) {
    const client = getOracleSidecarClient();
    const connection = await this.buildConnection(name, config);
    const inList = SYSTEM_SCHEMAS.map((s) => `'${s}'`).join(",");
    const sql = `SELECT DISTINCT OWNER FROM ALL_TABLES WHERE OWNER NOT IN (${inList}) ORDER BY OWNER`;
    const result = await client.query({ connection, sql, max_rows: 1000 });
    return result.rows.map((row) => row[0]);
  }

  /**
   * Fetch full table metadata (columns + PKs) for the selected schemas.
   * @param {string} name - Connection name
   * @param {{ name: string, connect_string: string }} config
   * @param {string[]} schemaNames - Selected schema names
   * @param {(message: string, percent: number) => void} [onProgress]
   * @returns {Promise<Object>} Canonical payload { schema: { tables: { table: { columns, pk } } } }
   */
  static async fetchAllMetadata(name, config, schemaNames, onProgress) {
    const client = getOracleSidecarClient();
    const connection = await this.buildConnection(name, config);
    const inList = schemaNames.map((s) => `'${s.replace(/'/g, "''")}'`).join(",");

    if (onProgress) onProgress("Fetching column metadata...", 20);

    const columnsSql = `SELECT OWNER, TABLE_NAME, COLUMN_NAME, DATA_TYPE, DATA_LENGTH,
       DATA_PRECISION, DATA_SCALE, NULLABLE, DATA_DEFAULT, COLUMN_ID
FROM ALL_TAB_COLUMNS
WHERE OWNER IN (${inList})
ORDER BY OWNER, TABLE_NAME, COLUMN_ID`;

    const columnsResult = await client.query({ connection, sql: columnsSql, max_rows: 100000 });

    if (onProgress) onProgress("Fetching primary keys...", 60);

    const pkSql = `SELECT cons.OWNER, cons.TABLE_NAME, cc.COLUMN_NAME, cc.POSITION
FROM ALL_CONSTRAINTS cons
JOIN ALL_CONS_COLUMNS cc ON cons.OWNER = cc.OWNER AND cons.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
WHERE cons.OWNER IN (${inList}) AND cons.CONSTRAINT_TYPE = 'P'
ORDER BY cons.OWNER, cons.TABLE_NAME, cc.POSITION`;

    const pkResult = await client.query({ connection, sql: pkSql, max_rows: 100000 });

    if (onProgress) onProgress("Building schema payload...", 80);

    return this.buildCanonicalPayload(columnsResult.rows, pkResult.rows);
  }

  /**
   * Format an Oracle data type into a human-readable string.
   * @param {string} dataType
   * @param {number|null} dataLength
   * @param {number|null} dataPrecision
   * @param {number|null} dataScale
   * @returns {string}
   */
  static formatOracleType(dataType, dataLength, dataPrecision, dataScale) {
    if (!dataType) return "";
    const dt = dataType.toUpperCase();

    // Types with precision/scale (NUMBER, FLOAT, etc.)
    if (dataPrecision != null && dt !== "DATE" && dt !== "CLOB" && dt !== "BLOB" && dt !== "LONG") {
      if (dataScale != null && dataScale > 0) {
        return `${dt}(${dataPrecision},${dataScale})`;
      }
      return `${dt}(${dataPrecision})`;
    }

    // Types with length (VARCHAR2, CHAR, NVARCHAR2, RAW, etc.)
    if (dataLength != null && (dt.includes("CHAR") || dt.includes("RAW") || dt === "NVARCHAR2")) {
      return `${dt}(${dataLength})`;
    }

    // TIMESTAMP with fractional seconds
    if (dt.startsWith("TIMESTAMP")) {
      const match = dt.match(/\((\d+)\)/);
      if (match) return dt;
      // Default: TIMESTAMP(6) if raw "TIMESTAMP" without precision
      if (dataScale != null) return `TIMESTAMP(${dataScale})`;
      return dt;
    }

    return dt;
  }

  /**
   * Build the canonical payload from Oracle metadata rows.
   * @param {any[][]} columnsRows - Rows from ALL_TAB_COLUMNS query
   * @param {any[][]} pkRows - Rows from ALL_CONSTRAINTS/ALL_CONS_COLUMNS query
   * @returns {Object} { schema: { tables: { table: { columns: {}, pk: [] } } } }
   */
  static buildCanonicalPayload(columnsRows, pkRows) {
    // Build PK lookup: schema.table -> Set of column names
    const pkLookup = {};
    for (const row of pkRows) {
      const [owner, tableName, columnName] = row;
      const key = `${owner}.${tableName}`;
      if (!pkLookup[key]) pkLookup[key] = new Set();
      pkLookup[key].add(columnName);
    }

    const payload = {};
    for (const row of columnsRows) {
      const [owner, tableName, columnName, dataType, dataLength, dataPrecision, dataScale, nullable, dataDefault] = row;

      if (!payload[owner]) payload[owner] = { tables: {} };
      if (!payload[owner].tables[tableName]) {
        payload[owner].tables[tableName] = { columns: {}, pk: [] };
      }

      const table = payload[owner].tables[tableName];
      table.columns[columnName] = {
        type: this.formatOracleType(dataType, dataLength, dataPrecision, dataScale),
        nullable: nullable === "Y" ? "Yes" : "No",
        default: this.cleanDefault(dataDefault),
      };

      // Build PK array (will be filled after all columns are processed)
    }

    // Fill PK arrays from lookup
    for (const [key, pkColumns] of Object.entries(pkLookup)) {
      const [owner, tableName] = key.split(".");
      if (payload[owner]?.tables?.[tableName]) {
        payload[owner].tables[tableName].pk = Array.from(pkColumns);
      }
    }

    return payload;
  }

  /**
   * Clean Oracle DATA_DEFAULT value (trim whitespace quirks).
   * @param {*} rawDefault
   * @returns {*}
   */
  static cleanDefault(rawDefault) {
    if (rawDefault == null) return null;
    if (typeof rawDefault !== "string") return rawDefault;
    const trimmed = rawDefault.trim();
    return trimmed === "" ? null : trimmed;
  }
}
