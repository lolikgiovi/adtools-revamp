# Global search contrast

Start the local server, then run the browser check using the existing Playwright installation:

```sh
./node_modules/.bin/vite --host 127.0.0.1 --port 1248 --strictPort
```

```sh
PLAYWRIGHT_MODULE=/Users/ddl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs \
node frontend/components/tests/global-search-contrast-browser.mjs
```

The check uses the real search overlay and all themes from ThemeManager. It measures
rendered title, description and icon contrast for keyboard selection and pointer hover,
with each theme's default accent and six extreme accent overrides. Text must reach
4.5:1 and icons 3:1 against the row background. It also checks filtering, ArrowDown and
Escape. External requests are blocked.

`result.json` records measured colors, ratios and failures; `dark.png` and `light.png`
show the search overlay. Rerunning replaces these artifacts.

Verified on 2026-11-04: 266 combinations passed with zero contrast failures and a
minimum measured ratio of 5.70:1. Before the fix, the GitHub Dark High Contrast
selection measured 2.79:1 for the title, 1.25:1 for the description and 1:1 for
the icon. The existing global-search and global-search-analytics tests also
passed (13 tests).
