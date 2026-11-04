# Quick Query early validation

Verified 4 November 2026 using Chrome at 1440px (dark) and 390px (light).

Live checks flag required values, string length with BYTE/CHAR units, numeric format,
precision, scale, invalid dates, field-header mismatches, and missing UPDATE match keys.
The issue list links to editable cells, preserves input, clears as cells are corrected,
and shows at most 100 issues. Blank spare rows are ignored. Blank UPDATE values still
skip non-key columns; all match-key components must be present. Excel issues identify
source row and field and do not select cells in the separate manual grid.

The screenshot schema (CONFIG_ID, DESCRIPTION, PARAMETER_KEY) is exercised explicitly:
blank PARAMETER_KEY is highlighted at C1, generation is blocked before the CONFIG_ID
confirmation, correcting the key removes the issue, and UPDATE SQL then generates.
See `1440-dark-required-key.png` and `390-light-required-key.png`.

The browser run records 46 checks in `result.json`, with zero uncaught page errors.
The Quick Query suite passed 426 tests; the regression suite includes all nine reported false-positive/negative cases,
exact decimal precision and audit-user literal handling. Production Vite compilation and ESLint were also run.
Existing lint warnings and dependency source-map/build warnings remain.

## Reproduce

Use the existing installed dependencies. From the repository root, start the local server:

```sh
npm run dev -- --host 127.0.0.1 --port 1249
```

In another terminal:

```sh
node frontend/tools/quick-query/tests/input-validation-browser.mjs
./node_modules/.bin/vitest run frontend/tools/quick-query/tests
```

The browser runner blocks requests outside the local server and uses synthetic data in
isolated browser contexts. It writes screenshots and `result.json` to this directory.
Set QUICK_QUERY_TEST_URL and QUICK_QUERY_TEST_OUTPUT to override the server and output.
Changes have not been deployed to the hosted or packaged app.

## Validation parity and legacy alerts

All five reported false negatives and all four false positives are covered in both
preflight and generation. Numeric constraints operate on decimal text rather than
rounded JavaScript Numbers; character limits count Unicode code points; nullable Y
is accepted; generated UUIDs, effective audit users and expanded attachments are
checked against their actual constraints. Spaced datatype declarations are parsed.

Duplicate warnings and generation errors use displayed data-row coordinates starting
at 1, preserving blank-row gaps. Alert cell references navigate and select the related
cell. The browser test covers a real 1,000-row worker result with duplicate keys at C1
and C72, and a legacy generation error linked to B1. Excel alerts remain text because
the imported rows are separate from the editable manual grid.

- `1440-dark-duplicate-warning.png` / `390-light-duplicate-warning.png`: warning links.
- `1440-dark-duplicate-links.png` / `390-light-duplicate-links.png`: selected row 72.
- `1440-dark-legacy-cell-link.png` / `390-light-legacy-cell-link.png`: legacy error links.

## Audit-user validation targets

When Custom or SYSTEM overrides CREATED_BY/UPDATED_BY, validation reports each
invalid field once at the audit-user control, rather than repeating it on every row.
The selected source control receives the invalid outline; underlying grid cells keep
their original values and have no misleading error markers. Clicking a custom-user
issue opens and focuses the editor. Saving a valid value clears the control errors.
Off mode continues to highlight and navigate to actual invalid sheet cells. Partial
UPDATEs also validate an implicit UPDATED_BY supplied by the override.

The 46 browser checks include a 72-row custom override, correction without changing
source data, Off mode, SYSTEM mode, and clearing control state on a new tab. See
`1440-dark-audit-control.png` and `390-light-audit-control.png`.
