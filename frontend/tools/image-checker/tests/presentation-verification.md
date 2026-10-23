# Image Checker presentation verification — 2026-10-22

## Repeat the browser check

Run the installed Vite binary from the repository root:

```sh
./node_modules/.bin/vite --host 127.0.0.1 --port 1248 --strictPort
```

Open `http://127.0.0.1:1248/tools/image-checker/tests/presentation-e2e.html`.
The page reports eight automatic checks: removed label controls, CDN-only matrix,
size warning, image/metadata filtering, inline Oracle expansion, overlay size alert,
and absence of document overflow. Choose Phone for a 390 px iframe, or Desktop
for the available desktop width. Replay check runs the real tool action with delayed
fixture responses: the one results header shows Checking images and the CDN count,
then changes to the outcome and filters with no progress bar. Cancel also clears
progress and shows Check canceled. Toggle theme provides a manual light-theme check.

Recorded browser result: all eight automatic assertions passed. Replay visibly
changed the same results header from Checking images / 0 of 8 CDN checks to
1 image with issues, with no progress indicator left. Desktop and 390 px views
were visually inspected.

Screenshots:

- [Loading](fixtures/presentation-loading.png)
- [Completed](fixtures/presentation-complete.png)
- [390 px layout](fixtures/presentation-phone.png)

These captures use a local PNG preview and illustrative CDN dimensions/bytes and
Oracle records. They do not establish production CDN, Oracle, or packaged Tauri
behavior. The existing metadata fixture separately loaded a real local PNG and
passed nine checks, including byte measurement and independent Oracle failure.

## Automated verification

```sh
./node_modules/.bin/vitest run frontend/tools/image-checker/tests
./node_modules/.bin/eslint frontend/tools/image-checker
./node_modules/.bin/prettier --check frontend/tools/image-checker
./node_modules/.bin/vite build
```

34 tests passed. The presentation tests cover >300,000 byte alerts (strict boundary),
unknown size, decimal KB display, removal of label controls, metadata filtering,
Tauri open_url routing, web fallback, and one header transitioning only after both
CDN and Oracle finish. Native opening is mocked; actual OS browser launch remains
unverified. The Impeccable detector returned no findings for the changed UI files.

ESLint and formatting of changed files passed; Vite production bundling passed
with the existing large-chunk warning. A whole-directory Prettier check also
reported pre-existing formatting in unchanged `icon.js`; that file was left alone.
The temporary verification server was stopped after the checks.
