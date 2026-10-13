# Quick Query imported BLOB output choice

Verified 2026-10-13 (Asia/Jakarta).

## Behavior

Generate Query now opens the existing BLOB choice dialog for Oracle-imported
Base64 data URIs as well as referenced attachments. Repeated imported values
count once, and empty imported BLOBs still trigger the choice.

- Embed BLOB content reconstructs the original bytes in PL/SQL.
- Keep placeholders for later generates regular SQL with `utl_raw.cast_to_raw('row-key')` for
  imported values. Keys follow the existing schema PK selection, including the
  first-column fallback; composite values are joined with a hyphen. Missing key
  values fall back to the BLOB field name. Quotes are escaped. This writes the
  placeholder text as bytes if executed; replace it before execution when the
  original bytes are required. Attached filenames
  retain the existing filename-as-bytes behavior.
- Cancel stops generation. Attachment-only labels reset on subsequent generation.

## Repeatable browser check

1. Run `npm run dev`. Open `http://127.0.0.1:1234/legacy.html`, then Quick Query.
   Vite may reload once while optimizing tool dependencies; reopen Quick Query.
2. Create a new query tab, table `TEST.BLOB_OVERLAY_CHECK`.
3. Set schema: `ID`, NUMBER, not nullable, PK Yes; `DOCUMENT`, BLOB, nullable.
4. Paste this TSV into the data grid (the data URI matches Oracle import output):

```text
ID	DOCUMENT
1	data:application/octet-stream;base64,AP8=
```

5. Generate Query. Confirm “BLOB content detected”, “1 imported BLOB value”,
   and both “Embed BLOB content” and “Keep placeholders for later”.
6. Choose placeholders; use Copy to inspect output. MERGE contains
   `utl_raw.cast_to_raw('1') AS document` with no DECLARE block or Base64 payload.
7. Generate again and embed. Copy contains a DECLARE block,
   `UTL_ENCODE.BASE64_DECODE(UTL_RAW.CAST_TO_RAW('AP8='))`, temporary BLOB
   append and cleanup, followed by the verification SELECT.
8. Close the temporary query tab.

Browser evidence from the initial overlay change: the rendered desktop UI opened
the choice for synthetic Oracle-format data, and both regular SQL and embedded
PL/SQL were inspected through Copy. The dialog rendered without clipping at
1280 x 720. That run used the earlier EMPTY_BLOB() placeholder. The subsequent
row-key placeholder change is covered by automated tests; the steps above are
updated for reproducing that behavior. No live Oracle fetch or database execution
was performed.

## Automated checks

Tests were added before implementation and initially failed for missing imported
value detection, prompt routing, label changes, and placeholder generation.

```sh
./node_modules/.bin/vitest run frontend/tools/quick-query/tests/blob-attachment-choice.test.js frontend/tools/quick-query/tests/query-generation.test.js
./node_modules/.bin/vitest run frontend/tools/quick-query/tests
./node_modules/.bin/vite build
git diff --check
```

Results: 99 focused tests passed; 311 Quick Query tests passed across 25 files;
Vite production build and diff whitespace check passed. The build was run directly,
without npm prebuild hooks or the full repository test suite. Existing source-map,
Moment deprecation, jsdom, and chunk-size warnings remain. Impeccable detector
reported no findings for the changed UI source.
