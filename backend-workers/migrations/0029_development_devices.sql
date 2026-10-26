-- Keep development installations registered while excluding their telemetry from Dashboard reports.
ALTER TABLE device ADD COLUMN is_development INTEGER NOT NULL DEFAULT 0 CHECK (is_development IN (0, 1));
CREATE INDEX idx_device_is_development ON device(is_development, device_id);
