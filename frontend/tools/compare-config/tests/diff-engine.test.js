/**
 * Unit tests for diff-engine.js
 */
import { describe, it, expect } from 'vitest';
import {
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
} from '../lib/diff-engine.js';

describe('DiffEngine', () => {
  describe('calculateChangeRatio', () => {
    it('returns 0 for identical strings', () => {
      expect(calculateChangeRatio('hello', 'hello')).toBe(0);
    });

    it('returns 1 for completely different strings', () => {
      expect(calculateChangeRatio('abc', 'xyz')).toBeCloseTo(1, 1);
    });

    it('returns 0 for both empty', () => {
      expect(calculateChangeRatio('', '')).toBe(0);
    });

    it('returns 1 for one empty string', () => {
      expect(calculateChangeRatio('hello', '')).toBe(1);
      expect(calculateChangeRatio('', 'hello')).toBe(1);
    });

    it('calculates partial change ratio correctly', () => {
      // "hello" -> "hallo" = 2 changes (e removed, a added) out of 6 total chars
      const ratio = calculateChangeRatio('hello', 'hallo');
      expect(ratio).toBeGreaterThan(0);
      expect(ratio).toBeLessThan(1);
    });

    it('handles null/undefined values', () => {
      expect(calculateChangeRatio(null, null)).toBe(0);
      expect(calculateChangeRatio(null, 'test')).toBe(1);
      expect(calculateChangeRatio('test', undefined)).toBe(1);
    });
  });

  describe('computeCharDiff', () => {
    it('returns single equal segment for identical strings', () => {
      const result = computeCharDiff('hello', 'hello');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ type: DiffType.EQUAL, value: 'hello' });
    });

    it('detects character insertions', () => {
      const result = computeCharDiff('helo', 'hello');
      const insertions = result.filter(s => s.type === DiffType.INSERT);
      expect(insertions.length).toBeGreaterThan(0);
    });

    it('detects character deletions', () => {
      const result = computeCharDiff('hello', 'helo');
      const deletions = result.filter(s => s.type === DiffType.DELETE);
      expect(deletions.length).toBeGreaterThan(0);
    });

    it('handles empty strings', () => {
      expect(computeCharDiff('', '')).toEqual([{ type: DiffType.EQUAL, value: '' }]);
      expect(computeCharDiff('', 'abc')).toContainEqual({ type: DiffType.INSERT, value: 'abc' });
      expect(computeCharDiff('abc', '')).toContainEqual({ type: DiffType.DELETE, value: 'abc' });
    });

    it('handles complex changes', () => {
      const result = computeCharDiff('The quick brown fox', 'The slow brown dog');
      expect(result.some(s => s.type === DiffType.DELETE)).toBe(true);
      expect(result.some(s => s.type === DiffType.INSERT)).toBe(true);
      expect(result.some(s => s.type === DiffType.EQUAL)).toBe(true);
    });
  });

  describe('computeWordDiff', () => {
    it('detects word-level changes', () => {
      const result = computeWordDiff('hello world', 'hello universe');
      expect(result.some(s => s.type === DiffType.DELETE && s.value.includes('world'))).toBe(true);
      expect(result.some(s => s.type === DiffType.INSERT && s.value.includes('universe'))).toBe(true);
    });
  });

  describe('computeAdaptiveDiff', () => {
    it('returns unchanged for identical strings', () => {
      const result = computeAdaptiveDiff('hello', 'hello');
      expect(result.type).toBe('unchanged');
      expect(result.changed).toBe(false);
    });

    it('returns cell-diff for >50% change', () => {
      const result = computeAdaptiveDiff('abc', 'xyz');
      expect(result.type).toBe('cell-diff');
      expect(result.changed).toBe(true);
      expect(result.segments).toBeNull();
    });

    it('returns char-diff for <=50% change', () => {
      const result = computeAdaptiveDiff('hello', 'hallo');
      expect(result.type).toBe('char-diff');
      expect(result.changed).toBe(true);
      expect(result.segments).toBeDefined();
      expect(Array.isArray(result.segments)).toBe(true);
    });

    it('respects custom threshold', () => {
      // 'hello' -> 'hallo' is ~33% change, with threshold 0.2 it should be cell-diff
      const lowThreshold = computeAdaptiveDiff('hello', 'hallo', { threshold: 0.2 });
      expect(lowThreshold.type).toBe('cell-diff');

      // With threshold 0.5 (default), same change should be char-diff
      const highThreshold = computeAdaptiveDiff('hello', 'hallo', { threshold: 0.5 });
      expect(highThreshold.type).toBe('char-diff');
    });
  });

  describe('buildCompositeKey', () => {
    it('builds single column key', () => {
      const row = { id: 'A001', name: 'Test' };
      const key = buildCompositeKey(row, ['id']);
      expect(key).toBe('A001');
    });

    it('builds composite key with delimiter', () => {
      const row = { schema: 'HR', table: 'EMPLOYEES' };
      const key = buildCompositeKey(row, ['schema', 'table']);
      expect(key).toContain('HR');
      expect(key).toContain('EMPLOYEES');
      expect(key.includes('\x00|\x00')).toBe(true);
    });

    it('handles null values in key', () => {
      const row = { id: null, name: 'Test' };
      const key = buildCompositeKey(row, ['id', 'name']);
      expect(key).toContain('Test');
    });
  });

  describe('buildKeyMaps', () => {
    it('builds map with unique keys', () => {
      const rows = [
        { id: 'A', value: 1 },
        { id: 'B', value: 2 },
        { id: 'C', value: 3 }
      ];
      const { keyMap, duplicates } = buildKeyMaps(rows, ['id']);

      expect(keyMap.size).toBe(3);
      expect(duplicates).toHaveLength(0);
      expect(keyMap.get('A').row.value).toBe(1);
    });

    it('handles duplicate keys with suffixes', () => {
      const rows = [
        { id: 'A', value: 1 },
        { id: 'A', value: 2 },
        { id: 'A', value: 3 },
        { id: 'B', value: 4 }
      ];
      const { keyMap, duplicates } = buildKeyMaps(rows, ['id']);

      expect(keyMap.size).toBe(4);  // A#1, A#2, A#3, B
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0].key).toBe('A');
      expect(duplicates[0].count).toBe(3);

      expect(keyMap.get('A#1').row.value).toBe(1);
      expect(keyMap.get('A#2').row.value).toBe(2);
      expect(keyMap.get('A#3').row.value).toBe(3);
      expect(keyMap.get('B').row.value).toBe(4);
    });

    it('preserves original row index', () => {
      const rows = [
        { id: 'A', value: 1 },
        { id: 'B', value: 2 }
      ];
      const { keyMap } = buildKeyMaps(rows, ['id']);

      expect(keyMap.get('A').index).toBe(0);
      expect(keyMap.get('B').index).toBe(1);
    });
  });

  describe('normalizeDate', () => {
    it('normalizes ISO date', () => {
      expect(normalizeDate('2024-01-15')).toBe('2024-01-15');
    });

    it('normalizes ISO datetime', () => {
      const result = normalizeDate('2024-01-15T10:30:00');
      expect(result).toBe('2024-01-15');
    });

    it('normalizes US format', () => {
      const result = normalizeDate('01/15/2024');
      expect(result).toBe('2024-01-15');
    });

    it('normalizes Excel serial number', () => {
      // 45306 should be around Jan 15, 2024
      const result = normalizeDate('45306');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('returns null for non-date strings', () => {
      expect(normalizeDate('hello')).toBeNull();
      expect(normalizeDate('')).toBeNull();
      expect(normalizeDate(null)).toBeNull();
    });
  });

  describe('normalizeNumber', () => {
    it('normalizes integers', () => {
      expect(normalizeNumber('123')).toBe(123);
      expect(normalizeNumber(123)).toBe(123);
    });

    it('normalizes US format with commas', () => {
      expect(normalizeNumber('1,234.56')).toBe(1234.56);
      expect(normalizeNumber('1,234,567.89')).toBe(1234567.89);
    });

    it('normalizes European format with dots and comma decimal', () => {
      expect(normalizeNumber('1.234,56')).toBe(1234.56);
    });

    it('handles negative numbers', () => {
      expect(normalizeNumber('-123.45')).toBe(-123.45);
    });

    it('returns null for non-numeric strings', () => {
      expect(normalizeNumber('hello')).toBeNull();
      expect(normalizeNumber('')).toBeNull();
      expect(normalizeNumber(null)).toBeNull();
    });

    it('handles floating point precision', () => {
      // Should round to 10 decimal places
      const result = normalizeNumber('0.1');
      expect(result).toBe(0.1);
    });
  });

  describe('compareValues', () => {
    it('compares strings strictly by default', () => {
      expect(compareValues('hello', 'hello')).toBe(true);
      expect(compareValues('hello', 'Hello')).toBe(false);
      expect(compareValues('1,234', '1234')).toBe(false);
    });

    it('normalizes dates when enabled', () => {
      expect(compareValues('2024-01-15', '01/15/2024', true)).toBe(true);
    });

    it('normalizes numbers when enabled', () => {
      expect(compareValues('1,234.56', '1234.56', true)).toBe(true);
      expect(compareValues('1.234,56', '1234.56', true)).toBe(true);
    });

    it('handles null/undefined', () => {
      expect(compareValues(null, null)).toBe(true);
      expect(compareValues(null, '')).toBe(true);  // Both convert to empty string
      expect(compareValues(null, 'test')).toBe(false);
    });
  });

  describe('compareRow', () => {
    it('detects matching rows', () => {
      const refRow = { id: 1, name: 'John', age: 30 };
      const compRow = { id: 1, name: 'John', age: 30 };
      const result = compareRow(refRow, compRow, ['name', 'age']);

      expect(result.status).toBe(RowStatus.MATCH);
      expect(result.differences).toBeNull();
    });

    it('detects differing rows', () => {
      const refRow = { id: 1, name: 'John', age: 30 };
      const compRow = { id: 1, name: 'Jane', age: 30 };
      const result = compareRow(refRow, compRow, ['name', 'age']);

      expect(result.status).toBe(RowStatus.DIFFER);
      expect(result.differences).toHaveProperty('name');
      expect(result.differences).not.toHaveProperty('age');
    });

    it('uses adaptive diff for field differences', () => {
      const refRow = { id: 1, name: 'John' };
      const compRow = { id: 1, name: 'Johan' };
      const result = compareRow(refRow, compRow, ['name']);

      expect(result.differences.name.type).toBe('char-diff');
    });
  });

  describe('compareDatasets', () => {
    it('compares datasets by key', () => {
      const refData = [
        { id: 'A', value: 1 },
        { id: 'B', value: 2 },
        { id: 'C', value: 3 }
      ];
      const compData = [
        { id: 'A', value: 1 },
        { id: 'B', value: 99 },  // Changed
        { id: 'D', value: 4 }    // New
      ];

      const result = compareDatasets(refData, compData, {
        keyColumns: ['id'],
        fields: ['value'],
        matchMode: 'key'
      });

      expect(result.summary.matches).toBe(1);       // A
      expect(result.summary.differs).toBe(1);       // B
      expect(result.summary.onlyInRef).toBe(1);     // C
      expect(result.summary.onlyInComp).toBe(1);    // D
      expect(result.summary.total).toBe(4);
    });

    it('compares datasets by position', () => {
      const refData = [
        { value: 1 },
        { value: 2 },
        { value: 3 }
      ];
      const compData = [
        { value: 1 },
        { value: 99 }
      ];

      const result = compareDatasets(refData, compData, {
        fields: ['value'],
        matchMode: 'position'
      });

      expect(result.summary.matches).toBe(1);       // Row 1
      expect(result.summary.differs).toBe(1);       // Row 2
      expect(result.summary.onlyInRef).toBe(1);     // Row 3
      expect(result.summary.total).toBe(3);
    });

    it('reports duplicate keys', () => {
      const refData = [
        { id: 'A', value: 1 },
        { id: 'A', value: 2 }
      ];
      const compData = [
        { id: 'A', value: 1 }
      ];

      const result = compareDatasets(refData, compData, {
        keyColumns: ['id'],
        fields: ['value'],
        matchMode: 'key'
      });

      expect(result.duplicateKeys.reference).toHaveLength(1);
      expect(result.duplicateKeys.reference[0].key).toBe('A');
    });

    it('sorts results with differs first', () => {
      const refData = [
        { id: 'A', value: 1 },  // Match
        { id: 'B', value: 2 },  // Differ
        { id: 'C', value: 3 }   // Only in ref
      ];
      const compData = [
        { id: 'A', value: 1 },
        { id: 'B', value: 99 },
        { id: 'D', value: 4 }   // Only in comp
      ];

      const result = compareDatasets(refData, compData, {
        keyColumns: ['id'],
        fields: ['value'],
        matchMode: 'key'
      });

      // Differs should come first
      expect(result.rows[0].status).toBe(RowStatus.DIFFER);
      // Matches should come last
      expect(result.rows[result.rows.length - 1].status).toBe(RowStatus.MATCH);
    });
  });

  describe('reconcileColumns', () => {
    it('identifies common columns', () => {
      const refHeaders = ['id', 'name', 'age'];
      const compHeaders = ['id', 'name', 'email'];
      const result = reconcileColumns(refHeaders, compHeaders);

      expect(result.common).toContain('id');
      expect(result.common).toContain('name');
      expect(result.common).not.toContain('age');
      expect(result.common).not.toContain('email');
    });

    it('identifies columns only in reference', () => {
      const refHeaders = ['id', 'name', 'age'];
      const compHeaders = ['id', 'name'];
      const result = reconcileColumns(refHeaders, compHeaders);

      expect(result.onlyInRef).toContain('age');
    });

    it('identifies columns only in comparator', () => {
      const refHeaders = ['id', 'name'];
      const compHeaders = ['id', 'name', 'email'];
      const result = reconcileColumns(refHeaders, compHeaders);

      expect(result.onlyInComp).toContain('email');
    });

    it('handles case-insensitive matching', () => {
      const refHeaders = ['ID', 'Name'];
      const compHeaders = ['id', 'name'];
      const result = reconcileColumns(refHeaders, compHeaders);

      expect(result.common).toHaveLength(2);
      expect(result.isExactMatch).toBe(true);
    });

    it('detects exact match', () => {
      const headers = ['id', 'name', 'age'];
      const result = reconcileColumns(headers, headers);

      expect(result.isExactMatch).toBe(true);
      expect(result.onlyInRef).toHaveLength(0);
      expect(result.onlyInComp).toHaveLength(0);
    });
  });
});
