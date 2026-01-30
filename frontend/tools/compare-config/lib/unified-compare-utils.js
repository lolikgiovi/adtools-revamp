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
 * @deprecated Source B now has independent configuration - this always returns false
 */
export function isSourceBFollowMode(sourceAType, sourceBType) {
  // Phase 2: Source B has independent configuration, no longer follows Source A
  return false;
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
 * Validates a single Oracle source configuration.
 * @param {Object} config - Source configuration
 * @param {string} label - 'A' or 'B' for error messages
 * @returns {{valid: boolean, error?: string}}
 */
function validateSingleOracleConfig(config, label) {
  if (!config.connection) {
    return { valid: false, error: `Source ${label} connection is required` };
  }

  if (config.queryMode === 'table') {
    if (!config.schema) {
      return { valid: false, error: `Source ${label} schema is required` };
    }
    if (!config.table) {
      return { valid: false, error: `Source ${label} table is required` };
    }
  }

  if (config.queryMode === 'sql') {
    if (!config.sql || config.sql.trim().length === 0) {
      return { valid: false, error: `Source ${label} SQL query is required` };
    }
  }

  return { valid: true };
}

/**
 * Validates Oracle vs Oracle configuration before loading data.
 * Both sources are validated independently.
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

  // Validate Source A
  const sourceAValidation = validateSingleOracleConfig(sourceAConfig, 'A');
  if (!sourceAValidation.valid) {
    return sourceAValidation;
  }

  // Validate Source B independently
  const sourceBValidation = validateSingleOracleConfig(sourceBConfig, 'B');
  if (!sourceBValidation.valid) {
    return sourceBValidation;
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
    'source-b-query-mode-wrapper',
    'source-b-schema-search',
    'source-b-table-search',
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
    maxRows: 500,
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
 * Defines the progress steps for unified compare mode.
 * Each step has an id, label, and optional detail.
 * @returns {Array<{id: string, label: string, defaultDetail: string}>}
 */
export function getUnifiedProgressSteps() {
  return [
    { id: 'source-a', label: 'Loading Source A data', defaultDetail: '—' },
    { id: 'validate-b', label: 'Validating Source B', defaultDetail: '—' },
    { id: 'source-b', label: 'Loading Source B data', defaultDetail: '—' },
    { id: 'reconcile', label: 'Reconciling fields', defaultDetail: '—' },
  ];
}

/**
 * Determines which steps to show based on comparison mode.
 * For Oracle vs Oracle, all 4 steps are shown.
 * For other modes, the "Validating Source B" step is hidden.
 *
 * @param {'oracle-oracle'|'oracle-excel'|'excel-oracle'|'excel-excel'|null} mode
 * @returns {string[]} Array of step IDs to show
 */
export function getVisibleStepsForMode(mode) {
  if (mode === 'oracle-oracle') {
    return ['source-a', 'validate-b', 'source-b', 'reconcile'];
  }
  // For mixed or excel-excel modes, skip validation step
  return ['source-a', 'source-b', 'reconcile'];
}

/**
 * Gets the step label for a given step ID (for testing/documentation).
 * @param {string} stepId
 * @returns {string|null}
 */
export function getStepLabel(stepId) {
  const steps = getUnifiedProgressSteps();
  const step = steps.find((s) => s.id === stepId);
  return step ? step.label : null;
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

// ============================================
// Phase 5.3: Error Handling Utilities
// ============================================

/**
 * Error types for unified compare mode
 */
export const UnifiedErrorType = {
  TABLE_NOT_FOUND: 'table_not_found',
  SCHEMA_NOT_FOUND: 'schema_not_found',
  CONNECTION_FAILED: 'connection_failed',
  NO_COMMON_FIELDS: 'no_common_fields',
  NO_DATA: 'no_data',
  FILE_PARSE_ERROR: 'file_parse_error',
  VALIDATION_ERROR: 'validation_error',
};

/**
 * Generates an actionable error message with guidance for resolution.
 *
 * @param {string} errorType - Type of error from UnifiedErrorType
 * @param {Object} context - Context for the error (varies by type)
 * @returns {{title: string, message: string, hint: string}}
 */
export function getActionableErrorMessage(errorType, context = {}) {
  switch (errorType) {
    case UnifiedErrorType.TABLE_NOT_FOUND:
      return {
        title: 'Table Not Found',
        message: `Table "${context.schema}.${context.table}" does not exist in ${context.connectionName || 'Source B'}.`,
        hint: 'Verify the table exists in the target database, or select a different connection.',
      };

    case UnifiedErrorType.SCHEMA_NOT_FOUND:
      return {
        title: 'Schema Not Accessible',
        message: `Cannot access schema "${context.schema}" in ${context.connectionName || 'the connection'}.`,
        hint: 'Check that the schema exists and the connection has permission to access it.',
      };

    case UnifiedErrorType.CONNECTION_FAILED:
      return {
        title: 'Connection Failed',
        message: `Could not connect to ${context.connectionName || 'the database'}.`,
        hint: context.errorDetail
          ? `Error: ${context.errorDetail}. Check network connectivity and credentials.`
          : 'Check network connectivity and ensure credentials are correct.',
      };

    case UnifiedErrorType.NO_COMMON_FIELDS:
      return {
        title: 'No Common Fields',
        message: 'No matching column names found between the two sources.',
        hint: `Source A has: ${formatFieldList(context.headersA)}. Source B has: ${formatFieldList(context.headersB)}. Ensure column names match (case-insensitive).`,
      };

    case UnifiedErrorType.NO_DATA:
      return {
        title: 'No Data Returned',
        message: `${context.source || 'Source'} returned no rows.`,
        hint: context.whereClause
          ? `The WHERE clause "${context.whereClause}" may be filtering out all data. Try removing or adjusting it.`
          : 'The table or query returned no data. Verify data exists in the source.',
      };

    case UnifiedErrorType.FILE_PARSE_ERROR:
      return {
        title: 'File Parse Error',
        message: `Could not parse file "${context.fileName || 'the file'}".`,
        hint: context.errorDetail || 'Ensure the file is a valid Excel (.xlsx, .xls) or CSV file.',
      };

    case UnifiedErrorType.VALIDATION_ERROR:
      return {
        title: 'Validation Error',
        message: context.message || 'Configuration is invalid.',
        hint: context.hint || 'Please check the configuration and try again.',
      };

    default:
      return {
        title: 'Error',
        message: context.message || 'An unexpected error occurred.',
        hint: context.hint || 'Please try again or contact support if the issue persists.',
      };
  }
}

/**
 * Formats a field list for display, truncating if too long.
 *
 * @param {string[]} fields - Array of field names
 * @param {number} maxDisplay - Maximum fields to show before truncating
 * @returns {string}
 */
export function formatFieldList(fields, maxDisplay = 5) {
  if (!fields || fields.length === 0) return '(none)';

  if (fields.length <= maxDisplay) {
    return fields.join(', ');
  }

  const displayed = fields.slice(0, maxDisplay).join(', ');
  const remaining = fields.length - maxDisplay;
  return `${displayed}, +${remaining} more`;
}

/**
 * Determines inline validation state for a source configuration.
 * Returns null if configuration is valid, or an error object if invalid.
 *
 * @param {Object} config - Source configuration
 * @param {'A'|'B'} source - Which source is being validated
 * @param {Object} otherSourceConfig - The other source's configuration (for follow mode)
 * @returns {null|{type: string, message: string, hint: string}}
 */
export function validateSourceConfig(config, source, otherSourceConfig = null) {
  if (!config.type) {
    return null; // No type selected yet, not an error
  }

  if (config.type === 'oracle') {
    if (!config.connection) {
      return {
        type: 'info',
        message: 'Select a connection to continue.',
        hint: null,
      };
    }

    // Both sources require full configuration (no follow mode)
    if (config.queryMode === 'table') {
      if (!config.schema) {
        return {
          type: 'info',
          message: 'Select a schema to continue.',
          hint: null,
        };
      }
      if (!config.table) {
        return {
          type: 'info',
          message: 'Select a table to continue.',
          hint: null,
        };
      }
    } else if (config.queryMode === 'sql') {
      if (!config.sql || config.sql.trim().length === 0) {
        return {
          type: 'info',
          message: 'Enter a SQL query to continue.',
          hint: null,
        };
      }
    }
  } else if (config.type === 'excel') {
    if (!config.excelFiles || config.excelFiles.length === 0) {
      return {
        type: 'info',
        message: 'Upload Excel or CSV files to continue.',
        hint: null,
      };
    }
    if (!config.selectedExcelFile) {
      return {
        type: 'info',
        message: 'Select a file from the list to compare.',
        hint: null,
      };
    }
  }

  return null; // Valid
}

/**
 * Parses Oracle error codes and returns a user-friendly message.
 *
 * @param {string} errorMessage - Raw error message
 * @returns {{code: string|null, friendlyMessage: string}}
 */
export function parseOracleError(errorMessage) {
  if (!errorMessage) {
    return { code: null, friendlyMessage: 'An unknown error occurred.' };
  }

  const errorStr = String(errorMessage);

  // Common Oracle error patterns
  const oracleErrors = {
    'ORA-12154': 'TNS name could not be resolved. Check the connection host/service name.',
    'ORA-12514': 'Service name not found. Verify the service name is correct.',
    'ORA-12541': 'No listener at the specified host/port. Check if the database is running.',
    'ORA-12543': 'Connection refused. The database may be down or blocked by firewall.',
    'ORA-01017': 'Invalid username or password.',
    'ORA-28000': 'Account is locked. Contact your DBA.',
    'ORA-00942': 'Table or view does not exist.',
    'ORA-00904': 'Invalid column name in query.',
    'ORA-01031': 'Insufficient privileges to perform this operation.',
    'ORA-00955': 'Object already exists.',
    'ORA-02291': 'Foreign key constraint violation.',
    'ORA-00001': 'Unique constraint violated.',
  };

  for (const [code, message] of Object.entries(oracleErrors)) {
    if (errorStr.includes(code)) {
      return { code, friendlyMessage: message };
    }
  }

  // Check for timeout patterns
  if (errorStr.toLowerCase().includes('timeout')) {
    return { code: 'TIMEOUT', friendlyMessage: 'Connection timed out. The database may be slow or unreachable.' };
  }

  // Check for network patterns
  if (errorStr.toLowerCase().includes('network') || errorStr.toLowerCase().includes('socket')) {
    return { code: 'NETWORK', friendlyMessage: 'Network error. Check your connection to the database.' };
  }

  return { code: null, friendlyMessage: errorStr };
}
