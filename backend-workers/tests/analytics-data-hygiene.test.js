// @vitest-environment node
// End to end: Worker batch handler and migrations against SQLite with every migration applied.
// Failure cases this file pins down:
// 1. Older clients keep sending Monaco "Canceled", ResizeObserver, and Monaco view-model errors, burying real errors.
// 2. Dropping those rows without acknowledging them leaves them queued on the client forever.
// 3. A real error that only resembles noise ("Request canceled") is dropped.
// 4. users.last_seen is only written at sign-in, so active users look dormant.
// 5. last_seen moves backwards, or a batch that carried nothing touches it.
// 6. 0033 leaves window-hidden pauses recorded as page_leave, so visits are overcounted.
// 7. 0033 rewrites real leaves (navigation, pagehide) or other actions.
// 8. 0033 backfills last_seen from the wrong source, mixes timestamp formats, or moves it backwards.
// Reproduce: ./node_modules/.bin/vitest run backend-workers/tests/analytics-data-hygiene.test.js
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleAnalyticsBatchPost } from "../src/routes/analytics.js";

const MIGRATIONS = new URL("../migrations/", import.meta.url);
const NAMES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const HYGIENE = "0033_analytics_data_hygiene.sql";
const SESSION = { email: "reader@example.test", deviceId: "device-1" };

const migrate = (sqlite, predicate) =>
  NAMES.filter(predicate).forEach((name) => sqlite.exec(readFileSync(new URL(name, MIGRATIONS), "utf8")));

function d1(sqlite) {
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      const bound = (args) => ({
        all: async () => ({ results: statement.all(...args) }),
        first: async () => statement.get(...args) || null,
        run: async () => ({ success: true, meta: { changes: statement.run(...args).changes } }),
      });
      return { ...bound([]), bind: (...args) => bound(args) };
    },
    batch: async (statements) => {
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

async function postBatch(sqlite, payload) {
  const response = await handleAnalyticsBatchPost(
    new Request("http://localhost/analytics/batch", { method: "POST", body: JSON.stringify(payload) }),
    { DB: d1(sqlite) },
    SESSION,
  );
  return response.json();
}

function seedUser(sqlite, lastSeen) {
  sqlite.exec(`INSERT INTO users (id, email, created_time, last_seen) VALUES ('u1', '${SESSION.email}', '2026-01-01 00:00:00', '${lastSeen}');
    INSERT INTO device (device_id, user_id, created_time, last_seen) VALUES ('${SESSION.deviceId}', 'u1', '2026-01-01 00:00:00', '2026-01-01 00:00:00');`);
}

const error = (id, error_name, message) => ({
  event_id: id,
  error_kind: "unhandled_rejection",
  error_name,
  message,
  created_time: "2026-11-04T03:00:00Z",
});

describe("analytics data hygiene", () => {
  let sqlite;
  afterEach(() => {
    vi.useRealTimers();
    sqlite.close();
  });

  describe("ingestion", () => {
    beforeEach(() => {
      sqlite = new DatabaseSync(":memory:");
      migrate(sqlite, () => true);
      seedUser(sqlite, "2026-02-01 09:00:00+07:00");
    });

    it("acknowledges benign editor noise without storing it, and keeps real errors", async () => {
      const result = await postBatch(sqlite, {
        error_events: [
          error("e1", "Canceled", "Canceled"),
          error("e2", "Error", "ResizeObserver loop completed with undelivered notifications."),
          error("e3", "TypeError", "undefined is not an object (evaluating 'this.modelLineProjections[e-1].isVisible')"),
          error("e4", "Error", "Request canceled by server"),
        ],
      });
      expect(result.acknowledged.error_events.sort()).toEqual(["e1", "e2", "e3", "e4"]);
      const stored = sqlite.prepare("SELECT message FROM error_events").all();
      expect(stored.map((row) => row.message)).toEqual(["Request canceled by server"]);
    });

    it("moves users.last_seen forward when a batch carries activity, never backwards", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-04T03:00:00Z"));
      await postBatch(sqlite, {});
      expect(sqlite.prepare("SELECT last_seen FROM users").get().last_seen).toBe("2026-02-01 09:00:00+07:00");

      await postBatch(sqlite, {
        tool_usage: [{ event_id: "t1", tool_id: "json-tools", action: "prettify", created_time: "2026-11-04T03:00:00Z" }],
      });
      expect(sqlite.prepare("SELECT last_seen FROM users").get().last_seen).toBe("2026-11-04 10:00:00+07:00");

      sqlite.exec("UPDATE users SET last_seen = '2026-12-01 08:00:00+07:00'");
      await postBatch(sqlite, { events: [{ event_id: "v1", feature_id: "home", action: "page_view", properties: {} }] });
      expect(sqlite.prepare("SELECT last_seen FROM users").get().last_seen).toBe("2026-12-01 08:00:00+07:00");
    });

    // Released clients still send a hidden-window pause as page_leave; the Worker stores it as the pause it is.
    it("stores an older client's hidden-window page_leave as page_hidden", async () => {
      await postBatch(sqlite, {
        events: [
          { event_id: "p1", feature_id: "home", action: "page_leave", properties: { duration_ms: 5, reason: "hidden" } },
          { event_id: "p2", feature_id: "home", action: "page_leave", properties: { duration_ms: 6, reason: "navigation" } },
        ],
      });
      const rows = sqlite.prepare("SELECT action, properties FROM events ORDER BY event_id").all();
      expect(rows.map((row) => row.action)).toEqual(["page_hidden", "page_leave"]);
      expect(JSON.parse(rows[0].properties).reason).toBeUndefined();
      expect(JSON.parse(rows[1].properties).reason).toBe("navigation");
    });
  });

  describe("0033 data patch", () => {
    beforeEach(() => {
      sqlite = new DatabaseSync(":memory:");
      migrate(sqlite, (name) => name < HYGIENE);
    });

    it("relabels hidden pauses as page_hidden and leaves real leaves alone", () => {
      seedUser(sqlite, "2026-01-01 00:00:00");
      const insert = sqlite.prepare(
        "INSERT INTO events (device_id, feature_id, action, properties, created_time) VALUES (?, 'home', ?, ?, ?)",
      );
      insert.run(SESSION.deviceId, "page_leave", JSON.stringify({ duration_ms: 1, reason: "hidden" }), "2026-11-01 10:00:00+07:00");
      insert.run(SESSION.deviceId, "page_leave", JSON.stringify({ duration_ms: 2, reason: "navigation" }), "2026-11-01 10:00:01+07:00");
      insert.run(SESSION.deviceId, "page_leave", JSON.stringify({ duration_ms: 3, reason: "pagehide" }), "2026-11-01 10:00:02+07:00");
      insert.run(SESSION.deviceId, "control_click", JSON.stringify({ reason: "hidden" }), "2026-11-01 10:00:03+07:00");
      migrate(sqlite, (name) => name === HYGIENE);
      const rows = sqlite.prepare("SELECT action, properties FROM events ORDER BY id").all();
      expect(rows.map((row) => row.action)).toEqual(["page_hidden", "page_leave", "page_leave", "control_click"]);
      expect(JSON.parse(rows[0].properties)).toEqual({ duration_ms: 1 });
    });

    it("backfills users.last_seen from the latest activity in Jakarta wall time", () => {
      sqlite.exec(`INSERT INTO users (id, email, created_time, last_seen) VALUES
          ('u1', 'active@example.test', '2026-01-01 00:00:00', '2026-02-01 09:00:00'),
          ('u2', 'dormant@example.test', '2026-01-01 00:00:00', '2026-03-01 09:00:00+07:00'),
          ('u3', 'checkin@example.test', '2026-01-01 00:00:00', '2026-01-02 09:00:00+07:00');
        INSERT INTO device (device_id, user_id, created_time, last_seen) VALUES
          ('d1', 'u1', '2026-01-01 00:00:00', '2026-10-01 08:00:00+07:00'),
          ('d2', 'u2', '2026-01-01 00:00:00', '2026-02-01 08:00:00'),
          ('d3', 'u3', '2026-01-01 00:00:00', '2026-10-20 07:30:00+07:00');
        INSERT INTO tool_usage (event_id, user_email, device_id, tool_id, action, source, created_time) VALUES
          ('t1', 'active@example.test', 'd1', 'json-tools', 'prettify', 'client', '2026-11-04 21:15:00.123+07:00');
        INSERT INTO events (device_id, feature_id, action, properties, created_time) VALUES
          ('d1', 'home', 'page_view', '{}', '2026-11-03 10:00:00'),
          ('d2', 'home', 'page_view', '{}', '2026-01-15 10:00:00');`);
      migrate(sqlite, (name) => name === HYGIENE);
      const seen = Object.fromEntries(
        sqlite
          .prepare("SELECT email, last_seen FROM users")
          .all()
          .map((row) => [row.email, row.last_seen]),
      );
      expect(seen).toEqual({
        "active@example.test": "2026-11-04 21:15:00+07:00",
        "dormant@example.test": "2026-03-01 09:00:00+07:00",
        "checkin@example.test": "2026-10-20 07:30:00+07:00",
      });
    });
  });
});
