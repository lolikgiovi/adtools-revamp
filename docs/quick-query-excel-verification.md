# Quick Query Excel input parity

Verified on 2026-10-13. This is implementation and verification evidence, not a new SQL behavior specification.

## Implementation

Excel input is validated for empty, duplicate, and unknown headers, then aligned to the selected schema using the existing schema-alignment helper. Omitted columns become empty cells. Schema names are preserved in the resulting header. The original Excel data is not mutated.

The resulting data goes through the same schema validation, value processor, SQL generator, and execution service as the data sheet. There is no Excel-specific required-field, audit-field, or NULL policy and no missing-schema validation bypass. The SQL generator, execution service, and worker source are unchanged from HEAD.

Shared header checks reject duplicates in both schema and data-sheet input. Excel header matching ignores case for ordinary names and preserves explicitly quoted spelling. General quoted-identifier SQL support has not been added; the existing generator still rejects explicit quotes in identifiers.

## Reproduce

From the repository root, using installed dependencies:

```bash
./node_modules/.bin/vitest run frontend/tools/quick-query/tests/excel-query-parity.integration.test.js
./node_modules/.bin/vitest run frontend/tools/quick-query/tests
```

Run one command at a time. The focused integration file passed 24 checks; the complete Quick Query suite passed 302 tests across 25 files.

The parity checks compare generated SQL, errors, and duplicate-key results for equivalent Excel and full data-sheet inputs. They cover INSERT, UPDATE, MERGE, reordered mixed-case headers, omitted fields, required-field errors, missing UPDATE keys, audit options, absent audit columns, duplicate keys, invalid headers, input immutability, and blank-row alignment. Both direct generation and the real worker message handler are exercised; the worker transport is simulated in-process.

A direct production Vite bundle also passed using the installed Vite binary and a temporary output directory. This bypassed npm prebuild hooks and did not change release metadata. Vite reported mixed static/dynamic imports and large chunks. The test run reported dependency source-map and jsdom/deprecation warnings without failures.

## Retained existing behavior

- INSERT rejects empty required ordinary fields and emits NULL for empty nullable ordinary fields. Schema Default values are not automatically substituted by the existing processor.
- UPDATE skips empty ordinary fields, generates audit values according to existing options, and does not update creation fields.
- MERGE uses the existing empty-cell rules: an omitted nullable field becomes NULL in the source and can clear that field in an existing matched row. An omitted required ordinary field errors.
- The recent-update SELECT is emitted only when UPDATED_TIME exists in the schema and a verification query can be generated. Its presence does not guarantee the timestamp was changed when automatic timestamps are disabled.

No browser Excel-upload flow, native worker transport, Oracle execution, or large-file performance run was performed for this verification.
