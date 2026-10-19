# OTP-first fallback verification

Failure cases to cover before implementation: Resend 201/202/4xx/5xx, missing credentials,
network rejection, retry before/at 60 seconds, manual before/at 180 seconds, resends
resetting the original deadline, refresh/reopen, changed email, duplicate clicks,
late responses after close/unmount, invalid profile, and existing pending approval.

Backend route integration uses mocked Resend and storage. Frontend checks mount the
actual registration page and overlay in jsdom. These do not prove live delivery.

## Implemented contract

- Sender: `AD Tools <otp-adtools@lolik.cloud>` in both Worker environments.
- Resend must return exactly HTTP 200. Other provider statuses, missing API key,
  and provider network errors return HTTP 502 with `manualApprovalAvailable: true`.
- The first successful request opens OTP entry and explains the 1–3 minute wait.
- Retry Email becomes available after 60 seconds; each retry has its own 60-second cooldown.
- Manual approval becomes available after 180 seconds from the original attempt.
  A retry preserves that deadline; a send failure makes it available immediately.
- Frontend state is shared by normalized email and device across both surfaces.
  Backend KV stores deadlines for 30 minutes and checks them on both routes.
  KV retains the existing eventual-consistency limitation of the rate limiter;
  simultaneous requests across independent clients are not strictly serialized.
- The existing manual-only emergency runtime override remains supported.

## Reproduce browser checks

Run `npm run dev`, then open:

`http://localhost:1234/@fs/Users/ddl/projects/ad-tools-revamp/docs/verification/otp-first-preview.html`

This fixture imports the production registration page and overlay. Its API responses
and clock are simulated; it sends no email. It uses the fixture email and real local
browser storage, so use a separate browser profile when pending registration state matters.

1. Reset: send succeeds → Request OTP. Retry and manual buttons are disabled;
   the message says 1–3 minutes and the fallback countdown starts at 3:00.
2. Advance one minute. Retry Email becomes enabled, manual stays disabled.
3. Retry Email → Remount registration. OTP entry and the remaining two-minute
   manual deadline persist; the retry cooldown restarts at 60 seconds.
4. Advance one minute twice. Manual approval becomes enabled alongside OTP entry.
5. Reset: send fails → Request OTP. Manual approval is immediately enabled;
   the initial Request OTP button disappears and Retry Email has a 60-second cooldown.
6. Open verification overlay. The same email/device state is restored there.
7. Toggle theme and resize to 390px to check wrapping and stacked actions.

## Results — 2026-10-15

- Focused route/UI/monitor/notification run: 8 files, 64 tests passed.
- Full `npm run test:ci`: 114 files, 1,318 tests passed.
- Final frontend regression check after lifecycle/button-state refinements:
  3 files, 13 tests passed.
- Vite production build passed; existing chunk-size and dynamic-import warnings remain.
- Targeted ESLint: no errors, existing empty-catch warnings remain.
- Impeccable detector findings were existing shared-CSS accents/transitions outside this change.
- Real browser fixture: successful request, retry at 60 seconds, preserved deadline
  after retry/remount, manual at 180 seconds, immediate failure fallback, overlay
  restoration, desktop/mobile layout, and light/dark captures inspected.
- Workers-runtime configuration: 7 files / 86 tests passed, including all changed
  auth/approval routes. The unrelated `dashboard-person.test.js` suite failed to
  load because `node:sqlite` is unavailable in workerd. This is not a green full
  Workers-runtime suite.
- No deployment, remote KV mutation, live email send, or recipient inbox check performed.

## Deployment

Deploy the frontend and Worker together. Ensure Resend authorizes `lolik.cloud`
for the configured API key. A previously saved KV manual-mode override takes
precedence over Wrangler variables. To activate OTP after deployment with the
existing project CLI:

```bash
./node_modules/.bin/wrangler kv key put config:registration-auth-mode otp --binding adtools --remote --preview false
```

No D1 migration is required.
