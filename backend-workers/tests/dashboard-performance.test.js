// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import worker from "../worker.js";

function createStatement(db, sql, rows, options = {}) {
  const { onAll, onFirst } = options;
  return {
    run: vi.fn(async () => ({ success: true })),
    all: vi.fn(async () => {
      db.executed.push({ sql, args: [] });
      return (await onAll?.([])) || { results: rows };
    }),
    first: vi.fn(async () => {
      db.executed.push({ sql, args: [] });
      return (await onFirst?.()) || null;
    }),
    bind: (...args) => ({
      ...createStatement(db, sql, rows, options),
      all: vi.fn(async () => {
        db.executed.push({ sql, args });
        return (await onAll?.(args)) || { results: rows };
      }),
      first: vi.fn(async () => {
        db.executed.push({ sql, args });
        return (await onFirst?.(args)) || null;
      }),
    }),
  };
}

function createDb({ tableNames = [], rows = [], onAll, onFirst } = {}) {
  const db = { executed: [], prepare: null };
  db.prepare = vi.fn((sql) => {
    if (sql === "SELECT name FROM sqlite_master WHERE type = 'table'") {
      return createStatement(
        db,
        sql,
        tableNames.map((name) => ({ name })),
      );
    }
    return createStatement(db, sql, rows, { onAll, onFirst });
  });
  return db;
}

function createEnv(options = {}) {
  const storedTabs = options.storedTabs || null;
  const adtools = {
    get: vi.fn(async (key) => (key === "analytics-dashboard-config" ? storedTabs : null)),
    put: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  };
  return {
    ANALYTICS_DASHBOARD_PASSWORD: "testpassword123",
    DB: createDb(options),
    adtools,
  };
}

async function getToken(env) {
  const response = await worker.fetch(
    new Request("http://localhost/dashboard/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "testpassword123" }),
    }),
    env,
  );
  return (await response.json()).token;
}

async function query(env, token, body) {
  return worker.fetch(
    new Request("http://localhost/dashboard/query", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
    env,
  );
}

describe("dashboard query performance boundaries", () => {
  it("keeps paginated built-in tabs usable when KV contains older tab SQL", async () => {
    const env = createEnv({
      storedTabs: [
        { id: "daily", name: "Recent Activity", query: "SELECT 'old activity query'" },
        { id: "events", name: "Events", query: "SELECT 'old events query'" },
      ],
    });
    const token = await getToken(env);

    for (const tabId of ["daily", "events"]) {
      const response = await query(env, token, { tabId, page: 1, search: "old-config" });
      const body = await response.json();
      expect(body.ok, `${tabId}: ${body.error || "query failed"}`).toBe(true);
    }
  });

  it("shows recent client tool uses alongside legacy logs without historical projections", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      CREATE TABLE device (device_id TEXT PRIMARY KEY, platform TEXT, app_version TEXT);
      CREATE TABLE usage_log (user_email TEXT, device_id TEXT, tool_id TEXT, action TEXT, created_time TEXT);
      CREATE TABLE tool_usage (
        event_id TEXT UNIQUE, user_email TEXT, device_id TEXT, tool_id TEXT,
        action TEXT, properties TEXT, source TEXT, created_time TEXT
      );
      INSERT INTO device VALUES ('fixture-device', 'Desktop (Tauri)', '1.3.7');
      INSERT INTO usage_log VALUES
        ('fixture@example.com', 'fixture-device', 'quick-query', 'open', datetime('now', '+7 hours', '-1 minute')),
        ('fixture@example.com', 'fixture-device', 'quick-query', 'merge', datetime('now', '+7 hours', '-2 days'));
      INSERT INTO tool_usage VALUES
        ('client-1', 'fixture@example.com', 'fixture-device', 'kafka', 'publish', '{}', 'client', datetime('now', '+7 hours')),
        ('historical-1', 'fixture@example.com', 'fixture-device', 'quick-query', 'merge', '{}', 'historical_usage_log', datetime('now', '+7 hours', '-2 days'));
    `);
    const env = createEnv();
    env.DB = {
      prepare(sql) {
        return {
          bind(...args) {
            const statement = sqlite.prepare(sql);
            return { all: async () => ({ results: statement.all(...args) }) };
          },
          all: async () => ({ results: sqlite.prepare(sql).all() }),
          run: async () => sqlite.prepare(sql).run(),
        };
      },
    };

    try {
      const token = await getToken(env);
      const today = await (await query(env, token, { tabId: "daily", range: "today", search: "fixture" })).json();
      const month = await (await query(env, token, { tabId: "daily", range: "30d", search: "fixture" })).json();

      expect(today.ok).toBe(true);
      expect(today.data.map((row) => row.action)).toEqual(["publish", "open"]);
      expect(month.data.map((row) => row.action)).toEqual(["publish", "open", "merge"]);
      expect(month.data[0]).toMatchObject({ user: "fixture", platform: "Desktop (Tauri)", app_version: "1.3.7", tool_id: "kafka" });
    } finally {
      sqlite.close();
    }
  });

  it("bounds daily pages, binds search and pagination, and reports hasMore", async () => {
    const rows = Array.from({ length: 205 }, (_, index) => ({ id: index, user: `user-${index}` }));
    const env = createEnv({ tableNames: ["usage_log", "device"], rows });
    const token = await getToken(env);

    const firstResponse = await query(env, token, { tabId: "daily" });
    const first = await firstResponse.json();
    const firstQuery = env.DB.executed.find((entry) => entry.sql.includes("LIMIT ? OFFSET ?"));

    expect(firstResponse.status).toBe(200);
    expect(first.data).toHaveLength(100);
    expect(first.pagination).toEqual({ page: 1, pageSize: 100, hasMore: true });
    expect(firstQuery.sql).toContain("LOWER");
    expect(firstQuery.sql).not.toContain("user-0");
    expect(firstQuery.args).toEqual(["", "%%", "%%", "%%", "%%", "%%", "%%", 101, 0]);

    const boundedResponse = await query(env, token, { tabId: "daily", page: 0, pageSize: 999, search: "  Ada  " });
    const bounded = await boundedResponse.json();
    const boundedQuery = env.DB.executed.filter((entry) => entry.sql.includes("LIMIT ? OFFSET ?")).at(-1);

    expect(boundedResponse.status).toBe(200);
    expect(bounded.data).toHaveLength(200);
    expect(bounded.pagination).toEqual({ page: 1, pageSize: 200, hasMore: true });
    expect(boundedQuery.args).toEqual(["ada", "%ada%", "%ada%", "%ada%", "%ada%", "%ada%", "%ada%", 201, 0]);
  });

  it("shares identical in-flight computations and evicts entries beyond the fixed cache size", async () => {
    const release = {};
    release.promise = new Promise((resolve) => {
      release.resolve = resolve;
    });
    let queryExecutions = 0;
    let queryStarted;
    const queryStartedPromise = new Promise((resolve) => {
      queryStarted = resolve;
    });
    const customTabs = Array.from({ length: 33 }, (_, index) => ({
      id: `performance-tab-${index}`,
      name: `Performance ${index}`,
      query: `SELECT ${index} AS value`,
    }));
    const env = createEnv({
      storedTabs: [{ id: "coalesce-tab", name: "Coalesce", query: "SELECT 1 AS value" }, ...customTabs],
      onAll: async () => {
        if (queryExecutions === 0) {
          queryExecutions += 1;
          queryStarted();
          await release.promise;
        } else {
          queryExecutions += 1;
        }
        return { results: [{ value: 1 }] };
      },
    });
    const token = await getToken(env);

    const first = query(env, token, { tabId: "coalesce-tab" });
    await queryStartedPromise;
    const second = query(env, token, { tabId: "coalesce-tab" });
    release.resolve();
    await Promise.all([first, second]);
    expect(queryExecutions).toBe(1);

    const beforeEviction = queryExecutions;
    for (const tab of customTabs) {
      await query(env, token, { tabId: tab.id });
    }
    await query(env, token, { tabId: customTabs[0].id });

    expect(queryExecutions).toBe(beforeEviction + customTabs.length + 1);
  });

  it("resolves independent overview metrics concurrently after schema discovery", async () => {
    let activeScalars = 0;
    let maximumActiveScalars = 0;
    const env = createEnv({
      tableNames: ["usage_log", "error_events"],
      onFirst: async () => {
        activeScalars += 1;
        maximumActiveScalars = Math.max(maximumActiveScalars, activeScalars);
        await Promise.resolve();
        activeScalars -= 1;
        return { value: "1" };
      },
    });
    const token = await getToken(env);

    const response = await query(env, token, { tabId: "overview" });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data).toHaveLength(8);
    expect(data.data.map((metric) => metric.metric)).toEqual([
      "Active users today",
      "Active users 7d",
      "Tool opens 7d",
      "Successful tool uses 7d",
      "Uncaught errors 24h",
      "Affected users 7d",
      "Most used tool 30d",
      "Noisiest error 7d",
    ]);
    expect(maximumActiveScalars).toBeGreaterThan(1);
  });
});
