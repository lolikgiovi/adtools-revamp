-- Migration: Create device_usage table for simplified absolute count tracking
-- This replaces the delta-based daily_usage approach with idempotent full-state syncing

CREATE TABLE IF NOT EXISTS device_usage (
  device_id TEXT NOT NULL,
  user_email TEXT,
  tool_id TEXT NOT NULL,
  action TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_time TEXT NOT NULL,
  PRIMARY KEY (device_id, tool_id, action)
);

-- Index for querying usage by tool across all devices
CREATE INDEX IF NOT EXISTS idx_device_usage_tool ON device_usage(tool_id);

-- Index for device-specific usage history
CREATE INDEX IF NOT EXISTS idx_device_usage_device_time ON device_usage(device_id, updated_time DESC);

-- Index for fast per-user analytics without JOINs
CREATE INDEX IF NOT EXISTS idx_device_usage_user_email ON device_usage(user_email);
