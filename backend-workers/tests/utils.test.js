import { describe, it, expect } from 'vitest';
import { isOriginAllowed } from '../src/utils/cors.js';
import { allowedEmailDomains, isEmailDomainAllowed } from '../src/utils/email.js';

describe('CORS utilities', () => {
  describe('isOriginAllowed', () => {
    it('returns true when no origin header', () => {
      const request = { headers: { get: () => null } };
      const env = { ALLOWED_ORIGINS: 'http://localhost:1234' };
      expect(isOriginAllowed(request, env)).toBe(true);
    });

    it('returns true when origin is in allowed list', () => {
      const request = { headers: { get: (h) => h === 'Origin' ? 'http://localhost:1234' : null } };
      const env = { ALLOWED_ORIGINS: 'http://localhost:1234,tauri://localhost' };
      expect(isOriginAllowed(request, env)).toBe(true);
    });

    it('returns false when origin is not in allowed list', () => {
      const request = { headers: { get: (h) => h === 'Origin' ? 'http://evil.com' : null } };
      const env = { ALLOWED_ORIGINS: 'http://localhost:1234' };
      expect(isOriginAllowed(request, env)).toBe(false);
    });

    it('returns true when no restrictions configured', () => {
      const request = { headers: { get: (h) => h === 'Origin' ? 'http://any.com' : null } };
      const env = { ALLOWED_ORIGINS: '' };
      expect(isOriginAllowed(request, env)).toBe(true);
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
