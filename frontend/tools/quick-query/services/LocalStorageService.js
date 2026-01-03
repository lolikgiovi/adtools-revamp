import { UsageTracker } from "../../../core/UsageTracker.js";
const SCHEMA_STORAGE_KEY = "tool:quick-query:schema";
const DATA_STORAGE_KEY = "tool:quick-query:data";
const ORACLE_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_$#]*$/;
const MAX_SCHEMA_LENGTH = 30;
const MAX_TABLE_LENGTH = 128;
const MAX_CACHED_ROWS = 300;

export class LocalStorageService {
  constructor() {
    this.SCHEMA_STORAGE_KEY = SCHEMA_STORAGE_KEY;
    this.DATA_STORAGE_KEY = DATA_STORAGE_KEY;
    // In-memory search index (rebuilt when schema store changes)
    this._index = {
      dirty: true,
      schemas: new Map(), // schemaName -> { abbrs: string[], tables: Set<string> }
      tables: new Map(), // fullName -> { schemaName, tableName, abbrs: string[] }
      schemaAbbrIndex: new Map(), // abbr -> Set<schemaName>
      tableAbbrIndex: new Map(), // abbr -> Set<fullName>
    };
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

  // Unified helpers for separated schema/data storage
  getSchemaStore() {
    try {
      const raw = localStorage.getItem(this.SCHEMA_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      // Basic shape validation: { schema: { tables: { table: { columns, pk, unique } } } }
      if (typeof parsed !== "object" || parsed === null) {
        UsageTracker.trackEvent("quick-query", "storage_error", { type: "schema_corrupted" });
        return {};
      }
      return parsed;
    } catch (error) {
      console.error("Error reading schema store:", error);
      UsageTracker.trackEvent("quick-query", "storage_error", { type: "schema_read_failed", message: error.message });
      return {};
    }
  }

  getDataStore() {
    try {
      const raw = localStorage.getItem(this.DATA_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      // Basic shape validation: { schema: { table: { rows: [...] } } }
      if (typeof parsed !== "object" || parsed === null) {
        UsageTracker.trackEvent("quick-query", "storage_error", { type: "data_corrupted" });
        return {};
      }
      return parsed;
    } catch (error) {
      console.error("Error reading data store:", error);
      UsageTracker.trackEvent("quick-query", "storage_error", { type: "data_read_failed", message: error.message });
      return {};
    }
  }

  saveSchemaStore(store) {
    try {
      const payload = JSON.stringify(store);
      localStorage.setItem(this.SCHEMA_STORAGE_KEY, payload);
      // Mark index dirty so it can be rebuilt lazily on next search
      this._index.dirty = true;
      return true;
    } catch (error) {
      console.error("Error saving schema store:", error);
      const type =
        error &&
        String(error.name || "")
          .toLowerCase()
          .includes("quota")
          ? "quota_exceeded"
          : "schema_write_failed";
      UsageTracker.trackEvent("quick-query", "storage_error", { type, message: error.message });
      return false;
    }
  }

  saveDataStore(store) {
    try {
      const payload = JSON.stringify(store);
      localStorage.setItem(this.DATA_STORAGE_KEY, payload);
      return true;
    } catch (error) {
      console.error("Error saving data store:", error);
      const type =
        error &&
        String(error.name || "")
          .toLowerCase()
          .includes("quota")
          ? "quota_exceeded"
          : "data_write_failed";
      UsageTracker.trackEvent("quick-query", "storage_error", { type, message: error.message });
      return false;
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

      // 1) Convert schemaData (array-of-arrays) into new schema JSON shape
      const tableSchema = this._convertArraySchemaToJson(schemaData);
      if (!tableSchema) {
        UsageTracker.trackEvent("quick-query", "validation_error", { type: "invalid_schema_format" });
        throw new Error("Invalid schema format");
      }

      const now = new Date().toISOString();
      tableSchema.last_updated = now;

      const schemaStore = this.getSchemaStore();
      schemaStore[schemaName] = schemaStore[schemaName] || { tables: {} };
      schemaStore[schemaName].tables[tableName] = tableSchema;

      const schemaSaved = this.saveSchemaStore(schemaStore);
      if (!schemaSaved) return false;

      // 2) Optional: handle data table saving separately
      const dataStore = this.getDataStore();
      dataStore[schemaName] = dataStore[schemaName] || {};
      if (tableData) {
        const tableRows = this._convertArrayDataToJsonRows(tableData, tableSchema);
        dataStore[schemaName][tableName] = { rows: tableRows.slice(0, MAX_CACHED_ROWS), last_updated: now };
      } else {
        // Ensure last_updated is also persisted in data store even without rows
        const existing = dataStore[schemaName][tableName];
        dataStore[schemaName][tableName] = { rows: Array.isArray(existing?.rows) ? existing.rows : [], last_updated: now };
      }

      const dataSaved = this.saveDataStore(dataStore);
      if (!dataSaved) return false;

      return true;
    } catch (error) {
      console.error("Error saving schema:", error);
      UsageTracker.trackEvent("quick-query", "storage_error", { type: "save_schema_failed", message: error.message });
      return false;
    }
  }

  loadSchema(fullTableName, includeData = false) {
    try {
      const { schemaName, tableName } = this.parseTableIdentifier(fullTableName);
      const schemaStore = this.getSchemaStore();
      const schemaJson = schemaStore?.[schemaName]?.tables?.[tableName];
      if (!schemaJson) return null;

      const arraySchema = this._convertJsonSchemaToArray(schemaJson);
      if (!includeData) return arraySchema;

      const dataStore = this.getDataStore();
      const tableDataObj = dataStore?.[schemaName]?.[tableName] || null;
      const arrayData = tableDataObj ? this._convertJsonRowsToArray(tableDataObj.rows, arraySchema) : null;

      return { schema: arraySchema, data: arrayData };
    } catch (error) {
      console.error("Error loading schema:", error);
      UsageTracker.trackEvent("quick-query", "storage_error", { type: "load_schema_failed", message: error.message });
      return null;
    }
  }

  updateTableData(fullTableName, tableData) {
    try {
      const { schemaName, tableName } = this.parseTableIdentifier(fullTableName);
      const schemaStore = this.getSchemaStore();
      if (!schemaStore?.[schemaName]?.tables?.[tableName]) {
        return false;
      }

      const tableSchema = schemaStore[schemaName].tables[tableName];
      const dataStore = this.getDataStore();
      const tableRows = this._convertArrayDataToJsonRows(tableData, tableSchema);
      const now = new Date().toISOString();
      dataStore[schemaName] = dataStore[schemaName] || {};
      dataStore[schemaName][tableName] = { rows: tableRows.slice(0, MAX_CACHED_ROWS), last_updated: now };

      // Keep schema store's last_updated in sync to represent last activity
      schemaStore[schemaName].tables[tableName].last_updated = now;

      const dataSaved = this.saveDataStore(dataStore);
      const schemaSaved = this.saveSchemaStore(schemaStore);
      return dataSaved && schemaSaved;
    } catch (error) {
      console.error("Error updating table data:", error);
      UsageTracker.trackEvent("quick-query", "storage_error", { type: "update_table_data_failed", message: error.message });
      return false;
    }
  }

  deleteSchema(fullTableName) {
    try {
      const { schemaName, tableName } = this.parseTableIdentifier(fullTableName);
      const schemaStore = this.getSchemaStore();
      const dataStore = this.getDataStore();

      let changed = false;
      if (schemaStore?.[schemaName]?.tables?.[tableName]) {
        delete schemaStore[schemaName].tables[tableName];
        changed = true;
        if (Object.keys(schemaStore[schemaName].tables).length === 0) {
          delete schemaStore[schemaName];
        }
      }
      if (dataStore?.[schemaName]?.[tableName]) {
        delete dataStore[schemaName][tableName];
        if (Object.keys(dataStore[schemaName]).length === 0) {
          delete dataStore[schemaName];
        }
        changed = true;
      }

      if (!changed) return false;
      const a = this.saveSchemaStore(schemaStore);
      const b = this.saveDataStore(dataStore);
      this._index.dirty = true;
      return a && b;
    } catch (error) {
      console.error("Error deleting schema:", error);
      UsageTracker.trackEvent("quick-query", "storage_error", { type: "delete_schema_failed", message: error.message });
      return false;
    }
  }

  clearAllSchemas() {
    try {
      localStorage.removeItem(this.SCHEMA_STORAGE_KEY);
      localStorage.removeItem(this.DATA_STORAGE_KEY);
      this._index.dirty = true;
      return true;
    } catch (error) {
      console.error("Error clearing schemas/data:", error);
      UsageTracker.trackEvent("quick-query", "storage_error", { type: "clear_schemas_failed", message: error.message });
      return false;
    }
  }

  // Query Functions
  getAllTables() {
    const schemaStore = this.getSchemaStore();
    const dataStore = this.getDataStore();
    const allTables = [];

    Object.entries(schemaStore || {}).forEach(([schemaName, schemaData]) => {
      const tables = schemaData?.tables || {};
      Object.keys(tables).forEach((tableName) => {
        const sLU = tables[tableName]?.last_updated || null;
        const dLU = dataStore?.[schemaName]?.[tableName]?.last_updated || null;
        let lastUpdated = null;
        if (sLU && dLU) {
          lastUpdated = new Date(dLU).getTime() > new Date(sLU).getTime() ? dLU : sLU;
        } else {
          lastUpdated = sLU || dLU || null;
        }
        allTables.push({
          fullName: `${schemaName}.${tableName}`,
          schemaName,
          tableName,
          lastUpdated,
        });
      });
    });

    // Sort alphabetically to ensure consistent ordering without timestamps
    return allTables.sort((a, b) => {
      if (a.schemaName === b.schemaName) return a.tableName.localeCompare(b.tableName);
      return a.schemaName.localeCompare(b.schemaName);
    });
  }

  // Return the most recently updated table based solely on the data store
  getMostRecentDataTable() {
    try {
      const dataStore = this.getDataStore();
      let best = null;
      Object.entries(dataStore || {}).forEach(([schemaName, tables]) => {
        Object.entries(tables || {}).forEach(([tableName, info]) => {
          const ts = info?.last_updated ? new Date(info.last_updated).getTime() : -1;
          if (!best || ts > best.ts) {
            best = { ts, schemaName, tableName, fullName: `${schemaName}.${tableName}`, lastUpdated: info?.last_updated || null };
          }
        });
      });
      if (!best) return null;
      const { fullName, schemaName, tableName, lastUpdated } = best;
      return { fullName, schemaName, tableName, lastUpdated };
    } catch (_) {
      return null;
    }
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

  // Collapse helper: remove underscores and lowercase for plain-text matching
  collapseName(str) {
    return (str || "").toLowerCase().replace(/_/g, "");
  }

  // Subsequence check: characters of term appear in order in text
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

  // Compute a relevance score for a plain term across name/abbrs/collapsed
  scorePlainTerm(term, { name, abbrs = [], collapsed }) {
    const q = (term || "").toLowerCase();
    if (!q) return 0;
    const nm = (name || "").toLowerCase();
    const cl = (collapsed || nm).toLowerCase();

    let score = 0;

    // Exact abbreviation
    if (abbrs.some((a) => a === q)) score = Math.max(score, 100);
    // Abbreviation prefix
    if (abbrs.some((a) => a.startsWith(q))) score = Math.max(score, 90);

    // Raw name prefix/contains
    if (nm.startsWith(q)) score = Math.max(score, 85);
    if (nm.includes(q)) score = Math.max(score, 75);

    // Collapsed name prefix/contains
    if (cl.startsWith(q)) score = Math.max(score, 80);
    if (cl.includes(q)) score = Math.max(score, 70);

    // Subsequence on collapsed (gated to length >= 3)
    if (q.length >= 3 && this.isSubsequence(q, cl)) score = Math.max(score, 60);

    return score;
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

      // Cross-part progressive prefixes: allow longer prefix from previous part(s)
      // Example: saving_plan -> "sap" ("sa" + "p"), "sapla" ("sa" + "pla")
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

  // Table name abbreviations extend schema rules with an extra pattern:
  // full first word + first letters of the next word(s), e.g.,
  // "app_config" -> "appc", "appco", "appcon", "appconf".
  getTableAbbreviations(tableName) {
    const lower = (tableName || "").toLowerCase();
    if (!lower) return [];
    const parts = lower.split("_").filter(Boolean);
    const abbrs = new Set();

    // Acronym of first letters (e.g., user_account -> ua)
    abbrs.add(parts.map((p) => p[0]?.toLowerCase()).join(""));

    // Consonant-first initials chain across parts (e.g., bo_export_map -> bxm)
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
      // Progressive prefixes using initials of previous words
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

      // Extension: first word in full + progressive prefixes of the second
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

  // Build the in-memory index from the persisted schema store
  rebuildIndex() {
    const schemaStore = this.getSchemaStore();
    const schemas = new Map();
    const tables = new Map();
    const schemaAbbrIndex = new Map();
    const tableAbbrIndex = new Map();

    Object.entries(schemaStore || {}).forEach(([schemaName, schemaData]) => {
      const abbrs = this.getSchemaAbbreviations(schemaName);
      const tableSet = new Set();
      const collapsed = this.collapseName(schemaName);
      schemas.set(schemaName, { abbrs, tables: tableSet, collapsed });
      abbrs.forEach((abbr) => {
        const set = schemaAbbrIndex.get(abbr) || new Set();
        set.add(schemaName);
        schemaAbbrIndex.set(abbr, set);
      });

      const tablesObj = schemaData?.tables || {};
      Object.keys(tablesObj).forEach((tableName) => {
        const fullName = `${schemaName}.${tableName}`;
        const tabbrs = this.getTableAbbreviations(tableName);
        const collapsed = this.collapseName(tableName);
        tableSet.add(tableName);
        tables.set(fullName, { schemaName, tableName, abbrs: tabbrs, collapsed });
        tabbrs.forEach((abbr) => {
          const set = tableAbbrIndex.get(abbr) || new Set();
          set.add(fullName);
          tableAbbrIndex.set(abbr, set);
        });
      });
    });

    this._index = { dirty: false, schemas, tables, schemaAbbrIndex, tableAbbrIndex };
  }

  searchSavedSchemas(searchTerm) {
    // When search is empty, return recent tables to enable default suggestions
    if (!searchTerm) {
      const tables = this.getAllTables();
      return tables.sort((a, b) => {
        const aTs = a.lastUpdated ? new Date(a.lastUpdated).getTime() : -1;
        const bTs = b.lastUpdated ? new Date(b.lastUpdated).getTime() : -1;
        if (bTs !== aTs) return bTs - aTs; // newest first
        if (a.schemaName === b.schemaName) return a.tableName.localeCompare(b.tableName);
        return a.schemaName.localeCompare(b.schemaName);
      });
    }
    if (this._index.dirty) this.rebuildIndex();
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

    // Sort by score desc, then alphabetical for stability
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
    // Keep legacy validation for UI arrays
    if (Array.isArray(data)) {
      if (data.length === 0) return false;
      const hasHeaderRow = Array.isArray(data[0]) && data[0].length >= 2;
      const hasDataRow = Array.isArray(data[1]) && data[1].length >= 2;
      return hasHeaderRow && hasDataRow;
    }
    // New schema JSON validation (partial): { tables: { ... } }
    if (typeof data === "object" && data !== null) {
      const hasTables = Object.values(data).every((schema) => typeof schema === "object");
      return hasTables;
    }
    return false;
  }

  // ---------------------- Converters ----------------------
  _convertArraySchemaToJson(schemaArray) {
    try {
      if (!Array.isArray(schemaArray) || schemaArray.length === 0) return null;
      const columns = {};
      const pk = [];
      const unique = [];
      schemaArray.forEach((row) => {
        const [fieldName, dataType, nullable, _default, _order, pkFlag] = row;
        if (!fieldName || !dataType || !nullable) return; // basic guard
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
      // Validate: header fields must exist in schema columns
      const columns = Object.keys(tableSchema?.columns || {});
      const missing = header.filter((h) => !columns.includes(h));
      if (missing.length > 0) {
        UsageTracker.trackEvent("quick-query", "validation_error", { type: "header_fields_missing", missing });
        throw new Error(`Data columns missing in schema: ${missing.join(", ")}`);
      }
      const rows = [];
      tableData.slice(1).forEach((row) => {
        // Skip entirely empty rows
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
    // Recreate a 2D array with header row from schema fields order
    const header = Array.isArray(arraySchema) ? arraySchema.map((r) => r[0]) : [];
    const dataRows = Array.isArray(rows)
      ? rows.map((obj) => header.map((field) => (obj?.[field] == null ? null : obj[field])))
      : [];

    // If there are no stored data rows, treat it as a new empty row
    // so the spreadsheet always shows a writable row under the header.
    if (dataRows.length === 0) {
      dataRows.push(Array(header.length).fill(null));
    }

    return [header, ...dataRows];
  }
}
