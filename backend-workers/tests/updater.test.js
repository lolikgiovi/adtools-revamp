/**
 * Tests for updater utilities
 */

import { describe, it, expect } from 'vitest';
import { parseRange, contentTypeForKey } from '../src/routes/updater.js';

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

  describe('contentTypeForKey', () => {
    it('returns hinted content type from head', () => {
      const head = { httpMetadata: { contentType: 'application/zip' } };
      expect(contentTypeForKey('file.bin', head)).toBe('application/zip');
    });

    it('detects JSON files', () => {
      expect(contentTypeForKey('manifest.json', {})).toBe('application/json');
    });

    it('detects gzip files', () => {
      expect(contentTypeForKey('archive.gz', {})).toBe('application/gzip');
    });

    it('detects tar files', () => {
      expect(contentTypeForKey('archive.tar', {})).toBe('application/x-tar');
    });

    it('detects DMG files', () => {
      expect(contentTypeForKey('app.dmg', {})).toBe('application/x-apple-diskimage');
    });

    it('defaults to octet-stream', () => {
      expect(contentTypeForKey('unknown.xyz', {})).toBe('application/octet-stream');
    });
  });
});
