// @vitest-environment node
// Failure cases: prior repair or new ingestion changes; correct, ambiguous, unsupported, or
// historical rows shift; reruns shift twice; non-time fields change; rollback loses originals.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

it("repairs only corroborated rows from the redeployment regression with a reversible audit", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE tool_usage (
      id INTEGER PRIMARY KEY, event_id TEXT, device_id TEXT, tool_id TEXT, source TEXT, created_time TEXT
    );
    CREATE TABLE events (id INTEGER PRIMARY KEY, device_id TEXT, feature_id TEXT, created_time TEXT);
    INSERT INTO tool_usage VALUES
      (34641, 'prior', 'a', 'json-tools', 'client', '2026-10-29 17:00:00+07:00'),
      (34642, 'shifted', 'a', 'json-tools', 'client', '2026-10-29 17:00:00+07:00'),
      (34643, 'correct', 'b', 'json-tools', 'client', '2026-10-29 10:00:00+07:00'),
      (34644, 'unknown', 'c', 'json-tools', 'client', '2026-10-29 17:00:00+07:00'),
      (34645, 'ambiguous', 'd', 'json-tools', 'client', '2026-10-29 17:00:00+07:00'),
      (34646, 'historical', 'a', 'json-tools', 'historical_event', '2026-10-29 17:00:00+07:00'),
      (34647, 'wrong-tool', 'a', 'other', 'client', '2026-10-29 17:00:00+07:00'),
      (34758, 'overnight', 'a', 'json-tools', 'client', '2026-10-30 03:04:04+07:00'),
      (34759, 'new', 'a', 'json-tools', 'client', '2026-10-30 03:04:04+07:00');
    INSERT INTO events VALUES
      (1, 'a', 'json-tools', '2026-10-29 10:00:00'),
      (2, 'b', 'json-tools', '2026-10-29 10:00:00'),
      (3, 'd', 'json-tools', '2026-10-29 10:00:00'),
      (4, 'd', 'json-tools', '2026-10-29 17:00:00'),
      (5, 'a', 'json-tools', '2026-10-29 20:04:04');`);
    const original = db.prepare("SELECT * FROM tool_usage ORDER BY id").all();
    const sql = readFileSync(new URL("../scripts/repair-analytics-timestamps-2026-10-30.sql", import.meta.url), "utf8");
    const expected = original.map((row) => {
      if (row.id === 34642) return { ...row, created_time: "2026-10-29 10:00:00+07:00" };
      if (row.id === 34758) return { ...row, created_time: "2026-10-29 20:04:04+07:00" };
      return row;
    });
    db.exec(sql);
    expect(db.prepare("SELECT * FROM tool_usage ORDER BY id").all()).toEqual(expected);
    db.exec(sql);
    expect(db.prepare("SELECT * FROM tool_usage ORDER BY id").all()).toEqual(expected);
    const audit = db.prepare("SELECT * FROM analytics_timestamp_repair_20261030 ORDER BY tool_usage_id").all();
    expect(audit).toHaveLength(2);
    expect(audit[1]).toMatchObject({
      tool_usage_id: 34758,
      event_id: "overnight",
      original_time: "2026-10-30 03:04:04+07:00",
      corrected_time: "2026-10-29 20:04:04+07:00",
      evidence_event_id: 5,
    });
    db.exec(`UPDATE tool_usage SET created_time = (
      SELECT original_time FROM analytics_timestamp_repair_20261030 r
      WHERE r.tool_usage_id=tool_usage.id AND r.event_id=tool_usage.event_id
    ) WHERE EXISTS (
      SELECT 1 FROM analytics_timestamp_repair_20261030 r
      WHERE r.tool_usage_id=tool_usage.id AND r.event_id=tool_usage.event_id AND r.corrected_time=tool_usage.created_time
    );`);
    expect(db.prepare("SELECT * FROM tool_usage ORDER BY id").all()).toEqual(original);
  } finally {
    db.close();
  }
});
