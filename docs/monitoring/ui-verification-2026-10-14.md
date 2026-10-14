# Monitoring Config UI and build verification — 2026-10-14 (Asia/Jakarta)

Verification layers are separate. The product is the existing Vanilla JS SPA and Tauri desktop app; the synthetic browser harness is not an Oracle proxy or a shipped entry point.

Checkout base: `41e5dbbb5df99041dedfdc9a539222ce34018c11`; verification was performed against the feature working tree before its commit.

## Source and build

- Focused domain tests were designed before implementation. They cover exact decimal normalization, changed-column planning, complete hierarchy cloning, compatibility-clone rejection, orphan preservation and protected parent references.
- SQL advisory scanner tests were written before the scanner. They cover binds hidden in comments, strings, alternative quotes and identifiers, plus uncertain wildcard/nested projections.
- `npm run build`: frontend/application suite **106 files / 1,255 tests passed**, Worker suite **5 files / 59 tests passed**, release content validation and Vite production build.
- `cargo check --offline --manifest-path tauri/Cargo.toml`: passed using installed dependencies.
- Native PyInstaller sidecar build uses the existing `tauri/sidecar/venv`; no dependency installation.
- New Monitoring source passes ESLint. Run Query retains its pre-existing warnings; no new lint errors.
- Impeccable mechanical detector returned `[]` for the new UI. The fresh [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) were reviewed against the new controls: labels, semantic buttons/tables, focus states, live status, overflow, empty/error/loading states and deferred large resources.

## Computer Use

The native development executable was wrapped in a temporary `.app` under ignored `tauri/target/debug` so Computer Use could attach to it. It uses the same compiled Tauri code and development webview, with the existing `adtools` development data store. This is development-build evidence, not a packaged release or UAT proof.

Native Oracle load confirmed `FREEPDB1` / `freepdb1` / `MONITORING` before editing. A synthetic menu (`E2E_MENU_0312DD3E094E411D`) title-only edit showed one changed field in Review, disabled edit/target/duplicate apply controls during preflight, returned **Committed** with change ID `824fbec7-a892-44b2-b507-c1247b882725`, and refreshed to zero pending rows. No UAT mutations were performed. Final native readback/history evidence is recorded below.

The repeatable UI harness is available while Vite runs:

```text
http://localhost:1234/tools/monitoring-query/tests/workspace.html
```

It uses the real controller, editor lifecycle and IndexedDB draft store with a clearly labelled synthetic service. Its actions never write Oracle. Use the synthetic connection and Load, Edit a menu label, Done Editing, Review Changes, Simulate Remote Edit, then Update Oracle to observe baseline/latest/draft conflicts. Keep Latest or Reapply Draft onto Latest resolves explicitly. Fixture regeneration may make an older saved draft's original row absent; Discard Draft then Load resets that test state. Draft restoration across fixture reload was observed.

Computer Use exercised explicit edit, title-only review, stale conflict rejection, generated standalone SQL, and disabled unverified runner handoff. Screenshots capture dark/light and normal/half-width desktop states, including loading and empty states. At 720px viewport width, the document width remained 720px and all footer actions stayed within the viewport. This harness has no app sidebar; native evidence includes the actual shell.

- [Normal dark](evidence/ui-dark-normal.jpg)
- [Normal light](evidence/ui-light-normal.jpg)
- [Half-width dark](evidence/ui-dark-half.jpg)
- [Half-width light](evidence/ui-light-half.jpg)

## Performance

No performance-trace/Chrome DevTools MCP tool was available. LCP, CLS, INP and cold-network timing were **not measured**; no Lighthouse or Core Web Vitals score is claimed.

Source/build evidence: tool registration uses a dynamic import; Oracle Monaco is loaded only when a SQL entity is inspected; package generation and ZIP export are deferred until requested. Lists use `content-visibility` and internal scrolling. Ordinary text edits do not rebuild the editor or list on every keystroke, and local draft persistence is debounced. No additional dependency or runtime was installed.

The Monitoring tool chunk is approximately 45.7 KB raw / 14.9 KB gzip and its deferred package chunk 36.8 KB raw / 11.5 KB gzip in this build. Existing shared Monaco/main chunks still trigger Vite's large-chunk warning; this feature does not claim to resolve the application's broader loading budget.

## Remaining external gates

- Jenkins PL/SQL, CLOB transport, atomic session, stop-on-error and explicit target mapping remain unverified. Open in Run Query is disabled, and managed package provenance/recognizable package headers are blocked before Run Query's generic validator and splitter.
- No UAT load, UAT writes, monitoring dashboard runtime rendering, cache refresh or installed release-bundle proof is claimed.
- Successful LOCAL fixtures and audit history are retained for inspection. No container restart/recreation or persistent-volume change occurred.

## Final native result

With the final native sidecar rebuilt, the second title-only native transaction committed as change ID
`198c0d66-296a-4104-b38a-eb68dbcba5e5`. Its draft survived switching to UUID Generator and back before apply. **Verify Database** then
completed through the freshly launched bridge and displayed **Verified · 0 pending rows**. The old, idle sidecar was stopped only after
commit confirmation so the next read-only request launched the rebuilt binary. Cold startup exceeded the bridge's existing readiness
timeout once; the UI retained Committed, and a read-only retry after the bridge became healthy completed verification. No write was
retried or duplicated.

- [Native verified state](evidence/native-verified.png)

Final CSS uses foreground-mixed error text so error messages retain contrast in both light and dark themes. The production UI was rebuilt
with the installed local Vite binary after this CSS-only adjustment; a final status-reset correction clears an old Verified/Generated message when another edit starts; focused checks passed afterward.
