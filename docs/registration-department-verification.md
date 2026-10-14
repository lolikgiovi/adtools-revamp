# Registration department verification

> Historical RETAIL-only verification. The current mandatory department, role, and
> Bank Mandiri email requirements are documented in [Registration profile verification](registration-profile-verification.md).

Verified locally on 2026-10-14.

Department is optional. The dropdown offers `RETAIL` on the registration page and
shared OTP/manual approval overlay. OTP verification stores it on the user;
manual approval stores it on the request and copies it to the user when approved.
Unsupported nonempty department values are rejected. An omitted value preserves
an existing user department for older clients. No email domain policy changed.

## Repeatable automated checks

```sh
./node_modules/.bin/vitest run frontend/pages/register/tests/main.test.js frontend/components/tests/otp-overlay.test.js
./node_modules/.bin/vitest run --config backend-workers/vitest.config.js backend-workers/tests/auth.test.js backend-workers/tests/approval.test.js
npm run test:ci
npm run test:worker
./node_modules/.bin/vite build
```

Results: 6 focused frontend tests, 17 focused Worker tests, 1,249 full frontend
tests, and 61 full Worker tests passed. Vite build passed with chunk-size warnings.
These tests exercise DOM flows with mocked HTTP and Worker handlers with mocked
DB statements; they are not live email delivery proof.

## Database

Migration `0026_registration_department.sql` applied successfully to local D1
using `./node_modules/.bin/wrangler d1 migrations apply adtools --local`.
The nullable columns preserve historical users and pending approval requests.
Apply the migration to production D1 before deploying the updated Worker.
No remote migration or deployment was performed.

## Browser check

The Vite development app redirects registered development identities to Home.
An isolated temporary HTML harness mounted the actual `RegisterPage` with the
app stylesheet. Browser inspection confirmed the labeled native department
selector, both placeholder and RETAIL options, and successful RETAIL selection.
The harness was removed afterward. No registration submission or live OTP
email was tested in the browser, and no mobile or dark-theme pass was performed.
