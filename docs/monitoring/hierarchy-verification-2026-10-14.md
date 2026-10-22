# Monitoring hierarchy verification — 2026-10-14

Scope: Vanilla JS Monitoring Config UI. Browser checks used the existing synthetic workspace with the real controller and draft store; no Oracle writes or native application verification were performed.

## Reproduce

1. Run `npm run dev` and open `http://localhost:1234/tools/monitoring-query/tests/workspace.html`.
2. Select Synthetic LOCAL and Load. Existing synthetic local drafts may restore a different menu title.
3. Confirm the Channel label and indented menu, Summary queries / Detail queries counts, and Fields / Columns counts in their respective query lists.
4. Open Synthetic detail, then Synthetic value. Confirm the breadcrumb includes the menu, Detail queries, Synthetic detail and Synthetic value. Click the query ancestor and then the section ancestor to return.
5. Repeat with Synthetic long CLOB group and Synthetic count under Summary queries. Confirm the group ancestor is present.
6. Open Compatibility (0): empty message and read-only explanation remain visible.
7. Switch Theme and check at the default desktop viewport and 720 × 900. At 720px, document scroll width was 720px; query controls remained visible.

## Results

- Both query branches, mapping ancestor navigation, query counts and mapping counts passed browser interaction checks.
- Dark/light layouts inspected at 1280 × 720 and 720 × 900.
- Eight existing domain and SQL-analysis tests passed; changed JavaScript passed ESLint.
- Impeccable detector returned `[]` for the production markup changes.
- Local Vite production build passed (existing large-chunk warning).
- Duplicate-name ID display checked in source only; the browser fixture contains one menu.
- Fixed the fixture's missing shared dropdown stylesheet so browser evidence reflects the application control styling.

Evidence: [dark desktop](evidence/hierarchy-dark.png), [light half width](evidence/hierarchy-light-half.png).
