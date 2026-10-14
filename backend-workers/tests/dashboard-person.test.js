// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import worker from "../worker.js";

// Failure cases: same display name merges people; another user's activity leaks;
// date range is ignored; SQL-shaped identities alter the query; anonymous access succeeds.
describe("dashboard person behavior", () => {
  it("returns an authenticated, exact-identity, range-scoped profile", async () => {
    const sqlite = new DatabaseSync(":memory:");
    const migrations = new URL("../migrations/", import.meta.url);
    for (const name of readdirSync(migrations)
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      sqlite.exec(readFileSync(new URL(name, migrations), "utf8"));
    }
    const DB = {
      prepare(sql) {
        const statement = sqlite.prepare(sql);
        const bound = (args) => ({
          all: async () => ({ results: statement.all(...args) }),
          first: async () => statement.get(...args) || null,
          run: async () => statement.run(...args),
        });
        return { ...bound([]), bind: (...args) => bound(args) };
      },
    };
    const env = {
      DB,
      ANALYTICS_DASHBOARD_PASSWORD: "testpassword123",
      adtools: { get: async () => null, put: async () => {}, delete: async () => {} },
    };
    try {
      sqlite.exec(`INSERT INTO tool_usage (event_id, user_email, device_id, tool_id, action, source, created_time)
        VALUES ('person-a1', 'alex@one.test', 'a', 'quick-query', 'merge', 'client', datetime('now', '+7 hours')),
        ('person-a2', 'alex@one.test', 'a', 'json-tools', 'prettify', 'client', datetime('now', '+7 hours', '-1 day')),
        ('person-old', 'alex@one.test', 'a', 'run-query', 'run', 'client', datetime('now', '+7 hours', '-100 days')),
        ('person-b', 'alex@two.test', 'b', 'run-query', 'run', 'client', datetime('now', '+7 hours'));`);
      const auth = await worker.fetch(
        new Request("http://localhost/dashboard/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: "testpassword123" }),
        }),
        env,
      );
      const { token } = await auth.json();
      const query = (person, range = "30d", authorized = true) =>
        worker.fetch(
          new Request("http://localhost/dashboard/query", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(authorized ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify({ tabId: "who", person, range }),
          }),
          env,
        );
      expect((await query("alex@one.test", "30d", false)).status).toBe(401);
      const response = await query("alex@one.test");
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.data.summary).toMatchObject({ user_email: "alex@one.test", events: 2, active_days: 2, tools_used: 2 });
      expect(body.data.recent.every((row) => row.user_email === "alex@one.test")).toBe(true);
      expect(body.data.tools.map((row) => row.tool_id)).not.toContain("run-query");
      const all = await (await query("alex@one.test", "all")).json();
      expect(all.data.summary.events).toBe(3);
      const injected = await (await query("alex@one.test' OR 1=1 --")).json();
      expect(injected.data.summary.events).toBe(0);
      const people = await (
        await worker.fetch(
          new Request("http://localhost/dashboard/query", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ tabId: "who", range: "30d" }),
          }),
          env,
        )
      ).json();
      expect(people.data.filter((row) => row.section === "Top users").map((row) => row.user_email)).toContain("alex@two.test");
    } finally {
      sqlite.close();
    }
  });
});
