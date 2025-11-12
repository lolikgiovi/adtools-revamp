## Scope
- Validate Quick Query SQL generation end-to-end: input rows + schema → Oracle SQL string.
- Focus on MERGE, INSERT, UPDATE generation and Oracle reserved word handling.
- Assert critical Oracle semantics requested: MERGE update excludes created_*; MERGE insert includes all fields; lowercase reserved words quoted; uppercase reserved words unquoted.

## Test Framework
- Use `vitest` with `environment: jsdom` to avoid `localStorage` issues.
- Location: `app/tools/quick-query/services/__tests__/QueryGenerationService.spec.js`.

## Fixtures
- Table name: `my_table`.
- Schema arrays shaped as `[fieldName, dataType, nullable, default, order, pk]` (matches service usage in ValueProcessorService.js:193–214).
- Base schema (lowercase fields):
  - `['id', 'NUMBER', 'No', '', '', 'Yes']`
  - `['type', 'VARCHAR2(50)', 'Yes', '', '', '']`
  - `['sequence', 'NUMBER', 'Yes', '', '', '']`
  - `['created_time', 'DATE', 'Yes', '', '', '']`
  - `['created_by', 'VARCHAR2(50)', 'Yes', '', '', '']`
  - `['updated_time', 'DATE', 'Yes', '', '', '']`
  - `['updated_by', 'VARCHAR2(50)', 'Yes', '', '', '']`
- Uppercase schema variant (to match uppercase headers): replace field names with `TYPE`, `SEQUENCE`, etc.
- Input data arrays: first row = headers, subsequent rows = values (QueryGenerationService.js:119–166).

## Mocks & Environment
- Mock `UsageTracker` to no-op to avoid `localStorage` writes: stub `track`, `trackEvent`, `flushSync`.
- Do not provide attachments → `attachments = []` to keep generation deterministic.

## Test Cases

### 1) Reserved Words Formatting
- Directly test `formatFieldName`:
  - Input `'type'` → expect `"type"` (QueryGenerationService.js:375–380; constants.js:1–115 includes `type`).
  - Input `'sequence'` → expect `"sequence"`.
  - Input `'TYPE'` → expect `type` (unquoted, lowercase).
  - Input `'SEQUENCE'` → expect `sequence` (unquoted).

### 2) MERGE Statement: Update vs Insert Fields
- Input headers (lowercase): `['id','type','sequence','created_time','created_by','updated_time','updated_by']`.
- One data row: `[1,'menu',10,'', '', '', 'user1']`.
- Call `generateQuery('my_table','merge', schemaLower, inputData, [])`.
- Assert fragments:
  - Has prefix `SET DEFINE OFF;`.
  - `USING (SELECT` contains aliasing with quoted reserved words: `AS "type"`, `AS "sequence"` (QueryGenerationService.js:210–213).
  - `ON (tgt.id = src.id)` (PK equality, QueryGenerationService.js:215).
  - Update clause excludes created_* and PK (QueryGenerationService.js:217–223):
    - Contains `tgt."type" = src."type"` and `tgt."sequence" = src."sequence"`.
    - Contains `tgt.updated_time = src.updated_time` and `tgt.updated_by = src.updated_by`.
    - Does NOT contain `created_time` or `created_by`.
    - Does NOT contain `id` in the SET.
  - Insert clause includes all fields (QueryGenerationService.js:224–233):
    - Field list includes `id, "type", "sequence", created_time, created_by, updated_time, updated_by`.
    - Values list includes `src.id, src."type", src."sequence", src.created_time, src.created_by, src.updated_time, src.updated_by`.
  - Trailing `SELECT` exists and uses `WHERE id IN (1)` (QueryGenerationService.js:336–372).

### 3) MERGE Statement: Uppercase Reserved Words
- Headers uppercase: `['ID','TYPE','SEQUENCE','CREATED_TIME','CREATED_BY','UPDATED_TIME','UPDATED_BY']`.
- Uppercase schema variant mirrors headers.
- Data row: `[1,'menu',10,'', '', '', 'user1']`.
- `generateQuery(..., 'merge', schemaUpper, inputUpper, [])`.
- Assert:
  - `AS type` and `AS sequence` (unquoted, lowercased) in SELECT aliasing.
  - Update clause uses `tgt.type = src.type` and `tgt.sequence = src.sequence` (no quotes).
  - Insert clause fields `id, type, sequence, created_time, created_by, updated_time, updated_by` (no quotes for reserved words).

### 4) INSERT Statement
- Use base lowercase schema and headers.
- `generateQuery(..., 'insert', ...)`.
- Assert single-row INSERT:
  - Columns list includes every field including PK and audit.
  - Reserved words lowercase are quoted in column list.
  - Values include processed audit values: `SYSDATE` for `created_time`/`updated_time`; `'SYSTEM'` when `created_by` empty; `'USER1'` uppercased for `updated_by` (ValueProcessorService.js:16–24).

### 5) UPDATE Statement
- Two rows to exercise table-scope aggregation and IN clauses:
  - Row1: `[1,'menu',10,'', '', '', 'user1']`
  - Row2: `[2,'menu2',20,'', '', '', 'user2']`
- `generateQuery(..., 'update', ...)`.
- Assert structure:
  - Pre-update SELECT lists updated fields union + audit: includes `updated_time`, `updated_by` (QueryGenerationService.js:276–314).
  - Each `UPDATE my_table` block:
    - `SET` contains non-PK, excludes `created_time`, `created_by`, excludes `id`.
    - Contains setting for `updated_time` and `updated_by`.
  - `WHERE id = ...` per row and final SELECT uses `WHERE id IN (1, 2)`.

### 6) Error Handling (optional but valuable)
- Missing PK values on UPDATE → expect `throw Error("Primary key values are required for UPDATE operation.")` (QueryGenerationService.js:263–268).
- No fields to update (all values empty for non-PK) → expect `throw Error("No fields to update...")` (QueryGenerationService.js:270–274).

## Expected Assertions Style
- Use `toContain` for key substrings rather than full-string equality to avoid brittle formatting failures.
- Use negative assertions `not.toContain` for excluded fields in update SET.
- Validate reserved word quoting in all clause types: SELECT aliasing, UPDATE SET, INSERT column list, ON conditions.

## File Layout
- `app/tools/quick-query/services/__tests__/QueryGenerationService.spec.js`
- Shared fixture builders in the same spec file for simplicity; extract later if needed.

## References
- MERGE update exclusion: `app/tools/quick-query/services/QueryGenerationService.js:217–223`.
- MERGE insert fields: `app/tools/quick-query/services/QueryGenerationService.js:224–233`.
- Reserved word quoting: `app/tools/quick-query/services/QueryGenerationService.js:375–380`, `app/tools/quick-query/constants.js:1–115`.
- Primary key detection: `app/tools/quick-query/services/ValueProcessorService.js:193–214`.
- Audit value handling: `app/tools/quick-query/services/ValueProcessorService.js:16–24`.
- UPDATE flow and validations: `app/tools/quick-query/services/QueryGenerationService.js:237–334`.
- SELECT generation: `app/tools/quick-query/services/QueryGenerationService.js:336–372`.

## Acceptance Criteria
- All tests pass and assert the specified Oracle behaviors.
- Reserved words are handled exactly as specified for lowercase vs uppercase.
- MERGE update excludes created_* while insert contains all fields.
- UPDATE and SELECT scaffolding behaves as designed, including audit fields.
