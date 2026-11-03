# Project settings navigation verification

Verified 2026-11-03 using installed Playwright and Google Chrome. All projects,
URLs, connections, and credentials in these artifacts are disposable fixtures.
Native commands are stubbed; the test never contacts a real database.

The project selector stays above eight peer sections. Desktop uses a vertical
navigator; mobile uses a horizontally scrollable navigator. Only the selected
panel is visible. Environment rows open one editor for URLs, database assignments,
and Oracle connections; deletion lives in that editor with confirmation.

## Reproduce

Start the already-installed Vite binary from the repository root:

```sh
./node_modules/.bin/vite --port 1247 --host 127.0.0.1
```

In another terminal:

```sh
PROJECTS_TEST_URL=http://127.0.0.1:1247 \
PLAYWRIGHT_MODULE=/Users/lolik/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs \
node frontend/pages/settings/tests/navigation-browser.mjs
```

Use the path to an existing Playwright installation on another machine. No test
command installs dependencies. The script writes `result.json` and screenshots
at 1440px and 390px. It covers:

- Eight peer sections with exactly one visible panel.
- Compact environment rows without empty database labels or nested accordions.
- Environment editing and persistence of changed names and URLs.
- Opening and cancelling a connection editor while preserving an environment draft.
- Creating a connection, assigning it as the critical database, and saving.
- Cancelling and confirming environment deletion.
- Search filtering, restored navigation, and deep links into another section.
- No horizontal page overflow or browser exceptions.

The existing `frontend/core/tests/projects-browser.mjs` and
`frontend/core/tests/project-settings-browser.mjs` scenarios also passed after
updating their navigation steps. These cover creation, renaming, shared project
names against actual Worker routes with disposable SQLite, isolation, draft
restoration, secure connection identities, and desktop connection teardown.

The settings suite passed all 63 tests across 14 files. Direct Vite production
bundling passed. Targeted ESLint reported no errors and existing Settings warnings.
Formatting, `git diff --check`, and the design detector passed.

## Focus and project overlay cleanup

The same browser scenario also verifies that the project overlay has no footer
divider, the shared-project retry button is absent, and focused project-name and
Monaco JSON inputs have no extra outline or box shadow. Text fields and dropdowns
use their existing border to show focus; the JSON container uses its border.
`1440-project-focus.png`, `390-project-focus.png`, `1440-bulk-focus.png`, and
`390-bulk-focus.png` record these states. Desktop/mobile browser checks, all 63
settings tests, production bundling, targeted ESLint, and the design scan passed.
