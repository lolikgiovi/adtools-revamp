// @vitest-environment node
// End to end: real UsageTracker payloads -> real Worker handlers -> SQLite with every migration -> dashboard/overview reads.
// Failure cases this file pins down:
// 1. The client keeps POSTing absolute device_usage counters when nothing new happened, and the Worker keeps rewriting them.
// 2. A retried chunk (lost response) stores events, error events, or usage logs twice.
// 3. When the batch transaction fails and rows are inserted one by one, a row that failed is still acknowledged and lost.
// 4. A server that predates per-row acknowledgements leaves acknowledged rows queued forever.
// 5. events/usage_log keep whatever timestamp string the client sent (Z, offsets, offset-free), so string ranges drift.
// 6. The backfill rewrites rows that already carry an offset, aborts on usage_log twins, or leaves legacy tables behind.
// 7. Dashboard ranges and person days run datetime() on "+07:00" values and drop 00:00-07:00 Jakarta activity.
// 8. The overview's seven-day pulse starts at the current time of day, so the oldest day is partial.
// 9. Tool Usage / Tool Adoption tabs keep reading frozen device_usage counters and miss new successful uses.
// Reproduce: ./node_modules/.bin/vitest run backend-workers/tests/analytics-ingestion-integrity.test.js
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsSender } from "../../frontend/core/AnalyticsSender.js";
import { UsageTracker } from "../../frontend/core/UsageTracker.js";
import { handleAnalyticsBatchPost, handleAnalyticsLogPost, handleAnalyticsOverviewGet } from "../src/routes/analytics.js";
import worker from "../worker.js";

const MIGRATIONS = new URL("../migrations/", import.meta.url);
const MIGRATION_NAMES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const SESSION = { email: "reader@example.test", deviceId: "device-1" };
const PASSWORD = "integrity-fixture";

function applyMigrations(sqlite, predicate) {
  for (const name of MIGRATION_NAMES.filter(predicate)) sqlite.exec(readFileSync(new URL(name, MIGRATIONS), "utf8"));
}

/** events reference a registered device, as every production row does. */
function registerDevice(sqlite, deviceId, email = SESSION.email) {
  sqlite.exec(`INSERT OR IGNORE INTO users (id, email, created_time, last_seen)
    VALUES ('user-${deviceId}', '${email}', '2026-01-01 00:00:00', '2026-01-01 00:00:00');
    INSERT OR IGNORE INTO device (device_id, user_id, created_time, last_seen)
    VALUES ('${deviceId}', 'user-${deviceId}', '2026-01-01 00:00:00', '2026-01-01 00:00:00');`);
}

/** D1-shaped wrapper. `faults.batch` makes the transaction fail; `faults.run(sql, args)` fails single statements. */
function d1(sqlite, faults = {}) {
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      const bound = (args) => ({
        all: async () => ({ results: statement.all(...args) }),
        first: async () => statement.get(...args) || null,
        run: async () => {
          if (faults.run?.(sql, args)) throw new Error("injected statement failure");
          return { success: true, meta: { changes: statement.run(...args).changes } };
        },
      });
      return { ...bound([]), bind: (...args) => bound(args) };
    },
    batch: async (statements) => {
      if (faults.batch) throw new Error("injected batch failure");
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (err) {
        sqlite.exec("ROLLBACK");
        throw err;
      }
    },
  };
}

function createEnv(sqlite, faults) {
  const kv = new Map();
  return {
    DB: d1(sqlite, faults),
    ANALYTICS_DASHBOARD_PASSWORD: PASSWORD,
    SEND_LIVE_USER_LOG: "true",
    adtools: {
      get: async (key) => kv.get(key) ?? null,
      put: async (key, value) => void kv.set(key, value),
      delete: async (key) => void kv.delete(key),
    },
  };
}

async function postBatch(env, payload) {
  const response = await handleAnalyticsBatchPost(
    new Request("http://localhost/analytics/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
    env,
    SESSION,
  );
  return response.json();
}

async function dashboard(env, body) {
  const auth = await worker.fetch(
    new Request("http://localhost/dashboard/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    }),
    env,
  );
  const { token } = await auth.json();
  const response = await worker.fetch(
    new Request("http://localhost/dashboard/query", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
    env,
  );
  const json = await response.json();
  expect(json.ok, json.error).toBe(true);
  return json.data;
}

const count = (sqlite, table) => sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const jakarta = (sqlite, expression) => sqlite.prepare(`SELECT ${expression} AS value`).get().value;

describe("analytics ingestion integrity", () => {
  let sqlite;
  let env;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    applyMigrations(sqlite, () => true);
    registerDevice(sqlite, SESSION.deviceId);
    env = createEnv(sqlite);
    localStorage.clear();
    localStorage.setItem("user.email", SESSION.email);
    localStorage.setItem("adtools.deviceId", SESSION.deviceId);
    UsageTracker._enabled = true;
    UsageTracker._backupEnabled = false;
    UsageTracker._state = { ...UsageTracker._createEmptyState(), deviceId: SESSION.deviceId };
    UsageTracker._state.counts = { "json-tools": { open: 9, prettify: 4 } };
    AnalyticsSender.sendBatch = vi.fn((payload) => postBatch(env, payload));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sqlite.close();
  });

  function queueOneOfEach() {
    UsageTracker._trackEventImmediate("json-tools", "page_view", { source: "sidebar" });
    UsageTracker._queueUsageLog("json-tools", "open");
    UsageTracker.queueErrorEvent({
      error_kind: "captured_error",
      error_name: "Error",
      message: "boom",
      created_time: new Date().toISOString(),
    });
    UsageTracker.trackToolUse("json-tools", "prettify");
  }

  it("never sends device_usage and stays silent when only counters exist", async () => {
    await UsageTracker._flushBatch();
    expect(AnalyticsSender.sendBatch).not.toHaveBeenCalled();

    queueOneOfEach();
    await UsageTracker._flushBatch();
    expect(AnalyticsSender.sendBatch).toHaveBeenCalledTimes(1);
    expect(AnalyticsSender.sendBatch.mock.calls[0][0].device_usage).toBeUndefined();
    expect(count(sqlite, "device_usage")).toBe(0);
  });

  it("accepts device_usage from older clients without writing it", async () => {
    const result = await postBatch(env, {
      device_usage: [{ tool_id: "json-tools", action: "open", count: 7, updated_time: "2026-11-04 10:00:00" }],
    });
    expect(result.ok).toBe(true);
    expect(count(sqlite, "device_usage")).toBe(0);
  });

  it("stores every row type once when the same chunk is retried", async () => {
    queueOneOfEach();
    const payload = UsageTracker._toBatchPayload(UsageTracker._state);
    for (const key of ["events", "usage_log", "error_events", "tool_usage"]) {
      expect(payload[key]).toHaveLength(1);
      expect(payload[key][0].event_id, key).toEqual(expect.any(String));
    }

    const first = await postBatch(env, payload);
    const retry = await postBatch(env, payload);

    for (const table of ["events", "usage_log", "error_events", "tool_usage"]) expect(count(sqlite, table), table).toBe(1);
    for (const key of ["events", "usage_log", "error_events", "tool_usage"]) {
      expect(first.acknowledged[key]).toEqual([payload[key][0].event_id]);
      expect(retry.acknowledged[key]).toEqual([payload[key][0].event_id]);
    }
  });

  it("keeps rows the Worker could not store when the batch falls back to single inserts", async () => {
    env = createEnv(sqlite, {
      batch: true,
      run: (sql, args) => sql.includes("INSERT") && sql.includes("events (") && args.includes("poison"),
    });
    queueOneOfEach();
    UsageTracker._trackEventImmediate("json-tools", "poison", {});

    await UsageTracker._flushBatch();

    expect(UsageTracker._state.events.map((event) => event.action)).toEqual(["poison"]);
    expect(UsageTracker._state.usageLogs).toEqual([]);
    expect(UsageTracker._state.errorEvents).toEqual([]);
    expect(UsageTracker._state.toolUses).toEqual([]);
    expect(count(sqlite, "events")).toBe(1);

    env = createEnv(sqlite);
    await UsageTracker._flushBatch();
    expect(UsageTracker._state.events).toEqual([]);
    expect(count(sqlite, "events")).toBe(2);
  });

  it("clears a sent chunk when an older Worker answers without per-row acknowledgements", async () => {
    UsageTracker._trackEventImmediate("json-tools", "page_view", {});
    UsageTracker._queueUsageLog("json-tools", "open");
    AnalyticsSender.sendBatch = vi.fn().mockResolvedValue({ ok: true });

    await UsageTracker._flushBatch();

    expect(UsageTracker._state.events).toEqual([]);
    expect(UsageTracker._state.usageLogs).toEqual([]);
  });

  it("stores events and usage logs as Jakarta wall time with an explicit offset", async () => {
    await postBatch(env, {
      events: [
        { event_id: "naive", feature_id: "json-tools", action: "naive", created_time: "2026-10-29 10:00:00" },
        { event_id: "utc", feature_id: "json-tools", action: "utc", created_time: "2026-10-29T03:00:00Z" },
        { event_id: "offset", feature_id: "json-tools", action: "offset", created_time: "2026-10-29T11:00:00+08:00" },
      ],
      usage_log: [{ event_id: "log", tool_id: "json-tools", action: "open", created_time: "2026-10-29 10:00:00.123" }],
    });
    const live = await handleAnalyticsLogPost(
      new Request("http://localhost/analytics/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool_id: "json-tools", action: "mount", created_time: "2026-10-29T03:00:00.456Z" }),
      }),
      env,
      SESSION,
    );
    expect(live.status).toBe(200);

    expect(
      sqlite
        .prepare("SELECT action, created_time FROM events ORDER BY action")
        .all()
        .map((row) => ({ ...row })),
    ).toEqual([
      { action: "naive", created_time: "2026-10-29 10:00:00+07:00" },
      { action: "offset", created_time: "2026-10-29 10:00:00+07:00" },
      { action: "utc", created_time: "2026-10-29 10:00:00+07:00" },
    ]);
    expect(
      sqlite
        .prepare("SELECT action, created_time FROM usage_log ORDER BY action")
        .all()
        .map((row) => ({ ...row })),
    ).toEqual([
      { action: "mount", created_time: "2026-10-29 10:00:00.456+07:00" },
      { action: "open", created_time: "2026-10-29 10:00:00.123+07:00" },
    ]);
  });

  it("backfills offset-free history once, folds usage_log twins, and drops legacy tables", () => {
    const legacy = new DatabaseSync(":memory:");
    try {
      const backfill = MIGRATION_NAMES.find((name) => name.startsWith("0032_"));
      expect(backfill, "0032 migration").toBeTruthy();
      applyMigrations(legacy, (name) => name < backfill);
      registerDevice(legacy, "d", "a@x.test");
      legacy.exec(`
        INSERT INTO events (device_id, feature_id, action, properties, created_time) VALUES
          ('d', 'json-tools', 'naive', '{}', '2026-10-29 10:00:00'),
          ('d', 'json-tools', 'explicit', '{}', '2026-10-29 10:00:00+07:00');
        INSERT INTO usage_log (user_email, device_id, tool_id, action, created_time) VALUES
          ('a@x.test', 'd', 'json-tools', 'open', '2026-10-29 10:00:00.100'),
          ('a@x.test', 'd', 'json-tools', 'open', '2026-10-29 10:00:00.200'),
          ('a@x.test', 'd', 'json-tools', 'open', '2026-10-29 10:00:00.200+07:00');
        INSERT INTO tool_usage (event_id, user_email, device_id, tool_id, action, source, created_time) VALUES
          ('h', 'a@x.test', 'd', 'json-tools', 'prettify', 'historical_event', '2026-10-29 10:00:00'),
          ('c', 'a@x.test', 'd', 'json-tools', 'prettify', 'client', '2026-10-29 10:00:00+07:00');
        INSERT INTO error_events (device_id, error_kind, error_name, message, created_time)
          VALUES ('d', 'captured_error', 'Error', 'x', '2026-10-29 10:00:00+07:00');`);

      applyMigrations(legacy, (name) => name >= backfill);

      const times = (table) =>
        legacy
          .prepare(`SELECT created_time FROM ${table} ORDER BY created_time`)
          .all()
          .map((row) => row.created_time);
      expect(times("events")).toEqual(["2026-10-29 10:00:00+07:00", "2026-10-29 10:00:00+07:00"]);
      expect(times("usage_log")).toEqual(["2026-10-29 10:00:00.100+07:00", "2026-10-29 10:00:00.200+07:00"]);
      expect(times("tool_usage")).toEqual(["2026-10-29 10:00:00+07:00", "2026-10-29 10:00:00+07:00"]);
      const tables = legacy
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name);
      expect(tables).not.toContain("daily_usage");
      expect(tables).not.toContain("user_usage");
      const columns = (table) =>
        legacy
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((column) => column.name);
      expect(columns("events")).toContain("event_id");
      expect(columns("error_events")).toContain("event_id");
    } finally {
      legacy.close();
    }
  });

  it("counts 00:00-07:00 Jakarta activity in today's dashboard range and on the same day", async () => {
    // Halfway between Jakarta midnight and now (capped at 06:00): always in the past, always in the early-morning gap.
    const early = jakarta(
      sqlite,
      `strftime('%Y-%m-%d %H:%M:%S', MIN(
        julianday('now', '+7 hours', 'start of day', '+6 hours'),
        (julianday('now', '+7 hours') + julianday('now', '+7 hours', 'start of day')) / 2
      )) || '+07:00'`,
    );
    const today = jakarta(sqlite, "date('now', '+7 hours')");
    sqlite
      .prepare(
        `INSERT INTO tool_usage (event_id, user_email, device_id, tool_id, action, source, created_time)
         VALUES ('early', ?, 'device-1', 'json-tools', 'prettify', 'client', ?)`,
      )
      .run(SESSION.email, early);

    const person = await dashboard(env, { tabId: "who", range: "today", person: SESSION.email });
    expect(person.summary.events).toBe(1);
    expect(person.days.map((row) => row.day)).toEqual([today]);
  });

  it("starts the overview's seven-day pulse at the oldest day's midnight", async () => {
    const oldest = jakarta(sqlite, "date('now', '+7 hours', '-6 days')");
    sqlite
      .prepare(
        `INSERT INTO tool_usage (event_id, user_email, device_id, tool_id, action, source, created_time)
         VALUES ('oldest', ?, 'device-1', 'json-tools', 'prettify', 'client', ?)`,
      )
      .run(SESSION.email, `${oldest} 00:00:01+07:00`);

    const response = await handleAnalyticsOverviewGet(new Request("http://localhost/analytics/overview"), env, SESSION);
    const overview = await response.json();
    expect(overview.user.daily).toEqual([{ day: oldest, count: 1 }]);
  });

  it("reports new successful uses in the Tool Usage and Tool Adoption tabs", async () => {
    UsageTracker.trackToolUse("json-tools", "prettify");
    UsageTracker._queueUsageLog("json-tools", "open");
    await UsageTracker._flushBatch();

    const tools = await dashboard(env, { tabId: "tools", range: "all" });
    expect(tools).toContainEqual(expect.objectContaining({ tool_id: "json-tools", action: "TOTAL", total_count: 1 }));
    const adoption = await dashboard(env, { tabId: "tool-adoption", range: "all" });
    expect(adoption).toContainEqual(
      expect.objectContaining({ tool_id: "json-tools", successful_uses: 1, opens: 1, users: 1, devices: 1, top_action: "prettify" }),
    );
    expect(count(sqlite, "device_usage")).toBe(0);
  });
});
