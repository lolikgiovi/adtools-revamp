# Native title-bar hit testing

The blank breadcrumb region was not marked with `data-tauri-drag-region`.
Tauri 2.9.5 matches the actual event target rather than inheriting this attribute
from the parent title bar. Its macOS mouseup handler therefore sent no
`internal_toggle_maximize` command for a double-click in this area. Blank action
and connection-group regions had the same gap. The app also lacked the
`core:window:allow-start-dragging` permission.

The noninteractive title-bar elements now carry the drag marker. Buttons, links,
search, and menus remain separate hit targets. Tauri's existing handler retains
macOS mouseup and movement-cancellation behavior; no duplicate double-click
handler is added. Preview What's New is now in the sidebar footer on both web
and desktop, leaving the header controls at their current sizes.

Reproduce using installed tools only:

```sh
./node_modules/.bin/vite --port 1247 --host 127.0.0.1
```

In another terminal:

```sh
HEADER_TEST_URL=http://127.0.0.1:1247 \
PLAYWRIGHT_MODULE=/Users/lolik/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs \
TAURI_DRAG_SCRIPT=/Users/lolik/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-2.9.5/src/window/scripts/drag.js \
node frontend/core/tests/titlebar-browser.mjs
```

Set the module and Cargo paths to the already-installed copies on your machine.
The test reads the actual installed Tauri handler and runs it against the app DOM,
recording native command calls. Before the fix it failed with `0 !== 1` for the
blank breadcrumb double-click. After the fix, both double-clicks dispatch exactly
one maximize/restore command; search and connection double-clicks do not. It also
checks native dragging permission and the relocated preview button's callback.
`result.json` records the result and `desktop.png` captures the resulting header.

This verifies event routing into Tauri, not the OS window's resulting geometry.
No native AD Tools window was running in the available computer-use session.
Changes to the native capability require rebuilding/restarting the desktop app.
The broader responsive toolbar scenario remains in
`frontend/core/tests/compact-header-browser.mjs`.
