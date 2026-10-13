# Monitoring Query — direct UPDATE examples

Proposed SQL templates for the [PRD](PRD.md), not implemented or executed statements.
IDs below come from the discovery snapshot; replacement values are illustrative and have not been applied.
These templates show the generated DML. They are not standalone safe migration scripts: the backend must run the full
baseline comparison, locks, UPDATEs, readback and commit on one connection as described below.

## Transaction flow

1. On **Update Oracle**, fetch the latest complete rows with ordinary SELECTs and compare with the loaded baseline.
2. If different, show baseline/latest/draft and stop without DML. No database locks are held during user review.
3. If unchanged, acquire a write transaction with autocommit disabled, reassert the target, lock the affected rows,
   and compare their complete values with the original baseline again.
4. Execute only reviewed changed columns as bound UPDATEs. Require one affected row for each UPDATE.
5. Read back and compare expected values; commit once if all pass. Otherwise roll back the whole batch.

The second comparison closes the race between fetching latest data and actually updating it.
Most configuration tables have no UPDATED_AT/version column, so comparing only a timestamp cannot provide this protection.
Locks stay held through commit/rollback; the UPDATE WHERE clause can then use the verified PK alone.

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
