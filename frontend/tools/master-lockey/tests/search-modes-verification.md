# Search mode browser verification

Verified on 2026-10-22 against the real Master Lockey class, template, and styles in a browser fixture.
The fixture supplies two sample rows and suppresses analytics; it does not invoke Tauri cache or remote data services.
This is browser UI evidence, not packaged desktop or live domain-fetch evidence.

## Reproduce

1. Run `npm run dev` and open `http://127.0.0.1:1234/tools/master-lockey/tests/search-modes.html`.
2. Select Single if Bulk was previously saved. Confirm Search Lockey and Extract Lockey from Confluence are the only top-level tabs.
3. In the empty state, confirm the search bar is visible, its controls are disabled, and Single / Bulk remains enabled.
4. Click Load sample data. Enter `welcome` in single search; expect one matching row.
5. Switch to Bulk, enter `welcomeTitle` and `missingKey` on separate lines, then click Search.
   Expect two results: one found and one not found, with EN/ID values for welcomeTitle.
6. Click Toggle narrow layout. Confirm the compact multiline input, inline actions, and switcher fit; hints and counts wrap when needed.
7. Switch to Single. Confirm the `welcome` query and one matching row remain and the toolbar fits.
8. Switch back to Bulk. Confirm the input and results remain.
9. Return to Single and click Empty state. Confirm the search bar remains visible and disabled.
10. Reload. Confirm the selected mode is restored.

## Recorded result

- Passed: empty-state toolbar visibility and disabled controls, enabled mode switcher, search enabled after loading sample data.
- Passed: single filtering, bulk found/missing results, retained single query, retained bulk input/results.
- Passed: standard browser layout and 620px tool container layout for both modes.
- Aligned both modes: compact input toolbar, switcher at right, hint/count below, shared table styling.
- Bulk filter and copy actions follow the table; multiline entry remains supported and resizable.
- Passed: Clear removes bulk results and resets the result count.
- Passed: mode restored after reload.
- Existing Master Lockey suite: 98 tests passed across main.test.js and service.test.js.
- Focused ESLint: no errors; two pre-existing warnings (matchedPages assignment and unused rows binding).

Empty-state screenshot: `/tmp/master-lockey-empty-search.png`.

Aligned bulk layout screenshot: `/tmp/master-lockey-aligned-bulk.png`.
