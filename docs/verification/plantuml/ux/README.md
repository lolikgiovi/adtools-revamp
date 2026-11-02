# PlantUML interaction verification

Run Vite on port 1234, then run from the repository root:

```bash
PLAYWRIGHT_MODULE=/tmp/adtools-plantuml-e2e/node_modules/playwright/index.mjs \
  node frontend/tools/plantuml/tests/ux-browser.mjs
```

Use an existing Playwright module and installed Chrome. No dependencies are installed by the suite.
Each run uses an isolated browser profile. `result.json` records the result; screenshots capture the
Find tooltip, collapsed application sidebar, desktop, and narrow layouts.

The regression suite was also run successfully:

```bash
PLAYWRIGHT_MODULE=/tmp/adtools-plantuml-e2e/node_modules/playwright/index.mjs \
  PLANTUML_TEST_OUTPUT=docs/verification/plantuml/ux/regression \
  node frontend/tools/plantuml/tests/browser.mjs
```

`regression/result.json` records rendering, imports/exports, persistence, CRUD, themes, navigation,
workspace recovery, and concurrent-save checks. `regression/workspace.zip` is its exported fixture.

The zoom assertion failed before the fix (`100%` displayed for an actual scale of `97%`).
The hover lacked the `.monaco-workbench` ancestor required by upstream managed-hover styling;
the fix supplies compact, opaque tooltip chrome only while PlantUML is the active surface.
The intermediate-width media rule discarded the editor split variable; it now honors the dragged split.

Production bundling passed with the installed Vite binary. ESLint and `git diff --check` passed.
The design detector's single missing-image-source warning is intentional: the preview image is hidden
until the local renderer provides a Blob URL. It never displays a placeholder or broken-image box.
Native Tauri interaction and direct filesystem folder editing are outside these browser checks.
