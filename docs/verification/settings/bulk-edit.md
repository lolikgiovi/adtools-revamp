# Shared settings Bulk Edit — 2026-10-22

## Behavior

Bulk Edit is available for every repeating settings type, including an empty list:

| Setting | JSON shape | Apply behavior |
| --- | --- | --- |
| Oracle | `[{"name":"DEV","address":"db.example.com:1521/DEV","username":"app","password":"example-only"}]` | Merge by exact name; omitted connections/passwords stay unchanged |
| Kafka | `[{"name":"DEV","brokers":"localhost:9092"}]` | Merge by name without changing saved IDs; omitted brokers stay unchanged |
| CDN / Lockey | `[{"key":"uat1","value":"https://example.com/"}]` | Replace list; preview additions, updates, removals, and unchanged rows |
| Merge SQL squads | `["capella","new-squad"]` | Replace list with validated unique tokens; preview removals |

All editors open in a shared native modal with trapped focus, a labelled heading, Close/Cancel/Escape support, and a visible action footer. Monaco stays on `vs-dark` in both light and dark application themes, matching JSON Tools. All editors share lazy-loaded Monaco, JSON syntax diagnostics, Format JSON, Preview Changes, Apply Changes, Cancel, error handling, stale-data checks, and model disposal. Input changes invalidate a preview. Models and their undo history are disposed on close, successful apply, settings rerender, and page deactivation. Bulk contents are not stored as drafts.

Oracle's visible form label is Database Address; saved metadata keeps `connect_string`. Usernames are loaded through the existing native username command; saved passwords are never returned to the editor. Supplied passwords go only through the existing credential command. An omitted password retains the saved password; a new connection needs a non-empty password. Validation finishes before writes. Native writes are sequential, not transactional; a failure reports the applied count and that credentials may already have been saved.

## Evidence

- 58 tests passed across four settings test files and the existing Kafka interaction test file.
- Oracle browser fixture: loaded address/username without password, formatted JSON, previewed `1 added · 1 updated · 1 unchanged`, applied DEV update and NEW addition, retained omitted KEEP, and reopened the editor.
- CDN browser fixture: replaced two environments with one; preview reported two removals and one addition; applied preview matched the new row.
- Squad browser fixture: replaced eight entries with two; preview reported seven removals, one addition, one unchanged; saved chips matched the replacement.
- Lockey at 390px: malformed JSON was blocked; corrected/formatted JSON previewed one update; apply refreshed the URL. Editor and actions fit without horizontal overflow. Actions sit below values at narrow widths.
- Kafka browser fixture: loaded Bulk Edit, previewed a new broker, cancelled, and confirmed no broker was saved. Stable IDs, omitted brokers, and save behavior are covered by focused tests.
- Modal preview/apply verified in a light application theme with dark Monaco. Native Escape closed the narrow modal and restored focus to Bulk Edit. Background controls were excluded from the active accessibility tree while the modal was open.
- Dark and light browser surfaces inspected. Production Vite build passed. Focused ESLint had no errors; existing warning patterns remain. Formatting and diff whitespace checks passed.

These are browser and mocked-adapter results. Native Keychain writes, packaged Tauri, and live Oracle/Kafka connections were not exercised. No real passwords were entered during verification.

## Reproduce

Run `npm run dev -- --host 127.0.0.1`, then open:

- `/pages/settings/tests/preview.html?category=oracle&theme=dark&json` — fake in-memory Oracle profiles and credential adapter. Open Bulk Edit, change DEV's address, omit KEEP, add NEW with an example-only password, preview, then apply. KEEP must remain; passwords must not appear when reopening.
- `?category=cdn&theme=light&populated` — replace the two seeded pairs with one, preview removals, and apply.
- `?category=merge-sql&theme=light` — use `["capella","new-squad"]`, preview, and apply.
- `?category=lockey&narrow&theme=dark&populated` — test malformed JSON, Format JSON, Preview Changes, Apply Changes, and the narrow layout.
- `?category=kafka&theme=dark` — preview a broker and cancel. Kafka uses this origin's browser storage; do not apply disposable profiles over real data.

The Oracle `json` fixture mocks username reads and credential writes. It never invokes native Keychain commands. Ordinary scalar credential actions and connection-test actions are not mocked and must not be triggered in this fixture.

Focused checks:

```bash
./node_modules/.bin/vitest run frontend/pages/settings/tests/oracle-json.test.js frontend/pages/settings/tests/oracle-json-ui.test.js frontend/pages/settings/tests/oracle-json-editor.test.js frontend/pages/settings/tests/bulk-list.test.js frontend/tools/kafka/tests/interactions.test.js
./node_modules/.bin/vite build --outDir /tmp/adtools-settings-build
```

[Final modal](bulk-edit-modal.png) · [earlier inline editor](bulk-edit-monaco.png) · [earlier 390px inline layout](bulk-edit-narrow.png)
