# Home workspace verification

Screenshots use explicitly mocked adoption data; they are not production analytics. Desktop screenshots simulate the Tauri shell with native calls stubbed; no live database or broker is contacted.

Run Vite, then:

```bash
PLAYWRIGHT_MODULE=/Users/lolik/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs HOME_TEST_URL=http://127.0.0.1:1247 node frontend/core/tests/home-workspace-browser.mjs
```

- 1440px: real adoption totals, pins, recent navigation and reload, disclosure, feedback persistence, no overflow
- 1440px desktop shell: tools and adoption visible, connection states identify configuration and active target
- 1440px: analytics failure preserves tools, retry works, empty/corrupt local data has usable fallback
- 900px: real adoption totals, pins, recent navigation and reload, disclosure, feedback persistence, no overflow
- 900px desktop shell: tools and adoption visible, connection states identify configuration and active target
- 900px: analytics failure preserves tools, retry works, empty/corrupt local data has usable fallback
- 620px: real adoption totals, pins, recent navigation and reload, disclosure, feedback persistence, no overflow
- 620px desktop shell: tools and adoption visible, connection states identify configuration and active target
- 620px: analytics failure preserves tools, retry works, empty/corrupt local data has usable fallback
- 390px: real adoption totals, pins, recent navigation and reload, disclosure, feedback persistence, no overflow
- 390px: analytics failure preserves tools, retry works, empty/corrupt local data has usable fallback

Additional verification: 37 relevant existing Vitest tests passed. The Tauri-mode frontend production bundle built successfully.
