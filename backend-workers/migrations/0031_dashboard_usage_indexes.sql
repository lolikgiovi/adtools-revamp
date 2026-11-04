-- Dashboard date windows and per-device recency read these instead of scanning every usage row.
CREATE INDEX IF NOT EXISTS idx_tool_usage_time_source_device ON tool_usage(created_time, source, device_id);
CREATE INDEX IF NOT EXISTS idx_tool_usage_device_source_time ON tool_usage(device_id, source, created_time);
CREATE INDEX IF NOT EXISTS idx_usage_log_device_time ON usage_log(device_id, created_time);
