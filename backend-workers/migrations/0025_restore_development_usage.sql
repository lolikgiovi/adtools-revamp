-- Restore legacy Dev User activity that was omitted from the frozen lifetime baseline.
-- Subtract client-ledger rows because the lifetime rollup adds those rows separately.
WITH canonical_device_usage AS (
  SELECT device_id, LOWER(TRIM(user_email)) AS user_email, tool_id, action, count, updated_time
  FROM device_usage
  WHERE LOWER(TRIM(COALESCE(user_email, ''))) = 'dev@localhost'
    AND tool_id NOT IN ('jenkins-runner', 'master_lockey', 'json_tools')
    AND LOWER(TRIM(tool_id)) != 'velocity-template'

  UNION ALL

  SELECT legacy.device_id,
    LOWER(TRIM(legacy.user_email)),
    CASE legacy.tool_id
      WHEN 'jenkins-runner' THEN 'run-query'
      WHEN 'master_lockey' THEN 'master-lockey'
      WHEN 'json_tools' THEN 'json-tools'
    END AS tool_id,
    legacy.action,
    legacy.count,
    legacy.updated_time
  FROM device_usage AS legacy
  WHERE LOWER(TRIM(COALESCE(legacy.user_email, ''))) = 'dev@localhost'
    AND legacy.tool_id IN ('jenkins-runner', 'master_lockey', 'json_tools')
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
),
snapshot AS (
  SELECT user_email,
    tool_id,
    action,
    SUM(CASE WHEN count > 0 THEN count ELSE 0 END) AS count,
    MAX(updated_time) AS last_updated
  FROM canonical_device_usage
  GROUP BY user_email, tool_id, action
),
client_ledger AS (
  SELECT LOWER(TRIM(user_email)) AS user_email,
    tool_id,
    action,
    COUNT(*) AS count
  FROM tool_usage
  WHERE LOWER(TRIM(user_email)) = 'dev@localhost'
    AND source = 'client'
    AND LOWER(TRIM(tool_id)) != 'velocity-template'
  GROUP BY LOWER(TRIM(user_email)), tool_id, action
)
INSERT OR REPLACE INTO lifetime_usage_baseline (user_email, tool_id, action, count, last_updated)
SELECT snapshot.user_email,
  snapshot.tool_id,
  snapshot.action,
  MAX(snapshot.count - COALESCE(client_ledger.count, 0), 0),
  snapshot.last_updated
FROM snapshot
LEFT JOIN client_ledger
  ON client_ledger.user_email = snapshot.user_email
  AND client_ledger.tool_id = snapshot.tool_id
  AND client_ledger.action = snapshot.action
WHERE snapshot.count > COALESCE(client_ledger.count, 0);
