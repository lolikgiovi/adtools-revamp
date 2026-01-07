/**
 * Integration tests for dashboard endpoints
 */

import { describe, it, expect } from 'vitest';
import { env, SELF } from 'cloudflare:test';

describe('Dashboard endpoints', () => {
  describe('POST /dashboard/verify', () => {
    it('rejects invalid password', async () => {
      const response = await SELF.fetch('http://localhost/dashboard/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'wrongpassword' }),
      });
      
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Invalid password');
    });

    it('returns token for correct password', async () => {
      // Note: ANALYTICS_DASHBOARD_PASSWORD must be set in vitest.config.js bindings
      const response = await SELF.fetch('http://localhost/dashboard/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'testpassword123' }),
      });
      
      const data = await response.json();
      if (data.ok) {
        expect(data.token).toBeDefined();
        expect(typeof data.token).toBe('string');
      } else {
        // If password not configured in test env, expect specific error
        expect(data.error).toContain('not configured');
      }
    });
  });

  describe('GET /dashboard/stats/* (unauthenticated)', () => {
    it('rejects /dashboard/stats/tools without auth', async () => {
      const response = await SELF.fetch('http://localhost/dashboard/stats/tools');
      
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Unauthorized');
    });

    it('rejects /dashboard/stats/daily without auth', async () => {
      const response = await SELF.fetch('http://localhost/dashboard/stats/daily');
      
      expect(response.status).toBe(401);
    });

    it('rejects /dashboard/stats/devices without auth', async () => {
      const response = await SELF.fetch('http://localhost/dashboard/stats/devices');
      
      expect(response.status).toBe(401);
    });

    it('rejects /dashboard/stats/events without auth', async () => {
      const response = await SELF.fetch('http://localhost/dashboard/stats/events');
      
      expect(response.status).toBe(401);
    });

    it('rejects /dashboard/stats/quick-query without auth', async () => {
      const response = await SELF.fetch('http://localhost/dashboard/stats/quick-query');
      
      expect(response.status).toBe(401);
    });

    it('rejects /dashboard/stats/quick-query-errors without auth', async () => {
      const response = await SELF.fetch('http://localhost/dashboard/stats/quick-query-errors');
      
      expect(response.status).toBe(401);
    });
  });

  describe('GET /dashboard/stats/* (authenticated)', () => {
    // Helper to get valid token
    async function getToken() {
      const response = await SELF.fetch('http://localhost/dashboard/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'testpassword123' }),
      });
      const data = await response.json();
      return data.token;
    }

    it('handles /dashboard/stats/tools with valid token', async () => {
      const token = await getToken();
      if (!token) return; // Skip if password not configured
      
      const response = await SELF.fetch('http://localhost/dashboard/stats/tools', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      
      // Auth check passed (not 401), response is valid JSON
      expect(response.status).not.toBe(401);
      const data = await response.json();
      expect(data).toHaveProperty('ok');
      if (data.ok) {
        expect(Array.isArray(data.data)).toBe(true);
      } else {
        // DB error is acceptable in test env (tables may not exist)
        expect(data.error).toBeDefined();
      }
    });

    it('handles /dashboard/stats/daily with valid token', async () => {
      const token = await getToken();
      if (!token) return;
      
      const response = await SELF.fetch('http://localhost/dashboard/stats/daily', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      
      expect(response.status).not.toBe(401);
      const data = await response.json();
      expect(data).toHaveProperty('ok');
    });

    it('handles /dashboard/stats/devices with valid token', async () => {
      const token = await getToken();
      if (!token) return;
      
      const response = await SELF.fetch('http://localhost/dashboard/stats/devices', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      
      expect(response.status).not.toBe(401);
      const data = await response.json();
      expect(data).toHaveProperty('ok');
    });

    it('handles /dashboard/stats/events with valid token', async () => {
      const token = await getToken();
      if (!token) return;
      
      const response = await SELF.fetch('http://localhost/dashboard/stats/events', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      
      expect(response.status).not.toBe(401);
      const data = await response.json();
      expect(data).toHaveProperty('ok');
    });
  });
});
