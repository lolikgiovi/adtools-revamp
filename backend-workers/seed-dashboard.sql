-- Seed script for local D1 database testing
-- Run with: npx wrangler d1 execute adtools --local --file=seed-dashboard.sql

-- Insert test users
INSERT OR IGNORE INTO users (id, email, created_time, last_seen) VALUES
  (1, 'john.doe@bankmandiri.co.id', '2026-01-01 09:00:00', '2026-01-05 16:00:00'),
  (2, 'jane.smith@bankmandiri.co.id', '2026-01-02 10:00:00', '2026-01-05 15:30:00'),
  (3, 'alex.wong@bankmandiri.co.id', '2026-01-03 08:30:00', '2026-01-05 14:00:00');

-- Insert test devices
INSERT OR IGNORE INTO device (device_id, user_id, platform, created_time, last_seen) VALUES
  ('device-001', 1, 'macos', '2026-01-01 09:00:00', '2026-01-05 16:00:00'),
  ('device-002', 1, 'web', '2026-01-01 09:30:00', '2026-01-05 15:00:00'),
  ('device-003', 2, 'macos', '2026-01-02 10:00:00', '2026-01-05 15:30:00'),
  ('device-004', 3, 'windows', '2026-01-03 08:30:00', '2026-01-05 14:00:00');

-- Insert device_usage stats
INSERT OR REPLACE INTO device_usage (device_id, user_email, tool_id, action, count, updated_time) VALUES
  ('device-001', 'john.doe@bankmandiri.co.id', 'json-tools', 'minify', 42, '2026-01-05 16:00:00'),
  ('device-001', 'john.doe@bankmandiri.co.id', 'json-tools', 'beautify', 35, '2026-01-05 15:30:00'),
  ('device-001', 'john.doe@bankmandiri.co.id', 'quick-query', 'generate', 28, '2026-01-05 14:00:00'),
  ('device-002', 'john.doe@bankmandiri.co.id', 'base64-tools', 'encode', 20, '2026-01-05 15:00:00'),
  ('device-003', 'jane.smith@bankmandiri.co.id', 'sql-in-clause', 'convert', 55, '2026-01-05 15:30:00'),
  ('device-003', 'jane.smith@bankmandiri.co.id', 'json-tools', 'minify', 30, '2026-01-05 14:30:00'),
  ('device-004', 'alex.wong@bankmandiri.co.id', 'uuid-generator', 'generate', 100, '2026-01-05 14:00:00'),
  ('device-004', 'alex.wong@bankmandiri.co.id', 'qr-tools', 'generate', 15, '2026-01-05 13:00:00');

-- Insert usage_log (today's activity)
INSERT INTO usage_log (user_email, device_id, tool_id, action, created_time) VALUES
  ('john.doe@bankmandiri.co.id', 'device-001', 'json-tools', 'minify', datetime('now', '-2 hours')),
  ('john.doe@bankmandiri.co.id', 'device-001', 'json-tools', 'beautify', datetime('now', '-1 hours')),
  ('jane.smith@bankmandiri.co.id', 'device-003', 'sql-in-clause', 'convert', datetime('now', '-30 minutes')),
  ('alex.wong@bankmandiri.co.id', 'device-004', 'uuid-generator', 'generate', datetime('now', '-15 minutes'));

-- Insert events with various feature_ids
INSERT INTO events (device_id, feature_id, action, properties, created_time) VALUES
  ('device-001', 'json-tools', 'minify', '{"inputSize": 1024, "outputSize": 512}', datetime('now', '-2 hours')),
  ('device-001', 'json-tools', 'beautify', '{"inputSize": 512, "outputSize": 1024}', datetime('now', '-1 hours')),
  ('device-003', 'quick-query', 'query_generated', '{"queryType": "SELECT", "tableName": "customers", "rowCount": 150, "hasAttachment": false}', datetime('now', '-45 minutes')),
  ('device-003', 'quick-query', 'query_generated', '{"queryType": "INSERT", "tableName": "orders", "rowCount": 25, "hasAttachment": true}', datetime('now', '-30 minutes')),
  ('device-004', 'quick-query', 'query_generated', '{"queryType": "UPDATE", "tableName": "products", "rowCount": 10, "hasAttachment": false}', datetime('now', '-20 minutes')),
  ('device-001', 'quick-query', 'validation_error', '{"tableName": "users", "fieldName": "email", "type": "invalid_format"}', datetime('now', '-50 minutes')),
  ('device-002', 'quick-query', 'parsing_error', '{"tableName": "transactions", "fieldName": "amount", "type": "type_mismatch"}', datetime('now', '-40 minutes')),
  ('device-004', 'uuid-generator', 'generate', '{"version": 4, "count": 10}', datetime('now', '-15 minutes')),
  ('device-003', 'sql-in-clause', 'convert', '{"itemCount": 50}', datetime('now', '-25 minutes'));
