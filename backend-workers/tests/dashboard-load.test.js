// @vitest-environment node
// Failure cases: Trends fans out into a dozen full-table scans and D1 rejects the burst as overloaded;
// device scoping materializes whole usage tables once per reference; Devices scans every usage row
// to find one latest timestamp per device; ranged reports read rows far outside the range;
// PlantUML has no detailed reports, so its tool detail offers nothing to open.
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import worker from "../worker.js";

const USAGE_TABLES = ["tool_usage", "usage_log"];

function migratedDatabase() {
  const db = new DatabaseSync(":memory:");
  const dir = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(new URL(file, dir), "utf8"));
  }
  return db;
}

function recordingEnv(db, statements) {
  return {
    ANALYTICS_DASHBOARD_PASSWORD: "load-fixture",
    ANALYTICS_EXCLUDED_DEVICE_IDS: "excluded",
    DB: {
      prepare(sql) {
        const statement = db.prepare(sql);
        const bound = (args) => ({
          all: async () => {
            if (/^\s*(SELECT|WITH)\b/i.test(sql)) {
              const plan = db
                .prepare(`EXPLAIN QUERY PLAN ${sql}`)
                .all(...args)
                .map((row) => row.detail);
              statements.push({ sql, plan });
            }
            return { results: statement.all(...args) };
          },
          first: async () => statement.get(...args) || null,
          run: async () => statement.run(...args),
        });
        return { ...bound([]), bind: (...args) => bound(args) };
      },
    },
    adtools: { get: async () => null, put: async () => {}, delete: async () => {} },
    UPDATES: { get: async () => ({ json: async () => ({ version: "1.3.12" }) }) },
  };
}

async function signIn(env) {
  const response = await worker.fetch(
    new Request("http://localhost/dashboard/verify", {
      method: "POST",
      body: JSON.stringify({ password: env.ANALYTICS_DASHBOARD_PASSWORD }),
    }),
    env,
  );
  return (await response.json()).token;
}

async function queryTab(env, token, tabId, range = "30d") {
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
  return body;
}

function usageReads(statements) {
  return statements.filter(({ sql }) =>
    USAGE_TABLES.some((table) => new RegExp(`\\b(?:FROM|JOIN)\\s+(?:main\\.)?${table}\\b`, "i").test(sql)),
  );
}

// A usage table is read through an index, never as a full row-by-row table scan or a materialized copy.
function unindexedUsageSteps(statements) {
  return statements.flatMap(({ plan }) =>
    plan.filter((detail) => USAGE_TABLES.some((table) => new RegExp(`\\b${table}\\b`).test(detail)) && !/\bINDEX\b/.test(detail)),
  );
}

function seed(db) {
  const rows = [];
  for (let day = 0; day < 75; day++) {
    for (const [email, device] of [
      ["a@example.test", "a1"],
      ["b@example.test", "b1"],
      ["c@example.test", "excluded"],
    ]) {
      rows.push(
        `('${email}-${day}','${email}','${device}','json-tools','prettify','{}','client',MIN(datetime('now','+7 hours','start of day','-${day} days','+9 hours'),datetime('now','+7 hours')))`,
      );
    }
  }
  db.exec(`INSERT INTO users (id,email,department,created_time,last_seen) VALUES
    ('a','a@example.test','RETAIL','2026-01-01','2026-01-01'),
    ('b','b@example.test',NULL,'2026-01-01','2026-01-01'),
    ('c','c@example.test','RETAIL','2026-01-01','2026-01-01');
    INSERT INTO device (device_id,user_id,platform,created_time,last_seen,app_version) VALUES
    ('a1','a','macOS','2026-01-01',datetime('now','+7 hours'),'1.3.12'),
    ('b1','b','Windows','2026-01-01',datetime('now','+7 hours','-40 days'),'1.3.9'),
    ('excluded','c','macOS','2026-01-01',datetime('now','+7 hours'),'1.3.12');
    INSERT INTO tool_usage (event_id,user_email,device_id,tool_id,action,properties,source,created_time) VALUES ${rows.join(",")},
    ('puml-view','a@example.test','a1','plantuml','view','{"diagram_type":"sequence","file_name":"payment.puml","line_count":10,"input_size":420,"duration_ms":80}','client',
      datetime('now','+7 hours','start of day','-1 day','+10 hours')),
    ('puml-edit','a@example.test','a1','plantuml','edit','{"diagram_type":"sequence","file_name":"payment.puml","line_count":21,"input_size":440,"duration_ms":90}','client',
      datetime('now','+7 hours','start of day','-1 day','+11 hours')),
    ('puml-svg','b@example.test','b1','plantuml','export_svg','{"diagram_type":"class","line_count":12}','client',
      datetime('now','+7 hours','start of day','-2 days','+10 hours')),
    ('puml-import','b@example.test','b1','plantuml','import','{"file_count":3}','client',
      datetime('now','+7 hours','start of day','-2 days','+9 hours')),
    ('puml-excluded','c@example.test','excluded','plantuml','view','{"diagram_type":"class"}','client',
      datetime('now','+7 hours','start of day','-1 day'));
    INSERT INTO usage_log (user_email,device_id,tool_id,action,created_time) VALUES
    ('a@example.test','a1','json-tools','open',datetime('now','+7 hours','start of day','-1 day')),
    ('b@example.test','b1','json-tools','open',datetime('now','+7 hours','start of day','-50 days'));
    INSERT INTO events (device_id,feature_id,action,properties,created_time) VALUES
    ('b1','plantuml','failed','{"action":"render","category":"invalid_input","diagram_type":"class"}',
      datetime('now','+7 hours','start of day','-2 days','+12 hours'));`);
}

it("loads Trends and Devices through indexed reads instead of full usage-table scans", async () => {
  const db = migratedDatabase();
  const statements = [];
  const env = recordingEnv(db, statements);
  try {
    seed(db);
    const token = await signIn(env);

    statements.length = 0;
    const trends = await queryTab(env, token, "trends", "30d");
    expect(trends.data).toHaveLength(30);
    expect(trends.analysis.periods.current.people).toBe(2);
    expect(trends.analysis.periods.current.devices).toBe(2);
    expect(trends.analysis.periods.previous.people).toBe(2);
    expect(trends.analysis.departments.find((row) => row.department === "RETAIL")).toMatchObject({ active_people: 1 });
    expect(trends.analysis.departments.find((row) => row.department === "Unknown")).toMatchObject({ active_people: 1 });
    expect(trends.analysis.features.some((row) => row.tool_id === "plantuml")).toBe(true);
    expect(usageReads(statements).length).toBeLessThanOrEqual(5);
    expect(unindexedUsageSteps(statements)).toEqual([]);

    statements.length = 0;
    const devices = await queryTab(env, token, "device-health");
    expect(devices.data.map((row) => row.device_id).sort()).toEqual(["a1", "b1"]);
    expect(devices.data.find((row) => row.device_id === "a1")).toMatchObject({ activity_status: "Active", days_since_seen: 0 });
    expect(unindexedUsageSteps(statements)).toEqual([]);
  } finally {
    db.close();
  }
});

it("offers PlantUML detailed reports built from recorded diagram uses", async () => {
  const db = migratedDatabase();
  const env = recordingEnv(db, []);
  try {
    seed(db);
    const token = await signIn(env);
    const tabs = await (
      await worker.fetch(new Request("http://localhost/dashboard/tabs", { headers: { Authorization: `Bearer ${token}` } }), env)
    ).json();
    const ids = (tabs.tabs || tabs.data || []).map((tab) => tab.id);
    expect(ids).toEqual(expect.arrayContaining(["plantuml", "plantuml-summary"]));

    const recent = (await queryTab(env, token, "plantuml")).data;
    expect(recent.map((row) => row.action).sort()).toEqual(["edit", "export_svg", "import", "view"]);
    expect(recent.find((row) => row.action === "import")).toMatchObject({ files: 3 });
    expect(recent.find((row) => row.action === "edit")).toMatchObject({ file_name: "payment.puml", lines: 21 });

    const summary = (await queryTab(env, token, "plantuml-summary")).data;
    expect(summary.find((row) => row.diagram_type === "sequence")).toMatchObject({
      uses: 2,
      people: 1,
      views: 1,
      edits: 1,
      avg_lines_per_use: 15.5,
      measured_uses: 2,
      max_lines: 21,
    });
    expect(summary.find((row) => row.diagram_type === "class")).toMatchObject({
      uses: 1,
      people: 1,
      exports: 1,
      render_failures: 1,
      avg_lines_per_use: 12,
      measured_uses: 1,
      max_lines: 12,
    });
    expect(summary.find((row) => row.diagram_type === "-")).toMatchObject({ avg_lines_per_use: null, measured_uses: 0, max_lines: null });
  } finally {
    db.close();
  }
});
