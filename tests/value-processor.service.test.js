import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ValueProcessorService } from '../app/tools/quick-query/services/ValueProcessorService.js';
import { UsageTracker } from '../app/core/UsageTracker.js';

// Mock UsageTracker
vi.mock('../app/core/UsageTracker.js', () => ({
  UsageTracker: {
    trackEvent: vi.fn(),
  },
}));

describe('ValueProcessorService', () => {
  let service;

  beforeEach(() => {
    service = new ValueProcessorService();
    vi.clearAllMocks();
  });

  describe('validateNumberPrecision', () => {
    it('should pass for valid numbers within precision and scale', () => {
      service.validateNumberPrecision(123.45, 5, 2, 'test_field');
      service.validateNumberPrecision(123, 5, 2, 'test_field');
      service.validateNumberPrecision(0.12, 5, 2, 'test_field');
      service.validateNumberPrecision(0, 5, 2, 'test_field');
      service.validateNumberPrecision(-123.45, 5, 2, 'test_field');
    });

    it('should throw error when total digits exceed precision', () => {
      expect(() => service.validateNumberPrecision(1234.56, 5, 2, 'test_field')).toThrow(/exceeds maximum precision/);
      expect(UsageTracker.trackEvent).toHaveBeenCalledWith('quick-query', 'value_error', expect.objectContaining({ type: 'precision_exceeded' }));
    });

    it('should throw error when decimal digits exceed scale', () => {
      expect(() => service.validateNumberPrecision(123.456, 6, 2, 'test_field')).toThrow(/exceeds maximum scale/);
      expect(UsageTracker.trackEvent).toHaveBeenCalledWith('quick-query', 'value_error', expect.objectContaining({ type: 'scale_exceeded' }));
    });

    it('should throw error when integer digits exceed precision - scale', () => {
      expect(() => service.validateNumberPrecision(1234.5, 5, 2, 'test_field')).toThrow(/Integer part .* exceeds maximum allowed digits/);
      expect(UsageTracker.trackEvent).toHaveBeenCalledWith('quick-query', 'value_error', expect.objectContaining({ type: 'integer_digits_exceeded' }));
    });
  });

  describe('processValue - NUMBER', () => {
    it('should parse numbers with thousands separators (10,000,000)', () => {
      const result = service.processValue('10,000,000', 'NUMBER', 'Yes', 'amount', 'test_table');
      expect(result).toBe('10000000');
    });

    it('should parse numbers with thousands separators and decimals (10,000.50)', () => {
      const result = service.processValue('10,000.50', 'NUMBER', 'Yes', 'amount', 'test_table');
      expect(result).toBe('10000.50');
    });

    it('should parse simple decimal with comma (10,5)', () => {
      const result = service.processValue('10,5', 'NUMBER', 'Yes', 'amount', 'test_table');
      expect(result).toBe('10.5');
    });
    
    it('should parse simple decimal with dot (10.5)', () => {
      const result = service.processValue('10.5', 'NUMBER', 'Yes', 'amount', 'test_table');
      expect(result).toBe('10.5');
    });
  });

  describe('formatTimestamp', () => {
    it('should return NULL for empty values', () => {
      expect(service.formatTimestamp(null)).toBe('NULL');
      expect(service.formatTimestamp('')).toBe('NULL');
    });

    it('should return SYSDATE and CURRENT_TIMESTAMP as is', () => {
      expect(service.formatTimestamp('SYSDATE')).toBe('SYSDATE');
      expect(service.formatTimestamp('CURRENT_TIMESTAMP')).toBe('CURRENT_TIMESTAMP');
      expect(service.formatTimestamp('sysdate')).toBe('SYSDATE');
    });

    it('should format ISO 8601 strings correctly', () => {
      const isoString = '2023-10-27T10:00:00Z';
      const result = service.formatTimestamp(isoString);
      // Expect local time conversion (user is in +07:00)
      // We use regex to be flexible about the exact offset but ensure the format is correct
      expect(result).toMatch(/TO_TIMESTAMP_TZ\('2023-10-27 \d{2}:00:00[+-]\d{2}:00', 'YYYY-MM-DD HH24:MI:SSTZH:TZM'\)/);
    });

    it('should format ISO 8601 strings with fractional seconds', () => {
      const isoString = '2023-10-27T10:00:00.123Z';
      const result = service.formatTimestamp(isoString);
      expect(result).toMatch(/TO_TIMESTAMP_TZ\('2023-10-27 \d{2}:00:00\.123[+-]\d{2}:00', 'YYYY-MM-DD HH24:MI:SS\.FF3TZH:TZM'\)/);
    });

    it('should format timestamps with comma decimal separator', () => {
      // The code expects DD-MM-YYYY format for the date part when comma is used
      const timestamp = '27-10-2023 10:00:00,123';
      const result = service.formatTimestamp(timestamp);
      expect(result).toContain("TO_TIMESTAMP('2023-10-27 10:00:00.123', 'YYYY-MM-DD HH24:MI:SS.FF3')");
    });

    // 3. Common Formats & Tool Exports
    describe('Common Tool Export Formats', () => {
      const testCases = [
        // Excel formats
        { input: '10/27/2023 10:00:00', expected: "TO_TIMESTAMP('2023-10-27 10:00:00', 'YYYY-MM-DD HH24:MI:SS')" },
        { input: '27/10/2023 10:00:00', expected: "TO_TIMESTAMP('2023-10-27 10:00:00', 'YYYY-MM-DD HH24:MI:SS')" },
        { input: '2023/10/27 10:00:00', expected: "TO_TIMESTAMP('2023-10-27 10:00:00', 'YYYY-MM-DD HH24:MI:SS')" },
        { input: '10-27-2023 10:00:00', expected: "TO_TIMESTAMP('2023-10-27 10:00:00', 'YYYY-MM-DD HH24:MI:SS')" },
        
        // SQLDeveloper / Toad / DBeaver formats
        { input: '27-OCT-23', expected: "TO_TIMESTAMP('2023-10-27 00:00:00', 'YYYY-MM-DD HH24:MI:SS')" },
        { input: '27-OCT-2023', expected: "TO_TIMESTAMP('2023-10-27 00:00:00', 'YYYY-MM-DD HH24:MI:SS')" },
        { input: '27.10.2023 10:00:00', expected: "TO_TIMESTAMP('2023-10-27 10:00:00', 'YYYY-MM-DD HH24:MI:SS')" },
        { input: '27.10.2023', expected: "TO_TIMESTAMP('2023-10-27 00:00:00', 'YYYY-MM-DD HH24:MI:SS')" },
        { input: '2023-10-27 10:00:00.0', expected: "TO_TIMESTAMP('2023-10-27 10:00:00', 'YYYY-MM-DD HH24:MI:SS')" }, // DBeaver sometimes adds .0
        { input: '27-Oct-2023 10:00:00', expected: "TO_TIMESTAMP('2023-10-27 10:00:00', 'YYYY-MM-DD HH24:MI:SS')" },
        
        // AM/PM formats
        { input: '10/27/2023 10:00:00 PM', expected: "TO_TIMESTAMP('2023-10-27 22:00:00', 'YYYY-MM-DD HH24:MI:SS')" },
        { input: '27-10-2023 10:00:00 PM', expected: "TO_TIMESTAMP('2023-10-27 22:00:00', 'YYYY-MM-DD HH24:MI:SS')" },
        { input: '2023-10-27 10:00:00 PM', expected: "TO_TIMESTAMP('2023-10-27 22:00:00', 'YYYY-MM-DD HH24:MI:SS')" },
        
        // Specific Toad Export case: 1/30/1993 12:00:00.000000 AM
        { input: '1/30/1993 12:00:00.000000 AM', expected: "TO_TIMESTAMP('1993-01-30 00:00:00.000000', 'YYYY-MM-DD HH24:MI:SS.FF6')" },
      ];

      testCases.forEach(({ input, expected }) => {
        it(`should format ${input} correctly`, () => {
          expect(service.formatTimestamp(input)).toContain(expected);
        });
      });
    });

    it('should format AM/PM dates with fractional seconds', () => {
      const result = service.formatTimestamp('10/15/2026 12:00:00.000000 AM');
      expect(result).toContain("TO_TIMESTAMP('2026-10-15 00:00:00.000000', 'YYYY-MM-DD HH24:MI:SS.FF6')");
    });

    it('should handle flexible parsing for unknown but valid formats', () => {
      // Moment is quite flexible, let's try something that isn't in the strict list but moment might handle
      // e.g. "2023 Oct 27"
      const result = service.formatTimestamp('2023 Oct 27');
      expect(result).toContain("TO_TIMESTAMP('2023-10-27 00:00:00', 'YYYY-MM-DD HH24:MI:SS')");
    });

    it('should throw error for truly invalid dates', () => {
      expect(() => service.formatTimestamp('not-a-date')).toThrow(/Invalid timestamp format/);
    });
  });
});
