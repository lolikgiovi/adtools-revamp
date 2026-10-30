# Dropdown layering verification

Run Vite (`npm run dev`), then use an already installed Playwright module:

```sh
PLAYWRIGHT_MODULE=/Users/lolik/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs \
node frontend/components/tests/dropdown-layering-browser.mjs
```

Set `DROPDOWN_TEST_URL` if Vite uses another address (default: http://localhost:1234).
No packages or browsers are downloaded. The test uses installed Google Chrome,
blocks external requests, and uses isolated browser storage with fixture registration.

The test checks Settings Project Selection, sidebar Project Selection, and the real
Master Lockey fixture at 1440px and 620px. Menu corner hit tests must reach the menu,
and its bounds must remain within the viewport. It also checks a dropdown inside a
modal dialog with a transformed, clipped parent and a covering sibling, using both
the native Popover API and the older-browser fallback. Search, pointer selection,
Escape, and outside-click dismissal are exercised.

Before the fix, the transformed/clipped dialog case failed with:
`dialog-true-1440: menu is covered or clipped`.

The cause is fixed-position menus remaining inside ancestor clipping and stacking
contexts. Open menus now use the browser top layer; older browsers move menus to
the document body or their native dialog and restore them on close.

Results are recorded in [result.json](result.json), with one screenshot per scenario.
Native macOS/Tauri rendering was not exercised; the fallback was forced in Chrome.

The existing focused component suite also passes (4 tests):

```sh
./node_modules/.bin/vitest run frontend/components/tests/searchable-dropdown.test.js
```

## Adaptive menus

Shared single-select controls now use a plain custom list for zero to three options,
and show search at four or more. Counts include all native option entries. The
short-list appearance follows the Velocity result-type menu: compact padding, a
checkmark, neutral hover/focus highlight, and no shadow. Both modes retain the
layering fix, and short menus expand enough to read their option labels.

The browser test also covers counts 0, 1, 2, 3, 4, and 8; filtering and selection;
live transitions in both directions while open; focus transfer; disabled-option
skipping with the keyboard; Home/ArrowDown/Enter; and native change-event counts.
The initial updated browser test failed before implementation because the two-option
dialog still displayed search. The shared unit fixture uses four options to retain
its search-specific coverage. All 1,844 frontend tests pass.

This applies to selects handled by SearchableDropdown, including controls mounted
later by tools and Settings. Editable Kafka suggestions, tags, checkbox multi-selects,
and explicitly opted-out native selects retain their existing behavior.
