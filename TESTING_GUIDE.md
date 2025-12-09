# Testing Guide for Device Usage & Live Logging

## Prerequisites

Make sure your Tauri dev server is running:
```bash
npx tauri dev
```

## Step 1: Run Database Migrations

Apply both new migrations to your local D1 database:

```bash
# Create a local D1 database if you don't have one
wrangler d1 create ad-tools-local

# Run the migrations
wrangler d1 execute ad-tools-local --local --file=migrations/0010_device_usage_table.sql
wrangler d1 execute ad-tools-local --local --file=migrations/0011_usage_log_table.sql
```

## Step 2: Configure Wrangler for Local Testing

Open `wrangler.toml` and ensure you have:

```toml
# Add to your existing config
[vars]
SEND_LIVE_USER_LOG = "true"  # Enable live logging for testing

[[d1_databases]]
binding = "DB"
database_name = "ad-tools-local"
database_id = "your-database-id"
```

## Step 3: Start Local Cloudflare Worker

In a new terminal:

```bash
# Start the worker in dev mode
wrangler dev --local --persist
```

This will start the worker on `http://localhost:8787` (or similar).

## Step 4: Configure Client to Use Local Worker

In your browser DevTools console (while app is running):

```javascript
// Point analytics to local worker
localStorage.setItem('config.analytics.endpoint', 'http://localhost:8787');

// Set a test email
localStorage.setItem('user.email', 'test@example.com');

// Verify settings
console.log('Endpoint:', localStorage.getItem('config.analytics.endpoint'));
console.log('Email:', localStorage.getItem('user.email'));
```

## Step 5: Test Device Usage Tracking

In DevTools console:

```javascript
// Import tracker
import { UsageTracker } from './app/core/UsageTracker.js';

// Track some events
UsageTracker.trackEvent('quick-query', 'run');
UsageTracker.trackEvent('quick-query', 'run');
UsageTracker.trackEvent('quick-query', 'merge');
UsageTracker.trackEvent('base64-tools', 'encode');

// Check local counts
console.log('Local counts:', UsageTracker.getCounts());

// Force flush to server
await UsageTracker._flushBatch();
console.log('Batch flushed!');
```

## Step 6: Verify Data in D1

Check what was inserted:

```bash
# Check device_usage table
wrangler d1 execute ad-tools-local --local --command="SELECT * FROM device_usage ORDER BY updated_time DESC LIMIT 10;"

# Check usage_log table (live logging)
wrangler d1 execute ad-tools-local --local --command="SELECT * FROM usage_log ORDER BY created_time DESC LIMIT 10;"
```

Expected results:
- **device_usage**: Should show absolute counts (e.g., `quick-query.run = 2`)
- **usage_log**: Should show individual log entries (one per `trackEvent()` call)

## Step 7: Test Live Logging Endpoint Directly

Test the `/analytics/log` endpoint with curl:

```bash
curl -X POST http://localhost:8787/analytics/log \
  -H "Content-Type: application/json" \
  -d '{
    "user_email": "test@example.com",
    "tool_id": "quick-query",
    "action": "test-action",
    "created_time": "2025-12-09 21:30:00+07:00"
  }'
```

Expected response:
```json
{"ok": true, "inserted": 1}
```

## Step 8: Test with Live Logging Disabled

Edit `wrangler.toml`:
```toml
[vars]
SEND_LIVE_USER_LOG = "false"  # Disable
```

Restart `wrangler dev`, then try the curl command again.

Expected response:
```json
{"ok": false, "message": "Live logging disabled"}
```

## Step 9: Test Idempotency

Test that device_usage counts don't double:

```javascript
// Track events
UsageTracker.trackEvent('test-tool', 'action1');
UsageTracker.trackEvent('test-tool', 'action1');
UsageTracker.trackEvent('test-tool', 'action1');

// Flush twice
await UsageTracker._flushBatch();
await UsageTracker._flushBatch();

// Check database - should show count=3, not count=6
```

```bash
wrangler d1 execute ad-tools-local --local --command="SELECT * FROM device_usage WHERE tool_id='test-tool';"
```

## Step 10: Verify in Network Tab

Open DevTools Network tab and track an event:

```javascript
UsageTracker.trackEvent('network-test', 'action');
```

You should see **2 requests**:
1. `POST /analytics/log` (immediate, if live logging enabled)
2. `POST /analytics/batch` (on next hourly flush or manual flush)

## Troubleshooting

### Live logging not working?

Check worker logs:
```bash
# Watch worker logs in real-time
wrangler dev --local --persist
```

### Database not found?

Make sure you created the local D1 database and ran migrations.

### CORS errors?

The worker should already have CORS headers. Check `corsHeaders()` function in `worker.js`.

### Client not sending to local worker?

Verify the endpoint:
```javascript
localStorage.getItem('config.analytics.endpoint'); // Should be 'http://localhost:8787'
```

## Clean Up After Testing

```javascript
// Reset to production
localStorage.removeItem('config.analytics.endpoint');

// Clear test data
UsageTracker.clearStorage();
```

## Next Steps

Once local testing passes:
1. Deploy worker: `wrangler deploy`
2. Run migrations on production D1
3. Set production env var: `wrangler secret put SEND_LIVE_USER_LOG`
4. Monitor production logs
