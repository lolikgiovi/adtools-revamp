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
