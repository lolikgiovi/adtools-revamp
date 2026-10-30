// @vitest-environment node
// Failure cases: correct explicit-offset rows shift; new rows shift; historical projections shift;
// uncorroborated or ambiguous rows shift; a rerun shifts rows twice; rollback loses original timestamps.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

it("repairs only corroborated pre-deployment timestamps and preserves a reversible audit", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE tool_usage (
      id INTEGER PRIMARY KEY, event_id TEXT, device_id TEXT, tool_id TEXT, source TEXT, created_time TEXT
    );
    CREATE TABLE events (id INTEGER PRIMARY KEY, device_id TEXT, feature_id TEXT, created_time TEXT);
    INSERT INTO tool_usage VALUES
      (1, 'shifted', 'a', 'json-tools', 'client', '2026-10-29 17:00:00+07:00'),
      (2, 'correct', 'b', 'json-tools', 'client', '2026-10-29 10:00:00+07:00'),
      (3, 'unknown', 'c', 'json-tools', 'client', '2026-10-29 17:00:00+07:00'),
      (4, 'ambiguous', 'd', 'json-tools', 'client', '2026-10-29 17:00:00+07:00'),
      (5, 'historical', 'a', 'json-tools', 'historical_event', '2026-10-29 17:00:00+07:00'),
      (6, 'wrong-tool', 'a', 'other', 'client', '2026-10-29 17:00:00+07:00'),
      (34642, 'new', 'a', 'json-tools', 'client', '2026-10-29 17:00:00+07:00');
    INSERT INTO events VALUES
      (1, 'a', 'json-tools', '2026-10-29 10:00:00'),
      (2, 'b', 'json-tools', '2026-10-29 10:00:00'),
      (3, 'd', 'json-tools', '2026-10-29 10:00:00'),
      (4, 'd', 'json-tools', '2026-10-29 17:00:00');`);
    const original = db.prepare("SELECT id, created_time FROM tool_usage ORDER BY id").all();
    const sql = readFileSync(new URL("../scripts/repair-analytics-timestamps-2026-10-29.sql", import.meta.url), "utf8");
    db.exec(sql);
    const expected = original.map((row) => (row.id === 1 ? { ...row, created_time: "2026-10-29 10:00:00+07:00" } : row));
    expect(db.prepare("SELECT id, created_time FROM tool_usage ORDER BY id").all()).toEqual(expected);
    db.exec(sql);
    expect(db.prepare("SELECT id, created_time FROM tool_usage ORDER BY id").all()).toEqual(expected);
    const audit = db.prepare("SELECT * FROM analytics_timestamp_repair_20261029").all();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      tool_usage_id: 1,
      event_id: "shifted",
      evidence_event_id: 1,
      original_time: "2026-10-29 17:00:00+07:00",
      corrected_time: "2026-10-29 10:00:00+07:00",
    });
    db.exec(`UPDATE tool_usage SET created_time = (
      SELECT original_time FROM analytics_timestamp_repair_20261029 r WHERE r.tool_usage_id = tool_usage.id
    ) WHERE id IN (SELECT tool_usage_id FROM analytics_timestamp_repair_20261029);`);
    expect(db.prepare("SELECT id, created_time FROM tool_usage ORDER BY id").all()).toEqual(original);
  } finally {
    db.close();
  }
});
