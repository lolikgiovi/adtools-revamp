# Lockey Update encoding stress test

Verified locally on 2026-10-21.

Run again from the repository root:

```sh
./node_modules/.bin/vitest run frontend/tools/lockey-update/tests/service.test.js frontend/tools/lockey-update/tests/main.test.js frontend/tools/html-editor/tests/encoding.test.js
```

Result: 117 tests passed across three files. Before the encoding validation change,
65 checks failed because unsafe input was accepted and SQL remained available.

Coverage:

- 21 unsafe inputs across localization keys, ID_VALUE, and EN_VALUE (63 cases).
- Curly quotes, en/em dashes, ellipsis, invisible spaces, Unicode separators,
  replacement characters, mojibake, accented/combining text, CJK, emoji, and lone surrogates.
- 1,000 rows with unsafe text in the first and final row, targeting four releases.
- Repeated unsafe characters produce one code-point entry per distinct character per field.
- ASCII apostrophes, hyphens, HTML, entities, tabs, and newlines remain accepted.
- Empty and ordinary space-only EN_VALUE/ID_VALUE values are allowed and preserved exactly.
  Empty-value notices are warnings, not blocking errors. Keys are trimmed and required;
  space-only keys fail. Empty unused rows are ignored. Non-ASCII spaces in values remain unsafe.
- UI lifecycle: valid SQL → unsafe input → key/field-specific errors, cleared SQL,
  disabled Copy/Download → correction → generation and actions restored.

The policy matches HTML Editor's non-ASCII Windows-import risk detection, but
Lockey Update treats these characters as blocking validation errors and does not
replace content. Example: `Lockey "accountStatusLabel" contains unsafe encoding
character in EN_VALUE: "’" (U+2019), "–" (U+2013). Replace before generating SQL.`

These are local Vitest service and DOM integration checks. The UI tests mock
Handsontable and Monaco; this run does not verify a real browser, Windows Toad,
or an Oracle execution. The existing UI validation gate blocks SQL generation.
