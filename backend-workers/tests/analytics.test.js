// @vitest-environment node

/**
 * Unit/integration tests for analytics routing and ingestion.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../worker.js";

function createDbMock() {
  const executed = [];
  const run = async (sql, args = []) => {
    executed.push({ sql, args });
    return { success: true };
  };
  const all = async () => ({ results: [] });
  const db = {
    executed,
    prepare: vi.fn((sql) => ({
      run: vi.fn(() => run(sql)),
      all: vi.fn(async () => {
        executed.push({ sql, args: [] });
        return all();
      }),
      first: vi.fn(async () => {
        executed.push({ sql, args: [] });
        return null;
      }),
      bind: (...args) => ({
        sql,
        args,
        run: vi.fn(() => run(sql, args)),
        first: vi.fn(async () => {
          executed.push({ sql, args });
          return null;
        }),
        all: vi.fn(async () => {
          executed.push({ sql, args });
          return all();
        }),
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
    SEND_LIVE_USER_LOG: "true",
    ANALYTICS_DASHBOARD_PASSWORD: "testpassword123",
    DB: createDbMock(),
    adtools: {
      get: vi.fn(async () => null),
    },
    ASSETS: {
      fetch: vi.fn(async () => new Response("Not Found", { status: 404 })),
    },
  };
}

function mockDashboardTables(env, tableNames) {
  const originalPrepare = env.DB.prepare;
  env.DB.prepare = vi.fn((sql) => {
    if (sql === "SELECT name FROM sqlite_master WHERE type = 'table'") {
      return {
        run: vi.fn(async () => ({ success: true })),
        first: vi.fn(async () => null),
        all: vi.fn(async () => ({
          results: tableNames.map((name) => ({ name })),
        })),
        bind: (...args) => ({
          sql,
          args,
          run: vi.fn(async () => ({ success: true })),
          first: vi.fn(async () => null),
          all: vi.fn(async () => ({
            results: tableNames.map((name) => ({ name })),
          })),
        }),
      };
    }
    return originalPrepare(sql);
  });
}

describe("Analytics endpoints", () => {
  let env;

  beforeEach(() => {
    env = createEnv();
  });

  it("rejects GET analytics ingestion", async () => {
    const batch = await worker.fetch(
      new Request("http://localhost/analytics/batch?device_id=d1&tool_id=json-tools&action=open&count=1"),
      env,
    );
    const log = await worker.fetch(
      new Request("http://localhost/analytics/log?user_email=user@example.com&device_id=d1&tool_id=json-tools&action=open"),
      env,
    );

    expect(batch.status).toBe(405);
    expect(log.status).toBe(405);
  });

  it("accepts POST /analytics/batch", async () => {
    const response = await worker.fetch(
      new Request("http://localhost/analytics/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_id: "analytics-test-device",
          user_email: "analytics-test@bankmandiri.co.id",
          device_usage: [
            {
              device_id: "analytics-test-device",
              user_email: "analytics-test@bankmandiri.co.id",
              tool_id: "json_tools",
              action: "open",
              count: 2,
              updated_time: "2026-01-01 10:00:00+07:00",
            },
          ],
          events: [],
        }),
      }),
      env,
    );

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.inserted.device_usage).toBe(1);
    expect(env.DB.batch).toHaveBeenCalledTimes(1);
  });

  it("accepts POST /analytics/log", async () => {
    const response = await worker.fetch(
      new Request("http://localhost/analytics/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_email: "analytics-test@bankmandiri.co.id",
          device_id: "analytics-test-device",
          tool_id: "json_tools",
          action: "open",
          created_time: "2026-01-01 10:00:00+07:00",
        }),
      }),
      env,
    );

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.inserted).toBe(1);
  });

  it("accepts POST /analytics/error and sanitizes metadata", async () => {
    const response = await worker.fetch(
      new Request("http://localhost/analytics/error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_email: "analytics-test@bankmandiri.co.id",
          device_id: "analytics-test-device",
          runtime: "web",
          app_version: "1.2.3",
          route: "#json-tools",
          tool_id: "json_tools",
          process_area: "tool",
          error_kind: "uncaught_error",
          error_name: "Error",
          message: "Unexpected failure with code 123456",
          stack: "Error: boom\nat fn (app.js:1:1)",
          source: "https://app.example/app.js?token=secret",
          lineno: 1,
          colno: 2,
          metadata: { sql: "select secret", context: "render" },
          created_time: "2026-01-01T03:00:00.000Z",
        }),
      }),
      env,
    );

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.inserted).toBe(1);

    const insert = env.DB.executed.find((item) => item.sql.includes("INSERT INTO error_events"));
    const createTable = env.DB.executed.find((item) => item.sql.includes("CREATE TABLE IF NOT EXISTS error_events"));
    expect(createTable).toBeTruthy();
    expect(insert.args).toContain("json-tools");
    expect(insert.args).toContain("Unexpected failure with code [redacted-code]");
    const metadata = JSON.parse(insert.args[15]);
    expect(metadata.context).toBe("render");
    expect(metadata.sql).toBeUndefined();
  });

  it("protects dashboard access to the errors tab", async () => {
    const response = await worker.fetch(
      new Request("http://localhost/dashboard/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tabId: "errors" }),
      }),
      env,
    );

    expect(response.status).toBe(401);
  });

  it("exposes owner insight dashboard tabs after auth", async () => {
    const login = await worker.fetch(
      new Request("http://localhost/dashboard/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "testpassword123" }),
      }),
      env,
    );
    const { token } = await login.json();

    const response = await worker.fetch(
      new Request("http://localhost/dashboard/tabs", {
        headers: { Authorization: `Bearer ${token}` },
      }),
      env,
    );

    const data = await response.json();
    const ids = data.tabs.map((tab) => tab.id);
    expect(response.status).toBe(200);
    expect(ids.slice(0, 4)).toEqual(["overview", "who", "active-users", "tools"]);
    expect(ids).toContain("who");
    expect(ids).toContain("friction");
    expect(ids).toContain("versions");
    expect(ids).toContain("error-summary");
    expect(ids).toContain("errors");
    expect(ids).toContain("qq-table-usage");
    expect(ids).toContain("compare-config");
    expect(ids).toContain("cc-table-pairs");
    expect(ids).toContain("run-query-summary");
    expect(ids).toContain("run-batch-summary");
    expect(ids).toContain("json-tools-summary");
    expect(ids).toContain("base64-summary");
    expect(ids).toContain("qr-summary");
    expect(ids).toContain("tlv-summary");
    expect(ids).toContain("image-checker-summary");
    expect(ids).toContain("template-editors-summary");
    expect(ids).toContain("uuid-sql-summary");
    expect(ids).toContain("merge-sql-summary");
    expect(ids).toContain("master-lockey-summary");
  });

  it("uses Quick Query analytics fallbacks and table usage rollup queries", async () => {
    const login = await worker.fetch(
      new Request("http://localhost/dashboard/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "testpassword123" }),
      }),
      env,
    );
    const { token } = await login.json();

    const recentResponse = await worker.fetch(
      new Request("http://localhost/dashboard/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tabId: "quick-query" }),
      }),
      env,
    );
    const rollupResponse = await worker.fetch(
      new Request("http://localhost/dashboard/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tabId: "qq-table-usage" }),
      }),
      env,
    );

    const recentSql = env.DB.executed.find((item) => item.sql.includes("$.has_attachments") && item.sql.includes("$.hasAttachments"));
    const rollupSql = env.DB.executed.find((item) => item.sql.includes("WITH qq AS") && item.sql.includes("attachment_generations"));
    expect(recentResponse.status).toBe(200);
    expect(rollupResponse.status).toBe(200);
    expect(recentSql).toBeTruthy();
    expect(rollupSql).toBeTruthy();
  });

  it("uses Compare Config source and table pair dashboard queries", async () => {
    const login = await worker.fetch(
      new Request("http://localhost/dashboard/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "testpassword123" }),
      }),
      env,
    );
    const { token } = await login.json();

    const recentResponse = await worker.fetch(
      new Request("http://localhost/dashboard/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tabId: "compare-config" }),
      }),
      env,
    );
    const rollupResponse = await worker.fetch(
      new Request("http://localhost/dashboard/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tabId: "cc-table-pairs" }),
      }),
      env,
    );

    const recentSql = env.DB.executed.find((item) => item.sql.includes("$.source_a_env") && item.sql.includes("$.source_b_table"));
    const rollupSql = env.DB.executed.find((item) => item.sql.includes("WITH cc AS") && item.sql.includes("GROUP BY env_a"));
    expect(recentResponse.status).toBe(200);
    expect(rollupResponse.status).toBe(200);
    expect(recentSql).toBeTruthy();
    expect(rollupSql).toBeTruthy();
  });

  it("exposes dashboard rollups for the other feature analytics", async () => {
    const login = await worker.fetch(
      new Request("http://localhost/dashboard/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "testpassword123" }),
      }),
      env,
    );
    const { token } = await login.json();

    const tabIds = [
      "run-query-summary",
      "run-batch-summary",
      "json-tools-summary",
      "base64-summary",
      "tlv-summary",
      "merge-sql-summary",
      "master-lockey-summary",
    ];

    for (const tabId of tabIds) {
      const response = await worker.fetch(
        new Request("http://localhost/dashboard/query", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ tabId }),
        }),
        env,
      );
      expect(response.status).toBe(200);
    }

    expect(env.DB.executed.find((item) => item.sql.includes("WITH rq AS") && item.sql.includes("oversize_runs"))).toBeTruthy();
    expect(env.DB.executed.find((item) => item.sql.includes("WITH rb AS") && item.sql.includes("configs_with_confluence"))).toBeTruthy();
    expect(env.DB.executed.find((item) => item.sql.includes("WITH jt AS") && item.sql.includes("avg_output_size"))).toBeTruthy();
    expect(env.DB.executed.find((item) => item.sql.includes("WITH b64 AS") && item.sql.includes("output_kind"))).toBeTruthy();
    expect(env.DB.executed.find((item) => item.sql.includes("WITH tlv AS") && item.sql.includes("valid_crc"))).toBeTruthy();
    expect(env.DB.executed.find((item) => item.sql.includes("WITH ms AS") && item.sql.includes("dangerous_statements"))).toBeTruthy();
    expect(env.DB.executed.find((item) => item.sql.includes("WITH ml AS") && item.sql.includes("max_lockeys"))).toBeTruthy();
  });

  it("returns a safe overview even when analytics tables are missing", async () => {
    const login = await worker.fetch(
      new Request("http://localhost/dashboard/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "testpassword123" }),
      }),
      env,
    );
    const { token } = await login.json();

    const response = await worker.fetch(
      new Request("http://localhost/dashboard/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tabId: "overview" }),
      }),
      env,
    );

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.mode).toBe("computed-overview");
    expect(data.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metric: "Active users today", value: "0" }),
        expect.objectContaining({ metric: "Uncaught errors 24h", value: "0" }),
      ]),
    );
  });

  it("returns safe computed Who insights with a time range", async () => {
    mockDashboardTables(env, ["usage_log", "events", "device", "users", "error_events"]);

    const login = await worker.fetch(
      new Request("http://localhost/dashboard/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "testpassword123" }),
      }),
      env,
    );
    const { token } = await login.json();

    const response = await worker.fetch(
      new Request("http://localhost/dashboard/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tabId: "who", range: "7d" }),
      }),
      env,
    );

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.mode).toBe("computed-who");
    expect(data.range).toBe("7d");
    expect(Array.isArray(data.data)).toBe(true);
    const whoQuery = env.DB.executed.find((item) => item.sql.includes("WITH activity AS ("));
    expect(whoQuery.sql).toContain("FROM usage_log");
    expect(whoQuery.sql).not.toContain("FROM events e");
    expect(whoQuery.sql).toContain("NOT EXISTS");
    expect(whoQuery.sql).toContain("u2.action != 'open'");
  });

  it("uses normalized usage log for tools and tool adoption instead of aggregated device counts", async () => {
    mockDashboardTables(env, ["usage_log", "device_usage", "error_events"]);

    const login = await worker.fetch(
      new Request("http://localhost/dashboard/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "testpassword123" }),
      }),
      env,
    );
    const { token } = await login.json();

    const toolsResponse = await worker.fetch(
      new Request("http://localhost/dashboard/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tabId: "tools" }),
      }),
      env,
    );
    const toolAdoptionResponse = await worker.fetch(
      new Request("http://localhost/dashboard/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tabId: "tool-adoption" }),
      }),
      env,
    );

    const toolsQuery = env.DB.executed.find(
      (item) => item.sql.includes("WITH normalized_usage AS") && item.sql.includes("SELECT tool_id, action, total_count"),
    );
    const toolAdoptionQuery = env.DB.executed.find(
      (item) => item.sql.includes("WITH normalized_usage AS") && item.sql.includes("top_action_count"),
    );

    expect(toolsResponse.status).toBe(200);
    expect(toolAdoptionResponse.status).toBe(200);
    expect(toolsQuery).toBeTruthy();
    expect(toolAdoptionQuery).toBeTruthy();
    expect(toolsQuery.sql).toContain("NOT EXISTS");
    expect(toolAdoptionQuery.sql).toContain("NOT EXISTS");
    expect(toolsQuery.sql).not.toContain("FROM device_usage");
  });

  it("uses normalized usage log for overview action totals and top tool", async () => {
    mockDashboardTables(env, ["usage_log", "error_events"]);
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);

    try {
      const login = await worker.fetch(
        new Request("http://localhost/dashboard/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: "testpassword123" }),
        }),
        env,
      );
      const { token } = await login.json();

      const response = await worker.fetch(
        new Request("http://localhost/dashboard/query", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ tabId: "overview" }),
        }),
        env,
      );

      const data = await response.json();
      const normalizedOverviewQueries = env.DB.executed.filter((item) => item.sql.includes("WITH normalized_usage AS"));
      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(normalizedOverviewQueries.length).toBeGreaterThanOrEqual(2);
      expect(normalizedOverviewQueries.some((item) => item.sql.includes("NOT EXISTS"))).toBe(true);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("normalizes Active Users query to avoid counting open plus actual usage twice", async () => {
    const login = await worker.fetch(
      new Request("http://localhost/dashboard/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "testpassword123" }),
      }),
      env,
    );
    const { token } = await login.json();

    const response = await worker.fetch(
      new Request("http://localhost/dashboard/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tabId: "active-users" }),
      }),
      env,
    );

    const data = await response.json();
    const activeUsersQuery = env.DB.executed.find((item) => item.sql.includes("WITH recent_usage AS ("));
    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(activeUsersQuery).toBeTruthy();
    expect(activeUsersQuery.sql).toContain("NOT EXISTS");
    expect(activeUsersQuery.sql).toContain("u2.action != 'open'");
  });

  it("self-heals error_events schema before error dashboard queries", async () => {
    const login = await worker.fetch(
      new Request("http://localhost/dashboard/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "testpassword123" }),
      }),
      env,
    );
    const { token } = await login.json();

    const response = await worker.fetch(
      new Request("http://localhost/dashboard/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tabId: "error-summary" }),
      }),
      env,
    );

    const data = await response.json();
    const createTable = env.DB.executed.find((item) => item.sql.includes("CREATE TABLE IF NOT EXISTS error_events"));
    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(createTable).toBeTruthy();
  });

  it("self-heals device app_version schema before version dashboard queries", async () => {
    const login = await worker.fetch(
      new Request("http://localhost/dashboard/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "testpassword123" }),
      }),
      env,
    );
    const { token } = await login.json();

    const response = await worker.fetch(
      new Request("http://localhost/dashboard/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tabId: "versions" }),
      }),
      env,
    );

    const data = await response.json();
    const alter = env.DB.executed.find((item) => item.sql.includes("ALTER TABLE device ADD COLUMN app_version"));
    const versionQuery = env.DB.executed.find((item) => item.sql.includes("WITH devices AS") && item.sql.includes("error_runtimes"));
    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(alter).toBeTruthy();
    expect(versionQuery).toBeTruthy();
    expect(versionQuery.sql).not.toContain("GROUP BY devices.platform, devices.app_version, version_errors.runtime");
  });

  it("merges new default insight tabs with stored dashboard config", async () => {
    env.adtools.get.mockResolvedValueOnce([{ id: "custom-tab", name: "Custom Tab", query: "SELECT 1 AS ok" }]);

    const login = await worker.fetch(
      new Request("http://localhost/dashboard/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "testpassword123" }),
      }),
      env,
    );
    const { token } = await login.json();

    const response = await worker.fetch(
      new Request("http://localhost/dashboard/tabs", {
        headers: { Authorization: `Bearer ${token}` },
      }),
      env,
    );

    const data = await response.json();
    const ids = data.tabs.map((tab) => tab.id);
    expect(data.source).toBe("kv+defaults");
    expect(ids[0]).toBe("overview");
    expect(ids).toContain("custom-tab");
  });
});
