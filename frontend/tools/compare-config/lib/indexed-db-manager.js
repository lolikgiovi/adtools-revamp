/**
 * IndexedDB Manager for Compare Config
 *
 * Manages persistent storage for:
 * - Excel Compare: uploaded files, session state
 * - Schema/Table: field preferences per schema+table combination
 * - Raw SQL: field preferences per query
 * - Comparison history for quick re-runs
 */

/**
 * Database configuration
 */
const DB_NAME = 'CompareConfigDB';
const DB_VERSION = 4;

/**
 * Object store names
 */
export const STORES = {
  EXCEL_FILES: 'excelFiles',
  EXCEL_COMPARE_STATE: 'excelCompareState',
  EXCEL_FILE_PREFS: 'excelFilePrefs',
  SCHEMA_TABLE_PREFS: 'schemaTablePrefs',
  RAW_SQL_PREFS: 'rawSqlPrefs',
  COMPARISON_HISTORY: 'comparisonHistory',
  UNIFIED_EXCEL_FILES: 'unifiedExcelFiles', // Phase 2: For unified compare Excel files
  TOOL_STATE: 'toolState', // For persisting large comparison results
};

/**
 * Database connection instance (singleton)
 */
let dbInstance = null;

/**
 * Opens or creates the IndexedDB database
 * @returns {Promise<IDBDatabase>} Database instance
 */
function openDatabase() {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('Failed to open IndexedDB:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      dbInstance = request.result;

      // Handle connection close
      dbInstance.onclose = () => {
        dbInstance = null;
      };

      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Create excelFiles store
      if (!db.objectStoreNames.contains(STORES.EXCEL_FILES)) {
        const excelFilesStore = db.createObjectStore(STORES.EXCEL_FILES, { keyPath: 'id' });
        excelFilesStore.createIndex('type', 'type', { unique: false });
        excelFilesStore.createIndex('uploadedAt', 'uploadedAt', { unique: false });
      }

      // Create excelCompareState store
      if (!db.objectStoreNames.contains(STORES.EXCEL_COMPARE_STATE)) {
        db.createObjectStore(STORES.EXCEL_COMPARE_STATE, { keyPath: 'id' });
      }

      // Create excelFilePrefs store (preferences per reference filename)
      if (!db.objectStoreNames.contains(STORES.EXCEL_FILE_PREFS)) {
        const excelFilePrefsStore = db.createObjectStore(STORES.EXCEL_FILE_PREFS, { keyPath: 'refFilename' });
        excelFilePrefsStore.createIndex('lastUsed', 'lastUsed', { unique: false });
      }

      // Create schemaTablePrefs store
      if (!db.objectStoreNames.contains(STORES.SCHEMA_TABLE_PREFS)) {
        const schemaTableStore = db.createObjectStore(STORES.SCHEMA_TABLE_PREFS, { keyPath: 'key' });
        schemaTableStore.createIndex('connectionId', 'connectionId', { unique: false });
        schemaTableStore.createIndex('lastUsed', 'lastUsed', { unique: false });
      }

      // Create rawSqlPrefs store
      if (!db.objectStoreNames.contains(STORES.RAW_SQL_PREFS)) {
        const rawSqlStore = db.createObjectStore(STORES.RAW_SQL_PREFS, { keyPath: 'queryHash' });
        rawSqlStore.createIndex('lastUsed', 'lastUsed', { unique: false });
      }

      // Create comparisonHistory store
      if (!db.objectStoreNames.contains(STORES.COMPARISON_HISTORY)) {
        const historyStore = db.createObjectStore(STORES.COMPARISON_HISTORY, {
          keyPath: 'id',
          autoIncrement: true,
        });
        historyStore.createIndex('mode', 'mode', { unique: false });
        historyStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      // Create unifiedExcelFiles store (Phase 2: for unified compare mode)
      if (!db.objectStoreNames.contains(STORES.UNIFIED_EXCEL_FILES)) {
        const unifiedExcelFilesStore = db.createObjectStore(STORES.UNIFIED_EXCEL_FILES, { keyPath: 'id' });
        unifiedExcelFilesStore.createIndex('source', 'source', { unique: false }); // 'sourceA' or 'sourceB'
        unifiedExcelFilesStore.createIndex('uploadedAt', 'uploadedAt', { unique: false });
      }

      // Create toolState store (for persisting large comparison results)
      if (!db.objectStoreNames.contains(STORES.TOOL_STATE)) {
        db.createObjectStore(STORES.TOOL_STATE, { keyPath: 'id' });
      }
    };
  });
}

/**
 * Closes the database connection
 */
export function closeDatabase() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/**
 * Generic helper to perform a transaction operation
 * @param {string} storeName - Object store name
 * @param {string} mode - Transaction mode ('readonly' or 'readwrite')
 * @param {function} operation - Operation to perform with the store
 * @returns {Promise<any>} Operation result
 */
async function withStore(storeName, mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);

    transaction.onerror = () => reject(transaction.error);

    try {
      const result = operation(store, resolve, reject);
      // If operation returns a request, handle it
      if (result instanceof IDBRequest) {
        result.onsuccess = () => resolve(result.result);
        result.onerror = () => reject(result.error);
      }
    } catch (error) {
      reject(error);
    }
  });
}

// =============================================================================
// Excel Files Store Operations
// =============================================================================

/**
 * Saves an Excel file to IndexedDB
 * @param {Object} fileData - File data object
 * @param {string} fileData.id - Unique file ID
 * @param {string} fileData.name - Original filename
 * @param {ArrayBuffer} fileData.content - File binary content
 * @param {string} fileData.type - 'ref' or 'comp'
 * @returns {Promise<string>} The file ID
 */
export async function saveExcelFile(fileData) {
  const record = {
    id: fileData.id,
    name: fileData.name,
    content: fileData.content,
    type: fileData.type,
    size: fileData.content.byteLength,
    uploadedAt: new Date(),
  };

  await withStore(STORES.EXCEL_FILES, 'readwrite', (store) => store.put(record));
  return record.id;
}

/**
 * Gets an Excel file by ID
 * @param {string} id - File ID
 * @returns {Promise<Object|null>} File data or null if not found
 */
export async function getExcelFile(id) {
  return withStore(STORES.EXCEL_FILES, 'readonly', (store) => store.get(id));
}

/**
 * Gets all Excel files of a specific type
 * @param {string} type - 'ref' or 'comp'
 * @returns {Promise<Array>} Array of file records
 */
export async function getExcelFilesByType(type) {
  return withStore(STORES.EXCEL_FILES, 'readonly', (store, resolve, reject) => {
    const index = store.index('type');
    const request = index.getAll(type);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Gets all Excel files
 * @returns {Promise<Array>} Array of all file records
 */
export async function getAllExcelFiles() {
  return withStore(STORES.EXCEL_FILES, 'readonly', (store) => store.getAll());
}

/**
 * Deletes an Excel file by ID
 * @param {string} id - File ID
 * @returns {Promise<void>}
 */
export async function deleteExcelFile(id) {
  return withStore(STORES.EXCEL_FILES, 'readwrite', (store) => store.delete(id));
}

/**
 * Clears all Excel files
 * @returns {Promise<void>}
 */
export async function clearAllExcelFiles() {
  return withStore(STORES.EXCEL_FILES, 'readwrite', (store) => store.clear());
}

// =============================================================================
// Excel Compare State Operations
// =============================================================================

/**
 * Saves the Excel Compare session state
 * @param {Object} state - State object to save
 * @returns {Promise<void>}
 */
export async function saveExcelCompareState(state) {
  const record = {
    id: 'current',
    ...state,
    lastUpdated: new Date(),
  };
  return withStore(STORES.EXCEL_COMPARE_STATE, 'readwrite', (store) => store.put(record));
}

/**
 * Gets the current Excel Compare session state
 * @returns {Promise<Object|null>} State object or null if not found
 */
export async function getExcelCompareState() {
  return withStore(STORES.EXCEL_COMPARE_STATE, 'readonly', (store) => store.get('current'));
}

/**
 * Clears the Excel Compare session state
 * @returns {Promise<void>}
 */
export async function clearExcelCompareState() {
  return withStore(STORES.EXCEL_COMPARE_STATE, 'readwrite', (store) => store.delete('current'));
}

// =============================================================================
// Unified Excel Files Store Operations (Phase 2)
// =============================================================================

/**
 * Saves a unified Excel file to IndexedDB
 * @param {Object} fileData - File data object
 * @param {string} fileData.id - Unique file ID
 * @param {string} fileData.name - Original filename
 * @param {ArrayBuffer} fileData.content - File binary content
 * @param {string} fileData.source - 'sourceA' or 'sourceB'
 * @returns {Promise<string>} The file ID
 */
export async function saveUnifiedExcelFile(fileData) {
  const record = {
    id: fileData.id,
    name: fileData.name,
    content: fileData.content,
    source: fileData.source,
    size: fileData.content.byteLength,
    uploadedAt: new Date(),
  };

  await withStore(STORES.UNIFIED_EXCEL_FILES, 'readwrite', (store) => store.put(record));
  return record.id;
}

/**
 * Gets a unified Excel file by ID
 * @param {string} id - File ID
 * @returns {Promise<Object|null>} File data or null if not found
 */
export async function getUnifiedExcelFile(id) {
  return withStore(STORES.UNIFIED_EXCEL_FILES, 'readonly', (store) => store.get(id));
}

/**
 * Gets all unified Excel files for a specific source
 * @param {string} source - 'sourceA' or 'sourceB'
 * @returns {Promise<Array>} Array of file records
 */
export async function getUnifiedExcelFiles(source) {
  return withStore(STORES.UNIFIED_EXCEL_FILES, 'readonly', (store, resolve, reject) => {
    const index = store.index('source');
    const request = index.getAll(source);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Gets all unified Excel files
 * @returns {Promise<Array>} Array of all file records
 */
export async function getAllUnifiedExcelFiles() {
  return withStore(STORES.UNIFIED_EXCEL_FILES, 'readonly', (store) => store.getAll());
}

/**
 * Deletes a unified Excel file by ID
 * @param {string} id - File ID
 * @returns {Promise<void>}
 */
export async function deleteUnifiedExcelFile(id) {
  return withStore(STORES.UNIFIED_EXCEL_FILES, 'readwrite', (store) => store.delete(id));
}

/**
 * Clears all unified Excel files for a specific source
 * @param {string} source - 'sourceA' or 'sourceB'
 * @returns {Promise<void>}
 */
export async function clearUnifiedExcelFiles(source) {
  return withStore(STORES.UNIFIED_EXCEL_FILES, 'readwrite', (store, resolve, reject) => {
    const index = store.index('source');
    const request = index.getAllKeys(source);

    request.onsuccess = () => {
      const keys = request.result;
      let pending = keys.length;

      if (pending === 0) {
        resolve();
        return;
      }

      for (const key of keys) {
        const deleteRequest = store.delete(key);
        deleteRequest.onsuccess = () => {
          pending--;
          if (pending === 0) resolve();
        };
        deleteRequest.onerror = () => reject(deleteRequest.error);
      }
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * Clears all unified Excel files (both sources)
 * @returns {Promise<void>}
 */
export async function clearAllUnifiedExcelFiles() {
  return withStore(STORES.UNIFIED_EXCEL_FILES, 'readwrite', (store) => store.clear());
}

// =============================================================================
// Excel File Preferences Operations
// =============================================================================

/**
 * Saves preferences for an Excel file (by reference filename)
 * @param {Object} prefs - Preferences object
 * @param {string} prefs.refFilename - Reference filename (used as key)
 * @param {string[]} prefs.selectedPkFields - Selected primary key fields
 * @param {string[]} prefs.selectedFields - Selected comparison fields
 * @param {string} [prefs.rowMatching] - Row matching mode ('key' or 'position')
 * @param {string} [prefs.dataComparison] - Data comparison mode ('strict' or 'normalized')
 * @returns {Promise<string>} The reference filename
 */
export async function saveExcelFilePrefs(prefs) {
  const record = {
    refFilename: prefs.refFilename,
    selectedPkFields: prefs.selectedPkFields || [],
    selectedFields: prefs.selectedFields || [],
    rowMatching: prefs.rowMatching || 'key',
    dataComparison: prefs.dataComparison || 'strict',
    lastUsed: new Date(),
  };

  await withStore(STORES.EXCEL_FILE_PREFS, 'readwrite', (store) => store.put(record));
  return record.refFilename;
}

/**
 * Gets preferences for an Excel file by reference filename
 * @param {string} refFilename - Reference filename
 * @returns {Promise<Object|null>} Preferences or null if not found
 */
export async function getExcelFilePrefs(refFilename) {
  return withStore(STORES.EXCEL_FILE_PREFS, 'readonly', (store) => store.get(refFilename));
}

/**
 * Gets all Excel file preferences
 * @returns {Promise<Array>} Array of all Excel file preference records
 */
export async function getAllExcelFilePrefs() {
  return withStore(STORES.EXCEL_FILE_PREFS, 'readonly', (store) => store.getAll());
}

/**
 * Deletes preferences for an Excel file
 * @param {string} refFilename - Reference filename
 * @returns {Promise<void>}
 */
export async function deleteExcelFilePrefs(refFilename) {
  return withStore(STORES.EXCEL_FILE_PREFS, 'readwrite', (store) => store.delete(refFilename));
}

/**
 * Clears all Excel file preferences
 * @returns {Promise<void>}
 */
export async function clearAllExcelFilePrefs() {
  return withStore(STORES.EXCEL_FILE_PREFS, 'readwrite', (store) => store.clear());
}

// =============================================================================
// Schema/Table Preferences Operations
// =============================================================================

/**
 * Generates a key for schema/table preferences
 * Uses schema.table format for specificity while remaining portable across connections
 * @param {string} connectionId - Connection identifier (kept for compatibility, not used in key)
 * @param {string} schema - Schema name
 * @param {string} table - Table name
 * @returns {string} Key based on schema.table
 */
export function generateSchemaTableKey(connectionId, schema, table) {
  // Use schema.table for better specificity (same table name can exist in different schemas)
  return `${schema}.${table}`;
}

/**
 * Saves preferences for a schema/table combination
 * @param {Object} prefs - Preferences object
 * @param {string} prefs.connectionId - Connection identifier
 * @param {string} prefs.schema - Schema name
 * @param {string} prefs.table - Table name
 * @param {string[]} prefs.selectedPkFields - Selected primary key fields
 * @param {string[]} prefs.selectedFields - Selected comparison fields
 * @param {string} [prefs.rowMatching] - Row matching mode ('key' or 'position')
 * @param {string} [prefs.dataComparison] - Data comparison mode ('strict' or 'normalized')
 * @returns {Promise<string>} The preference key
 */
export async function saveSchemaTablePrefs(prefs) {
  const key = generateSchemaTableKey(prefs.connectionId, prefs.schema, prefs.table);
  const record = {
    key,
    connectionId: prefs.connectionId,
    schema: prefs.schema,
    table: prefs.table,
    selectedPkFields: prefs.selectedPkFields || [],
    selectedFields: prefs.selectedFields || [],
    rowMatching: prefs.rowMatching || 'key',
    dataComparison: prefs.dataComparison || 'strict',
    lastUsed: new Date(),
  };

  await withStore(STORES.SCHEMA_TABLE_PREFS, 'readwrite', (store) => store.put(record));
  return key;
}

/**
 * Gets preferences for a schema/table combination
 * @param {string} connectionId - Connection identifier
 * @param {string} schema - Schema name
 * @param {string} table - Table name
 * @returns {Promise<Object|null>} Preferences or null if not found
 */
export async function getSchemaTablePrefs(connectionId, schema, table) {
  const key = generateSchemaTableKey(connectionId, schema, table);
  return withStore(STORES.SCHEMA_TABLE_PREFS, 'readonly', (store) => store.get(key));
}

/**
 * Gets all preferences for a connection
 * @param {string} connectionId - Connection identifier
 * @returns {Promise<Array>} Array of preference records
 */
export async function getSchemaTablePrefsByConnection(connectionId) {
  return withStore(STORES.SCHEMA_TABLE_PREFS, 'readonly', (store, resolve, reject) => {
    const index = store.index('connectionId');
    const request = index.getAll(connectionId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Deletes preferences for a schema/table combination
 * @param {string} connectionId - Connection identifier
 * @param {string} schema - Schema name
 * @param {string} table - Table name
 * @returns {Promise<void>}
 */
export async function deleteSchemaTablePrefs(connectionId, schema, table) {
  const key = generateSchemaTableKey(connectionId, schema, table);
  return withStore(STORES.SCHEMA_TABLE_PREFS, 'readwrite', (store) => store.delete(key));
}

/**
 * Clears all schema/table preferences
 * @returns {Promise<void>}
 */
export async function clearAllSchemaTablePrefs() {
  return withStore(STORES.SCHEMA_TABLE_PREFS, 'readwrite', (store) => store.clear());
}

// =============================================================================
// Raw SQL Preferences Operations
// =============================================================================

/**
 * Simple hash function for SQL queries
 * @param {string} sql - SQL query string
 * @returns {string} Hash string
 */
export function hashSqlQuery(sql) {
  // Normalize whitespace and case for consistent hashing
  const normalized = sql.trim().toLowerCase().replace(/\s+/g, ' ');
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `sql_${Math.abs(hash).toString(16)}`;
}

/**
 * Saves preferences for a raw SQL query
 * @param {Object} prefs - Preferences object
 * @param {string} prefs.query - The SQL query
 * @param {string[]} prefs.selectedPkFields - Selected primary key fields
 * @param {string[]} prefs.selectedFields - Selected comparison fields
 * @param {string} [prefs.rowMatching] - Row matching mode
 * @param {string} [prefs.dataComparison] - Data comparison mode
 * @returns {Promise<string>} The query hash
 */
export async function saveRawSqlPrefs(prefs) {
  const queryHash = hashSqlQuery(prefs.query);
  const record = {
    queryHash,
    query: prefs.query,
    selectedPkFields: prefs.selectedPkFields || [],
    selectedFields: prefs.selectedFields || [],
    rowMatching: prefs.rowMatching || 'key',
    dataComparison: prefs.dataComparison || 'strict',
    lastUsed: new Date(),
  };

  await withStore(STORES.RAW_SQL_PREFS, 'readwrite', (store) => store.put(record));
  return queryHash;
}

/**
 * Gets preferences for a raw SQL query
 * @param {string} query - The SQL query
 * @returns {Promise<Object|null>} Preferences or null if not found
 */
export async function getRawSqlPrefs(query) {
  const queryHash = hashSqlQuery(query);
  return withStore(STORES.RAW_SQL_PREFS, 'readonly', (store) => store.get(queryHash));
}

/**
 * Gets all raw SQL preferences
 * @returns {Promise<Array>} Array of all SQL preference records
 */
export async function getAllRawSqlPrefs() {
  return withStore(STORES.RAW_SQL_PREFS, 'readonly', (store) => store.getAll());
}

/**
 * Deletes preferences for a raw SQL query
 * @param {string} query - The SQL query
 * @returns {Promise<void>}
 */
export async function deleteRawSqlPrefs(query) {
  const queryHash = hashSqlQuery(query);
  return withStore(STORES.RAW_SQL_PREFS, 'readwrite', (store) => store.delete(queryHash));
}

/**
 * Clears all raw SQL preferences
 * @returns {Promise<void>}
 */
export async function clearAllRawSqlPrefs() {
  return withStore(STORES.RAW_SQL_PREFS, 'readwrite', (store) => store.clear());
}

// =============================================================================
// Comparison History Operations
// =============================================================================

/**
 * Adds an entry to comparison history
 * @param {Object} entry - History entry
 * @param {string} entry.mode - Comparison mode ('schema-table', 'raw-sql', 'excel-compare')
 * @param {string} entry.label - Display label for the entry
 * @param {Object} entry.config - Configuration to re-run the comparison
 * @returns {Promise<number>} The auto-generated ID
 */
export async function addComparisonHistory(entry) {
  const record = {
    mode: entry.mode,
    label: entry.label,
    config: entry.config,
    createdAt: new Date(),
  };

  return withStore(STORES.COMPARISON_HISTORY, 'readwrite', (store, resolve, reject) => {
    const request = store.add(record);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Gets comparison history entries
 * @param {Object} [options] - Query options
 * @param {string} [options.mode] - Filter by mode
 * @param {number} [options.limit] - Maximum number of entries to return
 * @returns {Promise<Array>} Array of history entries (newest first)
 */
export async function getComparisonHistory(options = {}) {
  return withStore(STORES.COMPARISON_HISTORY, 'readonly', (store, resolve, reject) => {
    const results = [];
    const index = store.index('createdAt');

    // Open cursor in reverse order (newest first)
    const request = index.openCursor(null, 'prev');

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const record = cursor.value;
        // Apply mode filter if specified
        if (!options.mode || record.mode === options.mode) {
          results.push(record);
        }
        // Check limit
        if (options.limit && results.length >= options.limit) {
          resolve(results);
          return;
        }
        cursor.continue();
      } else {
        resolve(results);
      }
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * Deletes a comparison history entry
 * @param {number} id - Entry ID
 * @returns {Promise<void>}
 */
export async function deleteComparisonHistory(id) {
  return withStore(STORES.COMPARISON_HISTORY, 'readwrite', (store) => store.delete(id));
}

/**
 * Clears all comparison history
 * @returns {Promise<void>}
 */
export async function clearComparisonHistory() {
  return withStore(STORES.COMPARISON_HISTORY, 'readwrite', (store) => store.clear());
}

/**
 * Prunes old comparison history entries, keeping only the most recent
 * @param {number} keepCount - Number of entries to keep
 * @returns {Promise<number>} Number of entries deleted
 */
export async function pruneComparisonHistory(keepCount = 50) {
  const allEntries = await getComparisonHistory();
  if (allEntries.length <= keepCount) {
    return 0;
  }

  const toDelete = allEntries.slice(keepCount);
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORES.COMPARISON_HISTORY, 'readwrite');
    const store = transaction.objectStore(STORES.COMPARISON_HISTORY);
    let deleted = 0;

    transaction.oncomplete = () => resolve(deleted);
    transaction.onerror = () => reject(transaction.error);

    for (const entry of toDelete) {
      const request = store.delete(entry.id);
      request.onsuccess = () => deleted++;
    }
  });
}

// =============================================================================
// Utility Operations
// =============================================================================

/**
 * Clears all data related to Excel Compare (files and state)
 * @returns {Promise<void>}
 */
export async function clearAllExcelCompareData() {
  await clearAllExcelFiles();
  await clearExcelCompareState();
}

/**
 * Clears all data in the database
 * @returns {Promise<void>}
 */
export async function clearAllData() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const storeNames = [
      STORES.EXCEL_FILES,
      STORES.EXCEL_COMPARE_STATE,
      STORES.EXCEL_FILE_PREFS,
      STORES.SCHEMA_TABLE_PREFS,
      STORES.RAW_SQL_PREFS,
      STORES.COMPARISON_HISTORY,
      STORES.UNIFIED_EXCEL_FILES,
    ];

    const transaction = db.transaction(storeNames, 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);

    for (const storeName of storeNames) {
      transaction.objectStore(storeName).clear();
    }
  });
}

/**
 * Gets storage statistics for the database
 * @returns {Promise<Object>} Statistics object
 */
export async function getStorageStats() {
  const db = await openDatabase();
  const stats = {};

  const storeNames = [
    STORES.EXCEL_FILES,
    STORES.EXCEL_COMPARE_STATE,
    STORES.EXCEL_FILE_PREFS,
    STORES.SCHEMA_TABLE_PREFS,
    STORES.RAW_SQL_PREFS,
    STORES.COMPARISON_HISTORY,
    STORES.UNIFIED_EXCEL_FILES,
  ];

  for (const storeName of storeNames) {
    stats[storeName] = await new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const countRequest = store.count();

      countRequest.onsuccess = () => resolve({ count: countRequest.result });
      countRequest.onerror = () => reject(countRequest.error);
    });
  }

  return stats;
}

/**
 * Checks if IndexedDB is available
 * @returns {boolean} True if IndexedDB is available
 */
export function isIndexedDBAvailable() {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch (e) {
    return false;
  }
}

// =============================================================================
// Tool State Store Operations (for large comparison results)
// =============================================================================

const TOOL_STATE_ID = 'compare-config-state';

/**
 * Saves tool state (comparison results) to IndexedDB
 * @param {Object} state - State object containing results
 * @returns {Promise<void>}
 */
export async function saveToolState(state) {
  const record = {
    id: TOOL_STATE_ID,
    results: state.results,
    savedAt: new Date().toISOString(),
  };

  await withStore(STORES.TOOL_STATE, 'readwrite', (store) => store.put(record));
}

/**
 * Loads tool state (comparison results) from IndexedDB
 * @returns {Promise<Object|null>} State object or null if not found
 */
export async function loadToolState() {
  return withStore(STORES.TOOL_STATE, 'readonly', (store) => store.get(TOOL_STATE_ID));
}

/**
 * Clears tool state from IndexedDB
 * @returns {Promise<void>}
 */
export async function clearToolState() {
  await withStore(STORES.TOOL_STATE, 'readwrite', (store) => store.delete(TOOL_STATE_ID));
}

// =============================================================================
// Default Export
// =============================================================================

export default {
  // Store names
  STORES,

  // Database management
  closeDatabase,
  isIndexedDBAvailable,
  getStorageStats,
  clearAllData,

  // Excel files
  saveExcelFile,
  getExcelFile,
  getExcelFilesByType,
  getAllExcelFiles,
  deleteExcelFile,
  clearAllExcelFiles,

  // Excel compare state
  saveExcelCompareState,
  getExcelCompareState,
  clearExcelCompareState,
  clearAllExcelCompareData,

  // Unified Excel files (Phase 2)
  saveUnifiedExcelFile,
  getUnifiedExcelFile,
  getUnifiedExcelFiles,
  getAllUnifiedExcelFiles,
  deleteUnifiedExcelFile,
  clearUnifiedExcelFiles,
  clearAllUnifiedExcelFiles,

  // Excel file preferences
  saveExcelFilePrefs,
  getExcelFilePrefs,
  getAllExcelFilePrefs,
  deleteExcelFilePrefs,
  clearAllExcelFilePrefs,

  // Schema/table preferences
  generateSchemaTableKey,
  saveSchemaTablePrefs,
  getSchemaTablePrefs,
  getSchemaTablePrefsByConnection,
  deleteSchemaTablePrefs,
  clearAllSchemaTablePrefs,

  // Raw SQL preferences
  hashSqlQuery,
  saveRawSqlPrefs,
  getRawSqlPrefs,
  getAllRawSqlPrefs,
  deleteRawSqlPrefs,
  clearAllRawSqlPrefs,

  // Comparison history
  addComparisonHistory,
  getComparisonHistory,
  deleteComparisonHistory,
  clearComparisonHistory,
  pruneComparisonHistory,

  // Tool state (for large comparison results)
  saveToolState,
  loadToolState,
  clearToolState,
};
