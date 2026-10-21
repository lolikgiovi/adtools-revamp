# Desktop tab shortcuts verification — 2026-10-21

## Behavior

On macOS, Window → Close Tab (Cmd+W) sends `close-active-tab` to the main webview. App routes it to the currently visible tool's `closeActiveTab()` method. Quick Query, HTML Editor, Velocity Template, and Kafka delegate to their existing close operations, preserving save/error handling, adjacent-tab selection, and the final remaining tab. Other tools and shell pages do nothing. Browser Cmd+W remains browser-controlled.

Window → New Tab (Cmd+T) sends `new-tab` to the main webview and calls the visible tool's `createNewTab()`. HTML Editor and Velocity Template delegate to `newDocument()`; Quick Query forwards through its wrapper to its UI; Kafka already exposes `createNewTab()`. Creation uses each tool's existing behavior and limits. Both commands share an in-progress guard so a new tab cannot interrupt a close and vice versa. Browser Cmd+T remains browser-controlled.

The red window button hides the macOS window without destroying its tool state or stopping the Oracle sidecar. Reopening through the Dock shows and focuses the existing window. AD Tools → Quit (Cmd+Q) retains the native quit action. Sidecar port cleanup runs on application exit.

## Automated results

- 48 tests passed across the four files below, including native-event routing for both commands, changing the active tool, no-op pages/browser sessions, overlapping commands, failed-command recovery, late listener cleanup, and App → QuickQuery wrapper → QuickQueryUI behavior.
- `cargo check --offline --locked --manifest-path tauri/Cargo.toml` passed.
- `./node_modules/.bin/vite build --mode tauri` passed with existing chunk-size and mixed-import warnings.
- `git diff --check` passed.
- App.js and Kafka main.js have pre-existing Prettier differences, also reproduced from HEAD; no unrelated formatting applied.

Reproduce the focused checks:

```sh
./node_modules/.bin/vitest run frontend/core/tests/desktop-tab-shortcuts.test.js frontend/tools/quick-query/tests/tab-management.test.js frontend/tools/kafka/tests/interactions.test.js frontend/core/tests/shell-page-lifecycle.test.js
cargo check --offline --locked --manifest-path tauri/Cargo.toml
./node_modules/.bin/vite build --mode tauri
git diff --check
```

## Native runtime checks still pending

The user confirmed Cmd+W works in HTML Editor but reported that it did nothing in Quick Query. The original isolated QuickQueryUI test missed QuickQuery's outer tool wrapper. A replacement test reproduced that exact App-to-wrapper failure before the fix; the wrapper now forwards the command to its UI. The native Quick Query retest remains pending.

The existing Tauri dev watcher rebuilt the changed native source. The desktop automation driver resolved `adtools` to an older `Monitoring Check.app` bundle rather than the running bare development executable, so native shortcut, WebKit/Monaco focus, quit, and Dock restore behavior are not claimed as verified. The mistakenly opened older app was stopped.

Using the current development build (start with `npm run tauri:dev` if needed):

1. Confirm Window → New Tab displays Cmd+T, Window → Close Tab displays Cmd+W, and AD Tools → Quit displays Cmd+Q. In each supported tool, focus an editor/input and press Cmd+T; confirm a new tab opens and becomes active. Repeat with tab-strip and HTML preview iframe focus. Confirm Cmd+T does nothing on Home/Settings and respects each tool's tab limit.
2. In each supported tool, open at least two tabs. Focus an editor/input, press Cmd+W, and confirm only the active workspace/document tab closes and the neighboring tab becomes active. Repeat with the tab strip focused. For HTML Editor, also repeat with preview iframe focus.
3. With one tab remaining, press Cmd+W repeatedly. Confirm the tab and application remain open. Repeat on Home and Settings.
4. Navigate between tools with multiple tabs; confirm Cmd+W closes a tab only in the currently visible tool. Hold Cmd+W during an asynchronous save and confirm overlapping commands are ignored.
5. Close the red window button. Confirm the application stays running, then click its Dock icon and confirm the existing window, tabs, and drafts return.
6. Press Cmd+Q. Confirm the app exits and the managed Oracle sidecar stops. Relaunch and confirm saved tab state restores according to each tool's existing persistence behavior.
7. In a normal browser session, confirm Cmd+W still closes the browser tab and Cmd+T opens a browser tab.
