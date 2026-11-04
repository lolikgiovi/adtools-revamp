# DBeaver schema paste modal

Verified 4 November 2026 against the local app. Clicking Paste from DBeaver now
opens a native modal containing a Handsontable sheet with the supplied DBeaver
Columns-view layout. The instruction names Copy Advanced Info. No clipboard read
permission is requested: users paste into the sheet themselves.

Convert schema validates the staged rows before applying them. It preserves field
types, Not Null values, zero and quoted defaults, and ordinal positions. Headered
pastes are mapped by header, including the existing Type Name/Default Value export
format. Headerless rows use the seven displayed columns. Primary keys are not
inferred. The footer explicitly states that conversion replaces this tab's schema
and clears its data, preserving the previous import behavior.

## Reproduce

Start the existing local Vite server in one terminal:

```sh
npm run dev -- --host 127.0.0.1 --port 1249
```

Then run from the repository root:

```sh
node frontend/tools/quick-query/tests/dbeaver-import-browser.mjs
./node_modules/.bin/vitest run frontend/tools/quick-query/tests
```

The browser runner uses installed Playwright and Chrome. It accepts
`DBEAVER_TEST_URL`, `DBEAVER_TEST_OUTPUT`, and `PLAYWRIGHT_MODULE` overrides. It
blocks non-local network requests and creates isolated development-user fixtures.
It writes `result.json` and desktop/mobile screenshots to this directory.

## Results

- All 383 tests across 32 Quick Query files passed.
- Six new import regression cases failed before implementation and passed after it.
- The browser runner passed at 1440px/dark and 390px/light with no page errors.
- Opening required no clipboard API read, even with clipboard access denied.
- Staging and cancellation preserved an existing schema and data row.
- Both headerless display rows and the legacy headered export converted correctly.
- Invalid input stayed in the modal and left the active schema unchanged.
- Cancel restored trigger focus; Escape closed the modal; navigation disposed it.
- The dialog remained within the viewport at both widths.
- Production Vite build passed; targeted ESLint and diff checks passed.

The clipboard fixtures are derived from the user's screenshot and the existing
export fixture. No running DBeaver application was inspected. The browser runner
dispatches a paste event with real clipboard data through Handsontable. A release
was not deployed.
