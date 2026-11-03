# AD Tools 1.3.14 verification

Release scope: project-specific environments and Quick Query work, plus the local PlantUML workspace.
Stable channel; optional update (`minVersion: 0.0.0`).

## Checks

- Release content contract passes without warnings.
- Frontend: 181 files, 1,855 tests pass.
- Worker integration: seven files, 87 tests pass.
- Rust: 56 tests pass using cached dependencies (`CARGO_NET_OFFLINE=true`).
- Desktop frontend production build passes.
- In-app browser: four release slides, Back, Done, replay, and Escape pass; see `browser-results.json`.

## Reproduce

Run `npm run release:content:check` and `CARGO_NET_OFFLINE=true npm run verify`.
Build with `CARGO_NET_OFFLINE=true npm run release:build`; select version `1.3.14`, no forced update, stable, and default notes.
Run `node docs/verification/release-1.3.14/verify-artifacts.mjs <release-directory>` to verify updater signatures,
archive layout/version, app architecture and code signatures, Oracle support files, and DMG checksums/integrity.
After publishing, run `node docs/verification/release-1.3.14/verify-production.mjs <release-directory>` to compare
both stable manifest routes, artifact sizes/ETags, and Web release identity against the local release.

Browser check: open `http://localhost:1235/?release-tour=preview` in a local Vite development server; advance through
all four slides, use Back, finish with Done, reopen via Preview What's New, and dismiss with Escape.

Both desktop architectures passed artifact verification, including updater signatures against the configured public key,
valid ad-hoc app signatures, version/architecture checks, bundled Oracle support, and installer checksums/integrity.
The Web production build also passed. Build output retains the existing Vite large-chunk warning.
Local command logs are retained under `tauri/releases/2026-11-03_10-50/verification/`.
