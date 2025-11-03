-- 0009_usage_restructure.sql
-- Restructure usage: daily_usage without user_id and add user_usage totals.
PRAGMA foreign_keys = ON;

-- Create user_usage and backfill from existing daily_usage (before reshape)
CREATE TABLE IF NOT EXISTS user_usage (
  user_id TEXT NOT NULL REFERENCES users(id),
  tool_id TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_time TEXT NOT NULL,
  PRIMARY KEY (user_id, tool_id)
);

-- Backfill user_usage from current daily_usage if present
INSERT INTO user_usage (user_id, tool_id, count, updated_time)
SELECT user_id, tool_id, SUM(count) AS count, MAX(updated_time) AS updated_time
FROM daily_usage
GROUP BY user_id, tool_id;

-- Reshape daily_usage: drop user_id dimension
CREATE TABLE daily_usage_new (
  day TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  action TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_time TEXT NOT NULL,
  PRIMARY KEY (day, tool_id, action)
);

-- Aggregate existing daily_usage into new table
INSERT INTO daily_usage_new (day, tool_id, action, count, updated_time)
SELECT day, tool_id, action, SUM(count) AS count, MAX(updated_time) AS updated_time
FROM daily_usage
GROUP BY day, tool_id, action;

-- Replace old daily_usage
DROP TABLE daily_usage;
ALTER TABLE daily_usage_new RENAME TO daily_usage;

-- Recreate index
CREATE INDEX IF NOT EXISTS idx_daily_usage_tool_day ON daily_usage(tool_id, day);