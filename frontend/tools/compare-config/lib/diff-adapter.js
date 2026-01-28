/**
 * Diff Adapter - Converts between JS diff engine output and Rust/View format
 *
 * The views expect results in the Rust backend format:
 * {
 *   env1_name, env2_name, table, summary,
 *   rows: [{ status, key (object), env1_data, env2_data, differences (array) }]
 * }
 *
 * The JS diff engine returns:
 * {
 *   summary, rows: [{ status, key (string), refData, compData, differences (object) }]
 * }
 *
 * This adapter bridges the two formats.
 */

import { RowStatus } from './diff-engine.js';

/**
 * Status mapping from JS engine to Rust/View format
 */
const STATUS_MAP = {
  [RowStatus.MATCH]: 'match',
  [RowStatus.DIFFER]: 'differ',
  [RowStatus.ONLY_IN_REF]: 'only_in_env1',
  [RowStatus.ONLY_IN_COMP]: 'only_in_env2',
  // Also handle string values
  'match': 'match',
  'differ': 'differ',
  'only_in_ref': 'only_in_env1',
  'only_in_comp': 'only_in_env2'
};

/**
 * Convert JS diff engine result to Rust/View compatible format
 * @param {Object} jsResult - Result from JS diff engine
 * @param {Object} options - Conversion options
 * @param {string} options.env1Name - Environment 1 display name
 * @param {string} options.env2Name - Environment 2 display name
 * @param {string} options.tableName - Table name
 * @param {Array<string>} options.keyColumns - Primary key column names
 * @returns {Object} Rust/View compatible result
 */
export function convertToViewFormat(jsResult, options = {}) {
  const {
    env1Name = 'Environment 1',
    env2Name = 'Environment 2',
    tableName = 'Unknown',
    keyColumns = []
  } = options;

  return {
    env1_name: env1Name,
    env2_name: env2Name,
    table: tableName,
    summary: {
      total: jsResult.summary.total,
      matches: jsResult.summary.matches,
      differs: jsResult.summary.differs,
      only_in_env1: jsResult.summary.onlyInRef,
      only_in_env2: jsResult.summary.onlyInComp
    },
    rows: jsResult.rows.map(row => convertRowToViewFormat(row, keyColumns))
  };
}

/**
 * Convert a single row from JS format to View format
 * @param {Object} jsRow - Row from JS diff engine
 * @param {Array<string>} keyColumns - Primary key column names
 * @returns {Object} View-compatible row
 */
function convertRowToViewFormat(jsRow, keyColumns) {
  // Convert status
  const status = STATUS_MAP[jsRow.status] || jsRow.status;

  // Convert key string back to object format
  // JS engine stores key as string, views expect { FIELD: value, ... }
  const keyObject = parseKeyToObject(jsRow.key, jsRow.refData || jsRow.compData, keyColumns);

  // Convert differences from object to array of field names
  const differences = jsRow.differences
    ? Object.keys(jsRow.differences)
    : [];

  return {
    status,
    key: keyObject,
    env1_data: jsRow.refData || null,
    env2_data: jsRow.compData || null,
    differences,
    // Preserve the detailed diff info for enhanced views
    _diffDetails: jsRow.differences
  };
}

/**
 * Parse a key string back into object format
 * @param {string} keyString - Composite key string
 * @param {Object} rowData - Row data to extract key values from
 * @param {Array<string>} keyColumns - Key column names
 * @returns {Object} Key as object
 */
function parseKeyToObject(keyString, rowData, keyColumns) {
  if (!keyColumns || keyColumns.length === 0) {
    return { KEY: keyString };
  }

  // If we have row data, extract key values from it
  if (rowData) {
    const keyObj = {};
    for (const col of keyColumns) {
      keyObj[col] = rowData[col] ?? null;
    }
    return keyObj;
  }

  // Fallback: parse from string if it contains delimiter
  const KEY_DELIMITER = '\x00|\x00';
  if (keyString.includes(KEY_DELIMITER)) {
    const values = keyString.split(KEY_DELIMITER);
    const keyObj = {};
    keyColumns.forEach((col, idx) => {
      keyObj[col] = values[idx] ?? null;
    });
    return keyObj;
  }

  // Single key column
  if (keyColumns.length === 1) {
    return { [keyColumns[0]]: keyString };
  }

  return { KEY: keyString };
}

/**
 * Convert Rust/View format back to JS diff engine format
 * (Useful for testing or when we need to re-process Rust results)
 * @param {Object} rustResult - Result in Rust/View format
 * @returns {Object} JS diff engine format
 */
export function convertFromViewFormat(rustResult) {
  return {
    summary: {
      total: rustResult.summary.total,
      matches: rustResult.summary.matches,
      differs: rustResult.summary.differs,
      onlyInRef: rustResult.summary.only_in_env1,
      onlyInComp: rustResult.summary.only_in_env2
    },
    rows: rustResult.rows.map(row => ({
      key: formatKeyObjectToString(row.key),
      status: convertStatusToJs(row.status),
      refData: row.env1_data,
      compData: row.env2_data,
      differences: row.differences
        ? row.differences.reduce((acc, field) => {
            acc[field] = { changed: true };
            return acc;
          }, {})
        : null
    })),
    duplicateKeys: { reference: [], comparator: [] }
  };
}

/**
 * Format key object to string
 * @param {Object} keyObj
 * @returns {string}
 */
function formatKeyObjectToString(keyObj) {
  if (!keyObj || typeof keyObj !== 'object') return String(keyObj);
  const values = Object.values(keyObj);
  if (values.length === 1) return String(values[0]);
  return values.join('\x00|\x00');
}

/**
 * Convert status from View format to JS format
 * @param {string} status
 * @returns {string}
 */
function convertStatusToJs(status) {
  const reverseMap = {
    'match': RowStatus.MATCH,
    'differ': RowStatus.DIFFER,
    'only_in_env1': RowStatus.ONLY_IN_REF,
    'only_in_env2': RowStatus.ONLY_IN_COMP
  };
  return reverseMap[status] || status;
}

/**
 * Enhance existing Rust results with detailed diff information
 * This can be used to add character-level diff to Rust comparison results
 * @param {Object} rustResult - Result from Rust backend
 * @param {Object} options - Options for diff enhancement
 * @param {number} options.threshold - Adaptive diff threshold (default 0.5)
 * @returns {Object} Enhanced result with _diffDetails
 */
export async function enhanceWithDetailedDiff(rustResult, options = {}) {
  const { computeAdaptiveDiff } = await import('./diff-engine.js');
  const { threshold = 0.5 } = options;

  const enhancedRows = rustResult.rows.map(row => {
    if (row.status !== 'differ' || !row.differences || row.differences.length === 0) {
      return row;
    }

    // Compute detailed diff for each differing field
    const diffDetails = {};
    for (const field of row.differences) {
      const env1Val = row.env1_data?.[field];
      const env2Val = row.env2_data?.[field];
      diffDetails[field] = computeAdaptiveDiff(env1Val, env2Val, { threshold });
    }

    return {
      ...row,
      _diffDetails: diffDetails
    };
  });

  return {
    ...rustResult,
    rows: enhancedRows
  };
}

export default {
  convertToViewFormat,
  convertFromViewFormat,
  enhanceWithDetailedDiff
};
