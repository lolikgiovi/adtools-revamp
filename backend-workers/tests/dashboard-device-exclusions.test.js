// @vitest-environment node
// Failure cases: excluded rows enter aggregates/pages, other devices of the same user disappear,
// cached unfiltered results leak into filtered requests, schema writes change, stored records are deleted.
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import worker from "../worker.js";

const devId = "6028654b-b517-4d2f-8239-3f466f77f123";

function database(sqlite) {
  return {
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
}

describe("Dashboard device exclusions", () => {
  it("filters every built-in report before aggregation without dropping the user's other device", async () => {
    const sqlite = new DatabaseSync(":memory:");
    const migrations = new URL("../migrations/", import.meta.url);
    for (const name of readdirSync(migrations)
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      sqlite.exec(readFileSync(new URL(name, migrations), "utf8"));
    }
    const now = new Date().toISOString();
    // Device-level ledger rows, with no frozen baseline: both devices belong to one user.
    sqlite
      .prepare(
        "INSERT INTO tool_usage (event_id, user_email, device_id, tool_id, action, properties, source, created_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run("dev-use", "same@example.test", devId, "json-tools", "prettify", "{}", "client", now);
    sqlite
      .prepare(
        "INSERT INTO tool_usage (event_id, user_email, device_id, tool_id, action, properties, source, created_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run("real-use", "same@example.test", "real-device", "json-tools", "prettify", "{}", "client", now);
    const env = {
      ANALYTICS_DASHBOARD_PASSWORD: "testpassword123",
      DB: database(sqlite),
      adtools: { get: async () => null, put: async () => {}, delete: async () => {} },
    };
    try {
      const auth = await worker.fetch(
        new Request("http://localhost/dashboard/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: "testpassword123" }),
        }),
        env,
      );
      const { token } = await auth.json();
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
      const query = async (target, tabId, extra = {}) =>
        (
          await worker.fetch(
            new Request("http://localhost/dashboard/query", {
              method: "POST",
              headers,
              body: JSON.stringify({ tabId, range: "all", page: 1, pageSize: 1, ...extra }),
            }),
            target,
          )
        ).json();
      const unfiltered = await query(env, "overview");
      expect(unfiltered.data.find((row) => row.metric === "Successful tool uses").value).toBe("2");
      const filteredEnv = { ...env, ANALYTICS_EXCLUDED_DEVICE_IDS: devId };
      const overview = await query(filteredEnv, "overview");
      expect(overview.data.find((row) => row.metric === "Successful tool uses").value).toBe("1");
      const lifetime = await query(filteredEnv, "tools");
      expect(lifetime.warning).toContain("Legacy lifetime totals");
      const daily = await query(filteredEnv, "daily");
      expect(daily.data).toHaveLength(1);
      expect(daily.pagination.hasMore).toBe(false);
      const person = await query(filteredEnv, "who", { person: "same@example.test" });
      expect(person.ok).toBe(true);
      expect(person.data.summary.events).toBe(1);
      expect(person.data.summary.devices_seen).toBe(1);
      const tabs = await (await worker.fetch(new Request("http://localhost/dashboard/tabs", { headers }), filteredEnv)).json();
      for (const tab of tabs.tabs) {
        const result = await query(filteredEnv, tab.id);
        expect(result.ok, `${tab.id}: ${result.error}`).toBe(true);
      }
      expect(sqlite.prepare("SELECT COUNT(*) AS count FROM tool_usage").get().count).toBe(2);
      const again = await query(env, "overview");
      expect(again.data.find((row) => row.metric === "Successful tool uses").value).toBe("2");
    } finally {
      sqlite.close();
    }
  });
});
