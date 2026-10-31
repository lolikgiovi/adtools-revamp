# Compact sidebar

Desktop rows and the sidebar project selector are both 30px high with 13px
labels, 500 weight, and 10px horizontal padding. Icons and the selector chevron
are 14px. Coarse pointers use 40px rows and selector controls with 14px text.
Web header controls are 30px (32px search on narrow screens), while native
title-bar controls are 26px. The restored 57px web header remains unchanged.

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

The project selector lives in the sidebar on both platforms. Search is centered
in the web header or native title bar. The browser check records the selector's
computed height, font size, weight, and padding alongside the sidebar row values,
and asserts they match for both desktop and touch. The original density baseline
figures above describe the initial compact-sidebar change.
