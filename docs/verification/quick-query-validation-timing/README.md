# Quick Query validation timing

Verified 2026-11-05 using the actual QuickQuery component in the in-app browser. The normal app required registration, so the accompanying standalone harness mounts the component without account creation or authentication changes. No data is sent to a database.

## Repeat the browser walkthrough

From the repository root:

```sh
cp docs/verification/quick-query-validation-timing/harness.html frontend/quick-query-ux-review.html
./node_modules/.bin/vite --host 127.0.0.1 --port 1248
```

Open http://127.0.0.1:1248/quick-query-ux-review.html and create a new Quick Query tab. Existing tabs on this dedicated origin are preserved. Set table APP.TIMING_FINAL. Enter the following schema rows (Default stays empty):

| Field Name | Data Type | Null | Default | Order | PK |
| --- | --- | --- | --- | --- | --- |
| ID | NUMBER | No | | 1 | Yes |
| NAME | VARCHAR2(5 CHAR) | No | | 2 | No |
| AGE | NUMBER(3,0) | Yes | | 3 | No |

1. Type ID=1 in the cell editor and press Tab. NAME is selected with no required-field warning. See `untouched-name.png`.
2. Press Tab again, leaving NAME empty. The panel shows `B1: NAME is required`. See `visited-name.png`.
3. Click the issue link, edit NAME to Alice and commit. Enter AGE=abc and commit; the numeric error appears. Correct AGE to 42; the error clears.
4. Add Row. Leave it entirely empty; no warning appears. Type ID=2 and tab into NAME; no warning appears yet. Click a cell in row 1; row 2 now reports NAME required.
5. Switch to another valid tab; no errors leak from this tab. Switch back; the row 2 error returns. Correct row 2 NAME to Bob.
6. Add Row. Paste ID=3 into row 3; NAME is reported immediately because pasted rows count as submitted input.
7. Click Generate. The missing name still blocks SQL. Correct NAME to Cara, commit, then Generate again. SQL is generated for the three rows. See `generated-query.png`.

Stop the temporary server with Ctrl-C and remove the copied `frontend/quick-query-ux-review.html` after the walkthrough. The harness is not part of the production application.

## Automated checks

```sh
./node_modules/.bin/vitest run frontend/tools/quick-query/tests
```

38 files / 442 tests passed, including eight new timing tests written before implementation. They cover untouched and visited cells, row departure, range selection, committed/pasted input, explicit NULL, complete validation, UPDATE semantics, and coordinate changes on row/column insertion/removal. Existing Quick Query tests cover the surrounding generation, schema, audit, and tab behavior.

Prettier checks and `git diff --check` passed. ESLint reported zero errors and 29 existing warnings in main.js. The standalone `input-validation-browser.mjs` assertions were updated to distinguish deferred empty cells from immediate value errors; that standalone script was not executed in this run. Browser screenshots/result.json record the interactive verification above.
