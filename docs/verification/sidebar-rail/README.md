# Sidebar rail verification

Desktop collapse keeps a 52px navigation rail. Project selection, navigation,
active states, footer actions, and keyboard pinning remain available. Mobile
continues to use an overlay drawer.

Expand/collapse uses synchronized 280ms transform animations for the workspace
and icon rows, with a clipped background reveal and a short label fade. The
workspace adopts its final width once rather than resizing editors every frame.
Reduced-motion mode changes
the desktop layout instantly. The browser scenarios pause the transition mid-motion
to check alignment and capture `*-transition.png`, then verify rapid reversals
and reduced-motion behavior. The checks also observe workspace resizing and
verify alignment while reversing a transition before it finishes.

Start the installed Vite server:

```sh
./node_modules/.bin/vite --host 127.0.0.1 --port 1247
```

Run with the existing Playwright installation:

```sh
PLAYWRIGHT_MODULE=/Users/ddl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs \
SIDEBAR_TEST_URL=http://127.0.0.1:1247 \
node frontend/components/tests/sidebar-rail-browser.mjs
```

The script blocks requests outside the local origin and writes `result.json`
and screenshots here. It checks rail width and content offset, visible icon
buttons and accessible names, tool navigation and active state, keyboard pinning
and focus restoration, project picker bounds and Escape, expansion by shortcut,
the 768/769px breakpoint, mobile drawer navigation, and horizontal overflow.
Screenshots cover dark and light rails, expanded navigation, project menus, and
mobile. Desktop mode simulates Tauri layout; it does not test the packaged app.

Verified on November 4, 2026:

- Rail browser scenarios: web, desktop simulation, and mobile passed with no page errors.
- Focused Vitest: `frontend/components/tests/sidebar.test.js` and
  `frontend/core/tests/admin-sidebar-access.test.js`, 8 tests passed.
- Production bundling: `./node_modules/.bin/vite build` passed with bundle-size
  and dependency warnings.
- ESLint on changed JavaScript: no errors; existing warning categories remain.
- The broader `frontend/core/tests/compact-header-browser.mjs` passed its 1440px
  web and desktop layout checks, then timed out at line 191 waiting for the hidden
  `.project-name-save` button in Settings. The broader run did not complete.
