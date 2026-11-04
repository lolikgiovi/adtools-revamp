Run Vite, then:

```sh
PLAYWRIGHT_MODULE=/Users/ddl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs node frontend/components/tests/global-search-catalog-browser.mjs
```

Fixture data only; external requests blocked. Timings include debounce and DOM rendering, on this machine.

- Unprefixed schema/table and filename suggestions, qualified names and qq: remain available; at most 8 results
- Legacy PlantUML workspace migrates to a filename catalog; table search reads keys, not schemas or rows
- Cold PlantUML navigation opens the selected file
- Renamed filenames update after committed saves
- Saved and deleted tables invalidate a separate search service
- 10,000 tables + 4,999 files: warm searches do no IndexedDB reads and complete within 250ms including debounce
- Content-only edits keep the filename index cached
- Committed tables and filenames from another browser window invalidate cached catalogs
- Quick Query search follows the selected project without leaking the previous catalog
- Rapid typing coalesces catalog work and only displays the latest query
