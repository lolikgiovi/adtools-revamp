# Quiet PlantUML editor verification

Verified in installed Chrome on 2026-11-02 using disposable profiles and the local rendering engine.

The changes keep prose neutral in titles, groups, notes, request labels, and response labels. Words such as
`on`, `return`, `control`, `database`, `SELECT`, and `JOIN` are not treated as code inside sentences.
Explicit `$variables`, `${interpolation}`, and `%functions()` remain accented. Participant references use the normal text color.

The chooser adds six locally bundled palettes adapted for PlantUML: GitHub Light, Solarized Light, One Dark,
Dracula, Nord, and Catppuccin Mocha. Theme metadata drives both the selector and saved-preference validation.
The preview footer is 29 px tall, with 24 px zoom buttons. Successful renders clear the status text instead of showing milliseconds;
loading, editing, empty, and error feedback remains available.

## Reproduce

With existing dependencies and Chrome, start Vite from the project root:

```bash
npm run dev -- --host 127.0.0.1
```

Then run:

```bash
PLAYWRIGHT_MODULE=/tmp/adtools-plantuml-e2e/node_modules/playwright/index.mjs \
  node frontend/tools/plantuml/tests/quiet-browser.mjs

PLAYWRIGHT_MODULE=/tmp/adtools-plantuml-e2e/node_modules/playwright/index.mjs \
  PLANTUML_TEST_OUTPUT=docs/verification/plantuml/quiet/regression \
  node frontend/tools/plantuml/tests/experience-browser.mjs

npm run build
```

Use another already installed Playwright module by changing `PLAYWRIGHT_MODULE`.

## Evidence

- `result.json`: all six checks passed with no page errors. Covers prose tokenization, explicit variables,
  footer height and zoom actions, all six new theme choices, source preservation, persistence after reload,
  editing/error feedback, and 1000/390 px layouts.
- Theme-named screenshots show the same rendered source in each new palette. `width-*.png` records responsive layout.
- `regression/result.json`: all ten editor/canvas regression checks passed, including cursor anchoring,
  bounded panning, touch transitions, original themes, and app-theme changes.
- Full build passed: 1,847 frontend tests, 87 Worker tests, release-content validation, and production bundling.
  Production bundling was repeated after the final Solarized contrast adjustment.
- Scoped ESLint, Prettier, and `git diff --check` passed.

Before implementation, the new checks failed on prose keyword matching, footer height, the timing counter,
and missing theme options. The final checks pass against the actual Monaco tokenizer and DOM.

The UI detector reports only the existing hidden preview image with no initial `src`. This is intentional:
`DiagramPreview.show()` assigns an SVG blob URL before revealing the image. Browser screenshots verify the rendered image.
