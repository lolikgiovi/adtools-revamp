-- 0005_remove_user_id_from_events.sql
-- Remove user_id from events; user linkage is via user_device.
-- D1 migrations: no explicit transactions.

-- Drop dependent index first
DROP INDEX IF EXISTS idx_events_user_ts;

-- Drop the column
ALTER TABLE events DROP COLUMN user_id;