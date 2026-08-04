/**
 * Unit tests for utility functions
 */

import { describe, it, expect } from 'vitest';
import { corsHeaders, isOriginAllowed, methodNotAllowed } from '../src/utils/cors.js';
import { tsGmt7Plain, dayGmt7, parseTsFlexible, tsToGmt7Plain } from '../src/utils/timestamps.js';
import { allowedEmailDomains, isEmailDomainAllowed } from '../src/utils/email.js';

describe('CORS utilities', () => {
  describe('corsHeaders', () => {
    it('returns expected CORS headers', () => {
      const headers = corsHeaders();
      expect(headers['Access-Control-Allow-Origin']).toBe('*');
      expect(headers['Access-Control-Allow-Methods']).toContain('POST');
      expect(headers['Access-Control-Allow-Methods']).toContain('GET');
    });
  });

  describe('isOriginAllowed', () => {
    it('returns true when no origin header', () => {
      const request = { headers: { get: () => null } };
      const env = { ALLOWED_ORIGINS: 'http://localhost:5173' };
      expect(isOriginAllowed(request, env)).toBe(true);
    });

    it('returns true when origin is in allowed list', () => {
      const request = { headers: { get: (h) => h === 'Origin' ? 'http://localhost:5173' : null } };
      const env = { ALLOWED_ORIGINS: 'http://localhost:5173,tauri://localhost' };
      expect(isOriginAllowed(request, env)).toBe(true);
    });

    it('returns false when origin is not in allowed list', () => {
      const request = { headers: { get: (h) => h === 'Origin' ? 'http://evil.com' : null } };
      const env = { ALLOWED_ORIGINS: 'http://localhost:5173' };
      expect(isOriginAllowed(request, env)).toBe(false);
    });

    it('returns true when no restrictions configured', () => {
      const request = { headers: { get: (h) => h === 'Origin' ? 'http://any.com' : null } };
      const env = { ALLOWED_ORIGINS: '' };
      expect(isOriginAllowed(request, env)).toBe(true);
    });
  });

  describe('methodNotAllowed', () => {
    it('returns 405 response', async () => {
      const response = methodNotAllowed();
      expect(response.status).toBe(405);
      const body = await response.json();
      expect(body.ok).toBe(false);
      expect(body.error).toContain('Method Not Allowed');
    });
  });
});

describe('Timestamp utilities', () => {
  describe('tsGmt7Plain', () => {
    it('returns timestamp in expected format', () => {
      const ts = tsGmt7Plain();
      expect(ts).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\+07:00$/);
    });
  });

  describe('dayGmt7', () => {
    it('returns date in YYYY-MM-DD format', () => {
      const day = dayGmt7();
      expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('parseTsFlexible', () => {
    it('parses numeric timestamps', () => {
      const now = Date.now();
      expect(parseTsFlexible(now)).toBe(now);
    });

    it('parses numeric strings', () => {
      expect(parseTsFlexible('1609459200000')).toBe(1609459200000);
    });

    it('parses ISO date strings', () => {
      const result = parseTsFlexible('2021-01-01T00:00:00Z');
      expect(result).toBe(Date.parse('2021-01-01T00:00:00Z'));
    });

    it('returns 0 for invalid input', () => {
      expect(parseTsFlexible('invalid')).toBe(0);
    });
  });

  describe('tsToGmt7Plain', () => {
    it('converts ISO string to GMT+7 plain format', () => {
      const result = tsToGmt7Plain('2026-01-01T00:00:00Z');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\+07:00$/);
    });

    it('returns null for invalid input', () => {
      expect(tsToGmt7Plain('invalid')).toBeNull();
    });
  });
});

describe('Email utilities', () => {
  describe('allowedEmailDomains', () => {
    it('parses comma-separated domains', () => {
      const env = { ALLOWED_EMAIL_DOMAINS: 'example.com, test.com' };
      const domains = allowedEmailDomains(env);
      expect(domains).toContain('example.com');
      expect(domains).toContain('test.com');
    });

    it('returns empty array when not configured', () => {
      const env = { ALLOWED_EMAIL_DOMAINS: '' };
      expect(allowedEmailDomains(env)).toEqual([]);
    });
  });

  describe('isEmailDomainAllowed', () => {
    it('returns true when no restrictions', () => {
      const env = { ALLOWED_EMAIL_DOMAINS: '' };
      expect(isEmailDomainAllowed('user@any.com', env)).toBe(true);
    });

    it('returns true for allowed domain', () => {
      const env = { ALLOWED_EMAIL_DOMAINS: 'example.com' };
      expect(isEmailDomainAllowed('user@example.com', env)).toBe(true);
    });

    it('returns false for disallowed domain', () => {
      const env = { ALLOWED_EMAIL_DOMAINS: 'example.com' };
      expect(isEmailDomainAllowed('user@other.com', env)).toBe(false);
    });

    it('handles case insensitivity', () => {
      const env = { ALLOWED_EMAIL_DOMAINS: 'EXAMPLE.COM' };
      expect(isEmailDomainAllowed('USER@example.com', env)).toBe(true);
    });
  });
});
