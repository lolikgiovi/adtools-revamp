import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SchemaValidationService } from '../app/tools/quick-query/services/SchemaValidationService.js';
import { UsageTracker } from '../app/core/UsageTracker.js';

// Mock UsageTracker
vi.mock('../app/core/UsageTracker.js', () => ({
  UsageTracker: {
    trackEvent: vi.fn(),
  },
}));

describe('SchemaValidationService', () => {
  let service;

  beforeEach(() => {
    service = new SchemaValidationService();
    vi.clearAllMocks();
  });

  describe('columnIndexToLetter', () => {
    it('should convert 0 to A', () => {
      expect(service.columnIndexToLetter(0)).toBe('A');
    });

    it('should convert 1 to B', () => {
      expect(service.columnIndexToLetter(1)).toBe('B');
    });

    it('should convert 25 to Z', () => {
      expect(service.columnIndexToLetter(25)).toBe('Z');
    });

    it('should convert 26 to AA', () => {
      expect(service.columnIndexToLetter(26)).toBe('AA');
    });

    it('should convert 27 to AB', () => {
      expect(service.columnIndexToLetter(27)).toBe('AB');
    });
  });

  describe('matchSchemaWithData', () => {
    it('should throw error with column letter when field name is empty', () => {
      const schemaData = [['ID', 'NUMBER', 'No']];
      // Input data: Header row has empty second column (index 1 -> B)
      const inputData = [
        ['ID', ''], 
        ['1', 'Value']
      ];

      expect(() => service.matchSchemaWithData(schemaData, inputData)).toThrow(/Empty field name found in data input at column B/);
    });

    it('should pass with valid data', () => {
      const schemaData = [['ID', 'NUMBER', 'No']];
      const inputData = [
        ['ID'], 
        ['1']
      ];
      expect(service.matchSchemaWithData(schemaData, inputData)).toBe(true);
    });
  });
});
