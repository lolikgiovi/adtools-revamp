// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import worker from "../worker.js";

function createD1Adapter(sqlite) {
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

describe("dashboard built-in tabs", () => {
  it("queries every tab against the migrated database schema", async () => {
    const sqlite = new DatabaseSync(":memory:");
    const migrationsDir = new URL("../migrations/", import.meta.url);
    for (const filename of readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      sqlite.exec(readFileSync(new URL(filename, migrationsDir), "utf8"));
    }

    const env = {
      ANALYTICS_DASHBOARD_PASSWORD: "testpassword123",
      DB: createD1Adapter(sqlite),
      adtools: { get: async () => null, put: async () => {}, delete: async () => {} },
    };

    try {
      const authResponse = await worker.fetch(
        new Request("http://localhost/dashboard/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: "testpassword123" }),
        }),
        env,
      );
      const { token } = await authResponse.json();
      const tabsResponse = await worker.fetch(
        new Request("http://localhost/dashboard/tabs", { headers: { Authorization: `Bearer ${token}` } }),
        env,
      );
      const { tabs } = await tabsResponse.json();
      expect(tabs.length).toBeGreaterThan(30);

      for (const tab of tabs) {
        const response = await worker.fetch(
          new Request("http://localhost/dashboard/query", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ tabId: tab.id, range: "30d", page: 1, pageSize: 100 }),
          }),
          env,
        );
        const body = await response.json();
        expect(response.status, `${tab.id}: ${body.error || "HTTP error"}`).toBe(200);
        expect(body.ok, `${tab.id}: ${body.error || "query failed"}`).toBe(true);
        expect(Array.isArray(body.data), `${tab.id}: missing rows`).toBe(true);
      }
    } finally {
      sqlite.close();
    }
  });
});
