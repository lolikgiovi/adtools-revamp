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
      return false;
    }
  }

  clearAllSchemas() {
    try {
      localStorage.removeItem(this.STORAGE_KEY);
      return true;
    } catch (error) {
      console.error("Error clearing schemas:", error);
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

    return abbrs;
  }

  getScore(schema, table, searchTerm) {
    const termLower = searchTerm.toLowerCase();
    schema = schema.toLowerCase();
    table = table?.toLowerCase();

    const schemaAbbrs = this.getSchemaAbbreviations(schema);

    if (schema === termLower) return 7;
    if (table === termLower) return 6;
    if (schemaAbbrs.has(termLower)) return 5;
    if (schema.startsWith(termLower)) return 4;
    if (table?.startsWith(termLower)) return 3;
    if (schema.includes(termLower)) return 2;
    if (table?.includes(termLower)) return 1;
    return 0;
  }

  searchSavedSchemas(searchTerm) {
    const allTables = this.getAllTables();
    if (!searchTerm) return allTables;

    let [schemaSearch, tableSearch] = searchTerm.split(".");

    if (!tableSearch) {
      const searchPattern = `%${schemaSearch}%`;
      const pattern = this.sqlLikeToRegex(searchPattern);

      return allTables
        .filter((table) => {
          const schemaAbbrs = this.getSchemaAbbreviations(table.schemaName);
          return pattern.test(table.schemaName) || pattern.test(table.tableName) || schemaAbbrs.has(schemaSearch.toLowerCase());
        })
        .sort((a, b) => {
          const scoreA = this.getScore(a.schemaName, a.tableName, schemaSearch);
          const scoreB = this.getScore(b.schemaName, b.tableName, schemaSearch);

          return scoreB - scoreA || a.schemaName.localeCompare(b.schemaName);
        });
    } else {
      const schemaPattern = this.sqlLikeToRegex(`%${schemaSearch}%`);
      const tablePattern = this.sqlLikeToRegex(`%${tableSearch}%`);

      return allTables
        .filter((table) => {
          const schemaAbbrs = this.getSchemaAbbreviations(table.schemaName);
          const tableAbbrs = this.getSchemaAbbreviations(table.tableName); // Add table abbreviations
          return (
            (schemaPattern.test(table.schemaName) || schemaAbbrs.has(schemaSearch.toLowerCase())) &&
            (tablePattern.test(table.tableName) || tableAbbrs.has(tableSearch.toLowerCase())) // Check table abbreviations
          );
        })
        .sort((a, b) => {
          const schemaAbbrsA = this.getSchemaAbbreviations(a.schemaName);
          const schemaAbbrsB = this.getSchemaAbbreviations(b.schemaName);
          const tableAbbrsA = this.getSchemaAbbreviations(a.tableName); // Add table abbreviations
          const tableAbbrsB = this.getSchemaAbbreviations(b.tableName);

          const schemaMatchA = schemaSearch.toLowerCase() === a.schemaName.toLowerCase() || schemaAbbrsA.has(schemaSearch.toLowerCase());
          const schemaMatchB = schemaSearch.toLowerCase() === b.schemaName.toLowerCase() || schemaAbbrsB.has(schemaSearch.toLowerCase());

          if (schemaMatchA !== schemaMatchB) return schemaMatchB ? 1 : -1;

          const tableMatchA = tableSearch.toLowerCase() === a.tableName.toLowerCase() || tableAbbrsA.has(tableSearch.toLowerCase());
          const tableMatchB = tableSearch.toLowerCase() === b.tableName.toLowerCase() || tableAbbrsB.has(tableSearch.toLowerCase());

          return tableMatchA ? -1 : tableMatchB ? 1 : 0;
        });
    }
  }

  validateSchemaFormat(data) {
    if (!data || typeof data !== "object") return false;

    return Object.entries(data).every(([schemaName, tables]) => {
      if (typeof tables !== "object") return false;

      return Object.entries(tables).every(([tableName, schema]) => {
        return (
          Array.isArray(schema) &&
          schema.every(
            (row) =>
              Array.isArray(row) &&
              row.length >= 3 &&
              typeof row[0] === "string" &&
              typeof row[1] === "string" &&
              typeof row[2] === "string"
          )
        );
      });
    });
  }
}
