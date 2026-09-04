// @vitest-environment node

import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { handleAnalyticsBatchPost, handlePublicAnalyticsOverviewPost } from "../src/routes/analytics.js";

function createD1Database() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE device_usage (
      device_id TEXT NOT NULL,
      user_email TEXT,
      tool_id TEXT NOT NULL,
      action TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      updated_time TEXT NOT NULL,
      PRIMARY KEY (device_id, tool_id, action)
    );
    CREATE TABLE usage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT NOT NULL,
      device_id TEXT NOT NULL,
      tool_id TEXT NOT NULL,
      action TEXT NOT NULL,
      created_time TEXT NOT NULL
    );
    CREATE UNIQUE INDEX usage_log_event_identity
      ON usage_log(user_email, device_id, tool_id, action, created_time);
  `);

  const execute = (sql, args = []) => database.prepare(sql).run(...args);
  const queryAll = (sql, args = []) => database.prepare(sql).all(...args);
  const queryFirst = (sql, args = []) => database.prepare(sql).get(...args) || null;

  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            run: async () => ({ success: true, ...execute(sql, args) }),
            all: async () => ({ results: queryAll(sql, args) }),
            first: async () => queryFirst(sql, args),
          };
        },
        run: async () => ({ success: true, ...execute(sql) }),
        all: async () => ({ results: queryAll(sql) }),
        first: async () => queryFirst(sql),
      };
    },
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
    close() {
      database.close();
    },
  };
}

function createEnvironment() {
  return {
    DB: createD1Database(),
    adtools: {
      get: async () => "0",
      put: async () => {},
    },
  };
}

async function readOverview(env) {
  const response = await handlePublicAnalyticsOverviewPost(
    new Request("http://localhost/analytics/public-overview", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "127.0.0.1" },
      body: JSON.stringify({ email: "User@example.com" }),
    }),
    env,
  );
  expect(response.status).toBe(200);
  return response.json();
}

describe("analytics overview count integrity", () => {
  let env;

  afterEach(() => env?.DB.close());

  it("does not add a repeated absolute batch snapshot to overview totals", async () => {
    env = createEnvironment();
    const payload = {
      device_id: "device-1",
      user_email: "user@example.com",
      events: [],
      error_events: [],
      usage_log: [
        {
          tool_id: "json-tools",
          action: "prettify",
          created_time: "2026-09-04 10:00:00",
        },
      ],
      device_usage: [
        {
          tool_id: "json-tools",
          action: "prettify",
          count: 2,
          updated_time: "2026-09-04 10:00:00",
        },
      ],
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await handleAnalyticsBatchPost(
        new Request("http://localhost/analytics/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
        env,
        { email: "user@example.com", deviceId: "device-1" },
      );
      expect(response.status).toBe(200);
    }

    const data = await readOverview(env);
    expect(data.user).toMatchObject({ totalActivities: 2, toolsUsed: 1 });
    expect(data.user.tools).toEqual([{ toolId: "json-tools", count: 2 }]);
    expect(data.global).toMatchObject({ totalActivities: 2, toolsUsed: 1, activeUsers: 1 });
    expect(data.user.daily).toEqual([{ day: "2026-09-04", count: 1 }]);
    expect(data.global.daily).toEqual([{ day: "2026-09-04", count: 1 }]);
    const storedLogs = await env.DB.prepare("SELECT COUNT(*) AS count FROM usage_log").first();
    expect(storedLogs.count).toBe(1);
  });

  it("deduplicates historical exact usage-log rows in the daily pulse", async () => {
    env = createEnvironment();
    await env.DB.prepare("DROP INDEX usage_log_event_identity").run();
    const insert = env.DB.prepare(
      "INSERT INTO usage_log (user_email, device_id, tool_id, action, created_time) VALUES (?, ?, ?, ?, ?)",
    );
    const values = ["user@example.com", "device-1", "json-tools", "prettify", "2026-09-04 10:00:00"];
    await insert.bind(...values).run();
    await insert.bind(...values).run();

    const data = await readOverview(env);

    expect(data.user.daily).toEqual([{ day: "2026-09-04", count: 1 }]);
    expect(data.global.daily).toEqual([{ day: "2026-09-04", count: 1 }]);
  });

  it("prefers the canonical absolute snapshot when a legacy alias exists", async () => {
    env = createEnvironment();
    await env.DB.prepare(
      "INSERT INTO device_usage (device_id, user_email, tool_id, action, count, updated_time) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind("device-1", "user@example.com", "master_lockey", "mount", 2, "2026-09-04 10:00:00")
      .run();

    const response = await handleAnalyticsBatchPost(
      new Request("http://localhost/analytics/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_id: "device-1",
          user_email: "user@example.com",
          events: [],
          error_events: [],
          usage_log: [],
          device_usage: [
            {
              tool_id: "master-lockey",
              action: "mount",
              count: 2,
              updated_time: "2026-09-04 11:00:00",
            },
          ],
        }),
      }),
      env,
      { email: "user@example.com", deviceId: "device-1" },
    );

    expect(response.status).toBe(200);
    const data = await readOverview(env);

    expect(data.user.totalActivities).toBe(2);
    expect(data.user.toolsUsed).toBe(1);
    expect(data.user.tools).toEqual([{ toolId: "master-lockey", count: 2 }]);
    expect(data.global.totalActivities).toBe(2);
    expect(data.global.toolsUsed).toBe(1);
    expect(data.global.tools).toEqual([{ toolId: "master-lockey", count: 2 }]);
  });

  it("ignores obsolete velocity-template rows in ingestion and overview totals", async () => {
    env = createEnvironment();
    const insertLog = env.DB.prepare(
      "INSERT INTO usage_log (user_email, device_id, tool_id, action, created_time) VALUES (?, ?, ?, ?, ?)",
    );
    await insertLog.bind("user@example.com", "device-1", "velocity-template", "open", "2026-09-04 10:00:00").run();
    await env.DB.prepare(
      "INSERT INTO device_usage (device_id, user_email, tool_id, action, count, updated_time) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind("device-1", "user@example.com", "velocity-template", "open", 9, "2026-09-04 10:00:00")
      .run();

    const response = await handleAnalyticsBatchPost(
      new Request("http://localhost/analytics/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_id: "device-1",
          user_email: "user@example.com",
          events: [{ type: "velocity-template", action: "open" }],
          error_events: [{ tool_id: "velocity-template", error_kind: "captured_error", message: "ignored" }],
          usage_log: [{ tool_id: "velocity-template", action: "open", created_time: "2026-09-04 11:00:00" }],
          device_usage: [{ tool_id: "velocity-template", action: "open", count: 12 }],
        }),
      }),
      env,
      { email: "user@example.com", deviceId: "device-1" },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      inserted: { events: 0, error_events: 0, usage_log: 0, device_usage: 0 },
    });

    const data = await readOverview(env);
    expect(data.user).toMatchObject({ totalActivities: 0, toolsUsed: 0 });
    expect(data.user.tools).toEqual([]);
    expect(data.user.daily).toEqual([]);
    expect(data.global).toMatchObject({ totalActivities: 0, toolsUsed: 0, activeUsers: 0 });
    expect(data.global.tools).toEqual([]);
    expect(data.global.daily).toEqual([]);
  });
});
