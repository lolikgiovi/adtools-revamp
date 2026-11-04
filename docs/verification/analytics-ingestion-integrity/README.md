# Analytics ingestion integrity

Real `UsageTracker` payloads go through the real Worker handlers into SQLite with every migration applied, then are read back through the dashboard and overview.

## Reproduce

```bash
./node_modules/.bin/vitest run backend-workers/tests/analytics-ingestion-integrity.test.js
```

## What it proves

| Case | Before | After |
| --- | --- | --- |
| Flush with only local counters | POSTs every `device_usage` counter | No request; `device_usage` never sent or written |
| Same chunk retried | Second copy of every event and error | One row each; both responses acknowledge the same ids |
| Batch transaction fails, one row fails alone | Whole chunk acknowledged, failed row lost | Only stored rows acknowledged; failed row stays queued and lands next flush |
| Event/usage-log timestamps (`Z`, `+08:00`, offset-free) | Stored verbatim | Stored as Jakarta wall time with `+07:00` (usage logs keep milliseconds) |
| Migration 0032 on legacy rows | — | Offset-free rows get `+07:00`, offset rows untouched, usage_log twins folded, legacy tables dropped |
| 00:00–07:00 Jakarta activity, "today" range | Excluded (`datetime()` shifted it to yesterday UTC) | Counted, on the right day |
| Overview seven-day pulse | Oldest day started at the current time of day | Oldest day starts at midnight |
| Tool Usage / Tool Adoption tabs | Frozen `device_usage` counters | Lifetime baseline plus new successful uses |

## Result

Run 2026-11-04: 10/10 passed. Full `npm run test:ci`: 206 files, 2,031 tests passed. `npm run test:worker`: 8 files, 95 tests passed.

Production read-only dry run of 0032 predicates (2026-11-04): 105,312 `events`, 37,919 `usage_log` and 26,181 historical `tool_usage` rows to backfill; 0 `usage_log` twins; 0 client `tool_usage` rows without an offset.
