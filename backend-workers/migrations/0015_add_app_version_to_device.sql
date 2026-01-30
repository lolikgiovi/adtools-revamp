-- Migration: Add app_version column to device table
-- Tracks the current app version installed on each device

ALTER TABLE device ADD COLUMN app_version TEXT NULL;

-- Index for querying devices by version (useful for version analytics)
CREATE INDEX IF NOT EXISTS idx_device_app_version ON device(app_version);
