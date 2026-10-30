// @vitest-environment node
// Failure cases: UTC/Jakarta midnight splits, repeated actions inflate people, copies look like
// operations, telemetry gaps look like zero adoption, excluded devices leak, one person with
// two devices becomes two people, unknown departments vanish, partial periods compare unfairly.
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import worker from "../worker.js";

it("explains usage patterns through authenticated, device-scoped report handlers", async () => {
  const db = new DatabaseSync(":memory:");
  const dir = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(new URL(file, dir), "utf8"));
  }
  const env = {
    ANALYTICS_DASHBOARD_PASSWORD: "patterns-fixture",
    ANALYTICS_EXCLUDED_DEVICE_IDS: "excluded",
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
  };
  try {
    db.exec(`INSERT INTO users (id,email,department,created_time,last_seen) VALUES
      ('a','a@example.test','RETAIL','2026-01-01','2026-01-01'),
      ('b','b@example.test',NULL,'2026-01-01','2026-01-01'),
      ('c','c@example.test','RETAIL','2026-01-01','2026-01-01');
      INSERT INTO device (device_id,user_id,created_time,last_seen) VALUES
      ('a1','a','2026-01-01',datetime('now','+7 hours')),
      ('a2','a','2026-01-01',datetime('now','+7 hours')),
      ('b1','b','2026-01-01',datetime('now','+7 hours')),
      ('excluded','c','2026-01-01',datetime('now','+7 hours'));
      INSERT INTO tool_usage (event_id,user_email,device_id,tool_id,action,source,created_time) VALUES
      ('work','a@example.test','a1','json-tools','prettify','client',datetime('now','+7 hours','start of day','-1 day','+12 hours')),
      ('copy','a@example.test','a2','json-tools','copy_output','client',datetime('now','+7 hours','start of day','-1 day','+12 hours')),
      ('night','b@example.test','b1','quick-query','merge','client',strftime('%Y-%m-%dT18:00:00Z','now','+7 hours','start of day','-2 days')),
      ('prior','a@example.test','a1','json-tools','prettify','client',datetime('now','+7 hours','start of day','-8 days','+12 hours')),
      ('today','a@example.test','a1','json-tools','prettify','client',datetime('now','+7 hours','start of day')),
      ('history','a@example.test','a1','json-tools','prettify','historical_event',datetime('now','+7 hours','start of day','-1 day')),
      ('excluded','c@example.test','excluded','json-tools','prettify','client',datetime('now','+7 hours','start of day','-1 day'));
      INSERT INTO usage_log (user_email,device_id,tool_id,action,created_time)
      VALUES ('a@example.test','a1','json-tools','open',datetime('now','+7 hours','start of day','-1 day'));`);
    const auth = await worker.fetch(
      new Request("http://localhost/dashboard/verify", {
        method: "POST",
        body: JSON.stringify({ password: env.ANALYTICS_DASHBOARD_PASSWORD }),
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
      expect(body.ok, body.error).toBe(true);
      return body;
    };
    const { analysis } = await query("trends");
    expect(analysis.periods.current).toMatchObject({ actions: 3, people: 2, devices: 3, operations: 2, output_actions: 1, opens: 1 });
    expect(analysis.periods.previous).toMatchObject({ actions: 1, people: 1 });
    expect(analysis.days).toHaveLength(7);
    expect(analysis.hours.find((row) => row.period === "current" && row.hour === 1)).toMatchObject({ actions: 1, people: 1 });
    expect(analysis.hours.find((row) => row.period === "current" && row.hour === 12)).toMatchObject({ actions: 2, people: 1 });
    expect(analysis.departments.find((row) => row.department === "RETAIL")).toMatchObject({
      registered_people: 1,
      active_people: 1,
      devices: 2,
    });
    expect(analysis.departments.find((row) => row.department === "Unknown")).toMatchObject({ registered_people: 1, active_people: 1 });
    expect(analysis.quality.historical_rows).toBe(1);
    expect(analysis.details.every((row) => row.user_email !== "c@example.test")).toBe(true);
    const devices = (await query("device-health")).data;
    expect(devices.find((row) => row.device_id === "a1")).toMatchObject({ department: "RETAIL" });
    expect(devices.find((row) => row.device_id === "a1")).toHaveProperty("last_checkin");
    expect(devices.find((row) => row.device_id === "a1")).toHaveProperty("last_tool_action");
    const all = (await query("trends", "all")).analysis;
    expect(all.periods.previous).toBeNull();
    expect(all.periods.current.actions).toBe(5);
    expect(db.prepare("SELECT COUNT(*) AS n FROM tool_usage").get().n).toBe(7);
  } finally {
    db.close();
  }
});
