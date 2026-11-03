# PlantUML formatting and feedback checks

Run Vite on port 1234, then run with an existing Playwright installation and installed Chrome:

```bash
PLAYWRIGHT_MODULE=/tmp/adtools-plantuml-e2e/node_modules/playwright/index.mjs \
  node frontend/tools/plantuml/tests/quality-browser.mjs
```

No dependencies or browsers are installed by the suite. It uses an isolated browser profile.

`result.json` records 26 checks. `formatted-examples.json` records 14 source/expected-output examples,
including the bundled example, an unindented copy, nested sequences at depths 4/12/32, multiline notes,
preprocessor functions and conditionals, activity switch/fork/repeat blocks, quoted braces, comments,
and multiple diagrams. Every example exercises the editor's real Format action and is checked for
idempotence. Ten supported examples are also rendered before and after formatting, with equal rendered text.
Non-UML diagram languages are intentionally left untouched; this is an indentation formatter, not a parser or code rewriter.

The browser checks verify:

- File, folder, and color dialogs are centered at 1440, 900, and 390 px.
- The preview toggle changes its icon, action label, and expanded state.
- Commands has a visible label.
- Edits wait for one second of inactivity, reset the delay on further edits, and retain the last valid diagram.
- Syntax errors show the source line and allow keyboard focus/navigation to that line.
- Typing clears the previous error, and valid input recovers without restarting the renderer.
- A valid diagram containing the literal label `Syntax Error` is rendered normally.

Screenshots capture the centered color dialog, syntax-error feedback, and the final workspace.
The existing UX and workspace regression suites also passed; their latest artifacts are under `../ux/`.
Production bundling uses the installed Vite binary. Native Tauri behavior is not covered by these checks.

Syntax references: [PlantUML sequence diagrams](https://plantuml.com/sequence-diagram),
[activity diagrams](https://plantuml.com/activity-diagram-beta), and [preprocessing](https://plantuml.com/preprocessing).

Before the fixes, the suite reproduced off-center dialogs, the static preview icon, the unlabeled Commands control,
and failures in note, preprocessor, switch, multiline-activity, and literal-brace formatting. The global margin reset
removed the browser's default dialog centering. The renderer also forwarded its error SVG's build banner and source dump;
it now extracts an actionable source location instead. The image detector's missing-source warning remains intentional:
the image is hidden until the local renderer supplies its Blob URL.
