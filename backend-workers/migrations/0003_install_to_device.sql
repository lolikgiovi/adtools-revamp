-- Rename user_installs -> user_device and install_id -> device_id
-- Also rename events.install_id -> events.device_id

-- 1) Create new user_device table and migrate data
CREATE TABLE user_device (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  platform TEXT,
  browser TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, device_id)
);
INSERT INTO user_device (user_id, device_id, platform, browser, created_at)
SELECT user_id, install_id, platform, browser, created_at FROM user_installs;
DROP TABLE user_installs;

-- 2) Create new events table with device_id and migrate data
CREATE TABLE events_new (
  id TEXT PRIMARY KEY,
  device_id TEXT,
  user_id TEXT,
  feature_id TEXT NOT NULL,
  action TEXT NOT NULL,
  ts TEXT NOT NULL,
  meta TEXT
);
INSERT INTO events_new (id, device_id, user_id, feature_id, action, ts, meta)
SELECT id, install_id, user_id, feature_id, action, ts, meta FROM events;
DROP TABLE events;
ALTER TABLE events_new RENAME TO events;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_feature_action ON events(feature_id, action);
CREATE INDEX IF NOT EXISTS idx_events_device ON events(device_id);