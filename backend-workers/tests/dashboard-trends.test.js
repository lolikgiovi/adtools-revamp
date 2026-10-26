// @vitest-environment node
// Failure cases: missing zero-use days; UTC events assigned to the wrong Jakarta day;
// first day lacks its prior-day baseline; opens counted as successes; excluded identities leak;
// grouped devices hide owners; stale version heartbeats hide recent usage; missing release metadata implies current.
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import worker from "../worker.js";

it("serves daily comparisons and individual device health through the authenticated API", async () => {
  const db = new DatabaseSync(":memory:");
  const dir = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(new URL(file, dir), "utf8"));
  }
  const env = {
    ANALYTICS_DASHBOARD_PASSWORD: "trends-fixture",
    ANALYTICS_EXCLUDED_DEVICE_IDS: "owner-device",
    DB: {
      prepare(sql) {
        const statement = db.prepare(sql);
        const bound = (args) => ({
          all: async () => ({ results: statement.all(...args) }),
          first: async () => statement.get(...args) || null,
          run: async () => statement.run(...args),
        });
        return { ...bound([]), bind: (...args) => bound(args) };
      },
    },
    adtools: { get: async () => null, put: async () => {}, delete: async () => {} },
    UPDATES: { get: async () => ({ json: async () => ({ version: "1.3.12" }) }) },
  };
  try {
    db.exec(`INSERT INTO users (id, email, created_time, last_seen) VALUES ('person', 'person@example.test', datetime('now'), datetime('now'));
      INSERT INTO users (id, email, created_time, last_seen) VALUES ('owner', 'fashalli.bilhaq@bankmandiri.co.id', datetime('now'), datetime('now'));
      INSERT INTO device (device_id, user_id, platform, created_time, last_seen, app_version) VALUES
        ('old-active', 'person', 'macOS', datetime('now','-100 days'), datetime('now','-80 days'), '1.3.9'),
        ('current-inactive', 'person', 'Windows', datetime('now','-100 days'), datetime('now','-45 days'), '1.3.12'),
        ('unknown', 'person', 'Unknown', datetime('now'), 'invalid', NULL),
        ('owner-device', 'owner', 'macOS', datetime('now'), datetime('now'), '1.3.12');
      INSERT INTO tool_usage (event_id, user_email, device_id, tool_id, action, source, created_time) VALUES
        ('a', 'person@example.test', 'old-active', 'json-tools', 'prettify', 'client', datetime('now','+7 hours','start of day','-1 day','+12 hours')),
        ('b', 'person@example.test', 'old-active', 'json-tools', 'prettify', 'client', datetime('now','+7 hours','start of day','-1 day','+13 hours')),
        ('c', 'person@example.test', 'old-active', 'json-tools', 'prettify', 'client', datetime('now','+7 hours','start of day','-7 days','+12 hours')),
        ('utc-boundary', 'person@example.test', 'old-active', 'json-tools', 'prettify', 'client', strftime('%Y-%m-%dT18:00:00Z','now','+7 hours','start of day','-2 days')),
        ('owner', 'fashalli.bilhaq@bankmandiri.co.id', 'owner-device', 'json-tools', 'prettify', 'client', datetime('now','+7 hours'));
      INSERT INTO usage_log (user_email, device_id, tool_id, action, created_time)
        VALUES ('person@example.test', 'old-active', 'json-tools', 'open', datetime('now','+7 hours'));`);
    const auth = await worker.fetch(
      new Request("http://localhost/dashboard/verify", {
        method: "POST",
        body: JSON.stringify({ password: "trends-fixture" }),
      }),
      env,
    );
    const { token } = await auth.json();
    const query = async (tabId, range = "7d") => {
      const response = await worker.fetch(
        new Request("http://localhost/dashboard/query", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify({ tabId, range }),
        }),
        env,
      );
      const body = await response.json();
      expect(body.error).toBeUndefined();
      expect(body.ok).toBe(true);
      return body.data;
    };
    const days = await query("trends");
    expect(days).toHaveLength(7);
    expect(days.at(-1).successful_uses).toBe(0);
    expect(days.at(-2)).toMatchObject({ successful_uses: 3, active_people: 1 });
    expect(days[0].previous_uses).toBe(1);
    expect(days.filter((day) => day.successful_uses === 0)).toHaveLength(6);
    const devices = await query("device-health");
    expect(devices).toHaveLength(3);
    expect(devices.find((row) => row.device_id === "old-active")).toMatchObject({
      user_email: "person@example.test",
      version_status: "Older version",
      activity_status: "Active",
      days_since_seen: 0,
    });
    expect(devices.find((row) => row.device_id === "current-inactive")).toMatchObject({
      version_status: "Up to date",
      activity_status: "Inactive 30+ days",
    });
    expect(devices.find((row) => row.device_id === "unknown")).toMatchObject({
      version_status: "Unknown",
      activity_status: "Unknown",
      days_since_seen: null,
    });
    env.UPDATES = undefined;
    // A separate binding avoids the query cache when release metadata becomes unavailable.
    env.ANALYTICS_EXCLUDED_DEVICE_IDS = "owner-device,another-exclusion";
    env.adtools = { get: async () => null, put: async () => {}, delete: async () => {} };
    const unavailable = await query("device-health");
    expect(unavailable.every((row) => row.version_status === "Unknown")).toBe(true);
  } finally {
    db.close();
  }
});
