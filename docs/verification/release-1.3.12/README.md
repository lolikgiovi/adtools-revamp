# AD Tools 1.3.12 release verification

Verified on 26 October 2026. Stable, optional desktop update (`minVersion: 0.0.0`).

## Automated checks

- Frontend/Node: 171 files, 1,809 tests passed.
- Cloudflare Worker runtime: 7 files, 87 tests passed. Node SQLite suites remain covered by the root Node run.
- Rust: 56 tests passed with Cargo offline.
- Release-content validation, production Web build, Worker deployment, and `git diff --check` passed.
- Browser: real PNG/JPEG/WebP workers, Quick Query image transfers, durable image-byte cache restoration,
  HTML notification validation, and all five release-tour screens passed.
- The browser report records three Monaco `Canceled` notifications from editor disposal separately from failures.
  All 37 HTML checks passed; no other uncaught browser errors occurred in the feature fixtures.
- Settings publishing: all 11 browser-to-local-Worker checks passed, including old-device enrollment, recipient isolation,
  replay preservation, acknowledgement history, and reconnect delivery.

## Production Web

The additive `0028_settings_publications.sql` migration was applied before deploying the Worker.
The dashboard password secret was confirmed present without reading its value.

- URL: <https://adtools.lolik.workers.dev>
- Worker version: `2a8c3456-d399-4b36-a0f8-f14262f3157c`
- Live metadata: `version: 1.3.12`, `releaseId: release-1.3.12`
- Home and its entry assets return 200; unauthenticated settings sync returns 401.
- Readback: [production-web.json](./production-web.json).

## Reproduce browser verification

Start the installed Vite server on the disposable fixture port:

```sh
./node_modules/.bin/vite --host 127.0.0.1 --port 1235
```

In another terminal:

```sh
PLAYWRIGHT_MODULE=/Users/ddl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs \
  node docs/verification/release-1.3.12/smoke.mjs
```

The harness uses installed Chrome, exercises real image workers and IndexedDB, intercepts fixture API/Oracle responses,
checks release navigation and a 390px viewport, and writes [browser-results.json](./browser-results.json) plus screenshots.
The image fixtures refuse to run on the normal app port so they do not overwrite the working app's data.

Repeat settings delivery checks:

```sh
PLAYWRIGHT_MODULE=/Users/ddl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs \
  node backend-workers/scripts/verify-settings-publishing.mjs
```

Its recorded result is [settings-publishing-results.json](./settings-publishing-results.json).
Full local command logs and screenshots are under `.wrangler/settings-publishing-verification/2026-10-26T06-19-02-291Z/`.

## Release fixes

- Removed the hidden Monitoring Config entry from the test-only active usage inventory; implementation and module mapping remain available.
- Kept the two Node SQLite dashboard suites out of workerd, matching the existing runner split.
- Updated the HTML fixture to use Velocity Template's current shared CSS root and expect the hidden Create Query button.
- Desktop packaging selects the exact current-version DMG rather than the first old DMG in the output directory.
- The signing script uses the installed project-local Tauri CLI.

## Limits

Fixture API and Oracle responses do not verify corporate endpoints, actual Oracle data, or native save dialogs.
A real installed-app upgrade/relaunch has not been exercised in this release run.
