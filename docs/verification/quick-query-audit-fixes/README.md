# Quick Query audit fixes — verification

Run on 2026-11-05 against the dev app (`http://127.0.0.1:1234/#quick-query`, Vite, real Handsontable grids,
real Excel worker). Result: **16 / 16 checks passed**.

## Reproduce

1. Start the dev server (`npm run dev`) and open Quick Query as a registered dev user
   (localStorage `user.email`, `user.registered = "true"`, `user.username`).
2. In the page console run:

   ```js
   const mod = await import("/@fs/<repo>/docs/verification/quick-query-audit-fixes/browser-check.js?raw");
   await (0, eval)(mod.default);
   ```

   It returns `{ passed, checks }`, creates two scratch tabs and closes them when done.

Unit coverage for the same fixes: `tests/generation-correctness.test.js`, `tests/excel-import.service.test.js`,
`tests/tab-isolation.test.js`, plus new cases in `split.test.js`, `oracle-data-import.service.test.js` and
`oracle-env-import.service.test.js` (all under `frontend/tools/quick-query/`).

## Results

| Audit item | Check | Result |
| --- | --- | --- |
| 15 | Schema with `FLOAT(126)` and `NVARCHAR2(10)` generates without errors | pass |
| 1 | BLOB text `x')); DELETE FROM …; --` stays one escaped literal | pass |
| 1 | No statement is injected after the BLOB literal | pass |
| 9 | Uppercase reserved column emitted as `"LEVEL"` | pass |
| 8 | `CONFIG_ID` match key: `UPDATE … WHERE config_id = 42` | pass |
| 16 | Data header `" CONFIG_ID "` generates | pass |
| 17 | `.xlsx` with an empty used-range column imports as `ID,BIRTH,AMT,CODE` | pass |
| 5 | Excel date cell (serial 45306) becomes `2024-01-15` | pass |
| 17 | Excel calculated `0.1*3` passes `NUMBER(10,2)` as `0.3` | pass |
| 17 | Excel `00000`-formatted 123 stays `'00123'` | pass |
| 4 | Re-importing a same-shaped file marks the SQL stale | pass |
| 3 | Excel rows do not follow into another tab (banner hidden) | pass |
| 3 | Tab A shows its own SQL after switching back | pass |
| 3 | Excel rows come back with their tab | pass |
| 3 | Tab A's edited grid is detected as stale after visiting tab B | pass |
| 2 | A generation result arriving after a tab switch is discarded | pass |

Items 6 (Split PL/SQL blocks, backslashes), 7 (Oracle schema import PKs) and 18 (Oracle data import with
lowercase schema) need the Split dialog's file output or a live Oracle connection; they are covered by the unit
tests listed above, not by this browser run.
