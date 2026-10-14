# Mobile sidebar viewport verification

The sidebar used `100vh`, including two mobile overrides. On iOS Safari this can
extend behind the browser toolbar, hiding the last footer entry (Approval).
The sidebar now uses `100dvh` with a `100vh` fallback, reserves the footer's height,
and includes bottom safe-area padding. The tool list shrinks and scrolls; the footer
can also scroll when the visible viewport is exceptionally short.

## Reproduce the check

1. Run `npm run dev` using existing dependencies.
2. Open `http://localhost:1234/components/tests/mobile-sidebar.html`.
3. Check portrait at 390 x 650 and 390 x 480, landscape at 667 x 320, and desktop
   at 1440 x 900. The fixture uses the actual App menu and Sidebar renderer,
   with 40 tool entries to force scrolling. It makes no Worker requests.
4. Confirm the header reports `PASS: Approval within viewport`, Approval is visible
   below Analytics, and the tool list scrolls independently.
5. On a real iPhone, open the development server using the Mac's network address.
   Show and hide Safari's toolbar, rotate the phone, and check the footer remains
   reachable above the toolbar and home indicator. Also check the deployed site
   after deployment.

## Results — 2026-10-14

Codex in-app browser against local Vite, with the real styles and menu renderer:

| Viewport   | Sidebar height | Approval bottom | Result |
| ---------- | -------------- | --------------- | ------ |
| 390 x 650  | 650 px         | 642 px          | PASS   |
| 390 x 480  | 480 px         | 472 px          | PASS   |
| 667 x 320  | 320 px         | 312 px          | PASS   |
| 1440 x 900 | 900 px         | 892 px          | PASS   |

The original layout also fits these emulated viewports: they do not reproduce
Safari's distinction between its largest viewport and the visible viewport.
The iPhone report and the `100vh` declarations identify that platform-specific issue.
Real iPhone toolbar/safe-area verification and deployed-fix verification remain pending.

Eight existing sidebar/access tests passed with:

```sh
./node_modules/.bin/vitest run frontend/core/tests/admin-sidebar-access.test.js frontend/components/tests/sidebar.test.js
```
