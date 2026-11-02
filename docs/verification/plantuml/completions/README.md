# PlantUML completion and reference-color verification

Verified in installed Chrome on 2026-11-02 using disposable browser profiles.

Common syntax now uses keyword completions with visible Monaco keyword icons. Tab and Enter insert the keyword alone;
`alt`, `group`, `loop`, `note`, and `participant` never add example conditions, actors, or block bodies.
The list contains 34 common keywords, including branches, participant declarations, notes, and activation controls.
Full palette definitions remain available through Colors, and new-file creation retains the sequence starter.

Participant references regain a few subdued accents: database references are warm, controls purple, entities green,
and other participants blue. Explicit variables retain their existing accent. Natural-language sentences remain neutral.

## Reproduce

Start Vite with existing dependencies:

```bash
npm run dev -- --host 127.0.0.1
```

In another terminal:

```bash
PLAYWRIGHT_MODULE=/tmp/adtools-plantuml-e2e/node_modules/playwright/index.mjs \
  node frontend/tools/plantuml/tests/completion-browser.mjs

PLAYWRIGHT_MODULE=/tmp/adtools-plantuml-e2e/node_modules/playwright/index.mjs \
  PLANTUML_TEST_OUTPUT=docs/verification/plantuml/completions/quiet \
  node frontend/tools/plantuml/tests/quiet-browser.mjs

PLAYWRIGHT_MODULE=/tmp/adtools-plantuml-e2e/node_modules/playwright/index.mjs \
  PLANTUML_TEST_OUTPUT=docs/verification/plantuml/completions/regression \
  node frontend/tools/plantuml/tests/experience-browser.mjs

npm run build
```

Use another already installed Playwright module by changing `PLAYWRIGHT_MODULE`.

## Evidence

- `result.json`: actual keyboard acceptance with both Tab and Enter for nine keywords; cursor placement;
  replacement in the middle of a keyword; preservation of adjacent arrows during symbol completion;
  loaded icon font and visible keyword glyph; note-prose context; and distinct rendered reference/variable/prose colors.
- `keyword-icon.png`: the real Monaco completion popup with the keyword icon.
- `references.png`: restrained reference colors alongside neutral sentence text and the rendered diagram.
- `quiet/result.json`: all six prose/theme/footer checks pass with no page errors.
- `regression/result.json`: all ten editor/canvas checks pass with no page errors.
- Full build passed 1,847 frontend tests, 87 Worker tests, release validation, and production bundling.
  Bundling was repeated after the final adjacent-arrow correction.
- Scoped ESLint, Prettier, `git diff --check`, and the UI detector passed.

The initial browser run reproduced full sample-block insertion for Tab and Enter and missing completions for `group`,
`activate`, `else`, `opt`, and `endbox`. The final run verifies the replacement behavior against the actual Monaco editor.
