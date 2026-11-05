# Compact pane gaps

Verified all four tools at 1440 × 1000 and 600 × 900 using installed Playwright and Chrome.

- Workspace row and column gaps are 4px (previously 12px).
- Visible divider lines are 2px; existing resize track widths remain unchanged.
- Arrow-key resizing and mouse dragging to the left change pane widths.
- Desktop workspace grids do not overflow horizontally.
- Divider handles are hidden in the stacked mobile layouts.

Kafka is desktop-only. The browser check mounts its real template and resizer directly without connecting to a broker; it does not verify desktop integration or broker operations. Other tools use application routes. Screenshots show the light theme after resizing.

Reproduce from the repository root with the development server running:

```sh
npm run dev -- --host 127.0.0.1
```

Then in another terminal:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/installed/playwright/index.mjs node docs/verification/compact-pane-gaps/check.mjs
```

Set `TEST_URL` if the server uses another address. The check uses the existing bundled Playwright path by default. No dependencies are installed. Results are saved to `results.json` with a screenshot per tool.
