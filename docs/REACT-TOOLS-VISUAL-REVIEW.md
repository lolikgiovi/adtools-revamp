# React tools visual review — 2026-10-11

Historical pass: the joined-workspace direction below was superseded by the user’s clarification that the deployed AD Tools UI is the primary reference. See [reference alignment](REACT-TOOLS-REFERENCE-ALIGNMENT.md) for the current direction and verification.

This pass addresses the user's rejection of the previous Base64 appearance. The earlier functional review is not evidence of visual acceptance.
Scope: all six migrated tools in `frontend/src/tools`, preserving the Mira neutral preset, Inter, Base UI, services, processing, persistence, and lazy routes.

## Direction and assessment

Operate mode: quiet developer workspaces, consistent compact controls, restrained hierarchy, and actions next to their subject.
The existing neutral palette remains authoritative: light background #ffffff, dark #0a0a0a, foreground #171717 / #fafafa,
with semantic muted/border tokens. Inter is for interface copy; monospace is reserved for code and generated data.
No decorative gradients, new fonts, dependencies, or page entrance animations.

| Tool         | Observed problem                                                                                   | Resulting composition                                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Base64       | Trigger taller than tab list, floating action below input, disconnected editors, heavy gray output | Native compact tab sizing; joined input/output workspace; encode/decode in input toolbar; matching editor surfaces                      |
| UUID         | Uneven standalone cards, small single-value field, weak relationship between workflows             | Joined asymmetric single/bulk sections, aligned section headers, readable single UUID, constrained quantity field                       |
| JSON         | Inconsistent toolbar surfaces, wrapped tab overflow, gray Monaco slab                              | Wrapped tabs with fixed trigger height, joined bordered workspace, quiet toolbar, matching light/dark Monaco surfaces and editor rhythm |
| Char Counter | Oversized data text and counts, heavy footer hierarchy                                             | Fixed text size, compact horizontal statistics, tabular numerals, consistent toolbar surface                                            |
| TLV          | Nested input borders and padding, disconnected panels                                              | Joined input/results, full input surface, restrained header and footer spacing, preserved bounded result scrolling                      |
| QR           | Large native color strips, downloads remote from preview, tall stacked layout                      | Compact labeled swatches with hex values, joined configuration/preview, downloads below preview, smaller half-width preview             |

## Skill application

- `frontend-design`: retained the product's explicit neutral identity and chose a joined workspace concept suited to transformations and inspection.
- `shadcn`: inspected `components.json` and installed Base UI Tabs, Card, Field, Input, and Button compositions; removed conflicting custom tab heights and retained existing control variants.
- `impeccable`: applied Operate, polish, and craft-floor guidance; inspected all six pages in a batched dark/normal and light/half-width round, fixed JSON wrapping and QR height, then confirmed the final matrix.
- `vercel-react-best-practices`: kept heavy Monaco behind its feature route; themes register at module scope, no editor recreation on typing, no layout reads in React render, no new per-keystroke effects.
- `vercel-composition-patterns`: reused existing primitives and composed input/output sections; no new boolean-configured universal tool component or parallel control layer.
- `web-design-guidelines`: checked fresh Vercel guidelines, focus/labels, long-content overflow, reduced motion, theme-native controls, and tab containment. Existing regression workflows verify keyboard actions and recovery.

## Reproduction and verification

Source base: `c0777120` plus this working-tree diff. Start local Vite on port 1234 (`npm run dev`).
Run `npm run e2e`: installed Chrome, one worker, normal 1280×900 and half-width 820×900, each in dark and light.
The suite checks UUID validation/copy, character counts/persistence, Base64 encode/decode/file downloads/preview,
JSON extraction/sorting/search/export, TLV parsing/recovery, QR rendering/download gating, and layout bounds.
Layout tests now assert every tab remains vertically inside its list, protecting the exact overflow defect;
QR joins JSON/TLV/Char Counter in the no-page-vertical-overflow assertions for these fixtures.

Screenshots and command logs are saved under `docs/evidence/react-tools-visual-2026-10-11/`.
Manual in-app browser check: Base64 text encode produces the expected visible result at the real 778×959 viewport.

Results: **60 Playwright tests passed** across all four theme/width combinations (1.9 minutes),
`npm run typecheck` passed, `npm run lint:react` passed, and direct `vite build` passed.
The production bundle retains the existing large Monaco/JSON and shell chunk warnings.
`npm run build` and the full legacy unit suite were not rerun for this visual-only pass.
Final screenshots confirm the repaired wrapped JSON tab row and visible half-width QR download actions.

| Tool           | Normal dark                                                                          | Half-width light                                                                           |
| -------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| base64-tools   | [Screenshot](evidence/react-tools-visual-2026-10-11/base64-tools-desktop-dark.png)   | [Screenshot](evidence/react-tools-visual-2026-10-11/base64-tools-half-desktop-light.png)   |
| uuid-generator | [Screenshot](evidence/react-tools-visual-2026-10-11/uuid-generator-desktop-dark.png) | [Screenshot](evidence/react-tools-visual-2026-10-11/uuid-generator-half-desktop-light.png) |
| char-counter   | [Screenshot](evidence/react-tools-visual-2026-10-11/char-counter-desktop-dark.png)   | [Screenshot](evidence/react-tools-visual-2026-10-11/char-counter-half-desktop-light.png)   |
| json-tools     | [Screenshot](evidence/react-tools-visual-2026-10-11/json-tools-desktop-dark.png)     | [Screenshot](evidence/react-tools-visual-2026-10-11/json-tools-half-desktop-light.png)     |
| qr-tools       | [Screenshot](evidence/react-tools-visual-2026-10-11/qr-tools-desktop-dark.png)       | [Screenshot](evidence/react-tools-visual-2026-10-11/qr-tools-half-desktop-light.png)       |
| tlv-viewer     | [Screenshot](evidence/react-tools-visual-2026-10-11/tlv-viewer-desktop-dark.png)     | [Screenshot](evidence/react-tools-visual-2026-10-11/tlv-viewer-half-desktop-light.png)     |

These are web checks, not packaged Tauri, live Worker, Oracle, or production verification.
