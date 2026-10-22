# Unified search browser verification

Verified on 2026-10-22 against the real Master Lockey class, template, and styles.
The browser fixture supplies two sample rows and suppresses analytics. Clipboard writes are captured
in the fixture's Copied text output so copy payloads can be inspected without changing the system clipboard.
This verifies browser UI and clipboard payload generation, not Tauri cache, packaged desktop, native clipboard,
or remote data fetching.

## Reproduce

1. Run `npm run dev` and open `http://127.0.0.1:1234/tools/master-lockey/tests/search-modes.html`.
2. Confirm there is one search field and no Single / Bulk switcher. Before loading data, the toolbar,
   missing-key option, filters, and copy buttons are disabled and the globe empty state is visible.
3. Click Load sample data. Enter `welcome,` then a newline, `continueButton`, then a newline, `missingKey`.
   The field grows to fit the lines. With Show missing keys unchecked, expect the two existing rows.
4. Check Show missing keys. Expect `2 found, 1 not found` and a missingKey row with Not found language values.
5. Select Not Found Only. Expect only missingKey. Uncheck Show missing keys; expect Show All and both existing rows.
6. Check Show missing keys and click Copy Results. Inspect the Copied text output: headers Lockey, EN, ID;
   both existing keys with their translations; missingKey with Not found values.
7. Select Search by Content, clear the field, and enter `Welcome`. Press Cmd+Enter (Ctrl+Enter on Windows/Linux).
   Expect one result and disabled missing-key controls. Clear restores all loaded rows and the compact field height.
8. Click Toggle narrow layout. At 620px, confirm the field, options, counts, and table fit without overlapping.
9. Click Empty state. Confirm the same globe empty state and disabled toolbar remain visible.

## Recorded result

- Passed: mixed comma/newline input, automatic field growth, case-insensitive partial search.
- Passed: missing-key rows, missing-only filtering, normal results restored when unchecked.
- Passed: Copy Results payload capture includes all visible rows and language columns.
- Passed: content search, disabled missing-key controls in content mode, Clear resets results and field height.
- Passed: empty-state disabled controls and standard / 620px layouts.
- Focused suite: 102 tests passed in main.test.js and service.test.js.
- New service cases were written first and failed before implementation; they cover separator mixing,
   blank queries, duplicate missing keys, case-insensitive partial matches, and whole-word matching.

Final screenshot: `/tmp/master-lockey-unified-search.png`.

## Toggle and disabled-control follow-up

- Show missing keys and Match Word now use Quick Query-style switches beside Show All.
  Match Word retains whole-word behavior; it does not enable case-sensitive matching.
- Verified both switches expose their boolean state and update the visible rows.
  With `welcome` and `missingKey`, whole-word on reports both missing; off finds welcomeTitle.
- Verified standard and 620px layouts: both switches and Show All remain together, with copy actions alongside.
- Verified disabled wrappers compute `cursor: not-allowed` and provide the load-data explanation.
  Keyboard focus exposes the same visible explanation without needing to hover a disabled native control.
- Verified switching Show missing keys off disables Show All with the explanation
  `Turn on Show missing keys to filter results.` Enabling it removes the disabled reason.
- Existing focused suite remains at 102 passing tests. Focused ESLint has no errors and two existing warnings.

Screenshots: `/tmp/master-lockey-search-toggles.png` and `/tmp/master-lockey-disabled-explanation.png`.

## Two-row layout follow-up

- Row 1 contains the full-width multiline search field and its integrated clear action.
- Row 2 orders Search by Key/Content, Match Word, Show missing keys, and Show All.
- Browser measurements confirm all four visible controls are 32px high and share the same top edge.
- Verified at standard width and a 620px tool container. Copy actions wrap beneath when needed;
  the four search options stay together at 620px.
- Screenshot: `/tmp/master-lockey-two-row-search.png`.
