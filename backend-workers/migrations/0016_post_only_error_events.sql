-- Migration: POST-only analytics cleanup and first-class uncaught error storage
-- Preserves historical GET-ingested analytics before dropping GET-only tables.

CREATE TABLE IF NOT EXISTS error_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT,
  device_id TEXT NOT NULL,
  runtime TEXT,
  app_version TEXT,
  route TEXT,
  tool_id TEXT,
  process_area TEXT NOT NULL DEFAULT 'shell',
  error_kind TEXT NOT NULL,
  error_name TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  source TEXT,
  lineno INTEGER,
  colno INTEGER,
  user_agent TEXT,
  metadata TEXT,
  created_time TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_error_events_time ON error_events(created_time DESC);
CREATE INDEX IF NOT EXISTS idx_error_events_email_time ON error_events(user_email, created_time DESC);
CREATE INDEX IF NOT EXISTS idx_error_events_device_time ON error_events(device_id, created_time DESC);
CREATE INDEX IF NOT EXISTS idx_error_events_tool_time ON error_events(tool_id, created_time DESC);
CREATE INDEX IF NOT EXISTS idx_error_events_process_time ON error_events(process_area, created_time DESC);
CREATE INDEX IF NOT EXISTS idx_error_events_name_time ON error_events(error_name, created_time DESC);

-- Keep this cleanup safe in environments that never had GET fallback tables.
CREATE TABLE IF NOT EXISTS get_device_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  user_email TEXT,
  tool_id TEXT NOT NULL,
  action TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_time TEXT NOT NULL,
  UNIQUE(device_id, tool_id, action)
);

CREATE TABLE IF NOT EXISTS get_usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  device_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  action TEXT NOT NULL,
  created_time TEXT NOT NULL
);

INSERT INTO device_usage (device_id, user_email, tool_id, action, count, updated_time)
SELECT
  device_id,
  user_email,
  CASE
    WHEN tool_id = 'master_lockey' THEN 'master-lockey'
    WHEN tool_id = 'json_tools' THEN 'json-tools'
    WHEN tool_id = 'jenkins-runner' THEN 'run-query'
    ELSE tool_id
  END AS tool_id,
  action,
  count,
  updated_time
FROM get_device_usage
WHERE true
ON CONFLICT(device_id, tool_id, action) DO UPDATE SET
  user_email = excluded.user_email,
  count = excluded.count,
  updated_time = excluded.updated_time;

INSERT INTO usage_log (user_email, device_id, tool_id, action, created_time)
SELECT
  user_email,
  device_id,
  CASE
    WHEN tool_id = 'master_lockey' THEN 'master-lockey'
    WHEN tool_id = 'json_tools' THEN 'json-tools'
    WHEN tool_id = 'jenkins-runner' THEN 'run-query'
    ELSE tool_id
  END AS tool_id,
  action,
  created_time
FROM get_usage_log;

DROP TABLE IF EXISTS get_device_usage;
DROP TABLE IF EXISTS get_usage_log;
