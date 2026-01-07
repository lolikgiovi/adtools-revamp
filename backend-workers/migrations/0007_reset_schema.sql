-- Reset schema to align with docs/DATA_STORING.md
PRAGMA foreign_keys = ON;

-- Drop legacy/old tables if exist
DROP TABLE IF EXISTS user_device;
DROP TABLE IF EXISTS user_installs;
DROP TABLE IF EXISTS counts_daily;
DROP TABLE IF EXISTS otps;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS device;
DROP TABLE IF EXISTS daily_usage;
DROP TABLE IF EXISTS otp;

-- users
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  created_time TEXT NOT NULL,
  last_seen TEXT NOT NULL
);

-- device
CREATE TABLE device (
  device_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  platform TEXT NULL,
  created_time TEXT NOT NULL,
  last_seen TEXT NOT NULL
);

-- events
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL REFERENCES device(device_id),
  feature_id TEXT NOT NULL,
  action TEXT NOT NULL,
  properties TEXT NOT NULL,
  created_time TEXT NOT NULL
);
CREATE INDEX idx_events_device_time ON events(device_id, created_time DESC);
CREATE INDEX idx_events_feature_action_time ON events(feature_id, action, created_time);

-- daily_usage
CREATE TABLE daily_usage (
  day TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  tool_id TEXT NOT NULL,
  action TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_time TEXT NOT NULL,
  PRIMARY KEY (day, user_id, tool_id, action)
);
CREATE INDEX idx_daily_usage_tool_day ON daily_usage(tool_id, day);

-- otp
CREATE TABLE otp (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT NULL
);
CREATE INDEX idx_otp_email_expiry ON otp(email, expires_at);