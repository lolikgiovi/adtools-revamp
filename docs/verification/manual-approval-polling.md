# Pending approval checks

Failure cases considered before implementation:

- No pending or malformed stored request: no status request or polling timer.
- Saved request on app load: one immediate check, regardless of current auth mode or page.
- Pending status: check again every 60 seconds; transient failures retry on that cadence.
- Slow response: manual checks, startup, and interval checks share one in-flight request.
- Approval: persist the session and profile, remove the pending request, notify the app, and stop polling.
- Request removed or replaced, or app destroyed during a check: ignore stale responses.
- Register page unmount and overlay close: detach UI subscribers while app-level pending monitoring continues.
- Overlay approval: complete the protected action automatically, with retry available if its KV fetch fails.
- Existing Check Status buttons remain available.

Verification commands and results are recorded after implementation.

## Behavior

The app starts the shared monitor after binding its registration event handlers.
It checks `manual.approval.request` immediately on startup when a valid request is
saved. The same monitor is started after a new manual request, and by a standalone
registration page or access overlay restoring a request. It checks every 60 seconds
while pending, independently of the current auth mode. One shared in-flight promise
prevents overlapping automatic and manual checks.

Approval persists the session and registered identity, removes the saved request,
emits `user:registered`, and stops the timer. The registration page advances to Home;
an open access overlay automatically completes its protected action. Other current
app pages are preserved. UI subscriptions detach on page unmount or overlay close,
while background monitoring continues. App destruction stops the monitor and stale
responses are ignored. Browser timers can be delayed while the app is suspended.

## Repeatable verification

```sh
./node_modules/.bin/vitest run frontend/core/tests/manual-approval-monitor.test.js frontend/pages/register/tests/main.test.js frontend/components/tests/otp-overlay.test.js
npm run build
```

Results on 2026-10-14:

- 20 focused tests passed, including immediate startup checks, exact 60-second
  cadence, successful completion, retry after failure, overlapping check coalescing,
  removed/replaced request protection, and stopped-monitor response protection.
- Full build checks passed: 1,281 tests across 106 files and 79 isolated Worker tests.
- Release content checks and Vite production build passed.
- `git diff --check` passed.

The monitor tests use fake timers and mocked HTTP; registration and overlay tests
exercise DOM flows with mocked HTTP. This is local verification, not live admin
approval or a deployed end-to-end run. No deployment was performed.
