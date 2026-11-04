-- Data patch for three analytics defects found in production data on 2026-11-05.
-- 1. BehaviorTracker logged a window-hidden pause as page_leave {reason: "hidden"}. Those rows are pauses, not leaves:
--    relabel them page_hidden (the action the tracker now sends) and drop the reason that no longer applies.
-- 2. users.last_seen was only written at sign-in. Backfill it from the latest of device check-in, tool use, and events,
--    comparing Jakarta wall time (the first 19 characters) so offset-free legacy values order correctly, and store
--    the result with the explicit +07:00 offset. It never moves backwards.
-- 3. Window-hidden noise and Monaco/ResizeObserver errors are no longer stored; existing rows are kept as history.

UPDATE events
SET action = 'page_hidden', properties = json_remove(properties, '$.reason')
WHERE action = 'page_leave' AND json_valid(properties) AND json_extract(properties, '$.reason') = 'hidden';

UPDATE users
SET last_seen = (
  SELECT max(seen) || '+07:00' FROM (
    SELECT substr(users.last_seen, 1, 19) AS seen
    UNION ALL SELECT substr(max(d.last_seen), 1, 19) FROM device d WHERE d.user_id = users.id
    UNION ALL SELECT substr(max(t.created_time), 1, 19) FROM tool_usage t WHERE t.user_email = users.email
    UNION ALL SELECT substr(max(e.created_time), 1, 19) FROM events e JOIN device d ON d.device_id = e.device_id WHERE d.user_id = users.id
  )
);
