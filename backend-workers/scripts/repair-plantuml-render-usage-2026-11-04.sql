-- Collapse PlantUML 'render' uses to one per user, device and Jakarta day.
-- Clients before 8cc7175e logged a render on every typing pause, file switch and resume.
-- Rows carry no file id, so per-file view/edit counts cannot be rebuilt; one use per day is the honest floor.
-- Idempotent: re-run after the force update lands to clear renders logged by clients still on the old build.
-- created_time is stored as 'YYYY-MM-DD HH:MM:SS+07:00', so the first 10 characters are the Jakarta date.

-- Dry run:
-- SELECT COUNT(*) FROM tool_usage
-- WHERE tool_id = 'plantuml' AND action = 'render' AND source = 'client'
--   AND id NOT IN (
--     SELECT MIN(id) FROM tool_usage
--     WHERE tool_id = 'plantuml' AND action = 'render' AND source = 'client'
--     GROUP BY user_email, device_id, SUBSTR(created_time, 1, 10)
--   );

DELETE FROM tool_usage
WHERE tool_id = 'plantuml' AND action = 'render' AND source = 'client'
  AND id NOT IN (
    SELECT MIN(id) FROM tool_usage
    WHERE tool_id = 'plantuml' AND action = 'render' AND source = 'client'
    GROUP BY user_email, device_id, SUBSTR(created_time, 1, 10)
  );
