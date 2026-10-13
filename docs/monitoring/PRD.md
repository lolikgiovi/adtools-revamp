# Monitoring Query — Product requirements

**Status:** revised requirements, ready for review; implementation has not started.  
**Date:** 2026-10-12. **Product:** AD Tools. **Route:** `#monitoring-query`. **Category:** Config.  
**Decision accepted (revised):** existing-row updates execute directly in AD Tools: fetch latest Oracle data → show conflicts → update if unchanged.
Creation/cloning retains generated INSERT scripts and optional Run Query handoff until direct INSERT scope is agreed.  
**Initial target:** MONITORING schema on UAT-MONITORING / EVTUAT4_COM. Other environments require explicit profiles and schema validation.

This document owns the feature requirements. [Schema discovery](README.md) owns dated evidence and the complete table/column inventory.
Requirements below describe intended behavior; they do not claim that the current application implements it.

## 1. Problem and outcome

Developers currently assemble monitoring dashboard configuration across related Oracle tables in DBeaver.
A single dashboard menu can contain multiple summary queries, summary fields, detail queries, detail columns and chart settings.
Editing those tables individually makes it difficult to understand the complete menu, clone configurations correctly,
preserve long SQL, and review the exact effect of a change.

Monitoring Query presents the configuration as one navigable hierarchy. Existing-row updates execute directly through AD Tools
after latest-data conflict checks. Jenkins is not required for updates. Creating/cloning still produces reviewable INSERT scripts
for the existing Run Query workflow. Saving a local draft never modifies Oracle; **Update Oracle** explicitly does.
Distinguish draft saved, update committed, outcome unknown, database state verified, script generated and script handed off.

### Success criteria

- A developer can inspect a menu and its query/field relationships without manually joining configuration tables.
- A developer can create, edit or clone a complete menu without manually remapping child IDs.
- Generated SQL modifies only the reviewed configuration rows and rejects stale originals before committing.
- Full SQL/CLOB content survives Oracle import, editing, persistence, generation and verification.
- Existing data defects remain visible; the tool does not silently repair or normalize unrelated configuration.
- A repeatable end-to-end artifact proves direct updates, conflict rejection, rollback and readback independently of script handoff.

## 2. Users and primary jobs

| User job                                   | Required experience                                                                    |
| ------------------------------------------ | -------------------------------------------------------------------------------------- |
| Understand a dashboard                     | Browse channel → menu → summary groups/fields and detail tables/columns/chart          |
| Change a query                             | Edit full SQL and settings; inspect related output mappings; review exact changes      |
| Add monitoring for another provider/status | Clone a block or menu; generate new IDs; remap children; edit SQL explicitly           |
| Change presentation                        | Edit titles, formatting, tone and ordering without modifying query text                |
| Enable or disable a dashboard              | Stage DSH_MENU.IS_ACTIVE, review and generate the change                               |
| Find broken configuration                  | Inspect missing parents, duplicate ordering and incomplete chart/mapping configuration |
| Apply a reviewed update                    | Fetch latest Oracle values, resolve any conflicts, then update directly in AD Tools    |
| Apply new/cloned configuration             | Export/copy the INSERT script or open Run Query; select the execution target there     |
| Check the result                           | Reload affected rows and compare them with the generated expected state                |

## 3. Release scope

### V1

| Entity               | Capability                                                                        |
| -------------------- | --------------------------------------------------------------------------------- |
| DSH_MENU             | Read, create, edit labels/channel/order, activate/deactivate, clone whole menu    |
| DSH_SUMMARY_GROUP    | Read, create, edit query/settings/order, clone with fields                        |
| DSH_SUMMARY_FIELD    | Read, create, edit mapping/presentation/order                                     |
| DSH_DETAIL_TABLE     | Read, create, edit query/settings/order/chart, clone with columns                 |
| DSH_DETAIL_COLUMN    | Read, create, edit mapping/presentation/order                                     |
| DSH_DATASOURCE       | Read a safe projection; select an existing datasource for queries                 |
| DSH_SUMMARY_QUERY    | Read-only compatibility section when present; retain unchanged                    |
| Configuration health | Read-only findings and links to affected entities                                 |
| Local drafts         | Autosave, restore, discard, refresh/rebase and explicit conflict resolution       |
| Change package       | Diff, guarded apply script, verification SQL, copy/download and Run Query handoff |

Five configuration tables support direct UPDATE plus generated INSERT scripts. Datasources and the single-summary-query table are read-only in V1.
An update batch cannot contain pending INSERTs or references to uncreated draft parents; complete creation and reload first.
Discarding a newly added unsaved block is supported. Removing an existing database row is outside V1.

### Excluded from V1

- Direct INSERT/DELETE, background/autosave DML, automatic Jenkins triggering or automatic dashboard query execution.
- Hard deletion, primary-key renaming, moving existing children to different parents, or automatic orphan cleanup.
- Datasource creation/editing, JDBC URL/credential display, and credential migration from DBeaver.
- USERS, TOKEN, Flyway history, or general-purpose table CRUD.
- Writing DSH_CONFIG_AUDIT until its application contract is known; an audit-history browser is deferred too.
- Editing DSH_SUMMARY_QUERY until its runtime role is confirmed.
- Cross-environment deployment, merge/promotion, or automatic SQL schema/provider substitutions.
- A monitoring dashboard renderer, chart renderer, or claim that database verification proves runtime dashboard behavior.

## 4. Interaction and layout

Use the existing compact developer-tool layout. Support normal and half-width desktop windows, light/dark themes,
keyboard navigation and reachable controls with large SQL/field lists. Mobile optimization is not an acceptance target.

The connection selector and MONITORING schema identity stay visible. The navigation pane groups menus by CHANNEL_NAME;
channel is a string attribute, not a separate database entity. Show label, active status, search, and pending-change count.
Selecting an item opens read-only details. **Edit** enters a local draft; **Add** and **Clone** create draft entities.

A menu exposes **Summary**, **Details**, and **Compatibility** sections. Summary groups own their field lists.
Detail tables own their column lists and **Chart** settings. Use breadcrumbs for the selected context.
Field/column tables show mapping, label, format, tone/alignment and order with inline validation.
SQL uses the existing Oracle Monaco integration with wrap, copy, search and a resizable editor.
Health findings and change review are reachable without losing the selected item or unsaved work.

Primary actions: **Load**, **Edit**, **Add**, **Clone**, **Review Changes**, **Update Oracle**, **Generate SQL**, **Copy SQL**,
**Download Package**, **Open in Run Query**, **Verify Database**, and **Discard Draft**.
**Update Oracle** fetches latest values and proceeds automatically if no conflict exists; do not add a second confirmation when the
reviewed revision is unchanged. If conflicts exist, stop and show baseline/latest/draft values. Resolution requires another Update Oracle action.
Do not label local persistence as “Save to database” or handoff as “Applied.”

```mermaid
flowchart LR
  A[Load Oracle baseline] --> B[Inspect and edit locally]
  B --> C[Review changes]
  C --> D[Update Oracle]
  D --> E[Fetch latest and compare]
  E --> F[No conflict: lock and recheck in transaction]
  F --> G[Execute bound UPDATEs and commit]
  G --> H[Read back and verify]
  E --> I[Conflict: baseline / latest / draft]
  F --> I
  I --> B
  C --> J[New rows: generate INSERT package]
  J --> K[Copy / download / Run Query]
```

## 5. Loading and schema compatibility

**MQ-01.** Oracle loading is available in Desktop through existing connection/credential services.
No passwords enter route data, local drafts or exports. Web shows a clear Desktop requirement;
V1 does not add a separate browser Oracle proxy or offline package-import product.

**MQ-02.** Select an existing AD Tools connection profile; DBeaver's connection is discovery evidence, not an imported credential profile.
Capture actual service/database identity, current schema and connection profile ID. Require MONITORING and compatible table metadata.
Do not identify an environment using a display name alone. Direct updates use the selected Oracle connection and reassert its identity inside the transaction.
For INSERT-script handoff, allow explicitly mapped execution identities when the Jenkins user differs.

**MQ-03.** Validate required tables, PKs, types, length semantics, nullability and relevant constraints against the discovery contract.
Refuse direct updates and generation on incompatible drift and explain the specific mismatch. Fetch CHAR_USED/CHAR_LENGTH/DATA_LENGTH and database character set
where required to validate VARCHAR2 byte versus character limits. Never guess a primary key from the first column.
Unknown constraints or new required columns require a compatibility decision, not optimistic DML.

**MQ-04.** Load complete configuration records and full CLOBs for the selected menu, plus all IDs required for uniqueness and health checks.
Do not accept a maxRows-truncated result as a complete baseline. Use explicit projections, deterministic ordering and bounded/paged reads.
The datasource projection includes ID, display name, active flag, pool size and timeout only; omit JDBC_URL and CREDENTIAL_REF at query time.
Load all summary fields/group IDs for schema-wide orphan detection because orphan fields cannot be reached through an existing menu.

**MQ-05.** Keep remote baseline separate from editable draft. Record load time and scope. Separate query responses are not an atomic snapshot;
refresh/revalidation and execution-time guards provide the concurrency protection. Cancel or ignore late responses from a prior connection/menu.
A failed load must never replace an existing baseline with an empty graph.

## 6. Editing, IDs and cloning

**MQ-06.** Existing primary keys and parent IDs are read-only. New IDs are editable before generation and must be globally unique within their table.
Support descriptive IDs and UUID strings. Suggested IDs use collision-resistant suffixes within VARCHAR2(50), with a fresh database collision check.
Do not impose UUID-only validation or silently truncate IDs.

**MQ-07.** Clone group → fields, detail table → columns/chart, or menu → supported groups/fields/detail tables/columns.
Maintain an explicit old-ID → new-ID map and rewrite only structural references. SQL is copied byte-for-byte unless edited by the developer;
do not replace provider names, date binds or textual occurrences of IDs automatically.
Cloning a menu with a DSH_SUMMARY_QUERY record is blocked in V1 with an explanation, preventing an apparently complete but partial clone.
Orphan fields are excluded from automatic cloning and remain visible as health findings.

**MQ-08.** Reordering stages numeric DISPLAY_ORDER changes for siblings only. Never renumber unrelated parents implicitly.
Existing duplicate values display a warning and use ID as a stable UI tie-breaker; this does not claim the monitoring application uses that tie-breaker.
An explicit reorder can assign consecutive values if they fit the database precision. Untouched duplicates remain untouched.

**MQ-09.** Defaults are visible for new entities and are derived from validated metadata. Existing values are never replaced with defaults on load.
Preserve CREATED\_\* on UPDATE. For new menus set CREATED_BY from the package's declared actor and use SYSTIMESTAMP for CREATED_AT;
for updated menus set UPDATED_BY and UPDATED_AT. For direct updates use an explicitly configured editor name or the connected Oracle
username resolved by the backend; display its source. A configured editor name is declared attribution, not independently authenticated identity.
Other managed tables have no audit columns; do not invent them. Timestamp fields affected by script execution are verified according to their
expression semantics rather than compared with a precomputed browser timestamp.

**MQ-10.** Persist drafts in a new, feature-owned IndexedDB database `MonitoringQueryDatabase`, version 1,
with `drafts` and `packages` stores. Key drafts by connection profile ID + database identity + schema + menu identity + draft ID.
Store baseline, edits, schema fingerprint, draft revision and timestamps. New menus receive a local draft identity before their database ID is final.
Never reuse or change QuickQueryDatabase/RunQueryDatabase formats.
Autosave failures remain visible and retain work in memory. Reload restores the draft as unverified until its baseline is refreshed.
Switching connection/menu must not attach edits to another target. Discard deletes only the selected local draft.

## 7. Validation and configuration health

Validation runs during editing and again before direct update or generation. Blocking errors identify the entity/field and offer navigation to it.
Warnings remain visible in review and in the package manifest. Scope warnings so unrelated legacy defects do not block a valid edit.

| Rule                                                                                  | Severity / behavior                                                                             |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Required value, correct type/precision, VARCHAR2 length/byte limit                    | Block the affected change                                                                       |
| Duplicate/new ID, missing datasource/menu/group/table parent                          | Block affected change; verify database existence before generation                              |
| IS_ACTIVE or SHOW_CHART outside Y/N                                                   | Block                                                                                           |
| TONE outside ok/fail/pend/info; ALIGN outside left/right; CHART_TYPE outside bar/line | Block; null allowed where DDL allows                                                            |
| PAGE_SIZE outside 1–100                                                               | Block                                                                                           |
| Non-null CHART_TYPE without SQL/label/value fields                                    | Block                                                                                           |
| Existing SHOW_CHART=Y with null CHART_TYPE                                            | Preserve; disclose runtime fallback is unverified                                               |
| Duplicate sibling DISPLAY_ORDER                                                       | Warn; never silently normalize                                                                  |
| Orphan summary field                                                                  | Health error; do not invent a parent or delete it                                               |
| Unknown VALUE_FORMAT                                                                  | Preserve and warn; observed values are suggestions, not an exhaustive enum                      |
| SOURCE_FIELD missing from a confidently parsed query projection                       | Warn pending runtime alias contract; show source/mapping together                               |
| Projection cannot be resolved statically, e.g. SELECT \*                              | Mark mapping unverified; never claim runtime validation                                         |
| New/changed timeout <= 0                                                              | Block as a product rule, explicitly stricter than current DDL; preserve untouched legacy values |
| Missing/extra query binds                                                             | Warn with detected names and context; no automatic bind renaming                                |

SQL analysis must distinguish actual binds from comments, quoted literals and quoted identifiers.
Observed binds: summary/chart `:startDate`, `:endDate`; detail also `:offset`, `:limit`.
Do not require every query to use every observed bind. SQL parsing is advisory, not a proof of read-only execution or correctness.
No edited SQL is executed against its datasource during validation in V1.

## 8. Review and change-package model

**MQ-11.** Review groups changes by menu and entity, showing operation, PK, modified scalar values, full SQL diff,
parent references and warnings. Unchanged fields generate no UPDATE assignment. Explicit NULL is distinct from unchanged;
empty VARCHAR2 is treated as NULL and rejected for required fields. Required SQL CLOBs cannot be empty.
For optional CLOBs, provide explicit Clear → NULL; preserve a baseline zero-length non-null CLOB as a distinct state.

**MQ-12.** **Update Oracle** freezes the reviewed draft revision, then fetches complete latest rows for every existing row in the batch
and compares all columns with the originally loaded baseline, including full CLOB content and null/empty distinctions.
A changed/deleted original is a conflict even when a different column changed. Show original baseline, latest Oracle value and proposed value;
retain the draft. Offer keep latest or explicitly reapply an edit onto the latest baseline; never provide a silent force-overwrite path.
Unrelated rows outside the update set do not conflict. A fetch/permission/metadata failure blocks writes, not local editing.
If there are no conflicts, proceed directly to the backend transaction described in MQ-15 without another confirmation dialog.
Reject a late preflight response if connection or draft revision changed. Disable duplicate submission while this revision is in flight.
For INSERT packages, refresh referenced parents and new-ID availability before generation; a collision blocks generation.

**MQ-13.** An immutable generated package contains:

- `manifest.json`: format version, package ID, source identity/schema, schema fingerprint, baseline/read times,
  draft revision, declared actor, operations, warnings, expected-state comparison rules and script SHA-256.
- `apply.sql`: guarded INSERT script for new rows; target identity assertions, rollback-on-error and one commit on success.
  Direct UPDATE review/export instead contains parameterized UPDATE templates and their typed bind values; it is not the execution API.
- `verify.sql`: explicit PK-scoped SELECTs with PK first, affected fields and full CLOB readback; no recent-time heuristics.
- `changes.json`: original/desired typed values for changed rows, supporting inspection and verification; contains no credentials.

Direct-update review also exposes the exact generated UPDATE statements, changed columns and bind values before applying.
The backend regenerates SQL from validated structured operations; it never trusts a client-provided SQL string.
See [UPDATE-EXAMPLES.md](UPDATE-EXAMPLES.md) for representative SELECT/UPDATE templates and bind contracts.

The package includes SQL/configuration and must be treated as internal development data.
Do not send it to analytics or a Worker storage service. Copy SQL copies exactly apply.sql; download includes all four files.
Any further edit or target change invalidates the active package and requires a new review/generation.
Old packages remain identifiable by their revision and creation time; they cannot masquerade as the current draft.

## 9. Direct UPDATE and Oracle script contracts

**MQ-14.** Use a feature-specific, metadata-checked allowlist of five managed tables and their exact PKs.
Use explicit `MONITORING.<TABLE>` and explicit column lists. No DDL, GRANT, DELETE, unconstrained UPDATE or generic MERGE/upsert.
INSERT means a reviewed new row; UPDATE means a reviewed existing row. A collision or missing original is an error.
Generate UPDATE assignments only for changed editable columns, plus DSH*MENU.UPDATED_BY/UPDATED_AT where applicable.
Bind every supplied value, including the PK; identifiers come only from the backend allowlist. PKs/parent IDs/CREATED*\* cannot be changed.

**MQ-15.** Direct updates require a new dedicated Tauri → Rust → Oracle sidecar write operation, separate from existing read-query endpoints.
One explicit Update Oracle action produces one transaction on one acquired connection with autocommit disabled:

1. Assert target database/service/schema and permissions; revalidate the managed-table contract.
2. Lock every existing row in the batch using explicit-column SELECT ... FOR UPDATE WAIT 5 in deterministic table/PK order.
   Fetch complete original values while holding the locks; never hold a transaction open while the user resolves a conflict.
3. Recompare locked rows with the submitted baseline for all columns. Compare nulls and scalar types explicitly and CLOBs by complete content,
   using materialized LOB values while the connection is open or DBMS_LOB.COMPARE where applicable. A missing row is a conflict.
4. If a row changed after the UI's latest-data fetch, roll back and return its current values as a conflict. No batch row may be updated.
5. Validate changed values/referenced parents and execute parameterized UPDATE statements. Bind SQL_TEXT/CHART_SQL explicitly as CLOBs.
   Require cursor.rowcount=1 for every intended row. A no-op draft has no UPDATE operations and must not update audit timestamps.
6. Read back expected updated values on the same transaction connection. Any constraint, row-count or readback failure rolls back the entire batch.
7. Commit once after all rows pass; return committed outcome and readback values. Close cursors/release connection in all cases.

The initial latest-data fetch provides a clear conflict experience. The locked recheck prevents another writer changing the row between
that fetch and the UPDATE. Lock timeout returns a retryable busy state; it is not automatically retried as a write.
A permission failure is reported directly; it does not silently redirect updates to Jenkins.
Unchanged fields are preserved. Do not replace/delete sibling collections; concurrent additions outside the change set are not removed.
After commit, refresh the baseline and clear only the successfully applied edits of the submitted draft revision.
Read-only verification may run again after commit; a concurrent subsequent edit is reported as changed since apply, not as a failed commit.

The direct-update request is structured, versioned and limited to UPDATE operations:

```text
{ version: 1, requestId, connectionProfileId, expectedDatabaseIdentity,
  schema: "MONITORING", schemaFingerprint, draftId, draftRevision,
  operations: [{ table, primaryKey, baseline: <complete typed original row>,
                 changes: <changed editable columns only> }] }
```

Resolve credentials in the backend; use no client-supplied executable SQL or arbitrary target identifiers.
Typed data must preserve NUMBER precision, timestamp precision, null and empty CLOBs without lossy JavaScript coercion.
Return structured conflict, validation, permission, lock-timeout and execution errors with operation IDs; never expose credentials.
If connection loss makes commit outcome uncertain, return **Outcome Unknown**. Preserve the draft/request ID and offer readback reconciliation;
never blindly retry. Request IDs support correlation but are not durable exactly-once guarantees without a separately implemented receipt store.
On reconciliation distinguish matching desired values, unchanged baseline, divergence and unavailable readback; require explicit user action
before a new write. A match establishes observed database state, not proof that this particular request was the writer.

Generated INSERT packages still use one guarded PL/SQL transaction unit for the external runner: assert target, verify parents/new IDs,
INSERT menus before groups/detail tables and fields/columns, require one row per operation, commit once and roll back/re-raise on any failure.
The generated script must not contain updates already applied directly. Runner compatibility is a gate for INSERT handoff only.
Rollback-on-error is transaction recovery, not a post-commit undo feature. A reversal requires fresh review and conflict checks.

**MQ-16.** For direct updates, bind stored query text as CLOB data; inner :startDate/:endDate/:offset/:limit tokens stay
inside that value and are not bound as part of the outer UPDATE. Direct writes do not need SQL\*Plus substitution settings or literal chunking.
The remaining serialization requirements apply to standalone generated INSERT scripts. Serialize stored SQL as data. Escape apostrophes correctly and preserve ampersands, semicolons, comments, Unicode,
CR/LF sequences and Oracle bind tokens inside that data. Disable SQL client substitution where the verified runner supports/requires it.
Never interpolate stored SQL as executable statements in the apply script.
Build CLOBs with temporary LOBs and escaped chunks safely below Oracle literal byte limits (target <= 2000 encoded bytes per chunk),
without splitting Unicode characters; release temporary LOBs on success and failure. No entire-CLOB VARCHAR2 or single-literal assumption.
If target encoding/runner transport cannot preserve the content, block generation/handoff with a specific error.

**MQ-17.** Direct updates and generated INSERT scripts do not write DSH_CONFIG_AUDIT in V1. The app must disclose “Database audit entries are not written” in review.
A local manifest is provenance for a proposed script, not a substitute for authenticated server audit history.
Defining audit action vocabulary, JSON serialization and execution actor is a prerequisite for adding database audit writes later.

## 10. Optional INSERT handoff and update verification

**MQ-18.** Direct updates have no Jenkins dependency. For creating/cloning rows, reuse `run-query` navigation and SQL injection; Open in Run Query populates the editor and never triggers a job.
Extend the route contract with versioned optional metadata:

```text
{ sql, monitoringPackage: { version: 1, packageId, scriptSha256,
    sourceIdentity, schema, draftRevision, requiresAtomicExecution: true } }
```

Run Query validates the selected Jenkins job/environment against an explicitly configured target-identity mapping.
Do not infer a mapping from similar display names. Mismatch or absent mapping blocks managed execution until resolved.
Preserve the package hash and provenance. Manual SQL edits invalidate managed-package status and require regeneration in Monitoring Query.

**MQ-19.** Do not pass this transaction through generic SQL chunk splitting. Run Query currently offers splitting above a 90 KB threshold;
managed packages must disable that path, calculate UTF-8 transport size using the actual runner limit, and explain oversize failures.
The developer can reduce the reviewed change set into separately reviewed packages, each with its own atomicity boundary.
Do not claim atomicity across packages. Copy/download remain available but oversized packages are not marked ready for this runner.

**MQ-20.** Before enabling managed Run Query execution, prove anonymous PL/SQL handling, delimiters, substitution behavior,
CLOB transport, single-session execution, commit/rollback, stop-on-error and propagated failure status against the actual Jenkins runner.
The current semicolon validator and size-split behavior are integration risks, not proof of PL/SQL compatibility.
Compatibility work belongs to this feature's implementation scope. Do not silently downgrade to unguarded DML if the runner fails this gate.

**MQ-21.** Direct-update states: **Draft**, **Checking Latest**, **Conflict**, **Updating**, **Committed**,
**Outcome Unknown**, **Verified**, **Verification Mismatch** and **Failed**. Never show Committed without a confirmed commit response.
Precommit readback failure rolls back; postcommit refresh failure retains Committed with verification pending.
INSERT-package lifecycle states: **Draft**, **Needs Refresh**, **Conflict**, **Ready for Review**, **Generated**, **Handed Off**,
**Verified**, **Verification Mismatch**. Run Query owns actual job status; no automatic completion callback is assumed.
Handed Off records editor transfer only. Verify Database is an explicit read-only operation against the package's source target.
Compare all intended changed/new rows with package expectations using typed values and complete CLOBs.
A Jenkins success message is not sufficient for Verified. Read failure or mismatch preserves the draft and package for investigation.
Verification of database values does not assert dashboard cache refresh, rendering or query execution.

## 11. Technical composition

Current checkout is a Vanilla JS SPA with class-based BaseTool, shared Oracle/Monaco services and Tauri Oracle connectivity.
Extend the Oracle bridge with a dedicated managed-update transaction command; Jenkins remains optional for INSERT scripts.
Implement in that active architecture; do not make this feature contingent on a React cutover or add a second shell.
If the implementation checkout has since migrated, follow its active architecture contract and preserve the same service/data behavior.

| Boundary                                   | Responsibility                                                                                           |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Tool controller / template / scoped styles | Navigation, forms, review, state rendering and widget lifecycle                                          |
| Oracle repository                          | Explicit metadata/configuration reads, complete fetches, identity, refresh and managed-update invocation |
| Managed-update backend                     | Allowlist, typed binds, full-row locked conflict check, one transaction, rollback and committed readback |
| Domain graph                               | Typed values, original/draft separation, ID maps, dependency traversal and clone rules                   |
| Validation / health service                | DDL-backed rules, advisory SQL analysis and scoped findings                                              |
| Change planner                             | Baseline comparison, deterministic INSERT/UPDATE plan and conflicts                                      |
| Oracle serializer / package service        | Guarded script, CLOB encoding, verification SQL, manifest/hash and exports                               |
| Draft store                                | Feature-owned IndexedDB persistence and revision management                                              |
| Run Query adapter                          | Versioned handoff, target mapping, atomic-package policy and provenance                                  |

Register `monitoring-query` in tools.json/toolDefinitions.js and use standard Desktop capability handling.
Reuse OracleConnectionService and keychain-backed credentials. Add a separate managed-update method and matching Rust/sidecar endpoint;
keep existing query endpoints separate from DML. Enforce the existing bridge authentication/access boundary for the new endpoint too.
Use existing Monaco and shared components. Dispose editor models, listeners and pending work on lifecycle teardown;
restore persisted edits after navigation. Route cancellation must not lose a draft or inject stale data into a new connection.
Do not log SQL/CLOB content or connection URLs. Analytics, if used, contain action IDs, counts, sizes and result categories only.

## 12. Acceptance and verification

Prefer end-to-end verification; use focused isolation tests only for failures that cannot be exercised efficiently through the complete flow.
When isolation tests are necessary, document failure modes and write tests before implementation, per AGENTS.md.
Do not install missing tooling automatically. No live UAT mutation is needed to demonstrate the feature.

| ID    | Scenario and pass condition                                                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-01 | Read-only load against the named UAT connection reconstructs menu hierarchy and complete SQL; retains no datasource secrets                |
| AC-02 | Discovery fixture reproduces 19 orphan summary fields and duplicate ordering; no automatic correction occurs                               |
| AC-03 | Edit a title only: review and DML change that field plus defined menu UPDATED\_\* only; unrelated SQL is preserved                         |
| AC-04 | Create/clone group, detail table and menu: IDs are unique, children point to cloned parents, SQL is unchanged until explicitly edited      |
| AC-05 | Clone a menu containing compatibility summary query: action is blocked with the V1 limitation                                              |
| AC-06 | Required/null/chart/precision validation matches DDL; unknown formats and Y-with-null-chart states round-trip without coercion             |
| AC-07 | Draft survives navigation/reload; two connections with identical menu IDs remain independent; persistence failure is visible               |
| AC-08 | Remote edit before latest fetch shows a conflict; edit after latest fetch fails the locked recheck and rolls back all updates              |
| AC-09 | Apostrophes, ampersands, Unicode, embedded binds, >4000-character SQL and optional empty/null CLOBs survive a full LOCAL Oracle round trip |
| AC-10 | Forced failure midway through direct LOCAL updates leaves all rows unchanged; AD Tools receives structured failure                         |
| AC-11 | Stale update retry fails baseline checks; zero-row UPDATE/lock timeout cannot succeed; INSERT collision fails script guards                |
| AC-12 | Run Query receives exact script/hash, requires a matching target, never auto-runs, and rejects managed-script edits/splitting              |
| AC-13 | Package near/above actual runner size limit gets correct byte-based behavior; no partial/chunked execution occurs                          |
| AC-14 | Confirmed commit, outcome unknown and verified state stay distinct; mismatches preserve recoverable draft/package                          |
| AC-15 | Normal and half-width Desktop, light/dark, keyboard use, empty state, long names and large SQL lists keep controls reachable               |
| AC-16 | Wrong schema, drift, missing credentials, interrupted/partial fetch and stale response produce explicit recoverable states                 |

For each E2E run retain a dated artifact containing commit, commands, environment, fixture/setup, screenshots or trace,
package hash, expected/actual database comparisons, result, cleanup and reproduction steps. Keep credentials out of artifacts. Add E2E cases for denied UPDATE permission, double submission, connection changes during preflight,
commit acknowledgment loss, readback reconciliation and stored SQL containing nested bind tokens.
Label source checks, fixtures, browser behavior, LOCAL Oracle execution, Jenkins execution and packaged Desktop evidence separately.
Generated SQL success on LOCAL Oracle is not proof of Jenkins or UAT behavior.

## 13. Delivery gates and unresolved application contracts

1. Validate schema/identity loading and the dedicated Oracle UPDATE API contract.
2. Implement hierarchy, drafts, editing/cloning, health and review.
3. Implement direct updates and prove latest-fetch/locked-recheck, CLOB binding, rollback, uncertain-commit handling and readback in LOCAL Oracle.
4. Implement INSERT generation and optional Run Query target mapping/atomic transport; verify the runner before enabling INSERT handoff.
   Direct UPDATE delivery does not depend on Jenkins availability or this integration gate.
5. Complete Desktop acceptance, read-only UAT load/readback checks and reproducible evidence.

Monitoring application cache/refresh behavior, exact value-format vocabulary, alias casing, pagination contract,
chart fallback and DSH_SUMMARY_QUERY usage remain unverified. V1 can inspect/edit confirmed configuration while preserving unknown values;
it must not claim runtime preview or compatibility-table editing. These unknowns do not justify inventing defaults or automatic reload actions.
Database audit writes/history and future direct INSERT/DELETE require separately agreed contracts.
Direct UPDATE access is confirmed by the user; the feature still handles actual runtime permission/connection failures.
