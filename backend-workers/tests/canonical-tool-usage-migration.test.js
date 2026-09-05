// @vitest-environment node

import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

describe("canonical tool usage historical recovery", () => {
  let db;
  afterEach(() => db?.close());

  it("recovers trusted successes, excludes dev, removes exact event retries, and is idempotent", () => {
    db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL);
      CREATE TABLE device (device_id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
      CREATE TABLE usage_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT NOT NULL, device_id TEXT NOT NULL,
        tool_id TEXT NOT NULL, action TEXT NOT NULL, created_time TEXT NOT NULL
      );
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL, feature_id TEXT NOT NULL,
        action TEXT NOT NULL, properties TEXT, created_time TEXT NOT NULL
      );
      INSERT INTO users VALUES ('u1', 'user@example.com'), ('dev', 'dev@localhost');
      INSERT INTO device VALUES ('d1', 'u1'), ('dd', 'dev');
      INSERT INTO usage_log (user_email, device_id, tool_id, action, created_time) VALUES
        ('user@example.com', 'd1', 'quick-query', 'merge', '2026-09-01 10:00:00'),
        ('dev@localhost', 'dd', 'quick-query', 'merge', '2026-09-01 10:00:00');
      INSERT INTO events (device_id, feature_id, action, properties, created_time) VALUES
        ('d1', 'base64-tools', 'encode_success', '{"input_mode":"text"}', '2026-09-01 10:01:00'),
        ('d1', 'base64-tools', 'encode_success', '{"input_mode":"text"}', '2026-09-01 10:01:00'),
        ('d1', 'json-tools', 'process_success', 'not-json', '2026-09-01 10:02:00'),
        ('d1', 'querify', 'generated', '{"success_count":1}', '2026-09-01 10:03:00'),
        ('d1', 'querify', 'generated', '{"success_count":0}', '2026-09-01 10:04:00'),
        ('dd', 'base64-tools', 'decode_success', '{}', '2026-09-01 10:05:00');
    `);

    const migration = fs.readFileSync(new URL("../migrations/0022_canonical_tool_usage.sql", import.meta.url), "utf8");
    db.exec(migration);
    db.exec(migration);

    const rows = db.prepare("SELECT tool_id, action FROM tool_usage ORDER BY tool_id, action").all();
    expect(rows).toEqual([
      { tool_id: "base64-tools", action: "encode" },
      { tool_id: "json-tools", action: "process" },
      { tool_id: "querify", action: "generate" },
      { tool_id: "quick-query", action: "merge" },
    ]);
  });
});
