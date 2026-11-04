// @vitest-environment node
// Who the users are and what they did: real migrations in SQLite, the real authenticated dashboard handler.
// Ways it could go wrong:
// - registered people with no activity in the period vanish from the People list (undercount);
// - a person with two devices is listed twice, or counts reconstructed (non-client) rows;
// - people without a department disappear instead of showing as Unknown;
// - an excluded device's owner leaks into the list;
// - People rows lose their department or role;
// - a person's recent uses drop the recorded detail (file name, diagram type), or show another person's.
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it } from "vitest";

let call;

beforeAll(async () => {
  const { default: worker } = await import("../../../../backend-workers/worker.js");
  const db = new DatabaseSync(":memory:");
  const migrations = new URL("../../../../backend-workers/migrations/", import.meta.url);
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(await readFile(new URL(file, migrations), "utf8"));
  }
  db.exec(`INSERT INTO users (id,email,created_time,last_seen,department,role) VALUES
    ('ana','ana@example.test',datetime('now','-40 days'),datetime('now'),'RETAIL','ENGINEER'),
    ('sme','sme@example.test',datetime('now','-10 days'),datetime('now'),'SME','ANALYST'),
    ('quiet','quiet@example.test',datetime('now','-5 days'),datetime('now'),'WHOLESALE',NULL),
    ('nodept','nodept@example.test',datetime('now'),datetime('now'),NULL,NULL),
    ('hidden','hidden@example.test',datetime('now'),datetime('now'),'NBDS',NULL);
    INSERT INTO device (device_id,user_id,platform,created_time,last_seen) VALUES
    ('ana-mac','ana','macOS',datetime('now'),datetime('now')),
    ('ana-win','ana','Windows',datetime('now'),datetime('now')),
    ('sme-mac','sme','macOS',datetime('now'),datetime('now')),
    ('quiet-mac','quiet','macOS',datetime('now'),datetime('now')),
    ('nodept-mac','nodept','macOS',datetime('now'),datetime('now')),
    ('excluded-device','hidden','macOS',datetime('now'),datetime('now'));`);
  const insert = db.prepare(`INSERT INTO tool_usage (event_id,user_email,device_id,tool_id,action,properties,source,created_time)
    VALUES (?,?,?,?,?,?,?,datetime('now','+7 hours','start of day',?,'+10 hours'))`);
  const rows = [
    [
      "ana@example.test",
      "ana-mac",
      "plantuml",
      "view",
      '{"file_name":"payment-flow.puml","diagram_type":"sequence"}',
      "client",
      "-1 day",
      3,
    ],
    ["ana@example.test", "ana-win", "plantuml", "export_svg", '{"file_name":"payment-flow.puml"}', "client", "-1 day", 1],
    ["ana@example.test", "ana-mac", "json-tools", "prettify", "{}", "client", "-2 days", 1],
    ["sme@example.test", "sme-mac", "run-query", "run", "{}", "client", "-1 day", 2],
    ["sme@example.test", "sme-mac", "run-query", "run", "{}", "historical_event", "-1 day", 50],
    ["nodept@example.test", "nodept-mac", "base64-tools", "encode", "{}", "client", "-2 days", 1],
    ["hidden@example.test", "excluded-device", "kafka", "publish", "{}", "client", "-1 day", 9],
  ];
  let id = 0;
  for (const [email, device, tool, action, properties, source, offset, count] of rows)
    for (let index = 0; index < count; index++) insert.run(`e${id++}`, email, device, tool, action, properties, source, offset);

  const env = {
    ANALYTICS_DASHBOARD_PASSWORD: "people-fixture-only",
    ANALYTICS_EXCLUDED_DEVICE_IDS: "excluded-device",
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
  const request = (path, body, token) =>
    worker.fetch(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      }),
      env,
    );
  const { token } = await (await request("/dashboard/verify", { password: "people-fixture-only" })).json();
  call = async (body) => (await request("/dashboard/query", body, token)).json();
});

describe("who the users are", () => {
  it("lists every registered person with department, role and their activity in the period", async () => {
    const { analysis } = await call({ tabId: "departments", range: "30d" });
    const people = Object.fromEntries(analysis.people.map((row) => [row.user_email, row]));
    expect(Object.keys(people).sort()).toEqual(["ana@example.test", "nodept@example.test", "quiet@example.test", "sme@example.test"]);
    expect(people["ana@example.test"]).toMatchObject({
      department: "RETAIL",
      role: "ENGINEER",
      uses: 5,
      tools: 2,
      top_tool: "plantuml",
      devices: 2,
    });
    expect(people["sme@example.test"]).toMatchObject({ department: "SME", role: "ANALYST", uses: 2, top_tool: "run-query" });
    expect(people["quiet@example.test"]).toMatchObject({ department: "WHOLESALE", uses: 0, top_tool: null });
    expect(people["nodept@example.test"]).toMatchObject({ department: "Unknown", uses: 1 });
    expect(people["ana@example.test"].registered_at).toBeTruthy();
  });

  it("shows department and role on People", async () => {
    const { data } = await call({ tabId: "who", range: "30d" });
    const ana = data.find((row) => row.section === "Top users" && row.user_email === "ana@example.test");
    expect(ana).toMatchObject({ department: "RETAIL", role: "ENGINEER" });
  });
});

describe("what they did", () => {
  it("returns a person's department, role and the detail recorded with each recent use", async () => {
    const { data } = await call({ tabId: "who", person: "ana@example.test", range: "30d" });
    expect(data.summary).toMatchObject({ department: "RETAIL", role: "ENGINEER" });
    const plantuml = data.recent.filter((row) => row.tool_id === "plantuml");
    expect(plantuml).toHaveLength(4);
    expect(plantuml.every((row) => JSON.parse(row.details).file_name === "payment-flow.puml")).toBe(true);
    expect(data.recent.every((row) => row.user_email === "ana@example.test")).toBe(true);
  });
});
