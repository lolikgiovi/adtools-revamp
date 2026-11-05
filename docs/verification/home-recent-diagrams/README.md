# Home recent sequence diagrams

The browser check uses a fresh local profile and saved PlantUML fixtures. External requests are blocked. It verifies empty history, the four-file limit and ordering, placement below Recent tables, escaped names, exact-file navigation, editing, reload persistence, deleted files, hidden-tool visibility, and mobile overflow. Screenshots and `results.json` are saved alongside the script.

Run from the repository root with Vite already running:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/installed/playwright/index.mjs node docs/verification/home-recent-diagrams/check.mjs
```

`TEST_URL` defaults to `http://127.0.0.1:1234`. The script defaults to the existing bundled Playwright path on this workstation. It does not install dependencies.

History is recorded locally when a PlantUML file is opened or edited. Existing file catalog metadata supplies current names and excludes deleted files; Home does not load diagram source or the rendering engine. Older activity cannot be reconstructed, so the list starts filling as files are used.
