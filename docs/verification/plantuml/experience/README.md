# PlantUML editor and canvas verification

Verified in installed Chrome on 2026-11-02. Each browser run uses a disposable profile.

Reproduce with the existing dependencies and Chrome (no installation or browser download):

```bash
npm run dev -- --host 127.0.0.1
```

In another terminal, run each command from the project root:

```bash
PLAYWRIGHT_MODULE=/tmp/adtools-plantuml-e2e/node_modules/playwright/index.mjs \
  node frontend/tools/plantuml/tests/experience-browser.mjs

PLAYWRIGHT_MODULE=/tmp/adtools-plantuml-e2e/node_modules/playwright/index.mjs \
  PLANTUML_TEST_OUTPUT=docs/verification/plantuml/experience/ux \
  node frontend/tools/plantuml/tests/ux-browser.mjs

PLAYWRIGHT_MODULE=/tmp/adtools-plantuml-e2e/node_modules/playwright/index.mjs \
  PLANTUML_TEST_OUTPUT=docs/verification/plantuml/experience/quality \
  node frontend/tools/plantuml/tests/quality-browser.mjs

PLAYWRIGHT_MODULE=/tmp/adtools-plantuml-e2e/node_modules/playwright/index.mjs \
  PLANTUML_TEST_OUTPUT=docs/verification/plantuml/experience/workspace \
  node frontend/tools/plantuml/tests/browser.mjs

npm run build
```

Set `PLAYWRIGHT_MODULE` to another already installed Playwright module if needed.

## Evidence

- `result.json`: compact rail, cursor anchoring, pan bounds, touch transitions, syntax states, rendered role colors,
  saved theme choices, Follow app behavior, and layouts at 1440, 1000, and 390 px. No page errors.
- `dark.png`, `light.png`, `high-contrast.png`, `width-*.png`: editor themes and responsive layouts.
- `ux/result.json`: pane resizing, file search, keyboard controls, font preference, preview toggles, and navigation isolation.
- `quality/result.json` and `quality/formatted-examples.json`: actual Monaco Format action, exact indentation,
  idempotence, preserved rendered text, debounce, and recovery from syntax errors.
- `workspace/result.json`: real engine rendering, local includes, blocked remote includes, CRUD, persistence,
  export/import, keyboard command access, lifecycle, and save conflicts. `workspace/workspace.zip` reproduces the exported fixture.
- `npm run build`: passed frontend and Worker test suites, release-content validation, and production bundling.
- Scoped ESLint and `git diff --check`: passed.

Before the changes, the new browser checks reproduced 7.41 px of diagram-coordinate drift on a single off-center pinch,
unbounded panning, missing touch zoom, missing syntax categories, and no editor-theme control. They now pass.
Cursor anchoring yields to the pan boundary when the requested position would exceed 30% overscroll.
Touch uses synthetic pointer input through the real event handlers; physical trackpad/touch hardware and native Tauri execution
are not covered by this run. The syntax layer does not evaluate preprocessor branches or infer runtime types.

The UI detector's only warning is the existing hidden preview `<img>` without an initial `src` in `template.js`.
This is intentional: `DiagramPreview.show()` attaches the generated SVG blob URL before revealing it, and `clear()` hides it.
The real-browser runs verify the rendered image; no placeholder or broken image is exposed.
