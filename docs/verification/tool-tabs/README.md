# Compact tool tabs verification

The browser check covers PlantUML as the 39px reference and all 12 requested tools at 1440, 900, and 390px.
It measures strip height and top spacing, checks page overflow, and switches the fixed mode tabs.
Desktop widths require 39px strips. Narrow layouts may wrap to keep every control accessible.
PlantUML retains its existing 40px toolbar above its document tabs.

Desktop-only tool gates are disabled in the test page to render their browser layouts. This does not test native
services. External requests are blocked; no queries, jobs, or Kafka operations run.

Reproduce from the repository root using the installed tools:

```sh
./node_modules/.bin/vite --host 127.0.0.1 --port 1259
```

In a second terminal:

```sh
PLAYWRIGHT_MODULE=/Users/ddl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs \
  node frontend/core/tests/tool-tabs-browser.mjs
```

`result.json` records the passing measurements. Screenshots show Quick Query, Master Lockey, JSON Tools, and the
PlantUML reference at each width. The production bundle is checked separately with `./node_modules/.bin/vite build`.
