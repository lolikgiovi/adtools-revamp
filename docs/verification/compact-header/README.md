# Sidebar and platform header verification

Project selection lives at the top of the sidebar on both web and desktop.
The web header is restored to its previous 57px height, with navigation on the
left, global search centered in the workspace header, and actions on the right.
On narrow web layouts, centered search becomes an icon and the sidebar opens
below the header so the project picker remains usable.

Desktop moves navigation, centered search, and the complete actions container
into the native title bar. Connections remain on the right. There is no second
workspace header; the sidebar project selector remains visible when expanded.
Development release preview actions live in the sidebar footer on both platforms,
and update notices open below the title bar. Native traffic-light space and drag
regions are preserved.

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
shows Quick Query immediately below the native toolbar; `*-project-menu.png`
shows the sidebar picker and its open menu.

Checks cover header height, centered search with the sidebar open and closed,
keyboard focus, Home navigation, project picker placement, long project names,
menu hit testing and bounds, Escape without collapsing the sidebar, preview
actions, connection menus, update notice bounds, opening project Settings,
readable breadcrumbs, and repeated desktop-to-web placement without duplicates.
The actual connection controller runs with native calls stubbed and external
network requests blocked. These are desktop layout simulations; native window
dragging and packaged macOS behavior require a native runtime.

The project browser scenarios in `frontend/core/tests/projects-browser.mjs` also
verify switching, isolated schemas/drafts/environments, automatic name publishing,
publication retries, and cross-account sharing against real Worker routes using
disposable SQLite. Results remain in `docs/verification/projects/`.

Native drag and double-click hit testing is recorded in `../titlebar/README.md`.
The replay uses the installed Tauri macOS event handler and checks command
routing, including the absence of window actions on interactive controls.
