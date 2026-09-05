-- Freeze the legacy cumulative device snapshots at the canonical-ledger cutover.
-- Lifetime usage is this immutable baseline plus append-only tool_usage rows whose source is 'client'.
CREATE TABLE IF NOT EXISTS lifetime_usage_baseline (
  user_email TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  action TEXT NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 0),
  last_updated TEXT,
  PRIMARY KEY (user_email, tool_id, action)
);

CREATE INDEX IF NOT EXISTS idx_lifetime_usage_baseline_tool_action
  ON lifetime_usage_baseline(tool_id, action);

WITH canonical_device_usage AS (
  SELECT device_id, user_email, tool_id, action, count, updated_time
  FROM device_usage
  WHERE tool_id NOT IN ('jenkins-runner', 'master_lockey', 'json_tools')
    AND LOWER(TRIM(tool_id)) != 'velocity-template'
    AND LOWER(TRIM(COALESCE(user_email, ''))) != 'dev@localhost'

  UNION ALL

  SELECT legacy.device_id,
    legacy.user_email,
    CASE legacy.tool_id
      WHEN 'jenkins-runner' THEN 'run-query'
      WHEN 'master_lockey' THEN 'master-lockey'
      WHEN 'json_tools' THEN 'json-tools'
    END AS tool_id,
    legacy.action,
    legacy.count,
    legacy.updated_time
  FROM device_usage AS legacy
  WHERE legacy.tool_id IN ('jenkins-runner', 'master_lockey', 'json_tools')
    AND LOWER(TRIM(COALESCE(legacy.user_email, ''))) != 'dev@localhost'
    AND NOT EXISTS (
      SELECT 1
      FROM device_usage AS canonical
      WHERE canonical.device_id = legacy.device_id
        AND canonical.action = legacy.action
        AND canonical.tool_id = CASE legacy.tool_id
          WHEN 'jenkins-runner' THEN 'run-query'
          WHEN 'master_lockey' THEN 'master-lockey'
          WHEN 'json_tools' THEN 'json-tools'
        END
    )
)
INSERT OR IGNORE INTO lifetime_usage_baseline (user_email, tool_id, action, count, last_updated)
SELECT COALESCE(LOWER(TRIM(user_email)), ''),
  tool_id,
  action,
  SUM(CASE WHEN count > 0 THEN count ELSE 0 END),
  MAX(updated_time)
FROM canonical_device_usage
GROUP BY COALESCE(LOWER(TRIM(user_email)), ''), tool_id, action
HAVING SUM(CASE WHEN count > 0 THEN count ELSE 0 END) > 0;
