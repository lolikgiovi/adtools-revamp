-- Migration: Create usage_log table for live user activity logging
-- This table logs individual actions in real-time when SEND_LIVE_USER_LOG is enabled

CREATE TABLE IF NOT EXISTS usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  device_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  action TEXT NOT NULL,
  created_time TEXT NOT NULL
);

-- Index for querying logs by user
CREATE INDEX IF NOT EXISTS idx_usage_log_email ON usage_log(user_email);

-- Index for querying logs by tool
CREATE INDEX IF NOT EXISTS idx_usage_log_tool ON usage_log(tool_id);

-- Index for querying logs by time
CREATE INDEX IF NOT EXISTS idx_usage_log_time ON usage_log(created_time DESC);

-- Composite index for user activity timeline
CREATE INDEX IF NOT EXISTS idx_usage_log_email_time ON usage_log(user_email, created_time DESC);
