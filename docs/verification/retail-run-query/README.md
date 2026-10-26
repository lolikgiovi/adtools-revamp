# RETAIL-only Run Query

Verified locally on 26 October 2026. Not published; installed clients need a new desktop release.

The saved `user.department` is trimmed and compared case-insensitively with `RETAIL`. Missing departments and every other department
hide Run Query from navigation (including saved pins), global search, About's tool catalogue, feedback choices, and Quick Query's
Run Query action. Direct Run Query routes redirect to Home before loading the tool. Run Batch keeps its existing availability.
Registration changes refresh navigation and search. Quick Query refreshes its action when a cached tool resumes.
This is client-side visibility using the existing registration profile, not a new backend authorization mechanism.

## Evidence

- Before implementation, the new visibility regression failed for missing and non-RETAIL departments.
- The browser check then exposed Quick Query's remaining visible Run Query action; it passes after applying the same policy there.
- Focused regression run: 36 files, 404 tests passed, including Quick Query, navigation races, sidebar pins, and global search.
- Browser: missing, SME, WHOLESALE, RETAIL, and whitespace/lowercase RETAIL profiles all pass.
- Production Vite build and `git diff --check` passed. ESLint has no errors; existing warnings remain.
- [Browser results](./results.json) and screenshots are saved beside this document.

## Reproduce

```sh
./node_modules/.bin/vite --host 127.0.0.1 --port 1235
```

In another terminal:

```sh
PLAYWRIGHT_MODULE=/Users/ddl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs \
  node docs/verification/retail-run-query/check.mjs
```

The browser uses a disposable profile and fixture registration. It simulates the desktop runtime only while rendering navigation,
returns to the Web runtime for Quick Query, and intercepts API traffic. It checks pins, search, the Quick Query action, direct-route
redirection, and successive department changes without a reload. It does not execute Jenkins jobs or require corporate access.
