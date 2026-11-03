# Schema manager and project transfers

Verified 2026-11-03 with installed Playwright and Google Chrome at 1440px and
390px. Screenshots use disposable local fixtures. No production services or
databases are accessed, and no packages are installed.

In Settings, choose Project → Quick Query schemas → Manage schemas. The overlay
supports search, Move, Copy, Delete, Import, and Export without navigating to or
initializing Quick Query. Move and Copy are also available in Quick Query's
existing Saved Schemas overlay. Destination choices are other local projects in
the current department; the active project does not change.

Copy preserves the source. Move commits the destination before removing source
records. Both transfer saved schema definitions, cached table rows, query type,
and timestamps. Query tab drafts remain in their original project. Destination
records use IndexedDB add operations in one transaction, preventing replacement
of existing schemas or table data. Source deletion is a separate atomic
transaction and checks for concurrent changes. If deletion fails or the source
changes during a move, both copies remain and the dialog explains the outcome.

Import and Export use the Quick Query schema JSON format. Import rejects existing
table names rather than overwriting them. Exports contain definitions, as in the
existing Quick Query export; saved rows travel with Move and Copy only.

## Reproduce

Start Vite from the repository root:

```sh
./node_modules/.bin/vite --port 1247 --host 127.0.0.1
```

With an already-installed Playwright module:

```sh
PROJECTS_TEST_URL=http://127.0.0.1:1247 \
PLAYWRIGHT_MODULE=/Users/lolik/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs \
node frontend/pages/settings/tests/schema-manager-browser.mjs
```

The script records success or failure in `result.json` and captures Settings,
project-selection, and Quick Query screenshots at both widths. It verifies:

- Opening management leaves the route unchanged and does not initialize Query.
- Search, Copy, Move, returning a schema to the legacy project database.
- Preserved saved rows and query type, retained original query drafts.
- Duplicate-name protection and rollback of an aborted destination transaction.
- Import, Export, deletion confirmation, and Query's transfer actions.
- Unchanged active project, no page overflow, and no browser exceptions.

The existing project-isolation browser scenario also passed after updating it to
use Settings' local overlay. Its API tests use real Worker handlers with a
disposable SQLite database.

Validation: 75 Settings/project/import tests and the full Quick Query suite
(374 tests) passed. Production Vite bundling, formatting, and diff checks passed.
Targeted ESLint has no errors; existing warnings remain. The design detector
reported only two existing Quick Query CSS warnings outside the changed rules
(the thick left border and width animation).
