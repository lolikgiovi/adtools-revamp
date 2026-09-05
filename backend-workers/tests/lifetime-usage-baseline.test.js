// @vitest-environment node

import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { buildLifetimeUsageRollupQuery } from "../src/utils/analyticsUsageSql.js";

describe("lifetime usage baseline", () => {
  let db;
  afterEach(() => db?.close());

  it("freezes canonicalized legacy counters and adds only new client ledger rows", () => {
    db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE device_usage (
        device_id TEXT NOT NULL,
        user_email TEXT,
        tool_id TEXT NOT NULL,
        action TEXT NOT NULL,
        count INTEGER NOT NULL,
        updated_time TEXT NOT NULL,
        PRIMARY KEY (device_id, tool_id, action)
      );
      CREATE TABLE tool_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        user_email TEXT NOT NULL,
        device_id TEXT NOT NULL,
        tool_id TEXT NOT NULL,
        action TEXT NOT NULL,
        properties TEXT NOT NULL DEFAULT '{}',
        source TEXT NOT NULL,
        created_time TEXT NOT NULL
      );

      INSERT INTO device_usage VALUES
        ('d1', 'User@Example.com', 'quick-query', 'merge', 2, '2026-09-04 10:00:00'),
        ('d1', 'User@Example.com', 'jenkins-runner', 'run_click', 5, '2026-09-04 10:01:00'),
        ('d1', 'User@Example.com', 'run-query', 'run_click', 4, '2026-09-04 10:02:00'),
        ('d2', 'User@Example.com', 'jenkins-runner', 'run_click', 3, '2026-09-04 10:03:00'),
        ('dev', 'dev@localhost', 'quick-query', 'merge', 100, '2026-09-04 10:04:00'),
        ('d1', 'User@Example.com', 'velocity-template', 'open', 100, '2026-09-04 10:05:00'),
        ('anonymous', NULL, 'html-template', 'mount', 4, '2026-09-04 10:06:00');

      INSERT INTO tool_usage (event_id, user_email, device_id, tool_id, action, source, created_time) VALUES
        ('historical-1', 'user@example.com', 'd1', 'quick-query', 'merge', 'historical_usage_log', '2026-09-04 10:00:00'),
        ('client-1', 'user@example.com', 'd1', 'quick-query', 'merge', 'client', '2026-09-05 10:00:00'),
        ('client-2', 'new@example.com', 'd3', 'json-tools', 'prettify', 'client', '2026-09-05 10:01:00'),
        ('client-dev', 'dev@localhost', 'dev', 'quick-query', 'merge', 'client', '2026-09-05 10:02:00');
    `);

    const migration = fs.readFileSync(new URL("../migrations/0023_freeze_lifetime_usage_baseline.sql", import.meta.url), "utf8");
    db.exec(migration);

    const baseline = db.prepare("SELECT user_email, tool_id, action, count FROM lifetime_usage_baseline ORDER BY tool_id").all();
    expect(baseline).toEqual([
      { user_email: "", tool_id: "html-template", action: "mount", count: 4 },
      { user_email: "user@example.com", tool_id: "quick-query", action: "merge", count: 2 },
      { user_email: "user@example.com", tool_id: "run-query", action: "run_click", count: 7 },
    ]);

    const lifetime = db
      .prepare(`WITH lifetime_usage AS (${buildLifetimeUsageRollupQuery()})
        SELECT SUM(count) AS total, COUNT(DISTINCT NULLIF(user_email, '')) AS users
        FROM lifetime_usage`)
      .get();
    expect(lifetime).toEqual({ total: 15, users: 2 });
  });
});
