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

## Multiline content search follow-up

- Content search accepts one phrase per line (LF or CRLF), skips blank lines, and matches any phrase
  across the language columns. Commas remain literal content.
- Match Word applies to every phrase. Highlights identify every matching phrase independently.
- Added seven tests before implementation covering multiline filtering, whole-word rules, language
  restrictions, punctuation, and highlighting. All 109 focused Master Lockey tests now pass.
- Browser fixture: select Search by Content and enter `Welcome` and `Lanjut` on separate lines.
  Verified both sample rows appear, with `Welcome` highlighted in EN and `Lanjut` highlighted in ID.
  Verified enabling Match Word keeps both exact-word matches.
- Screenshot: `/tmp/master-lockey-multiline-content.png`.

## Viewport and virtualization follow-up

- The fixture now includes the real `.tool-root` wrapper and a Load 5,000 rows action, with long wrapped
  content in every fifth row. The wrapper reproduces the app's otherwise indefinite percentage height.
- Before the fix, the large fixture's table was 211,519px tall, exceeded the 720px viewport, and had
  no internal overflow despite rendering only 160 data rows plus a spacer.
- The tool now uses the same viewport/native-titlebar height convention as Lockey Update; the table
  and nested flex panels can shrink, while tabs and search controls retain their height.
- After the fix, the table bottom measured 690.5px in a 720px viewport. The table scrolled internally;
  End reached key04999 with only 40 rows in the DOM at the bottom. Initial rendering remained bounded
  to 160 data rows and a spacer.
- Verified multiline search at 620px width: table height shrank to 347px, bottom stayed at 690.5px,
  and document scrollHeight stayed at 720px. The search controls remained above the scrolling table.
- Reproduce: open the fixture, click Load 5,000 rows, focus the Lockey results region, and press End.
  Inspect the final key and compare the region's clientHeight/scrollHeight and rendered row count.
- No virtualization matching or row-sizing algorithm was changed; this fix bounds its scroll viewport.

## Searchable dropdown layering follow-up

- The fixture now enhances its native selects with the same SearchableDropdown component used by BaseTool.mount,
  and supplies three sample domains. This reproduces the actual combobox overlay rather than a native select popup.
- Reproduced: the lower domain option was covered by the table header. DOM hit-testing at that option returned `<th>ID</th>`.
- Scoped `isolation: isolate` on the table scroll container keeps sticky table headers/cells in their own stacking context.
- Verified: the same hit-test now reaches the uat3 option. All options are visible above the header at standard and
  620px widths; the menu stays within the viewport, and the table remains viewport-bounded.
- Reproduce: load sample data in the fixture and open Pick Domain. The menu must remain above the table header.
- Screenshot: `/tmp/master-lockey-dropdown-layering.png`.
