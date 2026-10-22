# Settings UI verification — 2026-10-22

## Result

Browser verification passed for the shared settings UI. Web runtime gating remains in production code. Desktop-only settings were rendered with the browser fixture; native IPC, keychain writes, live Oracle/Redis/Kafka connections, updates, and packaged Tauri were not exercised.

- Web settings: shared 16px shell padding, compact rows, visible Edit buttons, aligned inline editor, Save/Cancel below the field. Labels use a 220px column; environment keys use 6rem, leaving the remaining width for URLs.
- Fixture: Enter saved `UI_REVIEW` as Jira Project Key; Escape discarded `DISCARD` and retained `UI_REVIEW`. Focus returned to Edit after both actions.
- Fixture: saved CDN row `REVIEW` / `https://example.com/assets`; formatted preview matched both values.
- Oracle fixture: opening Add Connection focused Connection Name. Submitting blank fields displayed the required-field message and focused Connection Name. Cancel closed the form.
- Dark web page and light 390px Oracle fixture inspected. Narrow form labels, fields, and actions fit the viewport.
- Production Vite bundle completed. Focused ESLint completed with no errors (existing warning patterns remain); diff whitespace check passed. Full test suite was not run.

## Reproduce

1. Run `npm run dev -- --host 127.0.0.1`.
2. Open `http://127.0.0.1:1234/`, choose Settings from the sidebar. Inspect padding and edit a field, then cancel.
3. Open `http://127.0.0.1:1234/pages/settings/tests/preview.html?theme=dark`.
4. Edit Jira Project Key, type `UI_REVIEW`, press Enter. Reopen, type `DISCARD`, press Escape. The preview must still read `UI_REVIEW`.
5. Edit CDN Base URLs; enter `REVIEW` and `https://example.com/assets`, then Save changes. Both values must appear in the preview.
6. Open `http://127.0.0.1:1234/pages/settings/tests/preview.html?category=oracle&narrow&theme=light`.
7. Click Add Connection, then Save Connection without entering data. Verify the error and focus, then Cancel. Do not enter real credentials or run connection tests in this fixture.
8. Use `?category=tool-settings&theme=dark&populated` to check long URL previews with sample values.
9. Use `?category=jenkins&theme=light` or `?category=redis&theme=dark` for desktop-only form layout inspection. Add `&narrow` for a 390px iframe.

The fixture renders real settings components with in-memory SettingsService values and exposes desktop-only configuration without changing production gates. Kafka profile helpers and section expansion still use browser storage; do not save Kafka profiles in the fixture. Native actions are not mocked and must not be triggered.

Screenshots: [compact web editor](desktop.png), [narrow Oracle form](narrow-oracle.png), [final URL column layout](url-layout.png). The first screenshot predates the final label-column adjustment.

Bundle check: `./node_modules/.bin/vite build --outDir /tmp/adtools-settings-build` (direct Vite invocation; no prebuild suite or version generation).

## Service grouping follow-up

- Top-level groups: Appearance, Jenkins, Confluence, Jira, Database, Kafka Connections, Tool Settings, Updates.
- Database has Oracle and Redis subsections. Tool Settings has CDN, Lockey, Merge SQL, and Velocity API Validator subsections.
- Compared every field against the configuration before regrouping, including inherited `requiresTauri`: all keys, storage keys, types, defaults, validation, descriptions, options, and effective desktop gates matched. No settings migration is needed.
- Browser fixture verified Jira URL/project/certificate/PAT together; the web fixture hides PAT fields, Database, and Updates.
- Nested focus handoffs verified with every section initially collapsed: Redis Database expands Database → Redis and focuses Edit Redis Database; Validator API URL expands Tool Settings → Velocity API Validator and focuses its Edit button.
- Light Database grouping inspected at 390px. Section headings are h3, subsection headings h4, and nested sections use flat separators, indented headings and content, and a 1px vertical guide.
- Production Vite bundle and focused ESLint completed (no lint errors). No native credentials or connection actions were executed.

Reproduce nested handoffs with `/pages/settings/tests/preview.html?focus=config.redis.database` and `?runtime=web&focus=config.velocityValidator.url`. Inspect narrow groups with `?category=database&narrow&theme=light`.

Screenshots: [Jira group](jira-group.png), [narrow Database group](database-group.png), [desktop subsection hierarchy](database-desktop.png).

## Trailing shell padding follow-up

The scrollable shell's `main-content` used `flex: 1` with a zero flex basis. Its settings child overflowed the shortened flex item, so the shell's bottom padding appeared before the end of the page. Settings now use `flex: 1 0 auto` on their containing shell content; the existing 16px padding remains the only outer inset.

Measured in the full local browser app at 1280×720: before, the content wrapper was 663px high while settings were 868.195px high; after, the wrapper was 900.195px high with the same page height and exactly 16px from page bottom to content-wrapper bottom. At the bottom of the shell scroll, the last category ended at y=704 with the viewport ending at y=720.

[Bottom spacing](bottom-spacing.png). This verifies shared browser layout; the user's packaged Tauri window was not driven.
