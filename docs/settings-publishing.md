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

Use the Dashboard surface with the existing buttons, fields, spacing, and theme tokens. The Publish Settings section opens
an administrator workspace with the existing dashboard password gate. The task order is audience, selected settings, preview, publish, history.
Use native labelled controls, inline errors and status, and a responsive single-column flow. No new visual identity or decorative labels.
The preview lists the exact recipient emails and selected values. Any edit invalidates it. Publishing requires the same audience snapshot.

## Operation

Open **Dashboard → Publish Settings** and unlock with the existing analytics dashboard password. This is the existing global administrator
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

Registered devices enroll automatically using the locally saved email and device ID matched against the server's registration record.
No recent session, OTP, or Settings visit is required. The server issues a settings-only bearer credential, stores its SHA-256 hash in D1,
and binds it to that account and device. Clients renew it automatically after 90 days or server rejection. Existing verified sessions
remain supported for older clients. Enrollment trusts possession of the registered email/device pair; this is not fresh proof of email
ownership. Email alone, a department, unknown devices, and mismatched pairs cannot enroll. The settings credential cannot authorize
publishing, analytics, or general KV access, and stops working if the device is reassigned. Publishing still requires dashboard authentication.

Client application uses a rollback journal for interrupted storage writes and per-publication markers to avoid replaying changes. Failed
acknowledgements retry without reapplying values. Settings already open offer **Refresh settings**, preserving unsaved form edits until clicked.
Publication requests have an idempotency ID, and database publication/recipient writes use a transactional D1 batch.

## Deployment

The production Worker and Web client were deployed in 1.3.12 on 26 October 2026 after applying the additive migration.
For a database that has not received this migration, apply it before deploying the Worker:

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

These fixtures seed old registered devices without sessions or settings credentials; they do not test OTP delivery. No native Keychain or packaged Tauri execution, live department data,
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

## Automatic enrollment failure cases — 2026-10-26

Before implementation, verify: old registered devices without sessions or settings credentials can enroll; email-only, unknown-device,
and mismatched email/device enrollment fails; expired settings credentials renew automatically; valid legacy sessions still enroll;
reassigned devices cannot use old credentials; failed enrollment retries without OTP; account/device changes discard in-flight results;
email and department audiences still isolate delivery; no Settings visit is needed for enrollment or application.

## Verified result — 2026-10-26

- Focused settings/API regression suite: 16 files, 93 tests passed.
- Browser-to-local-Worker verification: 11 checks passed, no browser errors. Both devices started on Home with only their old registration,
  no session, and no settings credential. Department/email delivery used the foreground event; the recipient never opened Settings.
  Reconnection renewed an expired credential and delivered the pending publication automatically.
- Production Vite build passed; responsive screenshots inspected; `git diff --check` passed.
- Broader Worker run: 87 tests passed; two existing Node SQLite suites failed to load in workerd. Both passed when run in the root Node suite.
- Repeat the browser verification with the command above. Machine-readable results, screenshots, fixture SQL, and command logs:
  `.wrangler/settings-publishing-verification/2026-10-26T02-57-36-392Z/`.
- No production deployment or native Desktop verification performed. Updated frontend and Worker are both required; no new migration is needed.

## Development device failure cases — 2026-10-26

Verify before implementation: dev enrollment marks only an existing matched device; unknown/mismatched pairs cannot mark or create devices;
normal enrollment never clears the flag; marked devices still enroll, sync, and acknowledge publications; cached client credentials
are renewed to mark a dev installation; Dashboard filters historical device rows and separates cached results when flags change; other
devices on the same account remain visible; legacy configured exclusions still work; stored records remain intact.

## Development device flag

Migration `0029_development_devices.sql` adds `device.is_development` (default `0`). Development frontend builds send
`isDevelopment: true` during settings enrollment, including renewing an existing credential that predates the flag. Only a successfully
matched registered email/device pair can mark that device. Released builds never clear an existing development mark.

The flag affects Dashboard analytics only. Registration, settings enrollment/delivery, publishing audiences, and normal feature permissions
continue to use the real device/account records. Development builds already skip telemetry uploads. Stored device-attributed history is
filtered from Dashboard reports; other devices belonging to the same user remain visible. Legacy lifetime baselines without device IDs
cannot be separated, and the existing Dashboard warning still applies. `ANALYTICS_EXCLUDED_DEVICE_IDS` remains supported.

A development mark does not register a missing device or bypass OTP. Complete registration once if enrollment reports an unknown device.
To deliberately return a device to analytics, set `is_development=0` on its record and use a released build; a dev build will mark it again.

Migration `0029_development_devices.sql` was applied to production D1 `adtools` on 26 October 2026; the migration record, column,
and index were verified by readback. The updated Worker still needs deployment before the development flag is used by enrollment and
Dashboard reports. Restarting the frontend alone does not deploy the Worker.

Development flag verification (26 October 2026): 21 focused test files / 104 tests passed, including the complete built-in Dashboard report
set with both configured exclusions and persisted flags. Production Vite build passed. Existing browser-to-local-Worker verification
passed all 11 checks with no browser errors; reproduce using the command above. Evidence and command logs:
`.wrangler/settings-publishing-verification/2026-10-26T06-59-13-321Z/result.json`.
