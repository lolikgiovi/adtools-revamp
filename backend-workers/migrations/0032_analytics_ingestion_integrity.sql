-- Retry-safe ingestion and one timestamp format for analytics rows.
-- 1. events and error_events get a client row id; a retried chunk is ignored instead of stored twice.
--    Rows written before this migration keep a NULL id and stay out of the unique index.
-- 2. Offset-free "YYYY-MM-DD HH:MM:SS[.mmm]" timestamps are Jakarta wall time (see tsToGmt7Plain).
--    Append the explicit offset so every analytics table stores "YYYY-MM-DD HH:MM:SS[.mmm]+07:00"; the wall-time prefix,
--    and therefore every string range and SUBSTR(created_time, 1, 10) day, is unchanged.
--    D1 rejects long GLOB patterns, so the shape check stays short.
-- 3. daily_usage and user_usage have had no reader or writer since 0010.

ALTER TABLE events ADD COLUMN event_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_event_id ON events(event_id) WHERE event_id IS NOT NULL;

ALTER TABLE error_events ADD COLUMN event_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_error_events_event_id ON error_events(event_id) WHERE event_id IS NOT NULL;

UPDATE events SET created_time = created_time || '+07:00'
WHERE created_time GLOB '????-??-?? ??:??:??*'
  AND substr(created_time, -6, 1) NOT IN ('+', '-') AND upper(substr(created_time, -1)) != 'Z';

-- usage_log is unique on (user, device, tool, action, created_time). A row already stored with the offset
-- is the same activity as its offset-free twin, so the twin is removed rather than renamed into a conflict.
DELETE FROM usage_log
WHERE created_time GLOB '????-??-?? ??:??:??*'
  AND substr(created_time, -6, 1) NOT IN ('+', '-') AND upper(substr(created_time, -1)) != 'Z'
  AND EXISTS (
    SELECT 1 FROM usage_log twin
    WHERE twin.user_email = usage_log.user_email
      AND twin.device_id = usage_log.device_id
      AND twin.tool_id = usage_log.tool_id
      AND twin.action = usage_log.action
      AND twin.created_time = usage_log.created_time || '+07:00'
  );

UPDATE usage_log SET created_time = created_time || '+07:00'
WHERE created_time GLOB '????-??-?? ??:??:??*'
  AND substr(created_time, -6, 1) NOT IN ('+', '-') AND upper(substr(created_time, -1)) != 'Z';

UPDATE tool_usage SET created_time = created_time || '+07:00'
WHERE created_time GLOB '????-??-?? ??:??:??*'
  AND substr(created_time, -6, 1) NOT IN ('+', '-') AND upper(substr(created_time, -1)) != 'Z';

DROP TABLE IF EXISTS daily_usage;
DROP TABLE IF EXISTS user_usage;
