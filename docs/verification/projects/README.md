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
