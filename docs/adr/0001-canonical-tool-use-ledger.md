# Use a canonical ledger for successful tool uses

AD Tools records raw opens, attempts, successes, errors, and behavioral events with different historical coverage. Impact reporting uses a separate idempotent Tool Use ledger containing only successful core outcomes; raw analytics remain immutable, and a one-time projection recovers defensible historical uses from trusted usage actions and success events. This avoids both destructive cleanup and permanently coupling impact metrics to heterogeneous event names.
