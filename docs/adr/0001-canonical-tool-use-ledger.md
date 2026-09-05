# Use a canonical ledger for successful tool uses

AD Tools records raw opens, attempts, successes, errors, and behavioral events with different historical coverage. New tool uses go to a separate idempotent Tool Use ledger containing only successful core outcomes. Raw analytics remain immutable, and a one-time projection recovers defensible historical successes for time-based insight queries.

Lifetime Home and cumulative Tools totals preserve the pre-ledger product history as a frozen `lifetime_usage_baseline` captured from canonicalized device counters at cutover. They add only ledger rows whose source is `client`; historical ledger projections are deliberately excluded because they overlap that baseline. This gives the product a stable historical starting point without double-counting as reliable new uses arrive.
