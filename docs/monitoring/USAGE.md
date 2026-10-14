# Using Monitoring Config

Open **Config → Monitoring Config** in AD Tools Desktop. Oracle access requires a saved connection in **Settings → Oracle Connections**, with its current schema set to MONITORING and the compatible configuration/audit tables available.

For the local test database, use the saved **MONITORING** profile connected to `127.0.0.1:1521/FREEPDB1`. Menus under `AD_TOOLS_LOCAL_E2E` are synthetic test fixtures.

## Edit an existing configuration

1. Select the Oracle connection and click **Load**. This reads configuration; it does not write Oracle.
2. Pick a menu from the left. **Summary** contains summary queries and their fields; **Details** contains detail queries, columns and chart settings. **Compatibility** is read-only.
3. Click a query or field label to inspect it. Click **Edit**, change the values, then **Done Editing**. Existing IDs and parent references are read-only. Query text is stored as data and is never executed for validation.
4. Click **Review Changes**. Expand each changed row to inspect the complete Before/After values. Resolve any validation errors.
5. Click **Update Oracle** to write the reviewed batch. The tool fetches latest rows, checks for conflicts, applies the batch and its history in one transaction, then refreshes the configuration.
6. After **Committed**, click **Verify Database** in review to check the result and audit evidence. **History** shows successful transactions for the selected menu; expand an entry and choose **Open Complete Diff** for before/after values.

Edits autosave locally in IndexedDB. **Done Editing** does not write Oracle. **Discard Draft** removes local pending changes after its inline confirmation.

## Add or clone

- **Add** beside Menus creates a draft menu.
- **Add Summary Query** or **Add Detail Query** adds a child to the selected menu. Open a query to add its fields or columns.
- **Clone** copies the selected menu/query/field with fresh IDs and remapped child references. SQL is copied unchanged. A menu with compatibility-query configuration cannot be cloned in V1.
- Fill required fields and review the new IDs, datasource and parent references before applying. New rows and existing edits can be reviewed together.
- **Remove New Block** discards a newly drafted block and its new children. Existing Oracle rows cannot be deleted here.

## Conflicts and recovery

If Oracle changed after Load, apply stops and shows original baseline, latest Oracle, and proposed draft values. Choose **Keep Latest** to drop that row's edit, or **Reapply Draft onto Latest** to preserve the intended changed fields on the refreshed baseline. Review again and explicitly click **Update Oracle**.

**Outcome Unknown** means the tool cannot confirm whether the submitted transaction committed. Keep the submitted draft frozen and use **Verify Database** to reconcile; do not blindly submit again. A transient bridge startup error can be retried for a read-only Load/Verify once the bridge is ready.

## Export SQL instead

From **Review Changes**, choose **Generate SQL**, then **Copy SQL** or **Download Package**. Generation checks the latest baseline but does not execute SQL. The download contains `apply.sql`, `verify.sql`, `manifest.json` and `changes.json`. Run the complete guarded `apply.sql` in one verified Oracle-client session, then use **Verify Database** to compare the intended configuration.

**Open in Run Query** remains disabled until Jenkins runner compatibility and explicit target mapping are verified. The separate **SQL template — requires backend bindings** preview is informational; Copy SQL exports the standalone script instead.

See [LOCAL verification](verification.md) and [Desktop/UI evidence](ui-verification-2026-10-14.md) for tested behavior and remaining external gates.
