import { UsageTracker } from "../../../core/UsageTracker.js";

// Database constants
const DB_NAME = "QuickQueryDatabase";
const DB_VERSION = 1;
const SCHEMA_STORE = "schemas";
const DATA_STORE = "tableData";

// Legacy localStorage keys for migration
const LEGACY_SCHEMA_KEY = "tool:quick-query:schema";
const LEGACY_DATA_KEY = "tool:quick-query:data";

// Validation constants
const ORACLE_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_$#]*$/;
const MAX_SCHEMA_LENGTH = 30;
const MAX_TABLE_LENGTH = 128;
const MAX_CACHED_ROWS = 300;

/**
 * IndexedDB-based storage service for Quick Query tool.
 * Replaces LocalStorageService to avoid quota_exceeded errors.
 * Maintains the same public API but with async methods.
 */
export class IndexedDBStorageService {
  constructor() {
    this.db = null;
    this._initPromise = null;

    // In-memory search index (rebuilt when schema store changes)
    this._index = {
      dirty: true,
      schemas: new Map(),
      tables: new Map(),
      schemaAbbrIndex: new Map(),
      tableAbbrIndex: new Map(),
    };
  }

  // ==================== Database Initialization ====================

  /**
   * Initialize the database connection and run migration if needed.
   * Must be called before any other methods.
   */
  async init() {
    if (this._initPromise) return this._initPromise;

    this._initPromise = this._openDatabase()
      .then(() => this._migrateFromLocalStorage())
      .catch((error) => {
        console.error("Failed to initialize IndexedDB:", error);
        UsageTracker.trackEvent("quick-query", "storage_error", {
          type: "indexeddb_init_failed",
          message: error.message,
        });
        throw error;
      });

    return this._initPromise;
  }

  /**
   * Open the IndexedDB database and create object stores if needed.
   */
  _openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        reject(new Error(`Failed to open database: ${request.error?.message}`));
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Create schemas store with indexes
        if (!db.objectStoreNames.contains(SCHEMA_STORE)) {
          const schemaStore = db.createObjectStore(SCHEMA_STORE, { keyPath: "fullName" });
          schemaStore.createIndex("schemaName", "schemaName", { unique: false });
          schemaStore.createIndex("lastUpdated", "lastUpdated", { unique: false });
        }

        // Create tableData store with indexes
        if (!db.objectStoreNames.contains(DATA_STORE)) {
          const dataStore = db.createObjectStore(DATA_STORE, { keyPath: "fullName" });
          dataStore.createIndex("schemaName", "schemaName", { unique: false });
          dataStore.createIndex("lastUpdated", "lastUpdated", { unique: false });
        }
      };
    });
  }

  /**
   * Migrate existing data from localStorage to IndexedDB.
   */
  async _migrateFromLocalStorage() {
    try {
      const legacySchemaRaw = localStorage.getItem(LEGACY_SCHEMA_KEY);
      const legacyDataRaw = localStorage.getItem(LEGACY_DATA_KEY);

      if (!legacySchemaRaw && !legacyDataRaw) {
        return; // Nothing to migrate
      }

      console.log("[IndexedDB Migration] Starting migration from localStorage...");

      const legacySchemaStore = legacySchemaRaw ? JSON.parse(legacySchemaRaw) : {};
      const legacyDataStore = legacyDataRaw ? JSON.parse(legacyDataRaw) : {};

      let migratedCount = 0;

      // Migrate each schema and its data
      for (const [schemaName, schemaData] of Object.entries(legacySchemaStore)) {
        const tables = schemaData?.tables || {};

        for (const [tableName, tableSchema] of Object.entries(tables)) {
          const fullName = `${schemaName}.${tableName}`;
          const lastUpdated = tableSchema?.last_updated || new Date().toISOString();

          // Store schema
          await this._putRecord(SCHEMA_STORE, {
            fullName,
            schemaName,
            tableName,
            schema: tableSchema,
            lastUpdated,
          });

          // Store data if exists
          const tableData = legacyDataStore?.[schemaName]?.[tableName];
          if (tableData) {
            await this._putRecord(DATA_STORE, {
              fullName,
              schemaName,
              tableName,
              rows: tableData.rows || [],
              lastUpdated: tableData.last_updated || lastUpdated,
            });
          }

          migratedCount++;
        }
      }

      // Only clear localStorage if migration actually moved data
      // This prevents data loss if legacy format differs from expected shape
      if (migratedCount > 0) {
        localStorage.removeItem(LEGACY_SCHEMA_KEY);
        localStorage.removeItem(LEGACY_DATA_KEY);
        console.log(`[IndexedDB Migration] Successfully migrated ${migratedCount} tables.`);
        UsageTracker.trackEvent("quick-query", "storage_migration", {
          count: migratedCount,
          success: true,
        });
      } else {
        console.warn("[IndexedDB Migration] Legacy data found but 0 tables migrated. Keeping localStorage as backup.");
        UsageTracker.trackEvent("quick-query", "storage_migration", {
          count: 0,
          success: false,
          reason: "no_tables_found",
        });
      }

      this._index.dirty = true;
    } catch (error) {
      console.error("[IndexedDB Migration] Migration failed:", error);
      UsageTracker.trackEvent("quick-query", "storage_error", {
        type: "migration_failed",
        message: error.message,
      });
      // Don't throw - allow the app to continue even if migration fails
    }
  }

  // ==================== Low-level DB Operations ====================

  _putRecord(storeName, record) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const request = store.put(record);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  _getRecord(storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  _deleteRecord(storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const request = store.delete(key);

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  _getAllRecords(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  _clearStore(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const request = store.clear();

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  // ==================== Storage Helper Functions ====================

  parseTableIdentifier(fullTableName) {
    const [schemaName, tableName] = fullTableName.split(".");
    if (!schemaName || !tableName) {
      UsageTracker.trackEvent("quick-query", "storage_error", {
        type: "invalid_table_format",
        input: fullTableName,
      });
      throw new Error('Invalid table name format. Expected "schema_name.table_name"');
    }
    return { schemaName, tableName };
  }

  // ==================== Schema Management Functions ====================

  /**
   * Save a schema and optionally its data.
   */
  async saveSchema(fullTableName, schemaData, tableData = null) {
    try {
      const { schemaName, tableName } = this.parseTableIdentifier(fullTableName);

      // Convert schemaData (array-of-arrays) into JSON shape
      const tableSchema = this._convertArraySchemaToJson(schemaData);
      if (!tableSchema) {
        UsageTracker.trackEvent("quick-query", "validation_error", {
          type: "invalid_schema_format",
        });
        throw new Error("Invalid schema format");
      }

      const now = new Date().toISOString();

      // Store schema
      await this._putRecord(SCHEMA_STORE, {
        fullName: fullTableName,
        schemaName,
        tableName,
        schema: tableSchema,
        lastUpdated: now,
      });

      // Store data
      if (tableData) {
        const tableRows = this._convertArrayDataToJsonRows(tableData, tableSchema);
        await this._putRecord(DATA_STORE, {
          fullName: fullTableName,
          schemaName,
          tableName,
          rows: tableRows.slice(0, MAX_CACHED_ROWS),
          lastUpdated: now,
        });
      } else {
        // Ensure data record exists even without rows
        const existing = await this._getRecord(DATA_STORE, fullTableName);
        await this._putRecord(DATA_STORE, {
          fullName: fullTableName,
          schemaName,
          tableName,
          rows: existing?.rows || [],
          lastUpdated: now,
        });
      }

      this._index.dirty = true;
      return true;
    } catch (error) {
      console.error("Error saving schema:", error);
      UsageTracker.trackEvent("quick-query", "storage_error", {
        type: "save_schema_failed",
        message: error.message,
      });
      return false;
    }
  }

  /**
   * Load a schema and optionally its data.
   */
  async loadSchema(fullTableName, includeData = false) {
    try {
      const schemaRecord = await this._getRecord(SCHEMA_STORE, fullTableName);
      if (!schemaRecord) return null;

      const arraySchema = this._convertJsonSchemaToArray(schemaRecord.schema);
      if (!includeData) return arraySchema;

      const dataRecord = await this._getRecord(DATA_STORE, fullTableName);
      const arrayData = dataRecord ? this._convertJsonRowsToArray(dataRecord.rows, arraySchema) : null;

      return { schema: arraySchema, data: arrayData };
    } catch (error) {
      console.error("Error loading schema:", error);
      UsageTracker.trackEvent("quick-query", "storage_error", {
        type: "load_schema_failed",
        message: error.message,
      });
      return null;
    }
  }

  /**
   * Update table data without modifying the schema.
   */
  async updateTableData(fullTableName, tableData) {
    try {
      const schemaRecord = await this._getRecord(SCHEMA_STORE, fullTableName);
      if (!schemaRecord) return false;

      const { schemaName, tableName } = this.parseTableIdentifier(fullTableName);
      const tableRows = this._convertArrayDataToJsonRows(tableData, schemaRecord.schema);
      const now = new Date().toISOString();

      // Update data
      await this._putRecord(DATA_STORE, {
        fullName: fullTableName,
        schemaName,
        tableName,
        rows: tableRows.slice(0, MAX_CACHED_ROWS),
        lastUpdated: now,
      });

      // Update schema's lastUpdated
      schemaRecord.lastUpdated = now;
      await this._putRecord(SCHEMA_STORE, schemaRecord);

      return true;
    } catch (error) {
      console.error("Error updating table data:", error);
      UsageTracker.trackEvent("quick-query", "storage_error", {
        type: "update_table_data_failed",
        message: error.message,
      });
      return false;
    }
  }

  /**
   * Delete a schema and its data.
   */
  async deleteSchema(fullTableName) {
    try {
      await this._deleteRecord(SCHEMA_STORE, fullTableName);
      await this._deleteRecord(DATA_STORE, fullTableName);
      this._index.dirty = true;
      return true;
    } catch (error) {
      console.error("Error deleting schema:", error);
      UsageTracker.trackEvent("quick-query", "storage_error", {
        type: "delete_schema_failed",
        message: error.message,
      });
      return false;
    }
  }

  /**
   * Clear all schemas and data.
   */
  async clearAllSchemas() {
    try {
      await this._clearStore(SCHEMA_STORE);
      await this._clearStore(DATA_STORE);
      this._index.dirty = true;
      return true;
    } catch (error) {
      console.error("Error clearing schemas/data:", error);
      UsageTracker.trackEvent("quick-query", "storage_error", {
        type: "clear_schemas_failed",
        message: error.message,
      });
      return false;
    }
  }

  // ==================== Query Functions ====================

  /**
   * Get all tables with metadata.
   */
  async getAllTables() {
    const schemaRecords = await this._getAllRecords(SCHEMA_STORE);
    const dataRecords = await this._getAllRecords(DATA_STORE);

    // Build data lastUpdated lookup
    const dataLastUpdated = new Map();
    for (const record of dataRecords) {
      dataLastUpdated.set(record.fullName, record.lastUpdated);
    }

    const allTables = schemaRecords.map((record) => {
      const sLU = record.lastUpdated || null;
      const dLU = dataLastUpdated.get(record.fullName) || null;
      let lastUpdated = null;

      if (sLU && dLU) {
        lastUpdated = new Date(dLU).getTime() > new Date(sLU).getTime() ? dLU : sLU;
      } else {
        lastUpdated = sLU || dLU || null;
      }

      return {
        fullName: record.fullName,
        schemaName: record.schemaName,
        tableName: record.tableName,
        lastUpdated,
      };
    });

    // Sort alphabetically
    return allTables.sort((a, b) => {
      if (a.schemaName === b.schemaName) {
        return a.tableName.localeCompare(b.tableName);
      }
      return a.schemaName.localeCompare(b.schemaName);
    });
  }

  /**
   * Return the most recently updated table based on the data store.
   */
  async getMostRecentDataTable() {
    try {
      const dataRecords = await this._getAllRecords(DATA_STORE);
      if (dataRecords.length === 0) return null;

      let best = null;
      for (const record of dataRecords) {
        const ts = record.lastUpdated ? new Date(record.lastUpdated).getTime() : -1;
        if (!best || ts > best.ts) {
          best = {
            ts,
            fullName: record.fullName,
            schemaName: record.schemaName,
            tableName: record.tableName,
            lastUpdated: record.lastUpdated,
          };
        }
      }

      if (!best) return null;
      const { fullName, schemaName, tableName, lastUpdated } = best;
      return { fullName, schemaName, tableName, lastUpdated };
    } catch (_) {
      return null;
    }
  }

  // ==================== Schema Searching Functions ====================

  getByteLength(str) {
    return new TextEncoder().encode(str).length;
  }

  validateOracleName(name, type = "schema") {
    if (type === "table" && typeof name === "undefined") {
      return true;
    }
    if (!name) return false;
    if (!ORACLE_NAME_REGEX.test(name)) return false;

    const byteLength = this.getByteLength(name);
    if (type === "schema" && byteLength > MAX_SCHEMA_LENGTH) return false;
    if (type === "table" && byteLength > MAX_TABLE_LENGTH) return false;

    return true;
  }

  collapseName(str) {
    return (str || "").toLowerCase().replace(/_/g, "");
  }

  isSubsequence(term, text) {
    if (!term || !text) return false;
    const q = term.toLowerCase();
    const t = text.toLowerCase();
    let i = 0;
    for (let c of t) {
      if (c === q[i]) {
        i++;
        if (i === q.length) return true;
      }
    }
    return false;
  }

  scorePlainTerm(term, { name, abbrs = [], collapsed }) {
    const q = (term || "").toLowerCase();
    if (!q) return 0;
    const nm = (name || "").toLowerCase();
    const cl = (collapsed || nm).toLowerCase();

    let score = 0;

    if (abbrs.some((a) => a === q)) score = Math.max(score, 100);
    if (abbrs.some((a) => a.startsWith(q))) score = Math.max(score, 90);
    if (nm.startsWith(q)) score = Math.max(score, 85);
    if (nm.includes(q)) score = Math.max(score, 75);
    if (cl.startsWith(q)) score = Math.max(score, 80);
    if (cl.includes(q)) score = Math.max(score, 70);
    if (q.length >= 3 && this.isSubsequence(q, cl)) score = Math.max(score, 60);

    return score;
  }

  getSchemaAbbreviations(schemaName) {
    const parts = schemaName.split("_");
    const abbrs = new Set();

    abbrs.add(parts.map((part) => part[0]?.toLowerCase()).join(""));

    if (parts.length === 1) {
      const word = parts[0].toLowerCase();
      const consonants = word.replace(/[aeiou]/g, "");
      for (let i = 1; i <= consonants.length; i++) {
        abbrs.add(consonants.slice(0, i));
      }
      for (let i = 1; i <= Math.min(4, word.length); i++) {
        abbrs.add(word.slice(0, i));
        let consonantBased = word.slice(0, i).replace(/[aeiou]/g, "");
        abbrs.add(consonantBased);
      }
      if (word.startsWith("config")) abbrs.add("cfg");
      if (word.startsWith("temp")) abbrs.add("tmp");
      if (word.startsWith("database")) abbrs.add("db");
    }

    parts.forEach((part, index) => {
      const word = part.toLowerCase();
      for (let i = 1; i <= Math.min(4, word.length); i++) {
        if (index === 0) {
          abbrs.add(word.slice(0, i));
        } else {
          const prefix = parts
            .slice(0, index)
            .map((p) => p[0]?.toLowerCase())
            .join("");
          abbrs.add(prefix + word.slice(0, i));
        }
      }
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
      if (index > 0) {
        const prev = parts[index - 1].toLowerCase();
        const prevMax = Math.min(4, prev.length);
        const currMax = Math.min(4, word.length);
        for (let pLen = 2; pLen <= prevMax; pLen++) {
          const prevPrefix = prev.slice(0, pLen);
          for (let cLen = 1; cLen <= currMax; cLen++) {
            abbrs.add(prevPrefix + word.slice(0, cLen));
          }
        }
      }
    });

    return Array.from(abbrs);
  }

  getTableAbbreviations(tableName) {
    const lower = (tableName || "").toLowerCase();
    if (!lower) return [];
    const parts = lower.split("_").filter(Boolean);
    const abbrs = new Set();

    abbrs.add(parts.map((p) => p[0]?.toLowerCase()).join(""));

    if (parts.length > 1) {
      const consonantInitials = parts
        .map((p) => {
          const c = p.replace(/[aeiou]/g, "");
          return (c[0] || p[0] || "").toLowerCase();
        })
        .join("");
      if (consonantInitials) abbrs.add(consonantInitials);
    }

    if (parts.length === 1) {
      const word = parts[0];
      for (let i = 1; i <= Math.min(4, word.length); i++) {
        abbrs.add(word.slice(0, i));
      }
      const consonants = word.replace(/[aeiou]/g, "");
      if (consonants) abbrs.add(consonants);
    } else {
      parts.forEach((part, index) => {
        const word = part;
        for (let i = 1; i <= Math.min(4, word.length); i++) {
          if (index === 0) {
            abbrs.add(word.slice(0, i));
          } else {
            const prefix = parts
              .slice(0, index)
              .map((p) => p[0]?.toLowerCase())
              .join("");
            abbrs.add(prefix + word.slice(0, i));
          }
        }
        const consonants = word.replace(/[aeiou]/g, "");
        if (index === 0) {
          if (consonants) abbrs.add(consonants);
        } else {
          const prefix = parts
            .slice(0, index)
            .map((p) => p[0]?.toLowerCase())
            .join("");
          if (consonants) abbrs.add(prefix + consonants);
        }
      });

      const first = parts[0];
      const second = parts[1];
      if (first && second) {
        for (let i = 1; i <= Math.min(4, second.length); i++) {
          abbrs.add(first + second.slice(0, i));
        }
      }
    }

    return Array.from(abbrs);
  }

  /**
   * Build the in-memory index from persisted schemas.
   */
  async rebuildIndex() {
    const schemaRecords = await this._getAllRecords(SCHEMA_STORE);
    const schemas = new Map();
    const tables = new Map();
    const schemaAbbrIndex = new Map();
    const tableAbbrIndex = new Map();

    for (const record of schemaRecords) {
      const { schemaName, tableName, fullName } = record;

      // Index schema if not already
      if (!schemas.has(schemaName)) {
        const abbrs = this.getSchemaAbbreviations(schemaName);
        const collapsed = this.collapseName(schemaName);
        schemas.set(schemaName, { abbrs, tables: new Set(), collapsed });
        abbrs.forEach((abbr) => {
          const set = schemaAbbrIndex.get(abbr) || new Set();
          set.add(schemaName);
          schemaAbbrIndex.set(abbr, set);
        });
      }

      // Add table to schema
      schemas.get(schemaName).tables.add(tableName);

      // Index table
      const tabbrs = this.getTableAbbreviations(tableName);
      const collapsed = this.collapseName(tableName);
      tables.set(fullName, { schemaName, tableName, abbrs: tabbrs, collapsed });
      tabbrs.forEach((abbr) => {
        const set = tableAbbrIndex.get(abbr) || new Set();
        set.add(fullName);
        tableAbbrIndex.set(abbr, set);
      });
    }

    this._index = { dirty: false, schemas, tables, schemaAbbrIndex, tableAbbrIndex };
  }

  /**
   * Search saved schemas by term.
   */
  async searchSavedSchemas(searchTerm) {
    // Return recent tables when search is empty
    if (!searchTerm) {
      const tables = await this.getAllTables();
      return tables.sort((a, b) => {
        const aTs = a.lastUpdated ? new Date(a.lastUpdated).getTime() : -1;
        const bTs = b.lastUpdated ? new Date(b.lastUpdated).getTime() : -1;
        if (bTs !== aTs) return bTs - aTs;
        if (a.schemaName === b.schemaName) return a.tableName.localeCompare(b.tableName);
        return a.schemaName.localeCompare(b.schemaName);
      });
    }

    if (this._index.dirty) await this.rebuildIndex();

    const results = [];
    const hasDot = searchTerm.includes(".");

    if (hasDot) {
      const [schemaTermRaw = "", tableTermRaw = ""] = searchTerm.split(".");
      const schemaTerm = (schemaTermRaw || "").trim();
      const tableTerm = (tableTermRaw || "").trim();
      const tableWildcard = tableTerm === "";

      this._index.schemas.forEach((schemaInfo, schemaName) => {
        if (!this.validateOracleName(schemaName, "schema")) return;

        const schemaScore = this.scorePlainTerm(schemaTerm, {
          name: schemaName,
          abbrs: schemaInfo.abbrs,
          collapsed: schemaInfo.collapsed,
        });
        if (schemaScore === 0) return;

        schemaInfo.tables.forEach((tableName) => {
          if (!this.validateOracleName(tableName, "table")) return;
          const fullName = `${schemaName}.${tableName}`;

          if (tableWildcard) {
            results.push({ fullName, schemaName, tableName, _score: schemaScore });
            return;
          }

          const tInfo = this._index.tables.get(fullName);
          if (!tInfo) return;

          const tableScore = this.scorePlainTerm(tableTerm, {
            name: tableName,
            abbrs: tInfo.abbrs,
            collapsed: tInfo.collapsed,
          });
          if (tableScore === 0) return;

          results.push({ fullName, schemaName, tableName, _score: schemaScore + tableScore });
        });
      });
    } else {
      const q = searchTerm.trim();
      this._index.tables.forEach((tInfo, fullName) => {
        const { schemaName, tableName, abbrs, collapsed } = tInfo;
        const sInfo = this._index.schemas.get(schemaName);
        const schemaScore = this.scorePlainTerm(q, {
          name: schemaName,
          abbrs: sInfo?.abbrs || [],
          collapsed: sInfo?.collapsed,
        });
        const tableScore = this.scorePlainTerm(q, { name: tableName, abbrs, collapsed });
        const best = Math.max(schemaScore, tableScore);
        if (best > 0) results.push({ fullName, schemaName, tableName, _score: best });
      });
    }

    // Sort by score desc, then alphabetical
    return results
      .sort((a, b) => {
        const diff = (b._score || 0) - (a._score || 0);
        if (diff !== 0) return diff;
        if (a.schemaName === b.schemaName) return a.tableName.localeCompare(b.tableName);
        return a.schemaName.localeCompare(b.schemaName);
      })
      .map(({ _score, ...rest }) => rest);
  }

  validateSchemaFormat(data) {
    if (Array.isArray(data)) {
      if (data.length === 0) return false;
      const hasHeaderRow = Array.isArray(data[0]) && data[0].length >= 2;
      const hasDataRow = Array.isArray(data[1]) && data[1].length >= 2;
      return hasHeaderRow && hasDataRow;
    }
    if (typeof data === "object" && data !== null) {
      const hasTables = Object.values(data).every((schema) => typeof schema === "object");
      return hasTables;
    }
    return false;
  }

  // ==================== Converters ====================

  _convertArraySchemaToJson(schemaArray) {
    try {
      if (!Array.isArray(schemaArray) || schemaArray.length === 0) return null;
      const columns = {};
      const pk = [];
      const unique = [];

      schemaArray.forEach((row) => {
        const [fieldName, dataType, nullable, _default, _order, pkFlag] = row;
        if (!fieldName || !dataType || !nullable) return;

        columns[fieldName] = {};
        columns[fieldName].type = String(dataType);
        if (typeof _default !== "undefined" && _default !== null && _default !== "") {
          columns[fieldName].default = _default;
        }
        columns[fieldName].nullable = String(nullable);

        const pkVal = (pkFlag ?? "").toString().trim().toLowerCase();
        if (pkVal === "yes" || pkVal === "y") pk.push(fieldName);
      });

      return { columns, pk, unique };
    } catch (e) {
      return null;
    }
  }

  _convertJsonSchemaToArray(schemaJson) {
    const rows = [];
    const columns = schemaJson?.columns || {};
    const pkSet = new Set(schemaJson?.pk || []);

    Object.entries(columns).forEach(([fieldName, def]) => {
      const dataType = def?.type || "";
      const nullable = def?.nullable || "Yes";
      const defVal = typeof def?.default !== "undefined" ? def.default : null;
      const pkFlag = pkSet.has(fieldName) ? "Yes" : "No";
      rows.push([fieldName, dataType, nullable, defVal, null, pkFlag]);
    });

    return rows;
  }

  _convertArrayDataToJsonRows(tableData, tableSchema) {
    try {
      if (!Array.isArray(tableData) || tableData.length === 0) return [];
      const header = Array.isArray(tableData[0]) ? tableData[0] : [];
      const columns = Object.keys(tableSchema?.columns || {});
      const missing = header.filter((h) => !columns.includes(h));

      if (missing.length > 0) {
        UsageTracker.trackEvent("quick-query", "validation_error", {
          type: "header_fields_missing",
          missing,
        });
        throw new Error(`Data columns missing in schema: ${missing.join(", ")}`);
      }

      const rows = [];
      tableData.slice(1).forEach((row) => {
        if (!Array.isArray(row) || row.every((cell) => cell === null || cell === "")) return;
        const obj = {};
        header.forEach((fieldName, idx) => {
          const val = row[idx];
          if (val === null || typeof val === "undefined" || val === "") {
            obj[fieldName] = null;
          } else {
            obj[fieldName] = String(val);
          }
        });
        rows.push(obj);
      });

      return rows;
    } catch (e) {
      return [];
    }
  }

  _convertJsonRowsToArray(rows, arraySchema) {
    const header = Array.isArray(arraySchema) ? arraySchema.map((r) => r[0]) : [];
    const dataRows = Array.isArray(rows) ? rows.map((obj) => header.map((field) => (obj?.[field] == null ? null : obj[field]))) : [];

    if (dataRows.length === 0) {
      dataRows.push(Array(header.length).fill(null));
    }

    return [header, ...dataRows];
  }
}
