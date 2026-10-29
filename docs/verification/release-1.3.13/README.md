# AD Tools 1.3.13 verification

Release scope: Run Query and Run Batch visibility for every department, including missing profile fields, and HTML Template focus mode.

## Automated checks

- Release content validation passes.
- Visibility regression: 12 tests pass, covering home/sidebar discovery, pinned navigation, direct links, and desktop-only behavior.
- Full Vitest suite: 1,824 tests pass; six failures reproduce on the unchanged main revision `68a048f7`.
- Existing failures: two dashboard device-exclusion cases and one dashboard person case (`column index out of range`), plus three Windows-1252 encoding cases.
- Worker integration: 87 tests pass.
- Rust: 56 tests pass.
- Vite production frontend build passes.
- ESLint on changed JavaScript: zero errors; existing warnings remain.
- HTML focus browser fixture and prior screenshot: [HTML focus verification](../html-focus/README.md).
- Browser verification could not be repeated in this session because local browser use is disabled in Work settings.

## Reproduce

Run `npm run release:content:check`, then `./node_modules/.bin/vitest run frontend/core/tests/retail-tool-access.test.js`.
Run `npm run test:ci` to reproduce the complete suite, and `npm run test:worker` for Worker integration checks.
Run `CARGO_NET_OFFLINE=true npm run test:rust` with existing cached Rust dependencies.

The release was built from an isolated copy of the staged release files using existing dependencies. Unrelated local analytics changes were excluded.
The normal release verification hook encountered the existing failures above. Verification was run separately, and packaging resumed with npm lifecycle hooks disabled; no dependencies were installed or downloaded.
