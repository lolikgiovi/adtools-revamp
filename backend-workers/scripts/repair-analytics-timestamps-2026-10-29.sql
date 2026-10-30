-- One-time production repair for the legacy Jakarta -> UTC -> Jakarta conversion.
-- 34641 was the highest observed client-ledger id before the fixed Worker deployed.
-- Only repair rows corroborated by the separate event stream at the corrected second,
-- with no event evidence at the existing wall time. Preserve every original for rollback.
CREATE TABLE IF NOT EXISTS analytics_timestamp_repair_20261029 (
  tool_usage_id INTEGER PRIMARY KEY,
  event_id TEXT NOT NULL,
  original_time TEXT NOT NULL,
  corrected_time TEXT NOT NULL,
  evidence_event_id INTEGER NOT NULL,
  repaired_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO analytics_timestamp_repair_20261029
  (tool_usage_id, event_id, original_time, corrected_time, evidence_event_id)
SELECT t.id, t.event_id, t.created_time, datetime(t.created_time) || '+07:00',
  (SELECT MIN(e.id) FROM events e
    WHERE e.device_id = t.device_id AND e.feature_id = t.tool_id
      AND substr(e.created_time, 1, 19) = datetime(t.created_time))
FROM tool_usage t
WHERE t.source = 'client' AND t.id <= 34641
  AND length(t.created_time) = 25 AND substr(t.created_time, -6) = '+07:00'
  AND EXISTS (SELECT 1 FROM events e
    WHERE e.device_id = t.device_id AND e.feature_id = t.tool_id
      AND substr(e.created_time, 1, 19) = datetime(t.created_time))
  AND NOT EXISTS (SELECT 1 FROM events e
    WHERE e.device_id = t.device_id AND e.feature_id = t.tool_id
      AND substr(e.created_time, 1, 19) = substr(t.created_time, 1, 19));

UPDATE tool_usage
SET created_time = (
  SELECT r.corrected_time FROM analytics_timestamp_repair_20261029 r
  WHERE r.tool_usage_id = tool_usage.id AND r.event_id = tool_usage.event_id
)
WHERE EXISTS (
  SELECT 1 FROM analytics_timestamp_repair_20261029 r
  WHERE r.tool_usage_id = tool_usage.id AND r.event_id = tool_usage.event_id
    AND r.original_time = tool_usage.created_time
);
