-- Migration: Create GET analytics tables for devices that cannot send POST requests
-- These tables mirror the POST endpoint tables but keep data separate for analysis

-- Table for live usage logs from GET requests
CREATE TABLE IF NOT EXISTS get_usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  device_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  action TEXT NOT NULL,
  created_time TEXT NOT NULL
);

-- Index for querying logs by user
CREATE INDEX IF NOT EXISTS idx_get_usage_log_email ON get_usage_log(user_email);

-- Index for querying logs by device
CREATE INDEX IF NOT EXISTS idx_get_usage_log_device ON get_usage_log(device_id);

-- Index for querying logs by tool
CREATE INDEX IF NOT EXISTS idx_get_usage_log_tool ON get_usage_log(tool_id);

-- Index for querying logs by time
CREATE INDEX IF NOT EXISTS idx_get_usage_log_time ON get_usage_log(created_time DESC);

-- Composite index for user activity timeline
CREATE INDEX IF NOT EXISTS idx_get_usage_log_email_time ON get_usage_log(user_email, created_time DESC);

-- Table for batched device usage from GET requests
CREATE TABLE IF NOT EXISTS get_device_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT,
  device_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  action TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_time TEXT NOT NULL
);

-- Index for querying device usage by device
CREATE INDEX IF NOT EXISTS idx_get_device_usage_device ON get_device_usage(device_id);

-- Index for querying device usage by user
CREATE INDEX IF NOT EXISTS idx_get_device_usage_email ON get_device_usage(user_email);

-- Index for querying device usage by tool
CREATE INDEX IF NOT EXISTS idx_get_device_usage_tool ON get_device_usage(tool_id);

-- Composite index for device+tool+action (useful for upserts/queries)
CREATE INDEX IF NOT EXISTS idx_get_device_usage_device_tool_action ON get_device_usage(device_id, tool_id, action);
