CREATE TABLE settings_publications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL UNIQUE,
  audience_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  target_json TEXT NOT NULL,
  settings_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  revoked_at TEXT
);
CREATE TABLE settings_recipients (
  publication_id INTEGER NOT NULL REFERENCES settings_publications(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (publication_id, user_id)
);
CREATE INDEX settings_recipients_user ON settings_recipients(user_id, publication_id);
CREATE TABLE settings_devices (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  device_id TEXT NOT NULL REFERENCES device(device_id),
  expires_at INTEGER NOT NULL,
  UNIQUE(user_id, device_id)
);
CREATE TABLE settings_deliveries (
  publication_id INTEGER NOT NULL REFERENCES settings_publications(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  device_id TEXT NOT NULL REFERENCES device(device_id),
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (publication_id, user_id, device_id)
);
