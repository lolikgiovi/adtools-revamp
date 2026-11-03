# Failure scenarios recorded before implementation

- A new project inherits legacy Redis, Kafka tabs, Jira keys, paths, squads, or validator endpoints.
- An asynchronous save follows a later project selection rather than its original project.
- Integration credentials become project-specific or are overwritten during project changes.
- A legacy Jira list loses keys or silently selects the first of several keys.
- Oracle connections with the same names in two environments share credentials or overwrite one another.
- Connection rename breaks environment references or loses its credential identity.
- Migration loses unbound Oracle records, unresolved references, or repeats copies after reload.
- Secure-storage denial leaves migration marked complete; retries fall back to another scope's credentials.
- Publication changes another project, loses rollback coverage, or exposes secure fields.
- Settings search/deep links or nested environment dialogs stop working after relocation.
