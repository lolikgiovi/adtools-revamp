# React tools: reference alignment

The user clarified on 2026-10-11 that the existing [AD Tools application](https://adtools.lolik.workers.dev/#home)
is the main UI reference. React migration changes the component implementation to shadcn; it does not authorize a separate design concept.
This supersedes the joined-workspace direction in the previous visual review. The chosen Mira/Base UI preset remains in place.

## Reference inspection

Inspected all six deployed tools through the user-provided browser tab at the real 778×959 viewport, navigating through the sidebar.
No forms were submitted, tool inputs edited, or user preferences changed on the deployed app.

| Tool         | Reference composition retained in React                                                                         |
| ------------ | --------------------------------------------------------------------------------------------------------------- |
| UUID         | Separate stacked Single UUID and Multiple UUIDs cards; quantity and bulk actions together above results         |
| Base64       | Underline operation tabs, standalone input/output groups, centered processing action between input and output   |
| JSON         | Underline operation tabs and input/output editor toolbars; supported narrow layout keeps usable bounded editors |
| Char Counter | Text workspace with summary/per-row toggle and counts grouped along the bottom; number above label              |
| TLV          | Separate input and results panels, format/parse header, input helper actions and result tabs                    |
| QR           | Separate configuration and preview cards, downloads with configuration controls, stacked at half width          |

Used the installed shadcn `TabsList variant="line"`, Card compositions, Field/FieldGroup, Input, Textarea, Button, and existing
Base UI Select/overlays. Consulted current shadcn component docs via its CLI. Removed the previous custom joined-card styling
for UUID/QR and the custom Monaco surface themes. Kept accessible labels, field validation, tab containment, keyboard handling,
disabled/loading states, download correctness, and draft cleanup from the earlier functional work.

## Verification

`npm run e2e` uses installed Chrome and four projects: 1280×900 dark/light and 820×900 dark/light, with one worker.
Tests cover existing transformation, copy, download, validation, navigation/persistence, keyboard, search, and recovery workflows.
Layout assertions protect horizontal bounds and tab containment. Bounded JSON, TLV, Char Counter, and QR fixtures must fit vertically.

Source base: `c0777120` plus the working-tree changes. Final source hashes, screenshots, E2E/build logs are under
`docs/evidence/react-tools-reference-2026-10-11/`. The previous visual pass's evidence is historical, not current screenshots.

**Results:** 60 E2E tests passed (1.5 minutes), TypeScript and React lint passed, formatting passed, and direct Vite production build passed. Existing large bundle warnings remain. Full legacy unit suite and `npm run build` were not rerun for this layout-only pass. Verification is browser-only; packaged Tauri and live backend workflows are outside this check.

## Reference-alignment screenshots

The subsequent [shared sizing pass](REACT-TOOLS-SIZING.md) contains the latest screenshots and verification.

- [base64-tools, dark](evidence/react-tools-reference-2026-10-11/base64-tools-desktop-dark.png) / [half-width light](evidence/react-tools-reference-2026-10-11/base64-tools-half-desktop-light.png)
- [uuid-generator, dark](evidence/react-tools-reference-2026-10-11/uuid-generator-desktop-dark.png) / [half-width light](evidence/react-tools-reference-2026-10-11/uuid-generator-half-desktop-light.png)
- [json-tools, dark](evidence/react-tools-reference-2026-10-11/json-tools-desktop-dark.png) / [half-width light](evidence/react-tools-reference-2026-10-11/json-tools-half-desktop-light.png)
- [char-counter, dark](evidence/react-tools-reference-2026-10-11/char-counter-desktop-dark.png) / [half-width light](evidence/react-tools-reference-2026-10-11/char-counter-half-desktop-light.png)
- [tlv-viewer, dark](evidence/react-tools-reference-2026-10-11/tlv-viewer-desktop-dark.png) / [half-width light](evidence/react-tools-reference-2026-10-11/tlv-viewer-half-desktop-light.png)
- [qr-tools, dark](evidence/react-tools-reference-2026-10-11/qr-tools-desktop-dark.png) / [half-width light](evidence/react-tools-reference-2026-10-11/qr-tools-half-desktop-light.png)
