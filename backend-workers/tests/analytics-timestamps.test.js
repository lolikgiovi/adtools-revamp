// @vitest-environment node
// Failure cases: Jakarta wall time is shifted twice during ingestion; explicit UTC/offset instants
// shift incorrectly; late-night activity moves to the next date; retry changes timestamps or duplicates rows.
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { UsageTracker } from "../../frontend/core/UsageTracker.js";
import { handleAnalyticsBatchPost } from "../src/routes/analytics.js";
import worker from "../worker.js";

it("preserves the client's Jakarta activity time through ingestion and dashboard reports", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const migrations = new URL("../migrations/", import.meta.url);
  for (const name of readdirSync(migrations)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    sqlite.exec(readFileSync(new URL(name, migrations), "utf8"));
  }
  const env = {
    ANALYTICS_DASHBOARD_PASSWORD: "timestamp-fixture",
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
      batch: async (statements) => Promise.all(statements.map((statement) => statement.run())),
    },
    adtools: { get: async () => null, put: async () => {}, delete: async () => {} },
  };
  try {
    const payload = UsageTracker._toBatchPayload({
      deviceId: "timestamp-device",
      toolUses: [
        { event_id: "morning", tool_id: "json-tools", action: "prettify", ts: "2026-10-29T03:00:00.000Z" },
        { event_id: "night", tool_id: "json-tools", action: "minify", ts: "2026-10-29T16:30:00.000Z" },
      ],
    });
    payload.tool_usage.push(
      { event_id: "utc", tool_id: "json-tools", action: "utc", ts: "2026-10-29T03:00:00Z" },
      { event_id: "offset", tool_id: "json-tools", action: "offset", created_time: "2026-10-29T11:00:00+08:00" },
    );
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await handleAnalyticsBatchPost(
        new Request("http://localhost/analytics/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
        env,
        { email: "reader@example.test", deviceId: "timestamp-device" },
      );
      expect(response.status).toBe(200);
    }
    const auth = await worker.fetch(
      new Request("http://localhost/dashboard/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "timestamp-fixture" }),
      }),
      env,
    );
    const { token } = await auth.json();
    const report = await worker.fetch(
      new Request("http://localhost/dashboard/query", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tabId: "daily", range: "all" }),
      }),
      env,
    );
    const body = await report.json();
    expect(body.ok, body.error).toBe(true);
    expect(Object.fromEntries(body.data.map((row) => [row.action, row.time]))).toEqual({
      prettify: "2026-10-29 / 10:00:00",
      minify: "2026-10-29 / 23:30:00",
      utc: "2026-10-29 / 10:00:00",
      offset: "2026-10-29 / 10:00:00",
    });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM tool_usage").get().count).toBe(4);
  } finally {
    sqlite.close();
  }
});
