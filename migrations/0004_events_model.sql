-- 0004_events_model.sql
-- Extend events schema with ts_epoch, event_name, properties
-- and add helpful indexes. Includes backfill for existing rows.

-- Add new columns (SQLite/D1 allows ADD COLUMN)
ALTER TABLE events ADD COLUMN ts_epoch INTEGER;
ALTER TABLE events ADD COLUMN event_name TEXT;
ALTER TABLE events ADD COLUMN properties TEXT; -- JSON string, optional

-- Backfill ts_epoch from ISO ts (treat as UTC)
UPDATE events
SET ts_epoch = CAST(strftime('%s', replace(substr(ts, 1, 19), 'T', ' '), 'utc') AS INTEGER) * 1000
WHERE ts IS NOT NULL AND ts_epoch IS NULL;

-- Backfill event_name from feature_id + action when missing
UPDATE events
SET event_name = COALESCE(event_name, feature_id || '.' || COALESCE(action, 'unknown'))
WHERE event_name IS NULL;

-- Backfill properties from legacy meta
UPDATE events
SET properties = meta
WHERE properties IS NULL AND meta IS NOT NULL;

-- Indexes to improve common queries
CREATE INDEX IF NOT EXISTS idx_events_ts_epoch ON events(ts_epoch);
CREATE INDEX IF NOT EXISTS idx_events_event_name ON events(event_name);
CREATE INDEX IF NOT EXISTS idx_events_device_ts ON events(device_id, ts_epoch);
CREATE INDEX IF NOT EXISTS idx_events_user_ts ON events(user_id, ts_epoch);
CREATE INDEX IF NOT EXISTS idx_events_feature_action_ts ON events(feature_id, action, ts_epoch);