/**
 * Unit tests for unified-compare-utils.js
 */
import { describe, it, expect } from 'vitest';
import {
  getComparisonMode,
  isSourceBFollowMode,
  syncPkFieldsToCompareFields,
  syncPkFieldsWithTracking,
  validateOracleToOracleConfig,
  createSourceBConfigFromSourceA,
  getSourceBDisabledFieldsForFollowMode,
  validateFieldSelection,
  isMixedMode,
  findCommonFields,
  validateMixedModeConfig,
  getResetBehaviorForSourceType,
  createResetSourceState,
  canStartUnifiedComparison,
  getUnifiedProgressSteps,
  getVisibleStepsForMode,
  getStepLabel,
  UnifiedErrorType,
  getActionableErrorMessage,
  formatFieldList,
  validateSourceConfig,
  parseOracleError,
} from '../lib/unified-compare-utils.js';

describe('UnifiedCompareUtils', () => {
  describe('getComparisonMode', () => {
    it('returns oracle-oracle for both Oracle sources', () => {
      expect(getComparisonMode('oracle', 'oracle')).toBe('oracle-oracle');
    });

    it('returns oracle-excel for Oracle A and Excel B', () => {
      expect(getComparisonMode('oracle', 'excel')).toBe('oracle-excel');
    });

    it('returns excel-oracle for Excel A and Oracle B', () => {
      expect(getComparisonMode('excel', 'oracle')).toBe('excel-oracle');
    });

    it('returns excel-excel for both Excel sources', () => {
      expect(getComparisonMode('excel', 'excel')).toBe('excel-excel');
    });

    it('returns null if source A type is null', () => {
      expect(getComparisonMode(null, 'oracle')).toBeNull();
    });

    it('returns null if source B type is null', () => {
      expect(getComparisonMode('oracle', null)).toBeNull();
    });

    it('returns null if both types are null', () => {
      expect(getComparisonMode(null, null)).toBeNull();
    });
  });

  describe('isSourceBFollowMode', () => {
    // Note: Follow mode is deprecated - Source B now has independent configuration
    it('returns false for Oracle vs Oracle (follow mode deprecated)', () => {
      expect(isSourceBFollowMode('oracle', 'oracle')).toBe(false);
    });

    it('returns false for Oracle vs Excel', () => {
      expect(isSourceBFollowMode('oracle', 'excel')).toBe(false);
    });

    it('returns false for Excel vs Oracle', () => {
      expect(isSourceBFollowMode('excel', 'oracle')).toBe(false);
    });

    it('returns false for Excel vs Excel', () => {
      expect(isSourceBFollowMode('excel', 'excel')).toBe(false);
    });

    it('returns false if source A is null', () => {
      expect(isSourceBFollowMode(null, 'oracle')).toBe(false);
    });

    it('returns false if source B is null', () => {
      expect(isSourceBFollowMode('oracle', null)).toBe(false);
    });
  });

  describe('syncPkFieldsToCompareFields', () => {
    it('adds PK fields to empty comparison fields', () => {
      const result = syncPkFieldsToCompareFields(['id', 'code'], []);
      expect(result).toContain('id');
      expect(result).toContain('code');
      expect(result).toHaveLength(2);
    });

    it('adds PK fields to existing comparison fields', () => {
      const result = syncPkFieldsToCompareFields(['id'], ['name', 'age']);
      expect(result).toContain('id');
      expect(result).toContain('name');
      expect(result).toContain('age');
      expect(result).toHaveLength(3);
    });

    it('does not duplicate fields already in comparison', () => {
      const result = syncPkFieldsToCompareFields(['id'], ['id', 'name']);
      expect(result).toContain('id');
      expect(result).toContain('name');
      expect(result).toHaveLength(2);
    });

    it('handles empty PK fields', () => {
      const result = syncPkFieldsToCompareFields([], ['name', 'age']);
      expect(result).toEqual(['name', 'age']);
    });

    it('handles null PK fields', () => {
      const result = syncPkFieldsToCompareFields(null, ['name', 'age']);
      expect(result).toEqual(['name', 'age']);
    });

    it('handles null comparison fields', () => {
      const result = syncPkFieldsToCompareFields(['id'], null);
      expect(result).toContain('id');
      expect(result).toHaveLength(1);
    });

    it('handles both null inputs', () => {
      const result = syncPkFieldsToCompareFields(null, null);
      expect(result).toEqual([]);
    });

    it('handles multiple composite PK fields', () => {
      const result = syncPkFieldsToCompareFields(
        ['schema', 'table', 'column'],
        ['value', 'description']
      );
      expect(result).toContain('schema');
      expect(result).toContain('table');
      expect(result).toContain('column');
      expect(result).toContain('value');
      expect(result).toContain('description');
      expect(result).toHaveLength(5);
    });

    it('preserves order with existing fields first for non-PK fields', () => {
      const result = syncPkFieldsToCompareFields(['id'], ['name', 'age']);
      // The Set maintains insertion order, so existing fields come first
      expect(result[0]).toBe('name');
      expect(result[1]).toBe('age');
      expect(result[2]).toBe('id');
    });
  });

  describe('validateOracleToOracleConfig', () => {
    const validSourceA = {
      type: 'oracle',
      connection: { name: 'DEV', connect_string: 'localhost/DEVDB' },
      queryMode: 'table',
      schema: 'HR',
      table: 'EMPLOYEES',
      sql: '',
      whereClause: '',
      maxRows: 100,
    };

    const validSourceB = {
      type: 'oracle',
      connection: { name: 'PROD', connect_string: 'localhost/PRODDB' },
    };

    it('returns valid for proper Oracle vs Oracle table config', () => {
      const result = validateOracleToOracleConfig(validSourceA, validSourceB);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('returns error if source A is not Oracle', () => {
      const result = validateOracleToOracleConfig(
        { ...validSourceA, type: 'excel' },
        validSourceB
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Both sources must be Oracle');
    });

    it('returns error if source B is not Oracle', () => {
      const result = validateOracleToOracleConfig(
        validSourceA,
        { ...validSourceB, type: 'excel' }
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Both sources must be Oracle');
    });

    it('returns error if source A connection is missing', () => {
      const result = validateOracleToOracleConfig(
        { ...validSourceA, connection: null },
        validSourceB
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Source A connection is required');
    });

    it('returns error if source B connection is missing', () => {
      const result = validateOracleToOracleConfig(
        validSourceA,
        { ...validSourceB, connection: null }
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Source B connection is required');
    });

    it('returns error if source A schema is missing in table mode', () => {
      const result = validateOracleToOracleConfig(
        { ...validSourceA, schema: null },
        validSourceB
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Source A schema is required');
    });

    it('returns error if source A table is missing in table mode', () => {
      const result = validateOracleToOracleConfig(
        { ...validSourceA, table: null },
        validSourceB
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Source A table is required');
    });

    it('returns valid for SQL mode with SQL query', () => {
      const sqlSourceA = {
        ...validSourceA,
        queryMode: 'sql',
        sql: 'SELECT * FROM HR.EMPLOYEES',
        schema: null,
        table: null,
      };
      const result = validateOracleToOracleConfig(sqlSourceA, validSourceB);
      expect(result.valid).toBe(true);
    });

    it('returns error for SQL mode without SQL query', () => {
      const sqlSourceA = {
        ...validSourceA,
        queryMode: 'sql',
        sql: '',
        schema: null,
        table: null,
      };
      const result = validateOracleToOracleConfig(sqlSourceA, validSourceB);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Source A SQL query is required');
    });

    it('returns error for SQL mode with whitespace-only SQL', () => {
      const sqlSourceA = {
        ...validSourceA,
        queryMode: 'sql',
        sql: '   ',
        schema: null,
        table: null,
      };
      const result = validateOracleToOracleConfig(sqlSourceA, validSourceB);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Source A SQL query is required');
    });
  });

  describe('createSourceBConfigFromSourceA', () => {
    const sourceAConfig = {
      type: 'oracle',
      connection: { name: 'DEV', connect_string: 'localhost/DEVDB' },
      queryMode: 'table',
      schema: 'HR',
      table: 'EMPLOYEES',
      sql: '',
      whereClause: "status = 'ACTIVE'",
      maxRows: 500,
    };

    const sourceBConnection = { name: 'PROD', connect_string: 'localhost/PRODDB' };

    it('copies all relevant settings from Source A', () => {
      const result = createSourceBConfigFromSourceA(sourceAConfig, sourceBConnection);

      expect(result.type).toBe('oracle');
      expect(result.queryMode).toBe('table');
      expect(result.schema).toBe('HR');
      expect(result.table).toBe('EMPLOYEES');
      expect(result.whereClause).toBe("status = 'ACTIVE'");
      expect(result.maxRows).toBe(500);
    });

    it('uses Source B connection instead of Source A connection', () => {
      const result = createSourceBConfigFromSourceA(sourceAConfig, sourceBConnection);

      expect(result.connection).toBe(sourceBConnection);
      expect(result.connection.name).toBe('PROD');
      expect(result.connection.connect_string).toBe('localhost/PRODDB');
    });

    it('copies SQL for SQL mode', () => {
      const sqlSourceA = {
        ...sourceAConfig,
        queryMode: 'sql',
        sql: 'SELECT * FROM HR.EMPLOYEES WHERE status = :status',
      };
      const result = createSourceBConfigFromSourceA(sqlSourceA, sourceBConnection);

      expect(result.queryMode).toBe('sql');
      expect(result.sql).toBe('SELECT * FROM HR.EMPLOYEES WHERE status = :status');
    });
  });

  describe('getSourceBDisabledFieldsForFollowMode', () => {
    it('returns list of field IDs to disable', () => {
      const result = getSourceBDisabledFieldsForFollowMode();

      expect(result).toContain('source-b-query-mode-wrapper');
      expect(result).toContain('source-b-schema-search');
      expect(result).toContain('source-b-table-search');
      expect(result).toContain('source-b-where');
      expect(result).toContain('source-b-max-rows');
      expect(result).toContain('source-b-sql');
    });

    it('does not include source-b-connection (should remain enabled)', () => {
      const result = getSourceBDisabledFieldsForFollowMode();

      expect(result).not.toContain('source-b-connection');
    });
  });

  describe('validateFieldSelection', () => {
    it('returns valid for key matching with PK and compare fields', () => {
      const result = validateFieldSelection(['id'], ['name', 'value'], 'key');
      expect(result.valid).toBe(true);
    });

    it('returns error for key matching without PK fields', () => {
      const result = validateFieldSelection([], ['name', 'value'], 'key');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('primary key field is required');
    });

    it('returns error for key matching with null PK fields', () => {
      const result = validateFieldSelection(null, ['name', 'value'], 'key');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('primary key field is required');
    });

    it('returns valid for position matching without PK fields', () => {
      const result = validateFieldSelection([], ['name', 'value'], 'position');
      expect(result.valid).toBe(true);
    });

    it('returns error for no comparison fields', () => {
      const result = validateFieldSelection(['id'], [], 'key');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('comparison field is required');
    });

    it('returns error for null comparison fields', () => {
      const result = validateFieldSelection(['id'], null, 'key');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('comparison field is required');
    });

    it('returns valid for position matching with only compare fields', () => {
      const result = validateFieldSelection([], ['name', 'value'], 'position');
      expect(result.valid).toBe(true);
    });
  });

  describe('isMixedMode', () => {
    it('returns true for Oracle vs Excel', () => {
      expect(isMixedMode('oracle', 'excel')).toBe(true);
    });

    it('returns true for Excel vs Oracle', () => {
      expect(isMixedMode('excel', 'oracle')).toBe(true);
    });

    it('returns false for Oracle vs Oracle', () => {
      expect(isMixedMode('oracle', 'oracle')).toBe(false);
    });

    it('returns false for Excel vs Excel', () => {
      expect(isMixedMode('excel', 'excel')).toBe(false);
    });

    it('returns false if source A is null', () => {
      expect(isMixedMode(null, 'excel')).toBe(false);
    });

    it('returns false if source B is null', () => {
      expect(isMixedMode('oracle', null)).toBe(false);
    });
  });

  describe('findCommonFields', () => {
    it('finds common fields with exact case match', () => {
      const result = findCommonFields(['ID', 'NAME', 'VALUE'], ['ID', 'NAME', 'STATUS']);
      expect(result.common).toEqual(['ID', 'NAME']);
      expect(result.onlyInA).toEqual(['VALUE']);
      expect(result.onlyInB).toEqual(['STATUS']);
    });

    it('finds common fields with case-insensitive match', () => {
      const result = findCommonFields(['ID', 'Name', 'VALUE'], ['id', 'name', 'status']);
      expect(result.common).toEqual(['ID', 'Name']);
      expect(result.onlyInA).toEqual(['VALUE']);
      expect(result.onlyInB).toEqual(['status']);
    });

    it('returns empty common when no overlap', () => {
      const result = findCommonFields(['A', 'B'], ['C', 'D']);
      expect(result.common).toEqual([]);
      expect(result.onlyInA).toEqual(['A', 'B']);
      expect(result.onlyInB).toEqual(['C', 'D']);
    });

    it('handles null headersA', () => {
      const result = findCommonFields(null, ['A', 'B']);
      expect(result.common).toEqual([]);
      expect(result.onlyInA).toEqual([]);
      expect(result.onlyInB).toEqual(['A', 'B']);
    });

    it('handles null headersB', () => {
      const result = findCommonFields(['A', 'B'], null);
      expect(result.common).toEqual([]);
      expect(result.onlyInA).toEqual(['A', 'B']);
      expect(result.onlyInB).toEqual([]);
    });

    it('handles empty arrays', () => {
      const result = findCommonFields([], []);
      expect(result.common).toEqual([]);
      expect(result.onlyInA).toEqual([]);
      expect(result.onlyInB).toEqual([]);
    });

    it('returns all common when headers are identical', () => {
      const result = findCommonFields(['A', 'B', 'C'], ['A', 'B', 'C']);
      expect(result.common).toEqual(['A', 'B', 'C']);
      expect(result.onlyInA).toEqual([]);
      expect(result.onlyInB).toEqual([]);
    });
  });

  describe('validateMixedModeConfig', () => {
    const oracleSourceWithHeaders = {
      type: 'oracle',
      headers: ['ID', 'NAME', 'VALUE', 'STATUS'],
    };

    const excelSourceWithHeaders = {
      type: 'excel',
      headers: ['ID', 'NAME', 'DESCRIPTION', 'AMOUNT'],
    };

    it('returns valid for Oracle vs Excel with common fields', () => {
      const result = validateMixedModeConfig(oracleSourceWithHeaders, excelSourceWithHeaders);
      expect(result.valid).toBe(true);
      expect(result.commonFields).toEqual(['ID', 'NAME']);
    });

    it('returns valid for Excel vs Oracle with common fields', () => {
      const result = validateMixedModeConfig(excelSourceWithHeaders, oracleSourceWithHeaders);
      expect(result.valid).toBe(true);
      expect(result.commonFields).toEqual(['ID', 'NAME']);
    });

    it('returns error for non-mixed mode (Oracle vs Oracle)', () => {
      const result = validateMixedModeConfig(
        { type: 'oracle', headers: ['A'] },
        { type: 'oracle', headers: ['A'] }
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Not a mixed mode');
    });

    it('returns error for non-mixed mode (Excel vs Excel)', () => {
      const result = validateMixedModeConfig(
        { type: 'excel', headers: ['A'] },
        { type: 'excel', headers: ['A'] }
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Not a mixed mode');
    });

    it('returns error when source A has no headers', () => {
      const result = validateMixedModeConfig(
        { type: 'oracle', headers: [] },
        excelSourceWithHeaders
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Source A has no columns');
    });

    it('returns error when source B has no headers', () => {
      const result = validateMixedModeConfig(oracleSourceWithHeaders, { type: 'excel', headers: [] });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Source B has no columns');
    });

    it('returns error when no common fields exist', () => {
      const result = validateMixedModeConfig(
        { type: 'oracle', headers: ['A', 'B', 'C'] },
        { type: 'excel', headers: ['X', 'Y', 'Z'] }
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('No common fields');
      expect(result.error).toContain('A, B, C');
      expect(result.error).toContain('X, Y, Z');
    });

    it('returns warning when mismatch ratio is high', () => {
      const result = validateMixedModeConfig(
        { type: 'oracle', headers: ['ID', 'A1', 'A2', 'A3', 'A4'] },
        { type: 'excel', headers: ['ID', 'B1', 'B2', 'B3', 'B4'] }
      );
      expect(result.valid).toBe(true);
      expect(result.warning).toContain('Only 1 common fields');
      expect(result.commonFields).toEqual(['ID']);
    });

    it('does not return warning when mismatch ratio is acceptable', () => {
      const result = validateMixedModeConfig(
        { type: 'oracle', headers: ['ID', 'NAME', 'VALUE'] },
        { type: 'excel', headers: ['ID', 'NAME', 'STATUS'] }
      );
      expect(result.valid).toBe(true);
      expect(result.warning).toBeUndefined();
      expect(result.commonFields).toEqual(['ID', 'NAME']);
    });

    it('handles case-insensitive header matching', () => {
      const result = validateMixedModeConfig(
        { type: 'oracle', headers: ['ID', 'Name', 'VALUE'] },
        { type: 'excel', headers: ['id', 'name', 'status'] }
      );
      expect(result.valid).toBe(true);
      expect(result.commonFields).toEqual(['ID', 'Name']);
    });

    it('returns error for null source config', () => {
      const result = validateMixedModeConfig(null, excelSourceWithHeaders);
      expect(result.valid).toBe(false);
    });
  });

  describe('getResetBehaviorForSourceType', () => {
    it('returns keepCachedFiles=true for Excel type', () => {
      const result = getResetBehaviorForSourceType('excel');
      expect(result.keepCachedFiles).toBe(true);
      expect(result.clearConnection).toBe(false);
      expect(result.clearSelection).toBe(true);
      expect(result.clearData).toBe(true);
    });

    it('returns keepCachedFiles=false for Oracle type', () => {
      const result = getResetBehaviorForSourceType('oracle');
      expect(result.keepCachedFiles).toBe(false);
      expect(result.clearConnection).toBe(true);
      expect(result.clearSelection).toBe(true);
      expect(result.clearData).toBe(true);
    });

    it('returns full reset for null type', () => {
      const result = getResetBehaviorForSourceType(null);
      expect(result.keepCachedFiles).toBe(false);
      expect(result.clearConnection).toBe(true);
      expect(result.clearSelection).toBe(true);
      expect(result.clearData).toBe(true);
    });

    it('returns full reset for undefined type', () => {
      const result = getResetBehaviorForSourceType(undefined);
      expect(result.keepCachedFiles).toBe(false);
      expect(result.clearConnection).toBe(true);
    });

    it('returns full reset for unknown type', () => {
      const result = getResetBehaviorForSourceType('unknown');
      expect(result.keepCachedFiles).toBe(false);
      expect(result.clearConnection).toBe(true);
    });
  });

  describe('createResetSourceState', () => {
    const mockExcelFiles = [
      { id: 'file-1', file: { name: 'test1.xlsx' } },
      { id: 'file-2', file: { name: 'test2.xlsx' } },
    ];

    it('preserves excelFiles for Excel type', () => {
      const result = createResetSourceState('excel', mockExcelFiles);
      expect(result.type).toBe('excel');
      expect(result.excelFiles).toEqual(mockExcelFiles);
      expect(result.selectedExcelFile).toBeNull();
      expect(result.data).toBeNull();
      expect(result.dataLoaded).toBe(false);
    });

    it('clears excelFiles for Oracle type', () => {
      const result = createResetSourceState('oracle', mockExcelFiles);
      expect(result.type).toBe('oracle');
      expect(result.excelFiles).toEqual([]);
      expect(result.connection).toBeNull();
      expect(result.schema).toBeNull();
      expect(result.table).toBeNull();
    });

    it('resets all Oracle config fields', () => {
      const result = createResetSourceState('oracle');
      expect(result.connection).toBeNull();
      expect(result.queryMode).toBe('table');
      expect(result.schema).toBeNull();
      expect(result.table).toBeNull();
      expect(result.sql).toBe('');
      expect(result.whereClause).toBe('');
      expect(result.maxRows).toBe(500);
    });

    it('clears Excel selection but keeps files', () => {
      const result = createResetSourceState('excel', mockExcelFiles);
      expect(result.selectedExcelFile).toBeNull();
      expect(result.file).toBeNull();
      expect(result.parsedData).toBeNull();
      expect(result.excelFiles).toHaveLength(2);
    });

    it('handles null type with empty excelFiles', () => {
      const result = createResetSourceState(null);
      expect(result.type).toBeNull();
      expect(result.excelFiles).toEqual([]);
      expect(result.connection).toBeNull();
    });

    it('handles undefined existing files', () => {
      const result = createResetSourceState('excel', undefined);
      expect(result.excelFiles).toEqual([]);
    });

    it('handles empty existing files array', () => {
      const result = createResetSourceState('excel', []);
      expect(result.excelFiles).toEqual([]);
    });

    it('preserves type so UI stays on same source type', () => {
      const excelResult = createResetSourceState('excel', mockExcelFiles);
      const oracleResult = createResetSourceState('oracle');

      expect(excelResult.type).toBe('excel');
      expect(oracleResult.type).toBe('oracle');
    });
  });

  describe('canStartUnifiedComparison', () => {
    it('returns canCompare=false when sourceA type is null', () => {
      const unified = {
        sourceA: { type: null },
        sourceB: { type: 'oracle' },
      };
      const result = canStartUnifiedComparison(unified);
      expect(result.canCompare).toBe(false);
      expect(result.reason).toContain('Source A');
    });

    it('returns canCompare=false when sourceB type is null', () => {
      const unified = {
        sourceA: { type: 'oracle' },
        sourceB: { type: null },
      };
      const result = canStartUnifiedComparison(unified);
      expect(result.canCompare).toBe(false);
      expect(result.reason).toContain('Source B');
    });

    it('returns canCompare=true for Oracle vs Oracle', () => {
      const unified = {
        sourceA: { type: 'oracle' },
        sourceB: { type: 'oracle' },
      };
      const result = canStartUnifiedComparison(unified);
      expect(result.canCompare).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('returns canCompare=true for Oracle vs Excel', () => {
      const unified = {
        sourceA: { type: 'oracle' },
        sourceB: { type: 'excel' },
      };
      const result = canStartUnifiedComparison(unified);
      expect(result.canCompare).toBe(true);
    });

    it('returns canCompare=true for Excel vs Oracle', () => {
      const unified = {
        sourceA: { type: 'excel' },
        sourceB: { type: 'oracle' },
      };
      const result = canStartUnifiedComparison(unified);
      expect(result.canCompare).toBe(true);
    });

    it('returns canCompare=true for Excel vs Excel', () => {
      const unified = {
        sourceA: { type: 'excel' },
        sourceB: { type: 'excel' },
      };
      const result = canStartUnifiedComparison(unified);
      expect(result.canCompare).toBe(true);
    });
  });

  describe('syncPkFieldsWithTracking', () => {
    it('returns empty arrays when no PK fields selected', () => {
      const result = syncPkFieldsWithTracking([], ['field1', 'field2']);
      expect(result.updatedCompareFields).toEqual(['field1', 'field2']);
      expect(result.newlyAddedFields).toEqual([]);
    });

    it('returns empty arrays when PK fields is null', () => {
      const result = syncPkFieldsWithTracking(null, ['field1']);
      expect(result.updatedCompareFields).toEqual(['field1']);
      expect(result.newlyAddedFields).toEqual([]);
    });

    it('adds new PK field and tracks it as newly added', () => {
      const result = syncPkFieldsWithTracking(['id'], ['name', 'status']);
      expect(result.updatedCompareFields).toContain('id');
      expect(result.updatedCompareFields).toContain('name');
      expect(result.updatedCompareFields).toContain('status');
      expect(result.newlyAddedFields).toEqual(['id']);
    });

    it('does not track already existing fields as newly added', () => {
      const result = syncPkFieldsWithTracking(['id'], ['id', 'name']);
      expect(result.updatedCompareFields).toEqual(['id', 'name']);
      expect(result.newlyAddedFields).toEqual([]);
    });

    it('tracks multiple newly added fields', () => {
      const result = syncPkFieldsWithTracking(['pk1', 'pk2', 'pk3'], ['existing']);
      expect(result.updatedCompareFields).toHaveLength(4);
      expect(result.newlyAddedFields).toEqual(['pk1', 'pk2', 'pk3']);
    });

    it('tracks only fields that are new', () => {
      const result = syncPkFieldsWithTracking(['pk1', 'pk2'], ['pk1', 'other']);
      expect(result.updatedCompareFields).toContain('pk1');
      expect(result.updatedCompareFields).toContain('pk2');
      expect(result.updatedCompareFields).toContain('other');
      expect(result.newlyAddedFields).toEqual(['pk2']);
    });

    it('handles empty compare fields array', () => {
      const result = syncPkFieldsWithTracking(['id'], []);
      expect(result.updatedCompareFields).toEqual(['id']);
      expect(result.newlyAddedFields).toEqual(['id']);
    });

    it('handles null compare fields array', () => {
      const result = syncPkFieldsWithTracking(['id'], null);
      expect(result.updatedCompareFields).toEqual(['id']);
      expect(result.newlyAddedFields).toEqual(['id']);
    });
  });

  describe('getUnifiedProgressSteps', () => {
    it('returns 4 progress steps', () => {
      const steps = getUnifiedProgressSteps();
      expect(steps).toHaveLength(4);
    });

    it('returns steps with correct IDs', () => {
      const steps = getUnifiedProgressSteps();
      const ids = steps.map((s) => s.id);
      expect(ids).toEqual(['source-a', 'validate-b', 'source-b', 'reconcile']);
    });

    it('each step has id, label, and defaultDetail', () => {
      const steps = getUnifiedProgressSteps();
      for (const step of steps) {
        expect(step).toHaveProperty('id');
        expect(step).toHaveProperty('label');
        expect(step).toHaveProperty('defaultDetail');
        expect(typeof step.id).toBe('string');
        expect(typeof step.label).toBe('string');
        expect(typeof step.defaultDetail).toBe('string');
      }
    });

    it('returns correct labels for each step', () => {
      const steps = getUnifiedProgressSteps();
      expect(steps[0].label).toBe('Loading Source A data');
      expect(steps[1].label).toBe('Validating Source B');
      expect(steps[2].label).toBe('Loading Source B data');
      expect(steps[3].label).toBe('Reconciling fields');
    });
  });

  describe('getVisibleStepsForMode', () => {
    it('returns all 4 steps for oracle-oracle mode', () => {
      const steps = getVisibleStepsForMode('oracle-oracle');
      expect(steps).toEqual(['source-a', 'validate-b', 'source-b', 'reconcile']);
    });

    it('returns 3 steps (no validate-b) for oracle-excel mode', () => {
      const steps = getVisibleStepsForMode('oracle-excel');
      expect(steps).toEqual(['source-a', 'source-b', 'reconcile']);
      expect(steps).not.toContain('validate-b');
    });

    it('returns 3 steps (no validate-b) for excel-oracle mode', () => {
      const steps = getVisibleStepsForMode('excel-oracle');
      expect(steps).toEqual(['source-a', 'source-b', 'reconcile']);
      expect(steps).not.toContain('validate-b');
    });

    it('returns 3 steps (no validate-b) for excel-excel mode', () => {
      const steps = getVisibleStepsForMode('excel-excel');
      expect(steps).toEqual(['source-a', 'source-b', 'reconcile']);
      expect(steps).not.toContain('validate-b');
    });

    it('returns 3 steps for null mode', () => {
      const steps = getVisibleStepsForMode(null);
      expect(steps).toEqual(['source-a', 'source-b', 'reconcile']);
    });
  });

  describe('getStepLabel', () => {
    it('returns correct label for source-a step', () => {
      expect(getStepLabel('source-a')).toBe('Loading Source A data');
    });

    it('returns correct label for validate-b step', () => {
      expect(getStepLabel('validate-b')).toBe('Validating Source B');
    });

    it('returns correct label for source-b step', () => {
      expect(getStepLabel('source-b')).toBe('Loading Source B data');
    });

    it('returns correct label for reconcile step', () => {
      expect(getStepLabel('reconcile')).toBe('Reconciling fields');
    });

    it('returns null for unknown step ID', () => {
      expect(getStepLabel('unknown-step')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(getStepLabel('')).toBeNull();
    });
  });

  // ============================================
  // Phase 5.3: Error Handling Utilities
  // ============================================

  describe('UnifiedErrorType', () => {
    it('defines TABLE_NOT_FOUND error type', () => {
      expect(UnifiedErrorType.TABLE_NOT_FOUND).toBe('table_not_found');
    });

    it('defines SCHEMA_NOT_FOUND error type', () => {
      expect(UnifiedErrorType.SCHEMA_NOT_FOUND).toBe('schema_not_found');
    });

    it('defines NO_COMMON_FIELDS error type', () => {
      expect(UnifiedErrorType.NO_COMMON_FIELDS).toBe('no_common_fields');
    });

    it('defines all expected error types', () => {
      expect(UnifiedErrorType).toHaveProperty('TABLE_NOT_FOUND');
      expect(UnifiedErrorType).toHaveProperty('SCHEMA_NOT_FOUND');
      expect(UnifiedErrorType).toHaveProperty('CONNECTION_FAILED');
      expect(UnifiedErrorType).toHaveProperty('NO_COMMON_FIELDS');
      expect(UnifiedErrorType).toHaveProperty('NO_DATA');
      expect(UnifiedErrorType).toHaveProperty('FILE_PARSE_ERROR');
      expect(UnifiedErrorType).toHaveProperty('VALIDATION_ERROR');
    });
  });

  describe('getActionableErrorMessage', () => {
    it('returns actionable message for TABLE_NOT_FOUND', () => {
      const result = getActionableErrorMessage(UnifiedErrorType.TABLE_NOT_FOUND, {
        schema: 'HR',
        table: 'EMPLOYEES',
        connectionName: 'PROD',
      });
      expect(result.title).toBe('Table Not Found');
      expect(result.message).toContain('HR.EMPLOYEES');
      expect(result.message).toContain('PROD');
      expect(result.hint).toBeTruthy();
    });

    it('returns actionable message for SCHEMA_NOT_FOUND', () => {
      const result = getActionableErrorMessage(UnifiedErrorType.SCHEMA_NOT_FOUND, {
        schema: 'UNKNOWN_SCHEMA',
        connectionName: 'DEV',
      });
      expect(result.title).toBe('Schema Not Accessible');
      expect(result.message).toContain('UNKNOWN_SCHEMA');
      expect(result.hint).toContain('permission');
    });

    it('returns actionable message for CONNECTION_FAILED', () => {
      const result = getActionableErrorMessage(UnifiedErrorType.CONNECTION_FAILED, {
        connectionName: 'STAGING',
        errorDetail: 'timeout',
      });
      expect(result.title).toBe('Connection Failed');
      expect(result.message).toContain('STAGING');
      expect(result.hint).toContain('timeout');
    });

    it('returns actionable message for NO_COMMON_FIELDS with headers', () => {
      const result = getActionableErrorMessage(UnifiedErrorType.NO_COMMON_FIELDS, {
        headersA: ['id', 'name', 'email'],
        headersB: ['user_id', 'full_name', 'contact'],
      });
      expect(result.title).toBe('No Common Fields');
      expect(result.hint).toContain('id, name, email');
      expect(result.hint).toContain('user_id, full_name, contact');
    });

    it('returns actionable message for NO_DATA with WHERE clause', () => {
      const result = getActionableErrorMessage(UnifiedErrorType.NO_DATA, {
        source: 'Source A',
        whereClause: "status = 'DELETED'",
      });
      expect(result.title).toBe('No Data Returned');
      expect(result.message).toContain('Source A');
      expect(result.hint).toContain("status = 'DELETED'");
    });

    it('returns actionable message for FILE_PARSE_ERROR', () => {
      const result = getActionableErrorMessage(UnifiedErrorType.FILE_PARSE_ERROR, {
        fileName: 'data.xlsx',
        errorDetail: 'Corrupted file format',
      });
      expect(result.title).toBe('File Parse Error');
      expect(result.message).toContain('data.xlsx');
      expect(result.hint).toContain('Corrupted file format');
    });

    it('returns generic message for unknown error type', () => {
      const result = getActionableErrorMessage('unknown_type', {
        message: 'Something went wrong',
      });
      expect(result.title).toBe('Error');
      expect(result.message).toBe('Something went wrong');
    });

    it('uses default values when context is empty', () => {
      const result = getActionableErrorMessage(UnifiedErrorType.TABLE_NOT_FOUND, {});
      expect(result.title).toBe('Table Not Found');
      expect(result.message).toContain('undefined.undefined'); // schema.table placeholders
      expect(result.hint).toBeTruthy();
    });
  });

  describe('formatFieldList', () => {
    it('returns (none) for empty array', () => {
      expect(formatFieldList([])).toBe('(none)');
    });

    it('returns (none) for null', () => {
      expect(formatFieldList(null)).toBe('(none)');
    });

    it('returns all fields if under maxDisplay', () => {
      const fields = ['id', 'name', 'email'];
      expect(formatFieldList(fields)).toBe('id, name, email');
    });

    it('returns exactly maxDisplay fields without truncation', () => {
      const fields = ['a', 'b', 'c', 'd', 'e'];
      expect(formatFieldList(fields, 5)).toBe('a, b, c, d, e');
    });

    it('truncates fields over maxDisplay', () => {
      const fields = ['id', 'name', 'email', 'phone', 'address', 'city', 'state'];
      expect(formatFieldList(fields, 5)).toBe('id, name, email, phone, address, +2 more');
    });

    it('uses default maxDisplay of 5', () => {
      const fields = ['a', 'b', 'c', 'd', 'e', 'f'];
      const result = formatFieldList(fields);
      expect(result).toContain('+1 more');
    });
  });

  describe('validateSourceConfig', () => {
    it('returns null for valid Oracle table config', () => {
      const config = {
        type: 'oracle',
        connection: { name: 'PROD' },
        queryMode: 'table',
        schema: 'HR',
        table: 'EMPLOYEES',
      };
      expect(validateSourceConfig(config, 'A')).toBeNull();
    });

    it('returns null for valid Oracle SQL config', () => {
      const config = {
        type: 'oracle',
        connection: { name: 'PROD' },
        queryMode: 'sql',
        sql: 'SELECT * FROM HR.EMPLOYEES',
      };
      expect(validateSourceConfig(config, 'A')).toBeNull();
    });

    it('returns null for valid Excel config with selected file', () => {
      const config = {
        type: 'excel',
        excelFiles: [{ id: '1', file: {} }],
        selectedExcelFile: { id: '1', file: {} },
      };
      expect(validateSourceConfig(config, 'A')).toBeNull();
    });

    it('returns info message when Oracle connection not selected', () => {
      const config = {
        type: 'oracle',
        connection: null,
        queryMode: 'table',
      };
      const result = validateSourceConfig(config, 'A');
      expect(result.type).toBe('info');
      expect(result.message).toContain('connection');
    });

    it('returns info message when Oracle schema not selected', () => {
      const config = {
        type: 'oracle',
        connection: { name: 'PROD' },
        queryMode: 'table',
        schema: null,
      };
      const result = validateSourceConfig(config, 'A');
      expect(result.type).toBe('info');
      expect(result.message).toContain('schema');
    });

    it('returns info message when Oracle table not selected', () => {
      const config = {
        type: 'oracle',
        connection: { name: 'PROD' },
        queryMode: 'table',
        schema: 'HR',
        table: null,
      };
      const result = validateSourceConfig(config, 'A');
      expect(result.type).toBe('info');
      expect(result.message).toContain('table');
    });

    it('returns info message when SQL is empty', () => {
      const config = {
        type: 'oracle',
        connection: { name: 'PROD' },
        queryMode: 'sql',
        sql: '   ',
      };
      const result = validateSourceConfig(config, 'A');
      expect(result.type).toBe('info');
      expect(result.message).toContain('SQL');
    });

    it('returns info message when Excel files not uploaded', () => {
      const config = {
        type: 'excel',
        excelFiles: [],
        selectedExcelFile: null,
      };
      const result = validateSourceConfig(config, 'A');
      expect(result.type).toBe('info');
      expect(result.message).toContain('Upload');
    });

    it('returns info message when Excel file not selected', () => {
      const config = {
        type: 'excel',
        excelFiles: [{ id: '1', file: {} }],
        selectedExcelFile: null,
      };
      const result = validateSourceConfig(config, 'A');
      expect(result.type).toBe('info');
      expect(result.message).toContain('Select a file');
    });

    it('returns info message for Source B in Oracle-Oracle mode without schema (no follow mode)', () => {
      // Follow mode is deprecated - Source B requires full configuration
      const config = {
        type: 'oracle',
        connection: { name: 'PROD' },
        queryMode: 'table',
        schema: null,
        table: null,
      };
      const otherConfig = { type: 'oracle' };
      const result = validateSourceConfig(config, 'B', otherConfig);
      expect(result).not.toBeNull();
      expect(result.message).toContain('schema');
    });

    it('returns null when type is null', () => {
      const config = { type: null };
      expect(validateSourceConfig(config, 'A')).toBeNull();
    });
  });

  describe('parseOracleError', () => {
    it('returns friendly message for ORA-12154', () => {
      const result = parseOracleError('ORA-12154: TNS:could not resolve the connect identifier');
      expect(result.code).toBe('ORA-12154');
      expect(result.friendlyMessage).toContain('TNS name');
    });

    it('returns friendly message for ORA-12514', () => {
      const result = parseOracleError('ORA-12514: TNS:listener does not currently know of service');
      expect(result.code).toBe('ORA-12514');
      expect(result.friendlyMessage).toContain('Service name');
    });

    it('returns friendly message for ORA-01017', () => {
      const result = parseOracleError('ORA-01017: invalid username/password; logon denied');
      expect(result.code).toBe('ORA-01017');
      expect(result.friendlyMessage).toContain('username or password');
    });

    it('returns friendly message for ORA-00942', () => {
      const result = parseOracleError('ORA-00942: table or view does not exist');
      expect(result.code).toBe('ORA-00942');
      expect(result.friendlyMessage).toContain('Table or view');
    });

    it('returns friendly message for timeout errors', () => {
      const result = parseOracleError('Connection timeout after 30000ms');
      expect(result.code).toBe('TIMEOUT');
      expect(result.friendlyMessage).toContain('timed out');
    });

    it('returns friendly message for network errors', () => {
      const result = parseOracleError('Network error: socket closed');
      expect(result.code).toBe('NETWORK');
      expect(result.friendlyMessage).toContain('Network error');
    });

    it('returns original message for unknown error', () => {
      const result = parseOracleError('Some unexpected error occurred');
      expect(result.code).toBeNull();
      expect(result.friendlyMessage).toBe('Some unexpected error occurred');
    });

    it('handles null input', () => {
      const result = parseOracleError(null);
      expect(result.code).toBeNull();
      expect(result.friendlyMessage).toContain('unknown error');
    });

    it('handles empty string input', () => {
      const result = parseOracleError('');
      expect(result.code).toBeNull();
      expect(result.friendlyMessage).toContain('unknown error');
    });
  });
});
