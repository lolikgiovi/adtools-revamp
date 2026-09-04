-- Migration: collapse legacy device_usage tool IDs into their canonical identities.
-- device_usage stores absolute snapshots. If an alias and canonical row exist for the same
-- device/action, the canonical snapshot wins because the client migration folds the alias count
-- into that row. Alias-only rows are retained under the canonical ID.

CREATE TABLE device_usage_normalized (
  device_id TEXT NOT NULL,
  user_email TEXT,
  tool_id TEXT NOT NULL,
  action TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_time TEXT NOT NULL,
  PRIMARY KEY (device_id, tool_id, action)
);

INSERT INTO device_usage_normalized (device_id, user_email, tool_id, action, count, updated_time)
SELECT device_id, LOWER(user_email), tool_id, action, count, updated_time
FROM device_usage
WHERE tool_id NOT IN ('jenkins-runner', 'master_lockey', 'json_tools');

INSERT INTO device_usage_normalized (device_id, user_email, tool_id, action, count, updated_time)
SELECT
  legacy.device_id,
  LOWER(legacy.user_email),
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
  );

DROP TABLE device_usage;
ALTER TABLE device_usage_normalized RENAME TO device_usage;

CREATE INDEX IF NOT EXISTS idx_device_usage_tool ON device_usage(tool_id);
CREATE INDEX IF NOT EXISTS idx_device_usage_device_time ON device_usage(device_id, updated_time DESC);
CREATE INDEX IF NOT EXISTS idx_device_usage_user_email ON device_usage(user_email);
