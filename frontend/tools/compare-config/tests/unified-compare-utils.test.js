/**
 * Unit tests for unified-compare-utils.js
 */
import { describe, it, expect } from 'vitest';
import {
  getComparisonMode,
  isSourceBFollowMode,
  syncPkFieldsToCompareFields,
  validateOracleToOracleConfig,
  createSourceBConfigFromSourceA,
  getSourceBDisabledFieldsForFollowMode,
  validateFieldSelection,
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
    it('returns true for Oracle vs Oracle', () => {
      expect(isSourceBFollowMode('oracle', 'oracle')).toBe(true);
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

      expect(result).toContain('source-b-query-mode');
      expect(result).toContain('source-b-schema');
      expect(result).toContain('source-b-table');
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
});
