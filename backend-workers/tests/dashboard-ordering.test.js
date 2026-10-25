// @vitest-environment node
// Failure cases: ISO and space timestamps sort as separate batches; equal timestamps shift between pages;
// pagination sorts only its visible page instead of the full source.
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import worker from "../worker.js";

it("orders mixed timestamp formats chronologically across activity pages", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const migrations = new URL("../migrations/", import.meta.url);
  for (const name of readdirSync(migrations)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    sqlite.exec(readFileSync(new URL(name, migrations), "utf8"));
  }
  const env = {
    ANALYTICS_DASHBOARD_PASSWORD: "ordering-fixture",
    DB: {
      prepare(sql) {
        const statement = sqlite.prepare(sql);
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
    const insert = sqlite.prepare(`INSERT INTO tool_usage
      (event_id, user_email, device_id, tool_id, action, properties, source, created_time)
      VALUES (?, 'reader@example.test', 'fixture-device', 'json-tools', ?, '{}', 'client', ?)`);
    insert.run("older", "older", "2026-10-25T08:00:00+07:00");
    insert.run("newer", "newer", "2026-10-25 16:00:00+07:00");
    insert.run("middle", "middle", "2026-10-25T05:00:00Z");
    insert.run("plain", "plain", "2026-10-25 10:00:00");
    const auth = await worker.fetch(
      new Request("http://localhost/dashboard/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "ordering-fixture" }),
      }),
      env,
    );
    const { token } = await auth.json();
    const actions = [];
    for (let page = 1; page <= 4; page++) {
      const result = await worker.fetch(
        new Request("http://localhost/dashboard/query", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ tabId: "daily", range: "all", page, pageSize: 1 }),
        }),
        env,
      );
      const body = await result.json();
      expect(body.ok, body.error).toBe(true);
      actions.push(body.data[0].action);
    }
    expect(actions).toEqual(["newer", "middle", "plain", "older"]);
  } finally {
    sqlite.close();
  }
});
