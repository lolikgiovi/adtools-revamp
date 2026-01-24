/**
 * Unified Compare Utilities
 * Core business logic for unified compare mode that can be unit tested
 */

/**
 * Determines the comparison mode based on source types
 * @param {string|null} sourceAType - 'oracle' or 'excel' or null
 * @param {string|null} sourceBType - 'oracle' or 'excel' or null
 * @returns {'oracle-oracle'|'oracle-excel'|'excel-oracle'|'excel-excel'|null}
 */
export function getComparisonMode(sourceAType, sourceBType) {
  if (!sourceAType || !sourceBType) return null;
  return `${sourceAType}-${sourceBType}`;
}

/**
 * Checks if Source B should follow Source A configuration (Oracle vs Oracle mode)
 * @param {string|null} sourceAType
 * @param {string|null} sourceBType
 * @returns {boolean}
 */
export function isSourceBFollowMode(sourceAType, sourceBType) {
  return sourceAType === 'oracle' && sourceBType === 'oracle';
}

/**
 * Updates the selected comparison fields when PK selection changes.
 * Ensures all selected PKs are included in the comparison fields.
 *
 * @param {string[]} selectedPkFields - Currently selected primary key fields
 * @param {string[]} selectedCompareFields - Currently selected comparison fields
 * @returns {string[]} Updated comparison fields with PKs included
 */
export function syncPkFieldsToCompareFields(selectedPkFields, selectedCompareFields) {
  if (!selectedPkFields || selectedPkFields.length === 0) {
    return selectedCompareFields || [];
  }

  const compareFieldsSet = new Set(selectedCompareFields || []);

  // Add all PK fields to comparison fields
  for (const pkField of selectedPkFields) {
    compareFieldsSet.add(pkField);
  }

  return Array.from(compareFieldsSet);
}

/**
 * Validates Oracle vs Oracle configuration before loading data.
 * Checks if Source B should be able to query the same schema.table as Source A.
 *
 * @param {Object} sourceAConfig - Source A configuration
 * @param {Object} sourceBConfig - Source B configuration
 * @returns {{valid: boolean, error?: string}}
 */
export function validateOracleToOracleConfig(sourceAConfig, sourceBConfig) {
  // Both must be Oracle
  if (sourceAConfig.type !== 'oracle' || sourceBConfig.type !== 'oracle') {
    return { valid: false, error: 'Both sources must be Oracle for Oracle vs Oracle mode' };
  }

  // Source A must have connection
  if (!sourceAConfig.connection) {
    return { valid: false, error: 'Source A connection is required' };
  }

  // Source B must have connection
  if (!sourceBConfig.connection) {
    return { valid: false, error: 'Source B connection is required' };
  }

  // For table mode, Source A must have schema and table
  if (sourceAConfig.queryMode === 'table') {
    if (!sourceAConfig.schema) {
      return { valid: false, error: 'Source A schema is required' };
    }
    if (!sourceAConfig.table) {
      return { valid: false, error: 'Source A table is required' };
    }
  }

  // For SQL mode, Source A must have SQL
  if (sourceAConfig.queryMode === 'sql') {
    if (!sourceAConfig.sql || sourceAConfig.sql.trim().length === 0) {
      return { valid: false, error: 'Source A SQL query is required' };
    }
  }

  return { valid: true };
}

/**
 * Creates the Source B configuration for Oracle vs Oracle mode.
 * Copies relevant settings from Source A, using Source B's connection.
 *
 * @param {Object} sourceAConfig - Source A configuration
 * @param {Object} sourceBConnection - Source B connection object
 * @returns {Object} Configuration to use for fetching Source B data
 */
export function createSourceBConfigFromSourceA(sourceAConfig, sourceBConnection) {
  return {
    type: sourceAConfig.type,
    connection: sourceBConnection,
    queryMode: sourceAConfig.queryMode,
    schema: sourceAConfig.schema,
    table: sourceAConfig.table,
    sql: sourceAConfig.sql,
    whereClause: sourceAConfig.whereClause,
    maxRows: sourceAConfig.maxRows,
  };
}

/**
 * Determines which Source B fields should be disabled/hidden in Oracle vs Oracle mode
 * @returns {string[]} List of field IDs that should be disabled
 */
export function getSourceBDisabledFieldsForFollowMode() {
  return [
    'source-b-query-mode',
    'source-b-schema',
    'source-b-table',
    'source-b-where',
    'source-b-max-rows',
    'source-b-sql',
  ];
}

/**
 * Checks if the new comparison fields are valid after PK selection change
 * @param {string[]} selectedPkFields - Currently selected primary key fields
 * @param {string[]} selectedCompareFields - Currently selected comparison fields
 * @param {string} rowMatching - 'key' or 'position'
 * @returns {{valid: boolean, error?: string}}
 */
export function validateFieldSelection(selectedPkFields, selectedCompareFields, rowMatching) {
  // For key-based matching, at least one PK is required
  if (rowMatching === 'key' && (!selectedPkFields || selectedPkFields.length === 0)) {
    return { valid: false, error: 'At least one primary key field is required for key-based matching' };
  }

  // At least one comparison field is required
  if (!selectedCompareFields || selectedCompareFields.length === 0) {
    return { valid: false, error: 'At least one comparison field is required' };
  }

  return { valid: true };
}

/**
 * Checks if the comparison mode is mixed (Oracle + Excel in either direction)
 * @param {string|null} sourceAType - 'oracle' or 'excel' or null
 * @param {string|null} sourceBType - 'oracle' or 'excel' or null
 * @returns {boolean}
 */
export function isMixedMode(sourceAType, sourceBType) {
  if (!sourceAType || !sourceBType) return false;
  return (
    (sourceAType === 'oracle' && sourceBType === 'excel') ||
    (sourceAType === 'excel' && sourceBType === 'oracle')
  );
}

/**
 * Finds common fields between two sets of headers (case-insensitive)
 * @param {string[]} headersA - Headers from Source A
 * @param {string[]} headersB - Headers from Source B
 * @returns {{common: string[], onlyInA: string[], onlyInB: string[]}}
 */
export function findCommonFields(headersA, headersB) {
  if (!headersA || !headersB) {
    return { common: [], onlyInA: headersA || [], onlyInB: headersB || [] };
  }

  const normalizedA = headersA.map((h) => h.toLowerCase());
  const normalizedB = headersB.map((h) => h.toLowerCase());
  const normalizedBSet = new Set(normalizedB);
  const normalizedASet = new Set(normalizedA);

  const common = headersA.filter((h) => normalizedBSet.has(h.toLowerCase()));
  const onlyInA = headersA.filter((h) => !normalizedBSet.has(h.toLowerCase()));
  const onlyInB = headersB.filter((h) => !normalizedASet.has(h.toLowerCase()));

  return { common, onlyInA, onlyInB };
}

/**
 * Validates mixed mode configuration (Oracle + Excel).
 * Checks if both sources have headers available and if there are common fields.
 *
 * @param {Object} sourceAConfig - Source A configuration with type and headers
 * @param {Object} sourceBConfig - Source B configuration with type and headers
 * @returns {{valid: boolean, warning?: string, error?: string, commonFields?: string[]}}
 */
export function validateMixedModeConfig(sourceAConfig, sourceBConfig) {
  // Must be mixed mode
  if (!isMixedMode(sourceAConfig?.type, sourceBConfig?.type)) {
    return { valid: false, error: 'Not a mixed mode configuration (Oracle + Excel)' };
  }

  const headersA = sourceAConfig.headers;
  const headersB = sourceBConfig.headers;

  // Both sources must have headers
  if (!headersA || headersA.length === 0) {
    return { valid: false, error: 'Source A has no columns/headers available' };
  }

  if (!headersB || headersB.length === 0) {
    return { valid: false, error: 'Source B has no columns/headers available' };
  }

  // Find common fields
  const { common, onlyInA, onlyInB } = findCommonFields(headersA, headersB);

  if (common.length === 0) {
    return {
      valid: false,
      error: `No common fields between Oracle and Excel sources. Source A has: ${headersA.slice(0, 5).join(', ')}${headersA.length > 5 ? '...' : ''}. Source B has: ${headersB.slice(0, 5).join(', ')}${headersB.length > 5 ? '...' : ''}.`,
    };
  }

  // Valid but with warning if significant mismatch
  const totalFields = new Set([...headersA, ...headersB]).size;
  const mismatchRatio = (onlyInA.length + onlyInB.length) / totalFields;

  if (mismatchRatio > 0.5) {
    return {
      valid: true,
      warning: `Only ${common.length} common fields found out of ${totalFields} total fields. ${onlyInA.length} fields only in Source A, ${onlyInB.length} only in Source B.`,
      commonFields: common,
    };
  }

  return { valid: true, commonFields: common };
}

/**
 * Determines the reset behavior for a source based on its type.
 * For Excel: keep cached files, clear selection and data
 * For Oracle: reset all config except connection (user may want to keep connection)
 *
 * @param {'oracle'|'excel'|null} sourceType - The source type
 * @returns {{keepCachedFiles: boolean, clearConnection: boolean, clearSelection: boolean, clearData: boolean}}
 */
export function getResetBehaviorForSourceType(sourceType) {
  if (sourceType === 'excel') {
    return {
      keepCachedFiles: true,
      clearConnection: false,
      clearSelection: true,
      clearData: true,
    };
  }

  if (sourceType === 'oracle') {
    return {
      keepCachedFiles: false,
      clearConnection: true,
      clearSelection: true,
      clearData: true,
    };
  }

  // Unknown or null type - full reset
  return {
    keepCachedFiles: false,
    clearConnection: true,
    clearSelection: true,
    clearData: true,
  };
}

/**
 * Creates a reset unified source state object.
 * For Excel: preserves excelFiles array, clears everything else
 * For Oracle: resets everything
 *
 * @param {'oracle'|'excel'|null} sourceType - Current source type
 * @param {Array} existingExcelFiles - Existing Excel files to preserve (if Excel type)
 * @returns {Object} Reset source state
 */
export function createResetSourceState(sourceType, existingExcelFiles = []) {
  const behavior = getResetBehaviorForSourceType(sourceType);

  return {
    type: sourceType, // Keep the type so UI stays on same source type
    connection: null,
    queryMode: 'table',
    schema: null,
    table: null,
    sql: '',
    whereClause: '',
    maxRows: 100,
    // Excel-specific
    excelFiles: behavior.keepCachedFiles ? existingExcelFiles : [],
    selectedExcelFile: null,
    file: null,
    parsedData: null,
    // Data
    data: null,
    dataLoaded: false,
  };
}

/**
 * Validates if a unified comparison can be started (for reset to enable proper UI state)
 * @param {Object} unified - The unified state object
 * @returns {{canCompare: boolean, reason?: string}}
 */
export function canStartUnifiedComparison(unified) {
  if (!unified.sourceA.type) {
    return { canCompare: false, reason: 'Source A type not selected' };
  }

  if (!unified.sourceB.type) {
    return { canCompare: false, reason: 'Source B type not selected' };
  }

  return { canCompare: true };
}

/**
 * Syncs PK fields to compare fields and returns which fields were newly added.
 * This is used for animation purposes.
 *
 * @param {string[]} selectedPkFields - Currently selected primary key fields
 * @param {string[]} selectedCompareFields - Currently selected comparison fields
 * @returns {{updatedCompareFields: string[], newlyAddedFields: string[]}}
 */
export function syncPkFieldsWithTracking(selectedPkFields, selectedCompareFields) {
  if (!selectedPkFields || selectedPkFields.length === 0) {
    return {
      updatedCompareFields: selectedCompareFields || [],
      newlyAddedFields: [],
    };
  }

  const existingSet = new Set(selectedCompareFields || []);
  const newlyAddedFields = [];

  for (const pkField of selectedPkFields) {
    if (!existingSet.has(pkField)) {
      newlyAddedFields.push(pkField);
      existingSet.add(pkField);
    }
  }

  return {
    updatedCompareFields: Array.from(existingSet),
    newlyAddedFields,
  };
}
