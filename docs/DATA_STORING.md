# DATA_STORING.md

AD Tools uses a local-first strategy with Cloudflare D1 as the durable backup. The client records usage and events in `localStorage` and periodically syncs to D1 via an hourly batch endpoint. All timestamps include an explicit GMT+7 suffix.

## Timestamp Policy
- Canonical timestamp format: `YYYY-MM-DD HH:MM:SS+07:00`.
- Day dimension format: `YYYY-MM-DD`.
- Client helpers should generate GMT+7 strings at capture time; the server persists them as-is.

## D1 Tables

### users
- `id` TEXT PRIMARY KEY (UUID v4)
- `email` TEXT UNIQUE NOT NULL
- `created_time` TEXT NOT NULL (`YYYY-MM-DD HH:MM:SS+07:00`)
- `last_seen` TEXT NOT NULL (`YYYY-MM-DD HH:MM:SS+07:00`)

Example upsert:
```
INSERT INTO users(id, email, created_time, last_seen)
VALUES (?, ?, ?, ?)
ON CONFLICT(email) DO UPDATE SET
  last_seen = excluded.last_seen;
```

### device
- `device_id` TEXT PRIMARY KEY
- `user_id` TEXT NOT NULL REFERENCES users(id)
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
- Purpose: daily usage totals per feature, not bound to a user.
- `day` TEXT NOT NULL (`YYYY-MM-DD`)
- `tool_id` TEXT NOT NULL
- `action` TEXT NOT NULL
- `count` INTEGER NOT NULL DEFAULT 0
- `updated_time` TEXT NOT NULL (`YYYY-MM-DD HH:MM:SS+07:00`)

Primary key and indexes:
- `PRIMARY KEY(day, tool_id, action)`
- `CREATE INDEX idx_daily_usage_tool_day ON daily_usage(tool_id, day);`

Upsert increment:
```
INSERT INTO daily_usage(day, tool_id, action, count, updated_time)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(day, tool_id, action) DO UPDATE SET
  count = daily_usage.count + excluded.count,
  updated_time = excluded.updated_time;
```

### user_usage
- Purpose: cumulative usage totals per user and feature across devices.
- `user_id` TEXT NOT NULL REFERENCES users(id)
- `tool_id` TEXT NOT NULL
- `count` INTEGER NOT NULL DEFAULT 0
- `updated_time` TEXT NOT NULL (`YYYY-MM-DD HH:MM:SS+07:00`)

Primary key and indexes:
- `PRIMARY KEY(user_id, tool_id)`
- Optional index: `CREATE INDEX idx_user_usage_tool ON user_usage(tool_id);`

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
  - `ad.daily_usage.queue`: array of usage objects `{ day, tool_id, action, count, updated_time }`.
  - `ad.user_usage.queue`: array of usage objects `{ user_id, tool_id, count, updated_time }`.
  - Quick Query storage (schema/data separated):
    - `tool:quick-query:schema`: JSON object using the new schema model (see `app/tools/quick-query/new_data_model_schema.json`). Example:
```
{
  "inhouse_forex": {
    "tables": {
      "rate_tiering": {
        "last_updated": "2025-11-04T08:55:00.000Z",
        "columns": {
          "RATE_TIERING_ID": { "type": "VARCHAR2(36)", "nullable": "No" },
          "CURRENCY_ISO_CODE": { "type": "VARCHAR2(10)", "nullable": "No" },
          "MIN_AMOUNT": { "type": "NUMBER(20,2)", "nullable": "Yes" },
          "MAX_AMOUNT": { "type": "NUMBER(20,2)", "nullable": "Yes" },
          "TIERING_GROUP": { "type": "VARCHAR2(36)", "nullable": "No" }
        },
        "pk": ["RATE_TIERING_ID", "CURRENCY_ISO_CODE", "TIERING_GROUP"],
        "unique": []
      }
    }
  }
}
```
    - `tool:quick-query:data`: JSON object using the new data model (see `app/tools/quick-query/new_data_model_data.json`). Example:
```
{
  "inhouse_forex": {
    "rate_tiering": {
      "last_updated": "2025-11-04T08:55:00.000Z",
      "rows": [
        {
          "RATE_TIERING_ID": "RT-UUID-001",
          "CURRENCY_ISO_CODE": "USD",
          "MIN_AMOUNT": "0",
          "MAX_AMOUNT": "10000",
          "TIERING_GROUP": "RETAIL"
        }
      ]
    }
  }
}
```
  - Notes: schema and data keys are written independently; if storage quota is exceeded, writes fail gracefully and are tracked via `UsageTracker`.
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
      "tool_id": "quick-query",
      "action": "run",
      "count": 12,
      "updated_time": "2025-11-03 11:00:00+07:00"
    }
  ],
  "user_usage": [
    {
      "user_id": "uuid-user-...",
      "tool_id": "quick-query",
      "count": 120,
      "updated_time": "2025-11-03 11:00:00+07:00"
    }
  ]
}
```
- Response:
```
{
  "ok": true,
  "inserted": {"events": 10, "daily_usage": 3, "user_usage": 2},
  "deduplicated": {"events": 2}
}
```
- Server behavior:
  - Validate payload sizes and sanitize `properties`.
  - Wrap inserts in a transaction.
  - `events`: simple inserts using `created_time`.
  - `daily_usage`: upsert increment using `(day, tool_id, action)`.
  - `user_usage`: upsert increment using `(user_id, tool_id)`.

## Indexing Guidance
- `daily_usage(day, tool_id, action)` composite primary key for fast upserts.
- Additional read indexes:
  - `idx_daily_usage_tool_day(tool_id, day)` for daily tool summaries.
  - `idx_user_usage_tool(tool_id)` for per-feature user totals.
- `idx_events_device_time(device_id, created_time)` for device timelines.
- `idx_events_feature_action_time(feature_id, action, created_time)` for feature/action trend queries.

## Privacy and Content Hygiene
- `properties` must be JSON and free from PII.
- Define an allowlist of keys per feature/tool; reject unexpected keys server-side.
- Enforce size limits for `properties` and total batch size.

## Failure Handling
- On D1 outages, queue remains client-side and retries on next flush.
- Optionally, use KV as a temporary buffer with a TTL, then reconcile to D1 when healthy.

### Quick Query Storage Failure Handling
- Missing/Corrupted schema/data: the app treats missing keys or invalid JSON as empty stores and records a `storage_error` event.
- Quota exceeded: write operations catch `QuotaExceededError` and return `false` without throwing; UI shows an error message.

## Alignment With Implementation
- This document adopts GMT+7 suffix timestamps and introduces `events.created_time` and `daily_usage.day` as explicit time dimensions.
- Registration and device linkage are upsert-based to avoid races.
- Users have UUID v4 IDs; relationships use `TEXT` foreign keys.
- The batch endpoint contract supports hourly and lifecycle-based flushes with idempotency.
 - Quick Query tool stores schema and data separately under `tool:quick-query:schema` and `tool:quick-query:data`, with UI conversions handled transparently.