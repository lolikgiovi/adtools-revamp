# Image Checker metadata verification

Verified 2026-10-02 using Vite and the Codex in-app browser.

## Repeat the browser check

1. Run `npm run dev` from the repository root.
2. Open http://localhost:1234/tools/image-checker/tests/metadata-e2e.html.
3. Click **Run verification**. Expect **RESULT: 9 checks passed**.

The fixture mounts the actual Image Checker, loads a real 1600 × 900 PNG over HTTP,
and reads its 7189 response bytes. Oracle connection selection and query results use
fixtures; this does not verify an actual Oracle database or production CDN.
It leaves saved connections and CDN settings unchanged.

The checks cover cleaned UUID queries and chosen connection, actual dimensions and
CDN bytes, the width warning, context/subcontext lines, base64 text size, the details
dialog, independent Oracle failure, and disabling the optional lookup.

Screenshot: [metadata-e2e-result.png](fixtures/metadata-e2e-result.png).

## Automated checks

```sh
./node_modules/.bin/vitest run frontend/tools/image-checker/tests
./node_modules/.bin/eslint frontend/tools/image-checker
./node_modules/.bin/vite build
```

Result: 27 tests passed; ESLint passed; production bundling passed with existing
chunk-size and mixed-import warnings.

Rows are matched by `IMAGE_ID` or by the UUID inside `IMAGE_LINK`, and lookups are
chunked so each statement stays small. `metadata.test.js` covers the link-only match,
rows that match no requested UUID, and the statement size bound.

`oracle-control.test.js` covers the multi-select Oracle combobox: hidden in the web
app, hidden with a Settings shortcut on desktop until a connection is saved, selecting
several connections at once, selection kept across rebuilds and stale names dropped,
selection persistence (including the legacy single-connection value), the
`config.oracle.connections` deep link, and the disabled state during a run.

## Live desktop check

In Desktop, configure CDN Base URLs and Oracle Connections in Settings. The Check
Image toolbar labels its two comboboxes **CDN Environment** and **Oracle DB**; the
Oracle combobox appears only on desktop, and only once a connection is saved; until
then it offers **Set Oracle connections**, which opens Settings on that section.
Choose one or more Oracle DBs (or leave **No Oracle DB** to skip the lookup and hide
the Oracle metadata); each selected DB adds a record in the expandable Oracle metadata row beneath its image. Paste image UUIDs or
paths, and click **Check images**. Verify the table against matching CONTENT.IMAGE
rows. CONTEXT is line 1; SUB_CONTEXT is line 2. Base64 size is the UTF-8 byte size
of stored CONTENT, including its data URI prefix. CDN size is image response bytes;
when CORS or an HTTP failure prevents reading those bytes, it is **Unavailable**.
A width above 1440 px shows “Width exceeds 1440 px.” CDN payloads strictly above
300,000 bytes show “Over 300 KB.” Displayed KB use 1,000 bytes.

Live desktop Oracle and production CDN verification remains outstanding.

## Desktop byte measurement follow-up

Desktop now calls `measure_image_size`, which downloads the image through Rust
HTTP and counts response chunks. This bypasses WebView CORS without estimating
size from pixels or converting the image. Three focused tests verify native
routing, native failure handling, and browser byte measurement. Rebuild/restart
the desktop backend to load the new command. Browser mode still needs readable
CDN responses. Actual desktop/CDN integration remains unverified.

Current presentation and progress-header evidence: [presentation-verification.md](presentation-verification.md).
