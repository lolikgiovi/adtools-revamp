# Analytics timestamp verification

Verified locally on 2026-10-29 using the real client batch serializer, analytics ingestion handler,
a migrated SQLite database, and authenticated dashboard report handlers.

## Reproduce

```bash
TZ=UTC ./node_modules/.bin/vitest run backend-workers/tests/analytics-timestamps.test.js
TZ=Asia/Jakarta ./node_modules/.bin/vitest run backend-workers/tests/analytics-timestamps.test.js
```

Before the fix, the UTC run failed: a client activity at 10:00 Jakarta appeared at 17:00,
and an activity at 23:30 appeared at 06:30 the next day. Explicit UTC and offset timestamps
were already correct. Both commands pass after the fix. The fixture also retries ingestion
and verifies that four events remain four rows.

The client serializes tool uses as Jakarta wall time without an offset. The server previously
parsed that value in its own timezone before converting it to Jakarta, adding another seven
hours when running in UTC. The parser now explicitly treats legacy wall time as Jakarta time
and continues to respect explicit offsets.

Related verification: 54 tests passed with this command:

```bash
TZ=UTC ./node_modules/.bin/vitest run backend-workers/tests/analytics-timestamps.test.js \
  backend-workers/tests/analytics-count-integrity.test.js backend-workers/tests/analytics.test.js \
  backend-workers/tests/dashboard-ordering.test.js frontend/core/tests/usage-tracker.test.js
```

## Production deployment and repair

Deployed on 2026-10-29 to `adtools` at 100% traffic:
`14d43769-a6a1-417e-bd5b-5d41eb17b434`.
Previous version: `f89e7e64-c49e-4d96-a33c-89f70997bdf4`.

Wrangler dry-run built the backend bundle. The Cloudflare versions API uploaded it with
`keep_assets: true`, production's existing bindings, and preserved secrets; Wrangler versions
deploy activated it. Production's downloaded bundle exactly matches the local checked bundle.
Bindings, compatibility date, and observability settings were verified unchanged. `/` returns
200, `/dashboard/tabs` correctly returns 401 without authorization, and `/web-build.json`
retains build `20261027030035`. Static assets were not rebuilt or uploaded.

The separate `events` stream corroborated the corrected second for 3,365 of 7,876 client-ledger
rows. None of those matched an event at their existing wall time. The repair is limited to
client-ledger IDs through 34641, captured before deployment. It leaves 4,511 uncorroborated rows
unchanged, plus all historical projection rows and new ingestion.

Applied `backend-workers/scripts/repair-analytics-timestamps-2026-10-29.sql` to production D1.
It records original and corrected timestamps and corroborating event IDs in
`analytics_timestamp_repair_20261029` before updating the ledger. Remote verification found:

- 3,365 audited rows; all 3,365 have their corrected timestamp.
- 891 corrected rows move to the previous calendar date.
- The pre-deployment ledger retains 34,057 rows: 7,876 client, 13,463 historical event,
  and 12,718 historical usage-log rows.

Before applying the repair, the entire usage table was exported. A local rehearsal against
all 34,057 backed-up rows and the matching event evidence changed exactly the selected rows,
preserved every other field, and verified a rerun made no further changes. Private backups
are retained in the Git-ignored `.wrangler/backups/analytics-timestamps-2026-10-29/` directory.
The remote audit table independently retains every changed timestamp for rollback.

The repair regression test covers correct, shifted, uncorroborated, ambiguous, historical,
wrong-tool, and post-deployment rows, repeat execution, and rollback. It was written before
the repair SQL. All 55 relevant tests passed:

```bash
TZ=UTC ./node_modules/.bin/vitest run backend-workers/tests/analytics-timestamp-repair.test.js \
  backend-workers/tests/analytics-timestamps.test.js backend-workers/tests/analytics-count-integrity.test.js \
  backend-workers/tests/analytics.test.js backend-workers/tests/dashboard-ordering.test.js \
  frontend/core/tests/usage-tracker.test.js
```

Repeatable production verification:

```bash
./node_modules/.bin/wrangler d1 execute adtools --remote --env '' --command \
  "SELECT COUNT(*) AS audited, SUM(t.created_time=r.corrected_time) AS verified FROM analytics_timestamp_repair_20261029 r JOIN tool_usage t ON t.id=r.tool_usage_id AND t.event_id=r.event_id;"
```

If rollback is needed, review and execute this guarded statement through the same remote D1
command. It restores only audited rows still carrying the repaired value:

```sql
UPDATE tool_usage
SET created_time = (
  SELECT r.original_time FROM analytics_timestamp_repair_20261029 r
  WHERE r.tool_usage_id = tool_usage.id AND r.event_id = tool_usage.event_id
)
WHERE EXISTS (
  SELECT 1 FROM analytics_timestamp_repair_20261029 r
  WHERE r.tool_usage_id = tool_usage.id AND r.event_id = tool_usage.event_id
    AND r.corrected_time = tool_usage.created_time
);
```
