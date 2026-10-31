# Home workspace verification

Screenshots use explicitly mocked adoption data; they are not production analytics. Desktop screenshots simulate the Tauri shell with native calls stubbed; no live database or broker is contacted.

Run Vite, then:

```bash
PLAYWRIGHT_MODULE=/Users/lolik/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs HOME_TEST_URL=http://127.0.0.1:1247 node frontend/core/tests/home-workspace-browser.mjs
```

- 1920px: single adoption breakdown, pins, recent navigation and reload, visible usage details, compact feedback persistence, no overflow
- 1920px desktop shell: personal recommendations and usage details, connection states identify configuration and active target
- 1920px: analytics failure preserves tools, retry works, empty/corrupt local data has usable fallback
- 1920px: unused tools first, least-used ranking after sync, team counts ignored, recommendation opens the tool
- 1440px: single adoption breakdown, pins, recent navigation and reload, visible usage details, compact feedback persistence, no overflow
- 1440px desktop shell: personal recommendations and usage details, connection states identify configuration and active target
- 1440px: analytics failure preserves tools, retry works, empty/corrupt local data has usable fallback
- 1440px: unused tools first, least-used ranking after sync, team counts ignored, recommendation opens the tool
- 900px: single adoption breakdown, pins, recent navigation and reload, visible usage details, compact feedback persistence, no overflow
- 900px desktop shell: personal recommendations and usage details, connection states identify configuration and active target
- 900px: analytics failure preserves tools, retry works, empty/corrupt local data has usable fallback
- 900px: unused tools first, least-used ranking after sync, team counts ignored, recommendation opens the tool
- 620px: single adoption breakdown, pins, recent navigation and reload, visible usage details, compact feedback persistence, no overflow
- 620px desktop shell: personal recommendations and usage details, connection states identify configuration and active target
- 620px: analytics failure preserves tools, retry works, empty/corrupt local data has usable fallback
- 620px: unused tools first, least-used ranking after sync, team counts ignored, recommendation opens the tool
- 390px: single adoption breakdown, pins, recent navigation and reload, visible usage details, compact feedback persistence, no overflow
- 390px: analytics failure preserves tools, retry works, empty/corrupt local data has usable fallback
- 390px: unused tools first, least-used ranking after sync, team counts ignored, recommendation opens the tool
