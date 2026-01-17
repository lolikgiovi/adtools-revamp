/**
 * Diff Engine - Wrapper around jsdiff library with custom comparison logic
 *
 * Features:
 * - Character-level diff using Myers algorithm (via jsdiff)
 * - Adaptive threshold: cell-level if >50% different, character-level otherwise
 * - Row comparison with primary key matching
 * - Support for composite primary keys
 * - Normalized comparison mode for dates/numbers
 */

import * as Diff from 'diff';

// Constants
const KEY_DELIMITER = '\x00|\x00';  // Null-pipe-null for composite key joining
const CHANGE_THRESHOLD = 0.5;       // 50% threshold for adaptive diff

/**
 * Diff segment types for rendering
 */
export const DiffType = {
  EQUAL: 'equal',
  INSERT: 'insert',
  DELETE: 'delete'
};

/**
 * Row comparison status
 */
export const RowStatus = {
  MATCH: 'match',
  DIFFER: 'differ',
  ONLY_IN_REF: 'only_in_ref',
  ONLY_IN_COMP: 'only_in_comp'
};

/**
 * Calculate the change ratio between two strings
 * @param {string} oldStr
 * @param {string} newStr
 * @returns {number} Ratio of changed characters (0-1)
 */
export function calculateChangeRatio(oldStr, newStr) {
  if (!oldStr && !newStr) return 0;
  if (!oldStr || !newStr) return 1;

  const oldVal = String(oldStr);
  const newVal = String(newStr);

  if (oldVal === newVal) return 0;

  const diff = Diff.diffChars(oldVal, newVal);

  let changedChars = 0;
  let totalChars = 0;

  for (const part of diff) {
    if (part.added) {
      changedChars += part.value.length;
      totalChars += part.value.length;
    } else if (part.removed) {
      changedChars += part.value.length;
      totalChars += part.value.length;
    } else {
      totalChars += part.value.length;
    }
  }

  return totalChars > 0 ? changedChars / totalChars : 0;
}

/**
 * Compute character-level diff between two strings
 * @param {string} oldStr
 * @param {string} newStr
 * @returns {Array<{type: string, value: string}>} Diff segments
 */
export function computeCharDiff(oldStr, newStr) {
  const oldVal = String(oldStr ?? '');
  const newVal = String(newStr ?? '');

  if (oldVal === newVal) {
    return [{ type: DiffType.EQUAL, value: oldVal }];
  }

  const diff = Diff.diffChars(oldVal, newVal);

  return diff.map(part => ({
    type: part.added ? DiffType.INSERT : part.removed ? DiffType.DELETE : DiffType.EQUAL,
    value: part.value
  }));
}

/**
 * Compute word-level diff between two strings
 * @param {string} oldStr
 * @param {string} newStr
 * @returns {Array<{type: string, value: string}>} Diff segments
 */
export function computeWordDiff(oldStr, newStr) {
  const oldVal = String(oldStr ?? '');
  const newVal = String(newStr ?? '');

  if (oldVal === newVal) {
    return [{ type: DiffType.EQUAL, value: oldVal }];
  }

  const diff = Diff.diffWords(oldVal, newVal);

  return diff.map(part => ({
    type: part.added ? DiffType.INSERT : part.removed ? DiffType.DELETE : DiffType.EQUAL,
    value: part.value
  }));
}

/**
 * Compute adaptive diff - uses threshold to decide granularity
 * @param {string} oldStr
 * @param {string} newStr
 * @param {Object} options
 * @param {number} options.threshold - Change ratio threshold (default 0.5)
 * @returns {Object} Diff result with type and segments
 */
export function computeAdaptiveDiff(oldStr, newStr, options = {}) {
  const threshold = options.threshold ?? CHANGE_THRESHOLD;
  const oldVal = String(oldStr ?? '');
  const newVal = String(newStr ?? '');

  // Quick equality check
  if (oldVal === newVal) {
    return {
      type: 'unchanged',
      changed: false,
      segments: null
    };
  }

  // Calculate change ratio
  const changeRatio = calculateChangeRatio(oldVal, newVal);

  if (changeRatio > threshold) {
    // More than threshold% different - show cell-level only
    return {
      type: 'cell-diff',
      changed: true,
      changeRatio,
      oldValue: oldVal,
      newValue: newVal,
      segments: null
    };
  } else {
    // Less than threshold% different - show character-level diff
    return {
      type: 'char-diff',
      changed: true,
      changeRatio,
      segments: computeCharDiff(oldVal, newVal)
    };
  }
}

/**
 * Build a composite key from row data
 * @param {Object} row - Row data object
 * @param {Array<string>} keyColumns - Column names for the key
 * @returns {string} Composite key string
 */
export function buildCompositeKey(row, keyColumns) {
  return keyColumns.map(col => String(row[col] ?? '')).join(KEY_DELIMITER);
}

/**
 * Build key maps from rows, handling duplicate keys with suffixes
 * @param {Array<Object>} rows - Array of row objects
 * @param {Array<string>} keyColumns - Column names for the key
 * @returns {Object} { keyMap: Map, duplicates: Array }
 */
export function buildKeyMaps(rows, keyColumns) {
  const occurrenceMap = new Map();  // baseKey -> [{ row, index }]

  // First pass: group by base key
  rows.forEach((row, index) => {
    const baseKey = buildCompositeKey(row, keyColumns);

    if (!occurrenceMap.has(baseKey)) {
      occurrenceMap.set(baseKey, []);
    }
    occurrenceMap.get(baseKey).push({ row, index });
  });

  // Second pass: flatten with suffixes for duplicates
  const keyMap = new Map();
  const duplicates = [];

  for (const [baseKey, occurrences] of occurrenceMap) {
    if (occurrences.length === 1) {
      keyMap.set(baseKey, occurrences[0]);
    } else {
      // Add suffix for duplicates: KEY#1, KEY#2, etc.
      duplicates.push({
        key: baseKey,
        count: occurrences.length
      });

      for (let i = 0; i < occurrences.length; i++) {
        const suffixedKey = `${baseKey}#${i + 1}`;
        keyMap.set(suffixedKey, { ...occurrences[i], occurrence: i + 1 });
      }
    }
  }

  return { keyMap, duplicates };
}

/**
 * Compare two values with optional normalization
 * @param {*} val1
 * @param {*} val2
 * @param {boolean} normalize - Whether to normalize dates/numbers
 * @returns {boolean} True if values are equal
 */
export function compareValues(val1, val2, normalize = false) {
  const str1 = String(val1 ?? '');
  const str2 = String(val2 ?? '');

  if (!normalize) {
    return str1 === str2;
  }

  // Normalized comparison
  // Try date first
  const date1 = normalizeDate(val1);
  const date2 = normalizeDate(val2);
  if (date1 && date2) {
    return date1 === date2;
  }

  // Try number
  const num1 = normalizeNumber(val1);
  const num2 = normalizeNumber(val2);
  if (num1 !== null && num2 !== null) {
    return num1 === num2;
  }

  // Fall back to trimmed string comparison
  return str1.trim() === str2.trim();
}

/**
 * Date patterns for normalization
 */
const DATE_PATTERNS = [
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/,          // ISO 8601
  /^\d{1,2}\/\d{1,2}\/\d{2,4}$/,                       // US format
  /^\d{1,2}-\d{1,2}-\d{2,4}$/,                         // European format
  /^\d{1,2}-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2,4}$/i,  // Text month
];

/**
 * Normalize a date value to ISO format (YYYY-MM-DD)
 * @param {*} value
 * @returns {string|null} ISO date string or null
 */
export function normalizeDate(value) {
  if (value == null || value === '') return null;

  const str = String(value).trim();

  // Check if it matches any date pattern
  const matchesPattern = DATE_PATTERNS.some(pattern => pattern.test(str));
  if (!matchesPattern) {
    // Check for Excel serial number (5 digits, typically 40000-50000 range for recent dates)
    if (/^\d{5}$/.test(str)) {
      const serial = parseInt(str, 10);
      if (serial >= 1 && serial <= 99999) {
        // Excel serial date: days since 1900-01-01 (with Excel's leap year bug)
        const excelEpoch = new Date(Date.UTC(1899, 11, 30));  // Dec 30, 1899 UTC
        const date = new Date(excelEpoch.getTime() + serial * 24 * 60 * 60 * 1000);
        if (!isNaN(date.getTime())) {
          return date.toISOString().split('T')[0];
        }
      }
    }
    return null;
  }

  // Try to parse the date
  // For formats like MM/DD/YYYY, we need to parse manually to avoid timezone issues
  const usMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (usMatch) {
    const [, month, day, year] = usMatch;
    const fullYear = year.length === 2 ? (parseInt(year) > 50 ? '19' + year : '20' + year) : year;
    const date = new Date(Date.UTC(parseInt(fullYear), parseInt(month) - 1, parseInt(day)));
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  }

  // For ISO format, parse as UTC
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    const date = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  }

  // For European format DD-MM-YYYY
  const euMatch = str.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (euMatch) {
    const [, day, month, year] = euMatch;
    const fullYear = year.length === 2 ? (parseInt(year) > 50 ? '19' + year : '20' + year) : year;
    const date = new Date(Date.UTC(parseInt(fullYear), parseInt(month) - 1, parseInt(day)));
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  }

  // Fallback to Date.parse (may have timezone issues)
  const date = new Date(str);
  if (!isNaN(date.getTime())) {
    return date.toISOString().split('T')[0];
  }

  return null;
}

/**
 * Normalize a number value, handling locale-specific formats
 * @param {*} value
 * @returns {number|null} Normalized number or null
 */
export function normalizeNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    return Math.round(value * 1e10) / 1e10;  // Round to 10 decimal places
  }

  const str = String(value).trim();

  // Skip if it looks like a date or non-numeric
  if (/[a-zA-Z]/.test(str) && !/^[+-]?\d/.test(str)) return null;

  // Detect format by last separator position
  const lastComma = str.lastIndexOf(',');
  const lastDot = str.lastIndexOf('.');

  let normalized;
  if (lastComma > lastDot) {
    // European format: 1.234,56 -> 1234.56
    normalized = str.replace(/\./g, '').replace(',', '.');
  } else {
    // US format: 1,234.56 -> 1234.56
    normalized = str.replace(/,/g, '');
  }

  const num = parseFloat(normalized);
  return isNaN(num) ? null : Math.round(num * 1e10) / 1e10;
}

/**
 * Compare a single row between reference and comparator
 * @param {Object} refRow - Reference row data
 * @param {Object} compRow - Comparator row data
 * @param {Array<string>} fields - Fields to compare
 * @param {Object} options
 * @param {boolean} options.normalize - Use normalized comparison
 * @param {number} options.threshold - Adaptive diff threshold
 * @returns {Object} Row comparison result
 */
export function compareRow(refRow, compRow, fields, options = {}) {
  const { normalize = false, threshold = CHANGE_THRESHOLD } = options;

  const fieldDiffs = {};
  let hasDifference = false;

  for (const field of fields) {
    const refVal = refRow[field];
    const compVal = compRow[field];

    const isEqual = compareValues(refVal, compVal, normalize);

    if (!isEqual) {
      hasDifference = true;
      fieldDiffs[field] = computeAdaptiveDiff(refVal, compVal, { threshold });
    }
  }

  return {
    status: hasDifference ? RowStatus.DIFFER : RowStatus.MATCH,
    differences: hasDifference ? fieldDiffs : null,
    refData: refRow,
    compData: compRow
  };
}

/**
 * Compare two datasets (arrays of row objects)
 * @param {Array<Object>} refData - Reference data rows
 * @param {Array<Object>} compData - Comparator data rows
 * @param {Object} options
 * @param {Array<string>} options.keyColumns - Primary key column(s)
 * @param {Array<string>} options.fields - Fields to compare
 * @param {boolean} options.normalize - Use normalized comparison
 * @param {number} options.threshold - Adaptive diff threshold
 * @param {string} options.matchMode - 'key' or 'position'
 * @param {Function} options.onProgress - Progress callback
 * @returns {Object} Comparison results
 */
export function compareDatasets(refData, compData, options = {}) {
  const {
    keyColumns = [],
    fields = [],
    normalize = false,
    threshold = CHANGE_THRESHOLD,
    matchMode = 'key',
    onProgress = null
  } = options;

  const results = {
    summary: {
      total: 0,
      matches: 0,
      differs: 0,
      onlyInRef: 0,
      onlyInComp: 0
    },
    rows: [],
    duplicateKeys: {
      reference: [],
      comparator: []
    }
  };

  if (matchMode === 'position') {
    return compareByPosition(refData, compData, fields, { normalize, threshold, onProgress });
  }

  // Key-based comparison
  const { keyMap: refKeyMap, duplicates: refDuplicates } = buildKeyMaps(refData, keyColumns);
  const { keyMap: compKeyMap, duplicates: compDuplicates } = buildKeyMaps(compData, keyColumns);

  results.duplicateKeys.reference = refDuplicates;
  results.duplicateKeys.comparator = compDuplicates;

  // Collect all unique keys
  const allKeys = new Set([...refKeyMap.keys(), ...compKeyMap.keys()]);
  const totalKeys = allKeys.size;
  let processed = 0;

  for (const key of allKeys) {
    const refEntry = refKeyMap.get(key);
    const compEntry = compKeyMap.get(key);

    let rowResult;

    if (refEntry && compEntry) {
      // Row exists in both - compare
      const comparison = compareRow(refEntry.row, compEntry.row, fields, { normalize, threshold });

      rowResult = {
        key,
        status: comparison.status,
        differences: comparison.differences,
        refData: comparison.refData,
        compData: comparison.compData,
        refIndex: refEntry.index,
        compIndex: compEntry.index
      };

      if (comparison.status === RowStatus.MATCH) {
        results.summary.matches++;
      } else {
        results.summary.differs++;
      }
    } else if (refEntry) {
      // Only in reference
      rowResult = {
        key,
        status: RowStatus.ONLY_IN_REF,
        differences: null,
        refData: refEntry.row,
        compData: null,
        refIndex: refEntry.index,
        compIndex: null
      };
      results.summary.onlyInRef++;
    } else {
      // Only in comparator
      rowResult = {
        key,
        status: RowStatus.ONLY_IN_COMP,
        differences: null,
        refData: null,
        compData: compEntry.row,
        refIndex: null,
        compIndex: compEntry.index
      };
      results.summary.onlyInComp++;
    }

    results.rows.push(rowResult);
    processed++;

    // Report progress
    if (onProgress && processed % 100 === 0) {
      onProgress({
        phase: 'comparing',
        processed,
        total: totalKeys,
        percent: Math.round((processed / totalKeys) * 100)
      });
    }
  }

  results.summary.total = results.rows.length;

  // Sort: differs first, then only_in_ref, only_in_comp, matches last
  results.rows.sort((a, b) => {
    const order = {
      [RowStatus.DIFFER]: 0,
      [RowStatus.ONLY_IN_REF]: 1,
      [RowStatus.ONLY_IN_COMP]: 2,
      [RowStatus.MATCH]: 3
    };
    return order[a.status] - order[b.status];
  });

  return results;
}

/**
 * Compare datasets by row position
 * @param {Array<Object>} refData
 * @param {Array<Object>} compData
 * @param {Array<string>} fields
 * @param {Object} options
 * @returns {Object} Comparison results
 */
function compareByPosition(refData, compData, fields, options = {}) {
  const { normalize = false, threshold = CHANGE_THRESHOLD, onProgress = null } = options;

  const results = {
    summary: {
      total: 0,
      matches: 0,
      differs: 0,
      onlyInRef: 0,
      onlyInComp: 0
    },
    rows: [],
    duplicateKeys: { reference: [], comparator: [] }
  };

  const maxLength = Math.max(refData.length, compData.length);

  for (let i = 0; i < maxLength; i++) {
    const refRow = refData[i];
    const compRow = compData[i];

    let rowResult;

    if (refRow && compRow) {
      const comparison = compareRow(refRow, compRow, fields, { normalize, threshold });

      rowResult = {
        key: `Row ${i + 1}`,
        status: comparison.status,
        differences: comparison.differences,
        refData: comparison.refData,
        compData: comparison.compData,
        refIndex: i,
        compIndex: i
      };

      if (comparison.status === RowStatus.MATCH) {
        results.summary.matches++;
      } else {
        results.summary.differs++;
      }
    } else if (refRow) {
      rowResult = {
        key: `Row ${i + 1}`,
        status: RowStatus.ONLY_IN_REF,
        differences: null,
        refData: refRow,
        compData: null,
        refIndex: i,
        compIndex: null
      };
      results.summary.onlyInRef++;
    } else {
      rowResult = {
        key: `Row ${i + 1}`,
        status: RowStatus.ONLY_IN_COMP,
        differences: null,
        refData: null,
        compData: compRow,
        refIndex: null,
        compIndex: i
      };
      results.summary.onlyInComp++;
    }

    results.rows.push(rowResult);

    // Report progress
    if (onProgress && i % 100 === 0) {
      onProgress({
        phase: 'comparing',
        processed: i,
        total: maxLength,
        percent: Math.round((i / maxLength) * 100)
      });
    }
  }

  results.summary.total = results.rows.length;

  return results;
}

/**
 * Reconcile columns between two datasets
 * @param {Array<string>} refHeaders
 * @param {Array<string>} compHeaders
 * @returns {Object} Column reconciliation result
 */
export function reconcileColumns(refHeaders, compHeaders) {
  const refSet = new Set(refHeaders.map(h => h.toLowerCase()));
  const compSet = new Set(compHeaders.map(h => h.toLowerCase()));

  const common = refHeaders.filter(h => compSet.has(h.toLowerCase()));
  const onlyInRef = refHeaders.filter(h => !compSet.has(h.toLowerCase()));
  const onlyInComp = compHeaders.filter(h => !refSet.has(h.toLowerCase()));

  return {
    common,
    onlyInRef,
    onlyInComp,
    isExactMatch: onlyInRef.length === 0 && onlyInComp.length === 0
  };
}

// Default export for convenience
export default {
  DiffType,
  RowStatus,
  calculateChangeRatio,
  computeCharDiff,
  computeWordDiff,
  computeAdaptiveDiff,
  buildCompositeKey,
  buildKeyMaps,
  compareValues,
  normalizeDate,
  normalizeNumber,
  compareRow,
  compareDatasets,
  reconcileColumns
};
