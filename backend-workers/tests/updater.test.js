/**
 * Tests for updater utilities
 */

import { describe, it, expect } from 'vitest';
import { parseRange } from '../src/routes/updater.js';

describe('Updater utilities', () => {
  describe('parseRange', () => {
    it('returns null for no header', () => {
      expect(parseRange(null, 1000)).toBeNull();
    });

    it('returns null for invalid format', () => {
      expect(parseRange('invalid', 1000)).toBeNull();
    });

    it('parses bytes=0-499 correctly', () => {
      const range = parseRange('bytes=0-499', 1000);
      expect(range).toEqual({ start: 0, end: 499 });
    });

    it('handles missing end (bytes=500-)', () => {
      const range = parseRange('bytes=500-', 1000);
      expect(range).toEqual({ start: 500, end: 999 });
    });

    it('handles suffix (bytes=-500)', () => {
      const range = parseRange('bytes=-500', 1000);
      expect(range).toEqual({ start: 500, end: 999 });
    });

    it('caps end to size-1', () => {
      const range = parseRange('bytes=0-9999', 1000);
      expect(range?.end).toBe(999);
    });

    it('returns null for invalid range (start > end)', () => {
      expect(parseRange('bytes=500-100', 1000)).toBeNull();
    });
  });
});
