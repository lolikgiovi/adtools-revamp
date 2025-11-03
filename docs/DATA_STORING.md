# DATA_STORING.md

AD Tools uses a local-first strategy with Cloudflare D1 as the durable backup. The client records usage and events in `localStorage` and periodically syncs to D1 via an hourly batch endpoint. All timestamps include an explicit GMT+7 suffix.

## Timestamp Policy
- Canonical timestamp format: `YYYY-MM-DD HH:MM:SS+07:00`.
- Day dimension format: `YYYY-MM-DD`.
- Client helpers should generate GMT+7 strings at capture time; the server persists them as-is.

## D1 Tables

### users
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `email` TEXT UNIQUE NOT NULL
- `created_time` TEXT NOT NULL (`YYYY-MM-DD HH:MM:SS+07:00`)
- `last_seen` TEXT NOT NULL (`YYYY-MM-DD HH:MM:SS+07:00`)

Example upsert:
```
INSERT INTO users(email, created_time, last_seen)
VALUES (?, ?, ?)
ON CONFLICT(email) DO UPDATE SET
  last_seen = excluded.last_seen;
```

### device
- `device_id` TEXT PRIMARY KEY
- `user_id` INTEGER NOT NULL REFERENCES users(id)
- `platform` TEXT NULL (e.g., `web`, `tauri`)
- `created_time` TEXT NOT NULL (`YYYY-MM-DD HH:MM:SS+07:00`)
- `last_seen` TEXT NOT NULL (`YYYY-MM-DD HH:MM:SS+07:00`)

Example upsert:
```
INSERT INTO device(device_id, user_id, platform, created_time, last_seen)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(device_id) DO UPDATE SET
  user_id = excluded.user_id,
  platform = excluded.platform,
  last_seen = excluded.last_seen;
```

### events
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `device_id` TEXT NOT NULL REFERENCES device(device_id)
- `feature_id` TEXT NOT NULL
- `action` TEXT NOT NULL
- `properties` TEXT NOT NULL (JSON string, sanitized, no PII)
- `created_time` TEXT NOT NULL (`YYYY-MM-DD HH:MM:SS+07:00`)

Recommended indexes:
- `CREATE INDEX idx_events_device_time ON events(device_id, created_time DESC);`
- `CREATE INDEX idx_events_feature_action_time ON events(feature_id, action, created_time);`

### daily_usage
- `day` TEXT NOT NULL (`YYYY-MM-DD`)
- `user_id` INTEGER NOT NULL REFERENCES users(id)
- `tool_id` TEXT NOT NULL
- `action` TEXT NOT NULL
- `count` INTEGER NOT NULL DEFAULT 0
- `updated_time` TEXT NOT NULL (`YYYY-MM-DD HH:MM:SS+07:00`)

Primary key and indexes:
- `PRIMARY KEY(day, user_id, tool_id, action)`
- `CREATE INDEX idx_daily_usage_tool_day ON daily_usage(tool_id, day);`

Upsert increment:
```
INSERT INTO daily_usage(day, user_id, tool_id, action, count, updated_time)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(day, user_id, tool_id, action) DO UPDATE SET
  count = daily_usage.count + excluded.count,
  updated_time = excluded.updated_time;
```

### otp
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `email` TEXT NOT NULL
- `code` TEXT NOT NULL
- `expires_at` TEXT NOT NULL (`YYYY-MM-DD HH:MM:SS+07:00`)
- `consumed_at` TEXT NULL (`YYYY-MM-DD HH:MM:SS+07:00`)

Recommended indexes:
- `CREATE INDEX idx_otp_email_expiry ON otp(email, expires_at);`

## Device Identity Source
- `device_id` is client-generated (e.g., `uuidv4()`), persisted in `localStorage` under a stable key (e.g., `ad.device.id`).
- The value is created once on first run and reused across sessions and syncs.

## Registration Flow (Race-safe)
1. Client obtains OTP and verifies email.
2. Upsert `users` by `email` using `ON CONFLICT(email) DO UPDATE` to avoid races.
3. Upsert `device` by `device_id` using `ON CONFLICT(device_id) DO UPDATE` to link to the user and refresh `last_seen`.
4. Record `consumed_at` in `otp` when verification succeeds.

Notes:
- Wrap `users`, `device`, and `otp` writes in a transaction for atomicity.
- Avoid "check then insert" patterns; rely on upsert semantics as shown.

## Client Storage and Flush Policy
- Local queues in `localStorage`:
  - `ad.events.queue`: array of event objects `{ device_id, feature_id, action, properties, created_time }`.
  - `ad.daily_usage.queue`: array of usage objects `{ day, user_id, tool_id, action, count, updated_time }`.
- Flush triggers:
  - Hourly timer (primary cadence).
  - Lifecycle: `visibilitychange`, `beforeunload`, and `online` events.
  - Volume threshold (e.g., 200 events) to keep queues bounded.
- Queue limits:
  - Max ~1000 events or ~256KB payload; evict oldest on overflow.
  - Bound `properties` size (e.g., ≤4KB) and keep to a whitelisted schema.

## Hourly Batch Endpoint Design
- Path: `POST /analytics/batch`
- Auth: optional bearer token or device fingerprint header (e.g., `X-Device-Id`).
- Idempotency:
  - Include `batch_id` (UUID) and optional per-event `event_id`.
  - Server deduplicates on `(event_id)` if provided; otherwise, accepts all.
- Request body:
```
{
  "batch_id": "uuid-...",
  "device_id": "uuid-...",
  "events": [
    {
      "event_id": "uuid-...",
      "feature_id": "quick-query",
      "action": "run",
      "properties": {"success": true},
      "created_time": "2025-11-03 10:30:12+07:00"
    }
  ],
  "daily_usage": [
    {
      "day": "2025-11-03",
      "user_id": 42,
      "tool_id": "quick-query",
      "action": "run",
      "count": 12,
      "updated_time": "2025-11-03 11:00:00+07:00"
    }
  ]
}
```
- Response:
```
{
  "ok": true,
  "inserted": {"events": 10, "daily_usage": 3},
  "deduplicated": {"events": 2}
}
```
- Server behavior:
  - Validate payload sizes and sanitize `properties`.
  - Wrap inserts in a transaction.
  - `events`: simple inserts using `created_time`.
  - `daily_usage`: upsert increment using the composite PK.

## Indexing Guidance
- `daily_usage(day, user_id, tool_id, action)` composite primary key for fast upserts.
- Additional read indexes:
  - `idx_daily_usage_tool_day(tool_id, day)` for daily tool summaries.
  - `idx_events_device_time(device_id, created_time)` for device timelines.
  - `idx_events_feature_action_time(feature_id, action, created_time)` for feature/action trend queries.

## Privacy and Content Hygiene
- `properties` must be JSON and free from PII.
- Define an allowlist of keys per feature/tool; reject unexpected keys server-side.
- Enforce size limits for `properties` and total batch size.

## Failure Handling
- On D1 outages, queue remains client-side and retries on next flush.
- Optionally, use KV as a temporary buffer with a TTL, then reconcile to D1 when healthy.

## Alignment With Implementation
- This document adopts GMT+7 suffix timestamps and introduces `events.created_time` and `daily_usage.day` as explicit time dimensions.
- Registration and device linkage are upsert-based to avoid races.
- The batch endpoint contract supports hourly and lifecycle-based flushes with idempotency.