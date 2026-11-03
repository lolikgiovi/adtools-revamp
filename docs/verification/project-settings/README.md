# Project settings verification

The browser runner uses fixture data and blocks all requests outside its local Vite server.
Desktop credential commands are mocked; it does not contact Oracle, Redis, Kafka, Jira, Confluence, or Jenkins.

## Reproduce

Start the installed server:

```sh
./node_modules/.bin/vite --port 1247 --host 127.0.0.1
```

In another terminal, run with the installed browser tooling:

```sh
PROJECTS_TEST_URL=http://127.0.0.1:1247 \
PLAYWRIGHT_MODULE=/Users/lolik/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs \
node frontend/core/tests/project-settings-browser.mjs
```

Set `PLAYWRIGHT_MODULE` to the existing Playwright module on a different machine.
The runner writes `result.json` and screenshots beside this file and exits nonzero on failure.

## Coverage

- Explicit selection from a legacy multi-key Jira list, without discarding the list.
- Project-scoped Redis, Kafka, Lockey, squad names, and validator settings; shared integration username.
- A captured settings writer completing after project selection changes.
- Independent Oracle identities for environments sharing a legacy connection; rename preserves bindings.
- Publication destination matching, rollback including a newly created project, and rejection of credential metadata.
- Project switching through the actual selector and reload, with consumer reads in the new document.
- Desktop and mobile settings layout with no horizontal overflow.
- Nested Oracle creation and restoration of the environment draft; scoped Oracle batch and Redis credential commands.
- Saved Oracle connections remain available for assignment after an environment is removed from their ownership.
- Desktop project switching disconnects Redis/Kafka sessions and Oracle pools before reloading.

Failure scenarios were recorded before implementation in `failure-scenarios.md`.
The focused storage tests were written and observed failing before the new storage helpers were implemented.
Existing test fixtures were updated for the new Settings hierarchy and stable Oracle identities.

## Limits

The fixture verifies native command arguments, not macOS Keychain prompts or live service connectivity.
Live Desktop verification still requires the user's configured services and credentials.

## Verification results

- `npm run build`: passed, including all 1,851 frontend tests, 87 Worker tests, and release-content validation.
- `cargo test --offline --manifest-path tauri/Cargo.toml --lib`: all 56 tests passed.
- Browser E2E: passed; see `result.json` and the desktop/mobile screenshots.
- Focused checks after migration/import refinements: 46 tests passed across eight files; the final switching/publication checks passed all 27 tests.
- ESLint: no errors; the existing warning-level findings remain.
- Settings design detector: no findings.
