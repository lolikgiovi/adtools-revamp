# Compact sidebar header verification

Passed at 1440px and 900px: 39px sidebar header, 28px project dropdown, project menu within the viewport,
Escape restores focus, and the collapsed project icon fits inside the header.
At 390px with touch input, the existing 57px header and 40px control remain available.
Screenshots and `result.json` record the results.

Reproduce from the repository root with the installed tools:

```sh
./node_modules/.bin/vite --host 127.0.0.1 --port 1259
```

In another terminal:

```sh
PLAYWRIGHT_MODULE=/Users/ddl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs \
  node frontend/core/tests/sidebar-header-browser.mjs
```

The test blocks external requests and uses a local development identity.
