# Registration department, role, and admin alerts

Failure cases to verify before implementation:

- Only the exact bankmandiri.co.id domain may register; Gmail, subdomains, suffix lookalikes, whitespace within addresses, and multiple @ signs must be rejected before any OTP/request persistence.

- New OTP and manual requests must require both fields. Existing stored approvals can still complete; omitted metadata during that legacy completion must not erase saved user metadata.
- All six departments and both roles must pass; unknown strings and non-string values must fail before consuming an OTP or storing a request.
- Both registration UI surfaces must submit and restore department and role in OTP and manual flows.
- Approval completion must use stored request metadata; the admin list must expose it.
- A new manual request triggers one notification; requesting an existing request triggers none.
- Only a new verified OTP user triggers an alert; repeated OTP authorization triggers none.
- Missing notification configuration must send nothing; provider rejection, timeout, or network failure must not fail registration.
- Alert content must not contain OTP codes, bearer tokens, or approve-without-login links.
- Database migration must preserve existing RETAIL values while accepting all new values.

Verification results and reproduction commands will be recorded after implementation.

## Behavior and notification setup

Department and role are mandatory in the registration page, shared access overlay,
new OTP requests, OTP verification, and new manual approval requests. Historical
approved requests can still complete without these fields. Database columns remain
nullable to preserve historical users and approvals. Role is profile metadata,
not an authorization permission.

Departments: RETAIL, SME, NBDS, ENTERPRISE, PARTNERSHIP, WHOLESALE.
Roles: ANALYST, ENGINEER.

`REGISTRATION_ADMIN_EMAIL` is configured as `fashalli.giovi@gmail.com` for both
Wrangler's default and production vars. The existing `RESEND_API_KEY`, `MAIL_FROM`,
and `MAIL_FROM_NAME` settings are reused. Set the admin email to an empty string to
disable alerts. New manual requests send a plain-text alert with a dashboard link;
existing request lookups do not resend it. New users completing OTP verification
send an informational alert; existing users reauthorizing do not. No OTP or session
token is included. Alerts use a per-request Resend idempotency key, a five-second
timeout, and best-effort logging on failure. There is no automatic retry queue.
See [Resend's idempotency documentation](https://resend.com/blog/engineering-idempotency-keys).

Production deployment must apply D1 migrations before activating the Worker code:

```sh
./node_modules/.bin/wrangler d1 migrations apply adtools --remote
./node_modules/.bin/wrangler deploy --env=""
```

These remote commands have not been executed as part of this change. Live email
delivery has not been tested.

## Repeatable verification

```sh
./node_modules/.bin/vitest run frontend/pages/register/tests/main.test.js frontend/components/tests/otp-overlay.test.js backend-workers/tests/auth.test.js backend-workers/tests/approval.test.js backend-workers/tests/registration-notification.test.js
./node_modules/.bin/wrangler d1 migrations apply adtools --local
npm run build
```

The 45 focused tests pass. Migration 0027 applied successfully to local D1
(0026 was already applied locally). The mechanical UI detector reported no findings.

Browser verification uses the actual RegisterPage implementation through the
[standalone preview](verification/registration-profile-preview.html). To reproduce,
run `npm run dev`, then open:

`http://localhost:1234/@fs/Users/ddl/projects/ad-tools-revamp/docs/verification/registration-profile-preview.html`

Fill Display Name and a @bankmandiri.co.id Email, then request manual approval with both dropdowns empty:
`Please select a department.` appears. Select NBDS and request again:
`Please select a role.` appears. Select ANALYST; both values appear selected. All six
departments and both roles were observed in the browser's accessibility tree. Only
one access-method button is visible. The browser check does not submit an actual
registration or send email; full HTTP flows and notification outcomes use mocked
fetch/database statements in the automated tests.

## Exact email domain

Registration accepts only `@bankmandiri.co.id`, case-insensitively, with surrounding
whitespace removed. Gmail, subdomains, suffix lookalikes, and multiple `@` signs are
rejected in the frontend and API before OTP persistence/consumption or a new manual
request is stored. This registration policy is fixed independently of configurable
managed-config allowlists. The notification recipient is separate and may use Gmail.
Existing approved requests whose email is outside Bank Mandiri cannot create a new
session through registration completion.

The browser check filled `preview@gmail.com`, WHOLESALE, and ENGINEER. Request Manual
Approval displayed `Use your @bankmandiri.co.id email.` without creating a request.

Final `npm run build` passed after all requirement changes: 1,271 tests across
105 files, followed by 79 tests across six isolated Worker test files. Release
content checks and the Vite production build also passed. Existing source-map and
large-chunk warnings remain. This is local verification, not production deployment
or live email-delivery proof.
