# Desktop external links — 4 November 2026

The installed `tauri-plugin-shell` 2.3.4 initialization script intercepts HTTP,
HTTPS, mail and telephone links with `target="_blank"` at the body. It invokes
`plugin:shell|open` without checking `event.defaultPrevented`.

The main window lacked `shell:allow-open`. Ordinary links therefore failed ACL
authorization. Image Checker, Run Query and Run Batch also handle some links
with the native `open_url` command: their clicks reached the body listener and
produced a second invocation, even when the first opener succeeded. Consequently,
an ACL error alone did not prove that the user's first browser launch failed.

The main window now permits shell opening under the installed plugin's default
HTTP(S), mail and telephone URL scope. Handled image and Jenkins build/history
links stop propagation so the shell listener cannot open them a second time.

## Verification

The regression tests were written before the fix. All five initially failed:
three ordinary-link cases lacked the capability, and the image and batch links
each invoked two openers. The fixture replays the installed shell plugin script;
it is kept as inert text with attribution rather than importing it into the app.

Repeat from the repository root:

```sh
./node_modules/.bin/vitest run frontend/core/tests/external-links.test.js frontend/tools/image-checker/tests/presentation.test.js frontend/tools/run-batch/tests/main.test.js frontend/tools/run-query/tests/lifecycle-listener-cleanup.test.js frontend/tools/run-query/tests/usage-count.test.js
cargo check --offline --manifest-path tauri/Cargo.toml
```

Results: 17 tests passed across five files; offline Cargo check passed. A Vite
build in `tauri` mode passed, with output directed outside the checkout. ESLint
reported no errors in the changed JavaScript; existing tool warnings remain.
The test replay mocks IPC and does not launch an OS browser.

The capability change requires a new desktop build and release. No release or
deployment was performed. Packaged-app follow-up: click current and history
build links in Run Query, the build link in Run Batch, Image Checker's Open image,
and an ordinary external link. Each click should open once in the default browser
and produce no shell ACL error. When upgrading the shell plugin, refresh the
initialization-script fixture and rerun these checks.
