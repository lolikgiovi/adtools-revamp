# HTML notification Velocity validation

Verified locally on 2026-10-26.

HTML Template has a Velocity Context JSON section below the source editor. Validate Velocity sends the unmodified source and parsed context to `config.velocityValidator.notificationUrl` as a JSON POST with `isAddFunction: true`. The Settings button focuses Notification Template Endpoint. Existing Velocity Template requests retain their original JSON payload without the notification flag.

Successful HTML responses (including a JSON string containing HTML) appear in the existing preview. The original response is available under API response as plain text; non-2xx responses show their HTTP status and body without treating them as valid HTML. Context drafts persist in document records, including unfinished JSON, and copy with duplicate tabs. Changes invalidate pending requests and results.

## Repeatable browser check

1. Run the already-installed Vite server with `npm run dev`.
2. Open <http://localhost:1234/tools/html-editor/tests/notification-check.html>.
3. Wait for the title `PASS: HTML notification validation`.
4. Expand Browser verification results to review all 11 checks.

The fixture mounts the actual editor with Monaco and the real JSON transport. It intercepts only its fixture endpoint with synthetic responses and uses an in-memory document store. It restores the previous notification endpoint setting after running. It does not call the corporate sandbox or use the pasted transaction data.

Passing browser checks:

- Context appears below HTML Template.
- Invalid JSON stays local.
- Duplicate preserves unfinished context.
- Switching tabs restores unfinished context.
- Document saves retain the raw context draft.
- Format JSON works.
- Notification request includes the exact source, parsed context, and `isAddFunction: true`.
- API output previews without replacing source.
- HTTP 503 retains the API diagnostic.
- Repeated clicks submit once while pending.
- Edited inputs reject a late API response.

Screenshot: [editor.png](editor.png). Captured at the narrow layout with White BG enabled so the returned HTML is readable.

## Automated checks

```sh
./node_modules/.bin/vitest run frontend/tools/html-editor/tests frontend/tools/velocity-template/tests/validator.test.js frontend/tools/velocity-template/tests/validator-ui.test.js
```

Result: 8 files, 72 tests passed.

Production bundle: `./node_modules/.bin/vite build --outDir /tmp/adtools-html-notification-validation-build` passed (2,496 modules). Existing import/chunk-size warnings remain.

## Limits

The sandbox API was not called. Live endpoint response envelopes and native desktop networking remain unverified. Responses containing a JSON object remain visible in API response; only raw HTML or JSON string responses are decoded for HTML preview. Browser calls require the endpoint's existing CORS/HTTP permissions. Desktop uses the existing native Velocity HTTP command.
