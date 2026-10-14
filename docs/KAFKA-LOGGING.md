# Kafka operation logging

KafkaService records diagnostic events through the existing UsageTracker events queue.
These follow the shared analytics settings and batch transport. They do not increment
successful tool-use counts; the existing `kafka / publish` use remains recorded only
when at least one delivery is confirmed.

Every service operation records one completion event with `duration_ms` and `outcome`
(`success`, `partial`, or `failure`). Saved broker profile names and topic names are
included when available. Broker addresses are not added separately; a profile name
can itself contain an address if the user named it that way.

| Event | Additional fields |
| --- | --- |
| `publish_result` | `requested_count`, `delivered_count`, and on partial/failure `failed_message_index` (zero based), `error_category` |
| `test_connection_result` | Categorized error on failure |
| `list_topics_result` | `topic_count` |
| `search_history_result` | `range_hours`, `match_count`, `scanned_count`, `limited` |
| `start_listener_result` | `from_beginning` |
| `stop_listener_result` | Last successfully started listener profile/topic, when available |
| `listener_error` | Listener profile/topic and categorized asynchronous error |
| `topic_favorite_changed` | `topic`, current `broker_profile` when available, picker `source` (`publish` or `listen`), and `favorite` (true for add, false for remove) |

Favorite changes are logged after local persistence succeeds. Favorites remain global
across profiles; the logged profile identifies the selection when the user acted.
Empty topics and failed saves do not generate a favorite-change event.

Error categories are `timeout`, `authorization`, `connection`, `busy`, `validation`,
or `unknown`. Raw error text, payloads, keys, headers, search queries, offsets, and
individual received records are excluded. No per-message listener telemetry is sent.
Telemetry failures do not change service return values or thrown errors.

Coverage is at the KafkaService boundary. Validation rejected before a service call
and the global connection indicator's direct native connect/disconnect calls are
outside this instrumentation.

## Verification

Repeat with the installed project-local binary:

```bash
./node_modules/.bin/vitest run frontend/tools/kafka/tests
```

Verified on 2026-10-14: 4 files, 44 tests passed. Operation logging tests cover partial
delivery, rejected calls, history summaries, excluded content, best-effort telemetry,
and asynchronous listener failures using injected native responses. Favorite tests
cover both pickers, add/remove state, empty input, failed saves, and telemetry failures. This proves the
frontend instrumentation; live Kafka delivery and remote analytics ingestion were
not exercised.
