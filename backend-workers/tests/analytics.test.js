// @vitest-environment node

/**
 * Unit/integration tests for analytics routing and ingestion.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker.js';

function createDbMock() {
  const executed = [];
  const db = {
    executed,
    prepare: vi.fn((sql) => ({
      bind: (...args) => ({
        sql,
        args,
        run: vi.fn(async () => {
          executed.push({ sql, args });
          return { success: true };
        }),
        first: vi.fn(async () => null),
        all: vi.fn(async () => ({ results: [] })),
      }),
    })),
    batch: vi.fn(async (statements) => {
      executed.push(...statements);
      return statements.map(() => ({ success: true }));
    }),
  };
  return db;
}

function createEnv() {
  return {
    SEND_LIVE_USER_LOG: 'true',
    ANALYTICS_DASHBOARD_PASSWORD: 'testpassword123',
    DB: createDbMock(),
    ASSETS: {
      fetch: vi.fn(async () => new Response('Not Found', { status: 404 })),
    },
  };
}

describe('Analytics endpoints', () => {
  let env;

  beforeEach(() => {
    env = createEnv();
  });

  it('rejects GET analytics ingestion', async () => {
    const batch = await worker.fetch(
      new Request('http://localhost/analytics/batch?device_id=d1&tool_id=json-tools&action=open&count=1'),
      env
    );
    const log = await worker.fetch(
      new Request('http://localhost/analytics/log?user_email=user@example.com&device_id=d1&tool_id=json-tools&action=open'),
      env
    );

    expect(batch.status).toBe(405);
    expect(log.status).toBe(405);
  });

  it('accepts POST /analytics/batch', async () => {
    const response = await worker.fetch(
      new Request('http://localhost/analytics/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: 'analytics-test-device',
          user_email: 'analytics-test@bankmandiri.co.id',
          device_usage: [
            {
              device_id: 'analytics-test-device',
              user_email: 'analytics-test@bankmandiri.co.id',
              tool_id: 'json_tools',
              action: 'open',
              count: 2,
              updated_time: '2026-01-01 10:00:00+07:00',
            },
          ],
          events: [],
        }),
      }),
      env
    );

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.inserted.device_usage).toBe(1);
    expect(env.DB.batch).toHaveBeenCalledTimes(1);
  });

  it('accepts POST /analytics/log', async () => {
    const response = await worker.fetch(
      new Request('http://localhost/analytics/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_email: 'analytics-test@bankmandiri.co.id',
          device_id: 'analytics-test-device',
          tool_id: 'json_tools',
          action: 'open',
          created_time: '2026-01-01 10:00:00+07:00',
        }),
      }),
      env
    );

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.inserted).toBe(1);
  });

  it('accepts POST /analytics/error and sanitizes metadata', async () => {
    const response = await worker.fetch(
      new Request('http://localhost/analytics/error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_email: 'analytics-test@bankmandiri.co.id',
          device_id: 'analytics-test-device',
          runtime: 'web',
          app_version: '1.2.3',
          route: '#json-tools',
          tool_id: 'json_tools',
          process_area: 'tool',
          error_kind: 'uncaught_error',
          error_name: 'Error',
          message: 'Unexpected failure with code 123456',
          stack: 'Error: boom\nat fn (app.js:1:1)',
          source: 'https://app.example/app.js?token=secret',
          lineno: 1,
          colno: 2,
          metadata: { sql: 'select secret', context: 'render' },
          created_time: '2026-01-01T03:00:00.000Z',
        }),
      }),
      env
    );

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.inserted).toBe(1);

    const insert = env.DB.executed.find((item) => item.sql.includes('INSERT INTO error_events'));
    expect(insert.args).toContain('json-tools');
    expect(insert.args).toContain('Unexpected failure with code [redacted-code]');
    const metadata = JSON.parse(insert.args[15]);
    expect(metadata.context).toBe('render');
    expect(metadata.sql).toBeUndefined();
  });

  it('protects dashboard access to the errors tab', async () => {
    const response = await worker.fetch(
      new Request('http://localhost/dashboard/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabId: 'errors' }),
      }),
      env
    );

    expect(response.status).toBe(401);
  });
});
