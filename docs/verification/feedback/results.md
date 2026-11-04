# Feedback verification

Run: npm run dev, then node frontend/core/tests/feedback-browser.mjs

Email delivery mocked; desktop uses the shared shell with native calls stubbed.

- PASS web 1440px light: visible matching height; active tool/change tool; draft dismissal/retry; successful payload; focus restored; no overflow
- PASS web 390px github-dark-hc: visible matching height; active tool/change tool; draft dismissal/retry; successful payload; focus restored; no overflow
- PASS desktop 1440px github-dark-hc: visible matching height; active tool/change tool; draft dismissal/retry; successful payload; focus restored; no overflow
- PASS desktop 900px light: visible matching height; active tool/change tool; draft dismissal/retry; successful payload; focus restored; no overflow

Additional checks:
- 46 targeted API/service/connection tests passed.
- Full Node/JSDOM suite: all 1,967 assertions passed, but exit status was failure from two unrelated `CSS.escape` errors in `frontend/pages/analytics-dashboard/departments.js:110`.
- Worker suite: 95 assertions passed; dashboard-load suite could not load `node:sqlite` under the configured Worker compatibility settings.
- Production web and Tauri frontend Vite bundles passed. The normal `npm run build` prebuild gate stopped at the JSDOM errors above.
- ESLint: no errors; pre-existing warnings in App, analytics routes and connection indicators.
- Independent visual review: ship; all eight captures checked, existing tokens preserved.

Notification behavior:
- Uses existing RESEND_API_KEY / MAIL_FROM and FEEDBACK_EMAIL=fashalli.giovi@gmail.com.
- Both feedback endpoints store the note first, then await the notification attempt.
- Provider/configuration failures preserve the saved note and return notification_sent=false; the form reports this explicitly.
- No automatic retry of failed email notifications. Live delivery and packaged native runtime were not exercised.
- Provider request shape checked against https://resend.com/docs/api-reference/emails/send-email.
- No deployment performed.
