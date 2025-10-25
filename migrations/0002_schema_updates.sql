-- Migration: schema updates for Users, User_Installs, and OTPs
-- Note: Transactions are managed by D1 migration runner; do not include BEGIN/COMMIT here.

-- 1) Users: remove email_hash, keep readable timestamps (TEXT)
CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  display_name TEXT,
  created_at TEXT,
  last_seen TEXT
);
INSERT INTO users_new (id, email, display_name, created_at, last_seen)
SELECT id, email, display_name, created_at, last_seen FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- 2) User_Installs: add platform and browser columns
ALTER TABLE user_installs ADD COLUMN platform TEXT;
ALTER TABLE user_installs ADD COLUMN browser TEXT;

-- 3) OTPs: convert timestamps to readable TEXT in GMT+7
CREATE TABLE otps_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);
INSERT INTO otps_new (id, email, code, expires_at, consumed_at, created_at)
SELECT
  id,
  email,
  code,
  CASE
    WHEN typeof(expires_at) = 'text' THEN expires_at
    ELSE strftime('%Y-%m-%dT%H:%M:%f', expires_at/1000, 'unixepoch', '+7 hours') || '+07:00'
  END,
  CASE
    WHEN consumed_at IS NULL THEN NULL
    WHEN typeof(consumed_at) = 'text' THEN consumed_at
    ELSE strftime('%Y-%m-%dT%H:%M:%f', consumed_at/1000, 'unixepoch', '+7 hours') || '+07:00'
  END,
  CASE
    WHEN typeof(created_at) = 'text' THEN created_at
    ELSE strftime('%Y-%m-%dT%H:%M:%f', created_at/1000, 'unixepoch', '+7 hours') || '+07:00'
  END
FROM otps;
DROP TABLE otps;
ALTER TABLE otps_new RENAME TO otps;

-- Indexes for otps
CREATE INDEX IF NOT EXISTS idx_otps_email ON otps(email);
CREATE INDEX IF NOT EXISTS idx_otps_email_code ON otps(email, code);