# Monitoring Query — guarded MERGE examples

Proposed SQL templates for the [PRD](PRD.md), not implemented or executed statements.
IDs below come from the discovery snapshot; replacement values are illustrative and have not been applied.
These templates show the generated backend MERGE templates. These parameterized previews require backend bindings and are not Copy SQL/Run Query exports: the backend must run the full
baseline comparison, locks, MERGEs, readback and commit on one connection as described below.

## Transaction flow

1. On **Update Oracle**, fetch the latest complete rows with ordinary SELECTs and compare with the loaded baseline.
2. If different, show baseline/latest/draft and stop without DML. No database locks are held during user review.
3. If unchanged, acquire a write transaction with autocommit disabled, reassert the target, lock the affected rows,
   and compare their complete values with the original baseline again.
4. Execute intent-specific bound MERGEs in parent-before-child order. Require one affected row for every operation.
5. Read back and compare expected values; commit once if all pass. Otherwise roll back the whole batch.

The second comparison closes the race between fetching latest data and actually updating it.
Most configuration tables have no UPDATED_AT/version column, so comparing only a timestamp cannot provide this protection.
Locks stay held through commit/rollback; MERGE matches only the verified physical PK.
Existing-row examples deliberately omit WHEN NOT MATCHED: a missing row must never be recreated.
A new-row MERGE omits WHEN MATCHED: a colliding row must never be overwritten.
The backend checks existence/baselines first and rolls back on a zero-row MERGE or PK collision.

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

If comparison succeeds, generate this matched-only MERGE:

```sql
MERGE INTO MONITORING.DSH_MENU t
USING (SELECT :menu_id AS MENU_ID FROM dual) s
ON (t.MENU_ID = s.MENU_ID)
WHEN MATCHED THEN UPDATE
SET t.MENU_LABEL = :new_menu_label,
    t.IS_ACTIVE = :new_is_active,
    t.UPDATED_BY = :updated_by,
    t.UPDATED_AT = SYSTIMESTAMP;
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
MERGE INTO MONITORING.DSH_SUMMARY_GROUP t
USING (SELECT :group_id AS GROUP_ID FROM dual) s
ON (t.GROUP_ID = s.GROUP_ID)
WHEN MATCHED THEN UPDATE
SET t.SQL_TEXT = :new_sql_text,
    t.TIMEOUT_MS = :new_timeout_ms;
```

| Bind           | Type / illustrative value                                                          |
| -------------- | ---------------------------------------------------------------------------------- |
| group_id       | VARCHAR2: livin-payment-bulk-overall-hit                                           |
| new_sql_text   | CLOB: complete reviewed editor contents, including inner :startDate/:endDate binds |
| new_timeout_ms | NUMBER: 60000                                                                      |

The inner date binds belong to the stored dashboard query. They are not parameters of this outer MERGE.
Pass new_sql_text as CLOB data; do not execute it, concatenate it into SQL, or squeeze it into one VARCHAR2 literal.
If SQL is unchanged, generate only `SET TIMEOUT_MS = :new_timeout_ms`.
No UPDATED_BY/UPDATED_AT columns exist on this table, so none are generated.

## 3. Update summary-field presentation

After fetching, locking and comparing the complete original field row:

```sql
MERGE INTO MONITORING.DSH_SUMMARY_FIELD t
USING (SELECT :field_id AS FIELD_ID FROM dual) s
ON (t.FIELD_ID = s.FIELD_ID)
WHEN MATCHED THEN UPDATE
SET t.FIELD_TITLE = :new_field_title,
    t.VALUE_FORMAT = :new_value_format,
    t.TONE = :new_tone,
    t.DISPLAY_ORDER = :new_display_order;
```

Values may include FIELD_TITLE='Total Hit', VALUE_FORMAT='number', TONE=NULL and DISPLAY_ORDER=2.
Only edited fields appear in SET; NULL is an explicit clear, not an instruction to skip the column.
FIELD_ID and GROUP_ID stay unchanged. Validate the logical group relationship even though Oracle has no FK for it.

## 4. Update detail SQL and chart settings

After full original-row validation under the transaction lock:

```sql
MERGE INTO MONITORING.DSH_DETAIL_TABLE t
USING (SELECT :table_id AS TABLE_ID FROM dual) s
ON (t.TABLE_ID = s.TABLE_ID)
WHEN MATCHED THEN UPDATE
SET t.SQL_TEXT = :new_sql_text,
    t.TIMEOUT_MS = :new_timeout_ms,
    t.PAGE_SIZE = :new_page_size,
    t.SHOW_CHART = :new_show_chart,
    t.CHART_TYPE = :new_chart_type,
    t.CHART_SQL = :new_chart_sql,
    t.CHART_LABEL_FIELD = :new_chart_label_field,
    t.CHART_VALUE_FIELD = :new_chart_value_field;
```

This example assumes all listed settings changed; omit unedited assignments. SQL_TEXT/CHART_SQL are explicit CLOB binds.
CHART_TYPE='bar' or 'line' requires chart SQL and label/value mappings. SHOW_CHART='Y' with a null CHART_TYPE
is a valid existing database state and must not be automatically rewritten.

## 5. Update a detail-column mapping

After fetching, locking and comparing the complete original column row:

```sql
MERGE INTO MONITORING.DSH_DETAIL_COLUMN t
USING (SELECT :column_id AS COLUMN_ID FROM dual) s
ON (t.COLUMN_ID = s.COLUMN_ID)
WHEN MATCHED THEN UPDATE
SET t.SOURCE_FIELD = :new_source_field,
    t.COLUMN_TITLE = :new_column_title,
    t.VALUE_FORMAT = :new_value_format,
    t.ALIGN = :new_align;
```

An illustrative mapping is SOURCE_FIELD='TOTAL_HIT', COLUMN_TITLE='Total Hit', VALUE_FORMAT='number', ALIGN='right'.
The developer reviews that mapping against the actual detail query projection; the tool does not claim runtime alias validation.

## 6. Create a new summary group in the same batch

This illustrative group uses an existing menu/datasource or new parents already created earlier in the transaction.
Check the new GROUP_ID is absent before execution. If another writer takes it, roll back the whole batch; never update that row.

```sql
MERGE INTO MONITORING.DSH_SUMMARY_GROUP t
USING (SELECT :new_group_id AS GROUP_ID FROM dual) s
ON (t.GROUP_ID = s.GROUP_ID)
WHEN NOT MATCHED THEN INSERT
  (GROUP_ID, MENU_ID, DATASOURCE_ID, GROUP_TITLE, SQL_TEXT, TIMEOUT_MS, DISPLAY_ORDER)
VALUES
  (s.GROUP_ID, :menu_id, :datasource_id, :group_title, :sql_text, :timeout_ms, :display_order);
```

Bind sql_text as a complete CLOB. All other values use metadata-derived types under the PRD's typed contract.
Create its reviewed summary fields afterward using insert-only MERGEs. Existing-row edits can precede or follow
these creations in dependency order on the same connection. Commit only after every operation and readback passes.
Never include both branches for a single reviewed operation: create/update intent is fixed by review, not inferred from current existence.

## Backend templates versus runnable exports

Examples here require bound parameters. The UI labels this preview **MERGE template — requires backend bindings**.
Generate SQL instead builds a standalone guarded PL/SQL script with embedded typed values and temporary CLOB construction;
Copy SQL and Open in Run Query use that script only. Both paths enforce the same existence/baseline checks and transaction rules.
Oracle syntax reference: [MERGE](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/MERGE.html).

## Readback and completion

For a summary SQL change, read back on the transaction connection before commit:

```sql
SELECT GROUP_ID, SQL_TEXT, TIMEOUT_MS
FROM MONITORING.DSH_SUMMARY_GROUP
WHERE GROUP_ID = :group_id;
```

Compare the entire CLOB and typed timeout with desired values. The backend then calls the driver's commit() once;
on any error it calls rollback(). These are API operations, not separately queued SQL requests on pooled connections.
A network failure around commit can leave outcome unknown; retain the request and reconcile by readback before any new write.
No example above changes database audit history or runs the stored dashboard SQL.
