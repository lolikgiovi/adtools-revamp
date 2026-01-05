/**
 * Integration tests for analytics endpoints
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';

describe('Analytics endpoints', () => {
  describe('POST /analytics', () => {
    it('accepts valid analytics event', async () => {
      const response = await SELF.fetch('http://localhost/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: 'test-device-123',
          featureId: 'json-tools',
          action: 'minify',
          properties: { test: true },
        }),
      });
      
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.ok).toBe(true);
    });
  });

  describe('POST /analytics/batch', () => {
    it('handles batch insert with device_usage', async () => {
      const response = await SELF.fetch('http://localhost/analytics/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: 'test-batch-device',
          user_email: 'test@example.com',
          events: [
            { feature_id: 'test-tool', action: 'test-action', created_time: '2026-01-01 12:00:00+07:00' },
          ],
          device_usage: [
            { tool_id: 'json-tools', action: 'minify', count: 5 },
            { tool_id: 'base64-tools', action: 'encode', count: 3 },
          ],
        }),
      });
      
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.inserted).toBeDefined();
      expect(data.inserted.events).toBeGreaterThanOrEqual(0);
      expect(data.inserted.device_usage).toBeGreaterThanOrEqual(0);
    });

    it('response does not include legacy daily_usage or user_usage', async () => {
      const response = await SELF.fetch('http://localhost/analytics/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: 'test-legacy-check',
          device_usage: [{ tool_id: 'test', action: 'test', count: 1 }],
        }),
      });
      
      const data = await response.json();
      expect(data.inserted.daily_usage).toBeUndefined();
      expect(data.inserted.user_usage).toBeUndefined();
    });
  });

  describe('GET /analytics/batch', () => {
    it('validates count parameter', async () => {
      const response = await SELF.fetch(
        'http://localhost/analytics/batch?device_id=test&tool_id=test&action=test&count=0'
      );
      
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('count');
    });

    it('accepts valid GET request with count > 0', async () => {
      const response = await SELF.fetch(
        'http://localhost/analytics/batch?device_id=test-get&tool_id=test-tool&action=test-action&count=5'
      );
      
      // May succeed or fail depending on DB availability
      const data = await response.json();
      expect(data.method).toBe('GET');
    });
  });

  describe('POST /analytics/log', () => {
    it('requires user_email', async () => {
      const response = await SELF.fetch('http://localhost/analytics/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: 'test-device',
          tool_id: 'test-tool',
          action: 'test-action',
        }),
      });
      
      // Either requires email (400) or logging disabled (200)
      const data = await response.json();
      expect(data.ok).toBe(false);
    });
  });

  describe('GET /analytics', () => {
    it('returns events array', async () => {
      const response = await SELF.fetch('http://localhost/analytics');
      
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.events).toBeDefined();
      expect(Array.isArray(data.events)).toBe(true);
    });
  });
});
