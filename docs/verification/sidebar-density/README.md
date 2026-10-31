# Compact sidebar

Desktop rows are 30px (previously 32px), with 13px labels (previously 14px),
14px icons (previously 16px), 11px group labels, tighter group gaps, and a 28px
search control. Sidebar width and the desktop title bar are unchanged. Coarse
pointers use 40px rows, 14px text, 16px icons, and a 36px search control.

Run Vite using the installed project binary:

```sh
./node_modules/.bin/vite --port 1247 --host 127.0.0.1
```

Then run the browser check with the installed Playwright package:

```sh
PLAYWRIGHT_MODULE=/Users/lolik/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs \
node frontend/components/tests/sidebar-density-browser.mjs
```

The test uses isolated desktop and touch contexts, blocks external requests, and
checks rendered row/font/icon/search sizing, active selection, search opening,
Escape dismissal, and viewport overflow. Desktop enables the real sidebar's
native-only tools using a runtime simulation; it does not invoke native services.
Screenshots are `desktop.png` and `touch.png`; `result.json` records the checks.

`baseline.json` and `*-before.png` were captured before the CSS change using the
same fixture. Desktop tool-list scroll height fell from 976px to 856px (12.3%).
The visible list area grew from 741px to 749px as the footer became smaller.
Touch uses larger click targets. The mechanical design scan passed.

The later desktop toolbar revision moves search into the title bar (26px) and
hides the now-empty sidebar search row. The current browser script verifies that
location; web/touch keeps the sidebar search. The original density baseline
figures above describe the initial compact-sidebar change.
