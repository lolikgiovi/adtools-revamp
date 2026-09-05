CREATE INDEX IF NOT EXISTS idx_tool_usage_source_email_tool_action_time
  ON tool_usage(source, user_email, tool_id, action, created_time DESC);
