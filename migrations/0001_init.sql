-- D1 schema for AD Tools analytics and registration

-- Users: optional PII with hashed linkage
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  email_hash TEXT,
  display_name TEXT,
  created_at TEXT,
  last_seen TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_email_hash ON users(email_hash);

-- OTP codes for email verification
CREATE TABLE IF NOT EXISTS otps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_otps_email ON otps(email);
CREATE INDEX IF NOT EXISTS idx_otps_email_code ON otps(email, code);

-- Installation linkage (pseudonymous install_id -> user)
CREATE TABLE IF NOT EXISTS user_installs (
  user_id TEXT NOT NULL,
  install_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, install_id)
);
CREATE INDEX IF NOT EXISTS idx_installs_install_id ON user_installs(install_id);

-- Raw events for analytics (queryable)
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  install_id TEXT,
  user_id TEXT,
  feature_id TEXT NOT NULL,
  action TEXT NOT NULL,
  ts TEXT NOT NULL,
  meta TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_feature_action ON events(feature_id, action);
CREATE INDEX IF NOT EXISTS idx_events_install ON events(install_id);

-- Pre-aggregated daily counts (fast dashboards)
CREATE TABLE IF NOT EXISTS counts_daily (
  day TEXT NOT NULL,
  feature_id TEXT NOT NULL,
  action TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, feature_id, action)
);