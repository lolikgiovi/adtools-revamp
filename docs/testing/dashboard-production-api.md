# Dashboard and production API testing

Dashboard is one privileged sidebar entry containing Analytics, Approvals, and Publish Settings. The existing configured administrator email
controls sidebar visibility; the existing server dashboard password/token controls API authorization. Settings still receives and applies
publications, but no longer contains the publishing entry point.

## Run the local desktop UI against production

Stop any existing Vite server on port 1234 first: Tauri reuses that port, and an already-running local-mode Vite server has the wrong API target.
Then run from the repository root:

```bash
npm run tauri:dev
```

Vite prints `[AD Tools] API: https://adtools.lolik.workers.dev (production)`. This keeps local frontend code and HMR while routing API calls
and relative API proxies to the production Worker. No local Wrangler server is needed. Plain `npm run dev` continues to use the local API. Tauri development starts Vite with `--mode tauri`, so no environment flag is needed.
Packaged Tauri builds continue to use production. The production API option disables the development registration shortcut; use your real account.

Open Dashboard, unlock with the production dashboard password, and check Analytics, Approvals, and Publish Settings. In Web Inspector's Network
panel, verify `/dashboard/verify`, `/dashboard/tabs`, `/dashboard/query`, `/approval/requests`, and `/api/settings/admin/publications` use
`https://adtools.lolik.workers.dev`. If an old local dashboard token is rejected, unlock again. Desktop development and packaged desktop origins
have separate browser storage, so development may require registration even if the packaged application is already registered.

Approving accounts and publishing settings in this mode change production data. Use an explicitly selected test recipient for publication.
Viewing reports and listing requests/publications do not approve or publish anything.

Development sessions do not collect or send analytics usage, interaction events, or error telemetry, even while reading the production API.
Packaged builds keep their existing tracking behavior. This does not erase telemetry that was already stored.

## Backend availability

Switching API targets does not deploy the current backend source. Read-only checks on 2026-10-24 found:

- `/dashboard/tabs`: HTTP 401 JSON without a token.
- `/approval/requests`: HTTP 401 JSON without a token.
- `/api/settings/admin/publications`: HTTP 307 redirect to `/`, rather than API JSON, both directly and through Vite's production proxy.

The publication route is present in local source, so the production response suggests that feature has not been deployed. Deploy the current
Worker and its D1 migrations through the normal release process before expecting production publishing to work. The settings schema requires
migration `0028_settings_publications.sql`, and `ANALYTICS_DASHBOARD_PASSWORD` must be configured. No deployment or remote migration was performed
for this navigation change. These unauthenticated checks establish endpoint reachability, not authenticated production report correctness.

## Repeatable UI verification

Start a separate local server and use an already-installed Playwright package:

```bash
./node_modules/.bin/vite --port 1245
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node frontend/pages/dashboard/tests/browser.mjs
```

To verify production API selection without sending authentication attempts or mutations to production:

```bash
ADTOOLS_API=production ./node_modules/.bin/vite --port 1246
DASHBOARD_TEST_URL=http://localhost:1246 EXPECT_PRODUCTION_API=true \
  PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node frontend/pages/dashboard/tests/browser.mjs
```

The browser script intercepts API calls, exercises all three password gates, section navigation, legacy bookmarks, Settings entry removal,
and horizontal overflow at 1440px and 390px. It records API request URLs, screenshots, and `result.json` in `docs/verification/dashboard/`.
It uses Chrome and does not establish native Tauri/WebKit runtime behavior or authenticated production correctness.
