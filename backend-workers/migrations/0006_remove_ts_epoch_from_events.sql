-- 0006_remove_ts_epoch_from_events.sql
-- Remove ts_epoch from events. We will order by parsed ts when needed.
-- Drop indexes that reference ts_epoch first; D1 runs statements without explicit transactions.

DROP INDEX IF EXISTS idx_events_ts_epoch;
DROP INDEX IF EXISTS idx_events_device_ts;
DROP INDEX IF EXISTS idx_events_feature_action_ts;

ALTER TABLE events DROP COLUMN ts_epoch;