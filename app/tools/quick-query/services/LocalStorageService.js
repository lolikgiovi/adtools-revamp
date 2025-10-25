import { UsageTracker } from "../../../core/UsageTracker.js";
const STORAGE_KEY = "quickquery_schemas";
const ORACLE_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_$#]*$/;
const MAX_SCHEMA_LENGTH = 30;
const MAX_TABLE_LENGTH = 128;
const MAX_CACHED_ROWS = 100;

export class LocalStorageService {
  constructor() {
    this.STORAGE_KEY = STORAGE_KEY;
  }

  // Storage Helper Functions
  parseTableIdentifier(fullTableName) {
    const [schemaName, tableName] = fullTableName.split(".");
    if (!schemaName || !tableName) {
      UsageTracker.trackEvent("quick-query", "storage_error", { type: "invalid_table_format", input: fullTableName });
      throw new Error('Invalid table name format. Expected "schema_name.table_name"');
    }
    return { schemaName, tableName };
  }

  getStorageData() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      if (!data) {
        return {
          schemas: {},
          lastUpdated: new Date().toISOString(),
        };
      }
      return JSON.parse(data);
    } catch (error) {
      console.error("Error reading storage:", error);
      UsageTracker.trackEvent("quick-query", "storage_error", { type: "read_failed", message: error.message });
      return {
        schemas: {},
        lastUpdated: new Date().toISOString(),
      };
    }
  }

  saveStorageData(data) {
    try {
      data.lastUpdated = new Date().toISOString();
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (error) {
      console.error("Error saving to storage:", error);
      UsageTracker.trackEvent("quick-query", "storage_error", { type: "write_failed", message: error.message });
      return false;
    }
  }

  // Schema Management Functions
  saveSchema(fullTableName, schemaData, tableData = null) {
    try {
      const { schemaName, tableName } = this.parseTableIdentifier(fullTableName);
      const storageData = this.getStorageData();

      if (!storageData.schemas[schemaName]) {
        storageData.schemas[schemaName] = { tables: {} };
      }

      storageData.schemas[schemaName].tables[tableName] = {
        schema: schemaData,
        data: tableData ? tableData.slice(0, MAX_CACHED_ROWS) : null,
        timestamp: new Date().toISOString(),
      };

      return this.saveStorageData(storageData);
    } catch (error) {
      console.error("Error saving schema:", error);
      UsageTracker.trackEvent("quick-query", "storage_error", { type: "save_schema_failed", message: error.message });
      return false;
    }
  }

  loadSchema(fullTableName, includeData = false) {
    try {
      const { schemaName, tableName } = this.parseTableIdentifier(fullTableName);
      const storageData = this.getStorageData();
      const tableInfo = storageData.schemas[schemaName]?.tables[tableName];

      if (!tableInfo) return null;

      if (!includeData) {
        return tableInfo.schema;
      }

      return {
        schema: tableInfo.schema,
        data: tableInfo.data || null,
      };
    } catch (error) {
      console.error("Error loading schema:", error);
      UsageTracker.trackEvent("quick-query", "storage_error", { type: "load_schema_failed", message: error.message });
      return null;
    }
  }

  updateTableData(fullTableName, tableData) {
    try {
      const { schemaName, tableName } = this.parseTableIdentifier(fullTableName);
      const storageData = this.getStorageData();

      if (!storageData.schemas[schemaName]?.tables[tableName]) {
        return false;
      }

      storageData.schemas[schemaName].tables[tableName].data = tableData.slice(0, MAX_CACHED_ROWS);
      storageData.schemas[schemaName].tables[tableName].timestamp = new Date().toISOString();

      return this.saveStorageData(storageData);
    } catch (error) {
      console.error("Error updating table data:", error);
      UsageTracker.trackEvent("quick-query", "storage_error", { type: "update_table_data_failed", message: error.message });
      return false;
    }
  }

  deleteSchema(fullTableName) {
    try {
      const { schemaName, tableName } = this.parseTableIdentifier(fullTableName);
      const storageData = this.getStorageData();

      if (storageData.schemas[schemaName]?.tables[tableName]) {
        delete storageData.schemas[schemaName].tables[tableName];

        if (Object.keys(storageData.schemas[schemaName].tables).length === 0) {
          delete storageData.schemas[schemaName];
        }

        return this.saveStorageData(storageData);
      }
      return false;
    } catch (error) {
      console.error("Error deleting schema:", error);
      UsageTracker.trackEvent("quick-query", "storage_error", { type: "delete_schema_failed", message: error.message });
      return false;
    }
  }

  clearAllSchemas() {
    try {
      localStorage.removeItem(this.STORAGE_KEY);
      return true;
    } catch (error) {
      console.error("Error clearing schemas:", error);
      UsageTracker.trackEvent("quick-query", "storage_error", { type: "clear_schemas_failed", message: error.message });
      return false;
    }
  }

  // Query Functions
  getAllTables() {
    const storageData = this.getStorageData();
    const allTables = [];

    Object.entries(storageData.schemas).forEach(([schemaName, schemaData]) => {
      Object.entries(schemaData.tables).forEach(([tableName, tableData]) => {
        allTables.push({
          fullName: `${schemaName}.${tableName}`,
          schemaName,
          tableName,
          timestamp: tableData.timestamp,
        });
      });
    });

    return allTables.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  // Schema searching functions
  getByteLength(str) {
    return new TextEncoder().encode(str).length;
  }

  validateOracleName(name, type = "schema") {
    if (type === "table" && typeof name === "undefined") {
      return true; // Allow undefined table names when only typing schema name
    }

    if (!name) {
      return false;
    }

    if (!ORACLE_NAME_REGEX.test(name)) {
      return false;
    }

    const byteLength = this.getByteLength(name);

    if (type === "schema" && byteLength > MAX_SCHEMA_LENGTH) {
      return false;
    }
    if (type === "table" && byteLength > MAX_TABLE_LENGTH) {
      return false;
    }

    return true;
  }

  sqlLikeToRegex(pattern) {
    return new RegExp("^" + pattern.replace(/%/g, ".*").replace(/_/g, ".").replace(/\[/g, "\\[").replace(/\]/g, "\\]") + "$", "i");
  }

  getSchemaAbbreviations(schemaName) {
    const parts = schemaName.split("_");
    const abbrs = new Set();

    // First letters abbreviation
    abbrs.add(parts.map((part) => part[0]?.toLowerCase()).join(""));

    // For single words, generate common abbreviation patterns
    if (parts.length === 1) {
      const word = parts[0].toLowerCase();

      // Generate all possible consonant combinations
      const consonants = word.replace(/[aeiou]/g, "");
      for (let i = 1; i <= consonants.length; i++) {
        abbrs.add(consonants.slice(0, i));
      }

      // Generate progressive abbreviations (both from start and with consonants)
      for (let i = 1; i <= Math.min(4, word.length); i++) {
        abbrs.add(word.slice(0, i)); // Normal slice (e.g., "c", "co", "con", "conf")

        // Consonant-based slice (e.g., "cfg" for "config")
        let consonantBased = word.slice(0, i).replace(/[aeiou]/g, "");
        abbrs.add(consonantBased);
      }

      // Add common variations (e.g., "cfg" for "config")
      if (word.startsWith("config")) abbrs.add("cfg");
      if (word.startsWith("temp")) abbrs.add("tmp");
      if (word.startsWith("database")) abbrs.add("db");
    }

    // For multi-word combinations
    parts.forEach((part, index) => {
      const word = part.toLowerCase();

      // Add first N chars of each part
      for (let i = 1; i <= Math.min(4, word.length); i++) {
        if (index === 0) {
          abbrs.add(word.slice(0, i));
        } else {
          // Combine with first letter of previous parts
          const prefix = parts
            .slice(0, index)
            .map((p) => p[0]?.toLowerCase())
            .join("");
          abbrs.add(prefix + word.slice(0, i));
        }
      }

      // Add consonant combinations for each part
      const consonants = word.replace(/[aeiou]/g, "");
      if (index === 0) {
        abbrs.add(consonants);
      } else {
        const prefix = parts
          .slice(0, index)
          .map((p) => p[0]?.toLowerCase())
          .join("");
        abbrs.add(prefix + consonants);
      }
    });

    return Array.from(abbrs);
  }

  searchSavedSchemas(searchTerm) {
    if (!searchTerm) return [];

    const storageData = this.getStorageData();
    const results = [];

    Object.entries(storageData.schemas).forEach(([schemaName, schemaData]) => {
      if (!this.validateOracleName(schemaName, "schema")) return;

      // Generate abbreviations and variations to match against
      const abbrs = this.getSchemaAbbreviations(schemaName);

      Object.entries(schemaData.tables).forEach(([tableName, tableData]) => {
        if (!this.validateOracleName(tableName, "table")) return;

        const fullName = `${schemaName}.${tableName}`;
        const regex = this.sqlLikeToRegex(searchTerm);

        if (regex.test(schemaName) || regex.test(tableName) || regex.test(fullName) || abbrs.some((abbr) => regex.test(abbr))) {
          results.push({
            fullName,
            schemaName,
            tableName,
            timestamp: tableData.timestamp,
          });
        }
      });
    });

    return results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  validateSchemaFormat(data) {
    if (!Array.isArray(data) || data.length === 0) return false;

    const hasHeaderRow = Array.isArray(data[0]) && data[0].length >= 2;
    const hasDataRow = Array.isArray(data[1]) && data[1].length >= 2;

    return hasHeaderRow && hasDataRow;
  }
}
