# Project hierarchy verification

The browser test records its checks in [result.json](result.json) and captures
[desktop](1440-projects.png) and [mobile](390-projects.png) screenshots. All project
and environment data in these screenshots is a fixture.

Start Vite using the installed project binary:

```sh
./node_modules/.bin/vite --port 1247 --host 127.0.0.1
```

Run the browser test with an already installed Playwright module. This session
used the bundled runtime package:

```sh
PROJECTS_TEST_URL=http://127.0.0.1:1247 \
PLAYWRIGHT_MODULE=/Users/lolik/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs \
node frontend/core/tests/projects-browser.mjs
```

The test runs in separate browser contexts at 1440px and 390px. It creates and
renames a project through Settings, edits environments, switches through the
actual searchable dropdown, checks independent QQ schemas and drafts in IndexedDB,
restores the original project's legacy environment, and verifies no horizontal
overflow or browser exceptions. Requests outside the fixture server are blocked.
It uses the installed Google Chrome browser and never downloads tooling.

For focused storage, publication compatibility, and switching checks:

```sh
./node_modules/.bin/vitest run frontend/core/tests/projects.test.js frontend/core/tests/project-switch.test.js frontend/core/tests/environments.test.js frontend/core/tests/published-settings.test.js
```

Production bundling uses `./node_modules/.bin/vite build`; it does not update the
release version. The full frontend suite uses `npm run test:ci`.

The separate Worker suite passed 87 tests but could not load the two pre-existing,
untracked analytics timestamp test files because the Worker runtime does not
provide `node:sqlite`. Those files and the unrelated timestamp changes were left
untouched.

Verified on 2026-10-29: all 178 frontend test files passed (1,844 tests), both
browser viewport checks passed, and production bundling succeeded. Targeted ESLint
reported no errors; the existing files retain their prior warnings. The design
mechanical scan reported no findings.


## Project header and shared names (2026-10-30)

The browser scenario now loads the real Worker through the installed Vite SSR
loader and runs its settings/project endpoints against disposable SQLite with
all D1 migrations applied. No production API or database is used. It publishes
only `{ name: "Payments v2" }`, then chooses that name in an independent browser
context registered in a different department. The receiving project has no
publisher environments or saved schemas. It also verifies the header selector,
keyboard dismissal, viewport bounds, project creation/rename/switching, schema
manager navigation, and project isolation at 1440px and 390px.

Additional artifacts: `1440-schemas.png`, `390-schemas.png`,
`1440-shared-project.png`, and `390-shared-project.png`. `result.json` records
both success and failure with reproduction through the command above.

The authenticated API is `GET /api/settings/projects` (paginated by `after`)
and `POST /api/settings/projects` with only a `name` field. Repeated publication
is case-insensitively idempotent. Registered users across departments share the
same name directory; local tool contents are never returned by this endpoint.
Renaming a local project does not rename an already-published directory entry.

Deployment requires migration `0030_project_directory.sql` before releasing the
updated Worker/frontend. This task does not deploy or change production data.

Final verification: `npm run test:ci` passed 180 files / 1,847 tests;
`./node_modules/.bin/vite build` succeeded; targeted ESLint and `git diff --check`
passed. Browser results passed at both widths. `1440-desktop-header.png` checks
the desktop header layout with connection indicators shown (layout simulation,
not a native Tauri runtime test). The design detector's two warnings refer to
existing Quick Query width animation/accent rules outside the changed styles.

## Simplified project settings (2026-10-31)

Settings now uses one picker for local and shared project names. Choosing a saved
name switches immediately; selecting “New project…” clears the inline name field.
“Save name” saves locally and publishes automatically, including when renaming the
current project. Separate Add, Rename, Publish, Shared projects, and Use project
controls are removed. Quick Query schemas and Testing Environments are sibling
sections with identical headings and alignment; environments no longer have a
nested accordion.

The browser command above verifies both 1440px and 390px layouts against the real
Worker routes using disposable SQLite. It also covers duplicate rejection without
publishing, failed publication on creation and rename, retry without duplicate
projects, and automatic sharing across accounts. Only project names are published.
Publication failure keeps the local name and displays a retry message. A new
project switches after successful publication; its failed publication can be
retried with Save name or the locally saved project can be chosen from the picker.

Verification: browser scenarios passed at both widths; 15 focused project,
switching, and environment editor tests passed; production Vite bundling passed.
Targeted ESLint has no errors (existing Settings warnings remain), the design
scan has no findings, and `git diff --check` passed.

## Sidebar project selection (2026-10-31)

The global project picker now lives in `.sidebar-header .sidebar-project` on both
platforms. The browser scenario opens the narrow sidebar before checking its
menu, verifies project state there, and confirms it remains below the native
header in the desktop layout simulation. See `../compact-header/README.md` for
the platform header, centered search, and keyboard verification.
