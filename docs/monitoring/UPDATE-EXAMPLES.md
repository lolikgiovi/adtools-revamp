# Monitoring Query — INSERT and UPDATE examples

Proposed SQL templates for the [PRD](PRD.md), not implemented or executed statements.
IDs below come from the discovery snapshot; replacement values are illustrative and have not been applied.
These examples show the generated backend INSERT/UPDATE templates. These parameterized previews require backend bindings and are not Copy SQL/Run Query exports: the backend must run the full
baseline comparison, locks, INSERTs/UPDATEs, readback and commit on one connection as described below.

## Transaction flow

1. On **Update Oracle**, fetch the latest complete rows with ordinary SELECTs and compare with the loaded baseline.
2. If different, show baseline/latest/draft and stop without DML. No database locks are held during user review.
3. If unchanged, acquire a write transaction with autocommit disabled, reassert the target, lock the affected rows,
   and compare their complete values with the original baseline again.
4. Execute explicit bound INSERTs and UPDATEs in parent-before-child order. Require one affected row for every operation.
5. Read back configuration and compare expected values. Insert/read back audit rows under PRD MQ-17 on the same connection.
6. Commit once only if configuration and audit rows pass; otherwise roll back the whole batch.

The second comparison closes the race between fetching latest data and actually updating it.
Most configuration tables have no UPDATED_AT/version column, so comparing only a timestamp cannot provide this protection.
Locks stay held through commit/rollback; UPDATE targets only the verified physical PK.
New rows use INSERT with a reviewed new PK. A missing original is a conflict; a colliding new ID is a conflict.
Never change an INSERT into UPDATE or an UPDATE into INSERT. Roll back the entire batch on zero-row UPDATE or PK collision.
Review, package manifests and execution results identify each operation as INSERT or UPDATE.

## 1. Update a menu label and active status

Preflight fetch (all columns, including existing audit fields):

```sql
SELECT MENU_ID, CHANNEL_NAME, MENU_LABEL, DISPLAY_ORDER, IS_ACTIVE,
       CREATED_BY, CREATED_AT, UPDATED_BY, UPDATED_AT
FROM MONITORING.DSH_MENU
WHERE MENU_ID = :menu_id;
```

Transaction-time locked fetch, followed by backend comparison with the complete baseline:

```sql
SELECT MENU_ID, CHANNEL_NAME, MENU_LABEL, DISPLAY_ORDER, IS_ACTIVE,
       CREATED_BY, CREATED_AT, UPDATED_BY, UPDATED_AT
FROM MONITORING.DSH_MENU
WHERE MENU_ID = :menu_id
FOR UPDATE WAIT 5;
```

If comparison succeeds, generate this UPDATE:

```sql
UPDATE MONITORING.DSH_MENU
SET MENU_LABEL = :new_menu_label,
    IS_ACTIVE = :new_is_active,
    UPDATED_BY = :updated_by,
    UPDATED_AT = SYSTIMESTAMP
WHERE MENU_ID = :menu_id;
```

Illustrative binds:

```json
{
  "menu_id": "livin-payment-bulk",
  "new_menu_label": "Payment Bulk Monitoring",
  "new_is_active": "N",
  "updated_by": "MONITORING"
}
```

UPDATED_BY is resolved according to the PRD actor policy. CREATED_BY/CREATED_AT and every unedited column are preserved.
If only MENU_LABEL was edited, omit IS_ACTIVE from SET and omit its bind.

## 2. Update a summary group's stored SQL and timeout

Fetch the full SQL CLOB, not a preview substring:

```sql
SELECT GROUP_ID, MENU_ID, DATASOURCE_ID, GROUP_TITLE, SQL_TEXT,
       TIMEOUT_MS, DISPLAY_ORDER
FROM MONITORING.DSH_SUMMARY_GROUP
WHERE GROUP_ID = :group_id;
```

Repeat the same projection with `FOR UPDATE WAIT 5` inside the transaction; compare all seven values with baseline.
After a successful locked comparison:

```sql
UPDATE MONITORING.DSH_SUMMARY_GROUP
SET SQL_TEXT = :new_sql_text,
    TIMEOUT_MS = :new_timeout_ms
WHERE GROUP_ID = :group_id;
```

| Bind           | Type / illustrative value                                                          |
| -------------- | ---------------------------------------------------------------------------------- |
| group_id       | VARCHAR2: livin-payment-bulk-overall-hit                                           |
| new_sql_text   | CLOB: complete reviewed editor contents, including inner :startDate/:endDate binds |
| new_timeout_ms | NUMBER: 60000                                                                      |

The inner date binds belong to the stored dashboard query. They are not parameters of this outer UPDATE.
Pass new_sql_text as CLOB data; do not execute it, concatenate it into SQL, or squeeze it into one VARCHAR2 literal.
If SQL is unchanged, generate only `SET TIMEOUT_MS = :new_timeout_ms`.
No UPDATED_BY/UPDATED_AT columns exist on this table, so none are generated.

## 3. Update summary-field presentation

After fetching, locking and comparing the complete original field row:

```sql
UPDATE MONITORING.DSH_SUMMARY_FIELD
SET FIELD_TITLE = :new_field_title,
    VALUE_FORMAT = :new_value_format,
    TONE = :new_tone,
    DISPLAY_ORDER = :new_display_order
WHERE FIELD_ID = :field_id;
```

Values may include FIELD_TITLE='Total Hit', VALUE_FORMAT='number', TONE=NULL and DISPLAY_ORDER=2.
Only edited fields appear in SET; NULL is an explicit clear, not an instruction to skip the column.
FIELD_ID and GROUP_ID stay unchanged. Validate the logical group relationship even though Oracle has no FK for it.

## 4. Update detail SQL and chart settings

After full original-row validation under the transaction lock:

```sql
UPDATE MONITORING.DSH_DETAIL_TABLE
SET SQL_TEXT = :new_sql_text,
    TIMEOUT_MS = :new_timeout_ms,
    PAGE_SIZE = :new_page_size,
    SHOW_CHART = :new_show_chart,
    CHART_TYPE = :new_chart_type,
    CHART_SQL = :new_chart_sql,
    CHART_LABEL_FIELD = :new_chart_label_field,
    CHART_VALUE_FIELD = :new_chart_value_field
WHERE TABLE_ID = :table_id;
```

This example assumes all listed settings changed; omit unedited assignments. SQL_TEXT/CHART_SQL are explicit CLOB binds.
CHART_TYPE='bar' or 'line' requires chart SQL and label/value mappings. SHOW_CHART='Y' with a null CHART_TYPE
is a valid existing database state and must not be automatically rewritten.

## 5. Update a detail-column mapping

After fetching, locking and comparing the complete original column row:

```sql
UPDATE MONITORING.DSH_DETAIL_COLUMN
SET SOURCE_FIELD = :new_source_field,
    COLUMN_TITLE = :new_column_title,
    VALUE_FORMAT = :new_value_format,
    ALIGN = :new_align
WHERE COLUMN_ID = :column_id;
```

An illustrative mapping is SOURCE_FIELD='TOTAL_HIT', COLUMN_TITLE='Total Hit', VALUE_FORMAT='number', ALIGN='right'.
The developer reviews that mapping against the actual detail query projection; the tool does not claim runtime alias validation.

## 6. Create a new summary group in the same batch

This illustrative group uses an existing menu/datasource or new parents already created earlier in the transaction.
Check the new GROUP_ID is absent before execution. If another writer takes it, roll back the whole batch; never update that row.

```sql
INSERT INTO MONITORING.DSH_SUMMARY_GROUP
  (GROUP_ID, MENU_ID, DATASOURCE_ID, GROUP_TITLE, SQL_TEXT, TIMEOUT_MS, DISPLAY_ORDER)
VALUES
  (:new_group_id, :menu_id, :datasource_id, :group_title, :sql_text, :timeout_ms, :display_order);
```

Bind sql_text as a complete CLOB. All other values use metadata-derived types under the PRD's typed contract.
Create its reviewed summary fields afterward using INSERT statements. Existing-row edits can precede or follow
these creations in dependency order on the same connection. Commit only after every operation and readback passes.
Each reviewed row has one explicit INSERT or UPDATE operation; execution cannot change that operation based on current existence.

## Backend templates versus runnable exports

Examples here require bound parameters. The UI labels this preview **SQL template — requires backend bindings**.
Generate SQL instead builds a standalone guarded PL/SQL script with embedded typed values and temporary CLOB construction;
Copy SQL and Open in Run Query use that script only. Both paths enforce the same existence/baseline checks and transaction rules.

## Readback and completion

For a summary SQL change, read back on the transaction connection before commit:

```sql
SELECT GROUP_ID, SQL_TEXT, TIMEOUT_MS
FROM MONITORING.DSH_SUMMARY_GROUP
WHERE GROUP_ID = :group_id;
```

Compare the entire CLOB and typed timeout with desired values. After writing and verifying the audit rows below, the backend calls the driver's commit() once;
on any error it calls rollback(). These are API operations, not separately queued SQL requests on pooled connections.
A network failure around commit can leave outcome unknown; retain the request and reconcile by readback before any new write.
Stored dashboard SQL is never executed by this flow.

## Audit records before the same commit

For each changed/new configuration row, bind complete typed before/after JSON envelopes as CLOBs under PRD MQ-17.
Use the same change ID and database timestamp for all rows in the transaction. For INSERT, old_value is SQL NULL.
AUDIT_ID is generated by Oracle; never supply it. The backend reads back and validates each inserted audit row before committing.

```sql
INSERT INTO MONITORING.DSH_CONFIG_AUDIT
  (TABLE_NAME, RECORD_ID, ACTION, OLD_VALUE, NEW_VALUE, CHANGED_BY, CHANGED_AT)
VALUES
  (:table_name, :record_id, :action, :old_value, :new_value, :changed_by, :transaction_timestamp)
RETURNING AUDIT_ID INTO :audit_id;
```

This template requires backend output binding for audit_id; standalone exports use a PL/SQL variable.
Audit failure rolls back configuration changes and all audit inserts. A successful transaction is visible as one grouped History entry.
