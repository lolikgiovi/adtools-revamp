# Desktop toolbar verification

Desktop uses one title-bar row: sidebar toggle and live Home breadcrumbs on the
left, global search centered in the window, and connections plus a tinted/bolder
project selector on the right. The project trigger fits the selected name; its
open menu fits option contents within the viewport. Desktop search is moved
from the sidebar, so there is no duplicate sidebar search or empty header row.
The development preview button lives in the sidebar footer. Web retains its
40px workspace header, sidebar search, breadcrumbs, and project selector.

Reproduce with installed tools only:

```sh
./node_modules/.bin/vite --port 1247 --host 127.0.0.1
```

In another terminal:

```sh
HEADER_TEST_URL=http://127.0.0.1:1247 \
PLAYWRIGHT_MODULE=/Users/lolik/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs \
node frontend/core/tests/compact-header-browser.mjs
```

`result.json` records checks and failures. Screenshots cover web at 1440, 900,
620, and 390px and desktop layouts at 1440, 900, and 620px. `*-quick-query.png`
shows actual Quick Query tabs below the native toolbar. `*-project-menu.png`
shows the project selector open independently of its trigger width.

Checks cover Home navigation and updated breadcrumbs, centered working search,
sidebar toggle, native traffic-light clearance, project placement, short/long
selected names, rename resizing, menu sizing and hit testing, Escape and focus
return, no duplicate sidebar search, and viewport overflow. A 78-character name
also checks that toolbar controls remain separate. Tool viewport calculations
reclaim the removed 40px desktop row. Existing project isolation/browser checks
also pass via `frontend/core/tests/projects-browser.mjs`.

The real connection menu controller runs with native calls stubbed and external
network requests blocked. This is a desktop layout simulation, not packaged macOS
or native dragging verification. Sidebar, dropdown, global-search, and connection
unit suites passed (21 tests). The production Vite build and design scan passed.
