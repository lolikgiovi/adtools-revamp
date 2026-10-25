# Compress Image / Quick Query integration verification

Verified locally on 2026-10-25. No deployment or packaged Tauri runtime verification.

## Reproduce

Use the installed project tooling from the repository root:

```sh
./node_modules/.bin/vite --port 1235
```

Open [the browser harness](http://localhost:1235/tools/compress-image/tests/quick-query-flow.html).
It displays a JSON PASS/FAIL report. Add `?review` to leave the returned attachments visible.
Port 1235 is a disposable test workspace: the harness resets only its Quick Query fixture tabs
and Compress Image workspace. It refuses to run on the normal app port, 1234.

The harness mounts the actual tools, executes their real image workers and IndexedDB transactions,
and reproduces the app's Compress Image unmount/remount behavior. It intercepts the final download
sink to inspect generated image/Base64/ZIP contents without writing files into Downloads.

## Recorded results

- [Browser report](./quick-query-flow-result.json): 23 passing checks.
- [Quick Query attachments](./quick-query-attachments.png).
- [Append / replace overlay](./quick-query-import-dialog.png).
- [Export filename and format overlay](./quick-query-export-dialog.png).
- [Existing browser regressions](./quick-query-flow-regressions.txt): 143 compressor checks and 28 PNG/JPEG variant checks passed.
- Existing Vitest scope: 40 files, 453 tests passed.
- Production frontend build: `./node_modules/.bin/vite build` passed.
- ESLint: no errors; existing Quick Query warnings remain.

Repeat the existing regression checks with:

```sh
./node_modules/.bin/vitest run frontend/tools/compress-image/tests frontend/tools/quick-query/tests frontend/core/tests/navigation-race.test.js
./node_modules/.bin/vite build
```

Coverage includes cold file/result/settings restoration, append/replace/cancel, atomic transfer limits,
PNG/JPEG/WebP workers, missing MIME metadata, conditional toolbar visibility, single and ZIP exports,
MIME-prefixed Base64, destination ordering, cancellation, unique filenames, preserving other attachments,
and creating a new query tab. Workflow dialogs are also checked for viewport centering.

Browser notifications say “Download started” because the browser does not expose final disk-write
completion. Desktop exports use the existing Tauri save dialog and filesystem plugins, reporting
“Saved” after writeFile resolves; that native path still requires a packaged-app check.
