import { describe, it, expect, beforeEach } from 'vitest';
import { QueryGenerationService } from '../services/QueryGenerationService.js';

describe('QueryGenerationService - Helper Methods', () => {
  let service;

  beforeEach(() => {
    service = new QueryGenerationService();
  });

  describe('columnIndexToLetter', () => {
    it('should convert single letter columns (A-Z)', () => {
      expect(service.columnIndexToLetter(0)).toBe('A');
      expect(service.columnIndexToLetter(1)).toBe('B');
      expect(service.columnIndexToLetter(25)).toBe('Z');
    });

    it('should convert double letter columns (AA-AZ, BA-BZ, etc.)', () => {
      expect(service.columnIndexToLetter(26)).toBe('AA');
      expect(service.columnIndexToLetter(27)).toBe('AB');
      expect(service.columnIndexToLetter(51)).toBe('AZ');
      expect(service.columnIndexToLetter(52)).toBe('BA');
      expect(service.columnIndexToLetter(701)).toBe('ZZ');
    });

    it('should convert triple letter columns (AAA, AAB, etc.)', () => {
      expect(service.columnIndexToLetter(702)).toBe('AAA');
      expect(service.columnIndexToLetter(703)).toBe('AAB');
    });
  });
});
