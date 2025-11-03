-- 0008_users_id_to_text.sql
-- Migrate users.id from INTEGER to TEXT UUID and update references.
PRAGMA foreign_keys = ON;

-- Recreate users with TEXT primary key
CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  created_time TEXT NOT NULL,
  last_seen TEXT NOT NULL
);

-- Copy existing users, casting id to TEXT
INSERT INTO users_new (id, email, created_time, last_seen)
SELECT CAST(id AS TEXT), email, created_time, last_seen FROM users;

-- Replace old users table
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- Recreate device with user_id TEXT
CREATE TABLE device_new (
  device_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  platform TEXT NULL,
  created_time TEXT NOT NULL,
  last_seen TEXT NOT NULL
);
INSERT INTO device_new (device_id, user_id, platform, created_time, last_seen)
SELECT device_id, CAST(user_id AS TEXT), platform, created_time, last_seen FROM device;
DROP TABLE device;
ALTER TABLE device_new RENAME TO device;

-- Recreate daily_usage with user_id TEXT
CREATE TABLE daily_usage_new (
  day TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  tool_id TEXT NOT NULL,
  action TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_time TEXT NOT NULL,
  PRIMARY KEY (day, user_id, tool_id, action)
);
INSERT INTO daily_usage_new (day, user_id, tool_id, action, count, updated_time)
SELECT day, CAST(user_id AS TEXT), tool_id, action, count, updated_time FROM daily_usage;
DROP TABLE daily_usage;
ALTER TABLE daily_usage_new RENAME TO daily_usage;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_daily_usage_tool_day ON daily_usage(tool_id, day);