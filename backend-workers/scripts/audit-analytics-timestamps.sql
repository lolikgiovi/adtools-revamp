-- Read-only production check. Offset-free event timestamps are Jakarta wall time.
SELECT datetime('now') AS utc_now, datetime('now', '+7 hours') AS jakarta_now;

SELECT COUNT(*) AS future_client_rows,
  MAX(created_time) AS latest_stored_jakarta
FROM tool_usage
WHERE source = 'client' AND datetime(created_time) > datetime('now', '+5 minutes');

-- Compare rows after the first timestamp deployment with the independent event stream.
SELECT COUNT(*) AS rows_since_first_fix,
  SUM(EXISTS (
    SELECT 1 FROM events e
    WHERE e.device_id = t.device_id AND e.feature_id = t.tool_id
      AND substr(e.created_time, 1, 19) = datetime(t.created_time)
  )) AS corroborated_seven_hour_shift,
  SUM(EXISTS (
    SELECT 1 FROM events e
    WHERE e.device_id = t.device_id AND e.feature_id = t.tool_id
      AND substr(e.created_time, 1, 19) = substr(t.created_time, 1, 19)
  )) AS corroborated_stored_wall_time
FROM tool_usage t
WHERE t.source = 'client' AND t.id > 34641;

SELECT t.id, t.tool_id, t.action, t.created_time AS stored_jakarta,
  datetime(t.created_time) AS suspected_corrected_jakarta,
  EXISTS (
    SELECT 1 FROM events e
    WHERE e.device_id = t.device_id AND e.feature_id = t.tool_id
      AND substr(e.created_time, 1, 19) = datetime(t.created_time)
  ) AS event_evidence_at_corrected_time
FROM tool_usage t
WHERE t.source = 'client'
ORDER BY t.id DESC LIMIT 12;

SELECT COUNT(*) AS previously_repaired,
  SUM(t.created_time = r.corrected_time) AS still_correct
FROM analytics_timestamp_repair_20261029 r
JOIN tool_usage t ON t.id = r.tool_usage_id AND t.event_id = r.event_id;
