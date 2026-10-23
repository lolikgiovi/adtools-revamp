# Settings publishing

## Contract and failure cases

An authenticated administrator publishes selected settings to an explicit snapshot of registered users, selected by email or department.
Theme, Updates, and credentials remain personal. Publications apply once per installation; subsequent local edits survive synchronization.
Only selected setting keys change. Lists replace the selected list; omitted settings stay unchanged. Oracle credentials remain in Keychain.

Verification must cover unauthorized publishing; spoofed recipient email/department/device; cross-audience reads and acknowledgements;
empty/unknown recipients; changed audiences between preview and publish; personal, secret, and unknown setting keys; credentials hidden in
structured values; malformed and oversized payloads; ordered overlapping publications; duplicate synchronization and acknowledgement;
expired credentials; stale responses after identity changes; offline recovery; storage failure and partial application; revocation before
delivery; and preserving unrelated settings, theme, update preferences, and local edits.

## UI direction

Extend the existing Settings surface using its buttons, fields, disclosure controls, spacing, and theme tokens. A Publish settings link opens
an administrator workspace with the existing dashboard password gate. The task order is audience, selected settings, preview, publish, history.
Use native labelled controls, inline errors and status, and a responsive single-column flow. No new visual identity or decorative labels.
The preview lists the exact recipient emails and selected values. Any edit invalidates it. Publishing requires the same audience snapshot.

## Operation

Open **Settings → Publish settings** and unlock with the existing analytics dashboard password. This is the existing global administrator
permission, not a new department-admin role. Choose emails or departments, select settings, edit their values, and preview. The preview lists
the exact registered users and values. Publishing refuses an audience that changed since preview. No publication can target everyone implicitly.

Each publication captures its recipients at publish time. New department members need a new publication. Email comparisons are case insensitive.
Limits are 100 target emails/departments, 500 registered recipients, 200 entries per list, and 128 KiB per request. History shows the latest
100 publications, recipient counts, device acknowledgements, and stopped deliveries. **Use as draft** can publish a corrected or previous version.
**Stop delivery** prevents future fetches; it does not undo changes already applied, including a response already in flight.

Clients synchronize at startup, every minute, on focus/visibility, and on reconnection while AD Tools is running. No background daemon is
installed. Settings synchronization is independent of the personal auto-update preference. Publications apply in order and only once per
installation and registered account. Subsequent local edits survive retries and reloads. A selected list replaces that list, not the other lists
or settings. Environment changes update the legacy CDN view too. Oracle and Kafka addresses can be published; usernames, passwords, tokens,
and Keychain entries remain local. A newly published Oracle connection still needs credentials on that device.

An existing verified session enrolls a device for settings synchronization. The server issues a random, settings-only bearer credential,
stores only its SHA-256 hash in D1, and binds it to the registered account and device. It expires after 90 days and stops working if the device
is reassigned. It cannot authorize publishing, analytics, or general KV access. If the session/credential has expired, Settings offers **Verify
account**; no unattended OTP prompt appears. Client-supplied target fields and device IDs never authorize a read or acknowledgement.

Client application uses a rollback journal for interrupted storage writes and per-publication markers to avoid replaying changes. Failed
acknowledgements retry without reapplying values. Settings already open offer **Refresh settings**, preserving unsaved form edits until clicked.
Publication requests have an idempotency ID, and database publication/recipient writes use a transactional D1 batch.

## Deployment

The production Worker and clients have not been deployed. Before deploying the new Worker, apply the additive migration to its D1 database:

```sh
./node_modules/.bin/wrangler d1 migrations apply adtools --remote
```

Deploy the frontend and Worker through the normal release workflow. Packaged Desktop clients need a build containing the synchronization code.
The existing `ANALYTICS_DASHBOARD_PASSWORD` must be configured; publishing denies access if it is missing. No new secret or dependency is required.

## Verification and reproduction

Focused regression checks:

```sh
./node_modules/.bin/vitest run backend-workers/tests/settings-publishing.test.js frontend/core/tests/published-settings.test.js frontend/pages/settings/tests
npm run test:worker
./node_modules/.bin/vite build
npm run release:content:check
```

The browser verification script starts isolated local D1/KV state, a local Worker on 8787 and Vite on 1244, and closes its own servers/browser.
It refuses to borrow occupied ports. It uses installed Chrome and Playwright, performs real browser-to-Worker requests, blocks external browser
requests, and writes screenshots, command logs, fixtures, and a machine-readable result under `.wrangler/settings-publishing-verification/`.

```sh
PLAYWRIGHT_MODULE=/Users/ddl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs \
  node backend-workers/scripts/verify-settings-publishing.mjs
```

These fixtures seed verified sessions; they do not test OTP delivery. No native Keychain or packaged Tauri execution, live department data,
or deployed API is covered by the local web verification.

In this worktree, installed dependencies were temporarily linked from the main checkout; nothing was installed. The ordinary build precheck
hit Vite's filesystem restriction for the external Oxipng WASM dependency. A temporary configuration under `.wrangler/settings-vitest.config.mjs`
allowed the existing dependency directory: the complete frontend suite then passed (153 files, 1,703 tests at that checkpoint). The production
Vite build and the Worker suite were checked independently. Final focused results and browser evidence are recorded below.

## Verified result — 2026-10-23

- Final focused regression scope: 10 files, 68 tests passed.
- Existing Worker scope: 7 files, 87 tests passed.
- Browser-to-local-Worker scope: all 10 checks passed with no browser errors, including department/email isolation, environment/Oracle address
  bindings, preserved usernames/theme/update preferences, preserved local edits after reload, device acknowledgements, and automatic reconnect delivery.
- Rendered 1440px and 390px states inspected in light and dark themes, including publication history and the final Settings scroll position.
- Production Vite build, release-content check, Prettier, and `git diff --check` passed.
- Browser evidence: `.wrangler/settings-publishing-verification/2026-10-23T06-54-26-902Z/result.json`, screenshots, and `commands.log`.
- Temporary verification servers stopped. No deployment, remote migration, or native Desktop execution performed.
