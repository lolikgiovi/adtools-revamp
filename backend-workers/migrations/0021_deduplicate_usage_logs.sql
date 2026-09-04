-- Migration: remove exact retry duplicates and make future usage-log inserts idempotent.
-- The event payload has no server-generated ID, so this identity uses the full attribution,
-- action, and timestamp tuple. New clients preserve milliseconds in created_time to keep two
-- distinct actions in the same second distinguishable.

UPDATE usage_log
SET user_email = LOWER(user_email)
WHERE user_email != LOWER(user_email);

UPDATE usage_log
SET tool_id = CASE tool_id
  WHEN 'jenkins-runner' THEN 'run-query'
  WHEN 'master_lockey' THEN 'master-lockey'
  WHEN 'json_tools' THEN 'json-tools'
  ELSE tool_id
END
WHERE tool_id IN ('jenkins-runner', 'master_lockey', 'json_tools');

DELETE FROM usage_log
WHERE id NOT IN (
  SELECT MIN(id)
  FROM usage_log
  GROUP BY user_email, device_id, tool_id, action, created_time
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_log_event_identity
  ON usage_log(user_email, device_id, tool_id, action, created_time);
