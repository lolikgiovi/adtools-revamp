# PlantUML verification

The browser suite uses real Chromium, IndexedDB, Monaco, and the pinned PlantUML engine. It blocks all external requests.
`result.json` records the checks and screenshots show desktop and narrow layouts; `workspace.zip` is a reproducible export.
Production results are recorded separately under `production/`.

Run from the repository root with Chrome and Playwright available:

```bash
npm run dev -- --host 127.0.0.1
```

In a second terminal:

```bash
PLAYWRIGHT_MODULE=/tmp/adtools-plantuml-e2e/node_modules/playwright/index.mjs \
  node frontend/tools/plantuml/tests/browser.mjs
```

If Playwright is not installed, install it manually outside the project:

```bash
npm install --prefix /tmp/adtools-plantuml-e2e --no-audit --no-fund playwright
```

The test uses installed Chrome (`channel: "chrome"`), with no browser download. Set `PLAYWRIGHT_MODULE` to another
existing Playwright module if needed. Each run uses a new browser profile and does not modify your normal workspace.

To verify packaged web assets, run `npm run build`, then:

```bash
npm run preview -- --host 127.0.0.1 --port 1248
```

In another terminal:

```bash
PLAYWRIGHT_MODULE=/tmp/adtools-plantuml-e2e/node_modules/playwright/index.mjs \
  PLANTUML_TEST_URL=http://127.0.0.1:1248 \
  PLANTUML_TEST_OUTPUT=docs/verification/plantuml/production \
  node frontend/tools/plantuml/tests/browser.mjs
```

The suite covers rendering, remote include rejection, local includes, current-result exports, reload persistence,
file/folder CRUD, invalid names, folder moves, formatting, colors, rapid edits, switching to JSON Tools, warm resume,
hard disposal, ZIP restoration, command/file pickers, malformed ZIP preservation, responsive layout, and conflicting saves.

The full `npm run build` passed 1,847 frontend/shared tests and 87 Worker tests, release content validation, and production bundling.
The Tauri frontend was also built with `vite build --mode tauri`; native macOS execution is not covered by the browser suite.
