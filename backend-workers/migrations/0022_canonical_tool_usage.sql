-- Canonical, success-only ledger used for impact reporting.
CREATE TABLE IF NOT EXISTS tool_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  user_email TEXT NOT NULL,
  device_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  action TEXT NOT NULL,
  properties TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL,
  created_time TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tool_usage_email_time ON tool_usage(user_email, created_time DESC);
CREATE INDEX IF NOT EXISTS idx_tool_usage_tool_action_time ON tool_usage(tool_id, action, created_time DESC);

-- Recover actions whose legacy usage_log boundary already represented success.
INSERT OR IGNORE INTO tool_usage (event_id, user_email, device_id, tool_id, action, properties, source, created_time)
SELECT 'historical:usage:' || id,
  LOWER(user_email),
  device_id,
  CASE tool_id
    WHEN 'jenkins-runner' THEN 'run-query'
    WHEN 'master_lockey' THEN 'master-lockey'
    WHEN 'json_tools' THEN 'json-tools'
    ELSE tool_id
  END,
  action,
  '{}',
  'historical_usage_log',
  created_time
FROM usage_log
WHERE LOWER(TRIM(user_email)) != 'dev@localhost'
  AND (
    (tool_id = 'uuid-generator' AND action IN ('single', 'multiple'))
    OR (tool_id = 'tlv-viewer' AND action = 'parse')
    OR (tool_id = 'quick-query' AND action IN ('merge', 'insert', 'update'))
    OR (tool_id = 'compare-config' AND action LIKE 'unified_%')
    OR (tool_id = 'merge-sql' AND action IN ('merge', 'report_from_sql'))
  );

-- Recover successful outcomes that were historically written only as rich events.
INSERT OR IGNORE INTO tool_usage (event_id, user_email, device_id, tool_id, action, properties, source, created_time)
SELECT 'historical:event:' || e.id,
  LOWER(u.email),
  e.device_id,
  CASE e.feature_id
    WHEN 'jenkins-runner' THEN 'run-query'
    WHEN 'master_lockey' THEN 'master-lockey'
    WHEN 'json_tools' THEN 'json-tools'
    ELSE e.feature_id
  END AS tool_id,
  CASE
    WHEN e.feature_id IN ('json-tools', 'json_tools') AND e.action = 'process_success'
      THEN COALESCE(CASE WHEN json_valid(e.properties) THEN json_extract(e.properties, '$.action') END, 'process')
    WHEN e.feature_id IN ('json-tools', 'json_tools') AND e.action = 'json_to_table_success' THEN 'json_to_table'
    WHEN e.feature_id = 'base64-tools' AND e.action = 'encode_success' THEN 'encode'
    WHEN e.feature_id = 'base64-tools' AND e.action = 'decode_success' THEN 'decode'
    WHEN e.feature_id = 'check-image' AND e.action = 'check_complete' THEN 'check'
    WHEN e.feature_id IN ('run-query', 'jenkins-runner') AND e.action = 'run_success' THEN 'run'
    WHEN e.feature_id = 'qr-tools' AND e.action = 'download_png' THEN 'download_png'
    WHEN e.feature_id = 'qr-tools' AND e.action = 'download_svg' THEN 'download_svg'
    WHEN e.feature_id = 'querify' AND e.action = 'generated' THEN 'generate'
    WHEN e.feature_id = 'run-batch' AND e.action = 'run_success' THEN 'run'
    WHEN e.feature_id = 'html-template' AND e.action = 'format_action' THEN 'format'
    WHEN e.feature_id = 'html-template' AND e.action = 'minify_action' THEN 'minify'
    WHEN e.feature_id = 'html-template' AND e.action = 'copy_html' THEN 'copy'
    WHEN e.feature_id = 'splunk-template' AND e.action = 'format_action' THEN 'format'
    WHEN e.feature_id = 'splunk-template' AND e.action = 'minify_action' THEN 'minify'
    WHEN e.feature_id = 'splunk-template' AND e.action = 'copy_success' THEN 'copy'
    WHEN e.feature_id = 'sql-in-clause' AND e.action = 'copy_output' THEN 'copy'
    WHEN e.feature_id IN ('master-lockey', 'master_lockey') THEN e.action
    ELSE e.action
  END AS action,
  e.properties,
  'historical_event',
  e.created_time
FROM events e
JOIN device d ON d.device_id = e.device_id
JOIN users u ON u.id = d.user_id
WHERE LOWER(TRIM(u.email)) != 'dev@localhost'
  AND e.id = (
    SELECT MIN(e2.id)
    FROM events e2
    WHERE e2.device_id = e.device_id
      AND e2.feature_id = e.feature_id
      AND e2.action = e.action
      AND e2.properties IS e.properties
      AND e2.created_time = e.created_time
  )
  AND (
    (e.feature_id IN ('json-tools', 'json_tools') AND e.action IN ('process_success', 'json_to_table_success'))
    OR (e.feature_id = 'base64-tools' AND e.action IN ('encode_success', 'decode_success'))
    OR (e.feature_id = 'check-image' AND e.action = 'check_complete')
    OR (e.feature_id IN ('run-query', 'jenkins-runner') AND e.action = 'run_success')
    OR (e.feature_id = 'qr-tools' AND e.action IN ('download_png', 'download_svg'))
    OR (
      e.feature_id = 'querify' AND e.action = 'generated'
      AND json_valid(e.properties) AND COALESCE(json_extract(e.properties, '$.success_count'), 0) > 0
    )
    OR (e.feature_id = 'run-batch' AND e.action = 'run_success')
    OR (e.feature_id = 'html-template' AND e.action IN ('format_action', 'minify_action', 'copy_html'))
    OR (e.feature_id = 'splunk-template' AND e.action IN ('format_action', 'minify_action', 'copy_success'))
    OR (e.feature_id = 'sql-in-clause' AND e.action = 'copy_output')
    OR (
      e.feature_id IN ('master-lockey', 'master_lockey')
      AND e.action IN (
        'bulk_search', 'confluence_copy_lockey', 'confluence_copy_table',
        'bulk_search_copy', 'bulk_search_copy_lockey', 'bulk_confluence_copy_lockey', 'bulk_confluence_copy_table'
      )
    )
  );
