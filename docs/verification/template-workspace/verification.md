# Template workspace verification

Date: 2026-10-26. Environment: local Vite server at `http://localhost:1234`, Codex in-app Chromium browser, 1280 × 720 viewport.

## Cause and implementation

Splunk's stylesheet contained global `.pane`, `.pane-header`, `.vtl-*`, `.handsontable-container`, and `[hidden]` selectors. Velocity imported that stylesheet directly. HTML also defined global `.pane` and `.editor-pane` selectors. These selectors allowed lazy-loaded tool styles to change another tool's layout.

The three editors now import scoped shared panel, header, button, and document-tab styling from `frontend/components/template-workspace.css`. Velocity no longer imports a sibling tool's stylesheet. Splunk uses the shared IndexedDB document store with its own database and legacy draft migration; Velocity keeps its existing database and API.

## Browser journey — PASS

1. Open Splunk Template from the sidebar. Existing template/context load into the first document. All three panels fit within the viewport; only their content scrolls.
2. Choose **New Splunk document**, enter `test=$context.value` in the template and `{"value":"tab-two"}` in Context Data. Result: `test=tab-two`.
3. Double-click its tab and rename it to **CSS isolation check**. Switch to the original document and back. Both template/context pairs remain independent.
4. Reload the page, reopen Splunk from the sidebar, and select **CSS isolation check**. Both drafts, the name, and rendered result survive reload.
5. Collapse and expand Splunk's source pane. Context Data receives the remaining vertical space. Switch to Table: its row shows field `test`, source `context`, value `value`. Return to Text.
6. Load HTML, then Velocity, then HTML again. HTML header padding remains `5.6px 8.8px`, tab height remains `38px`, and its intentional editor overflow remains `visible`. No document scroll overflow.
7. Collapse Velocity's source: grid rows are `42.1875px 529.812px`. Expand source and collapse context: rows are `529.812px 42.1875px`. Restore both panels.
8. Return to Splunk and press ArrowRight on its separator. Preview right edge is `1263.992px`, within workspace right edge `1264px`; no document scroll overflow.
9. Close the temporary **CSS isolation check** document. The original template/context and preview return. Closing the last document is disabled.

Evidence: [Splunk tabs and bounded panels](splunk-tabs.png), captured before removing the temporary document.

## Automated checks — PASS

```sh
./node_modules/.bin/vitest run frontend/tools/splunk-template/tests/ frontend/tools/velocity-template/tests/ frontend/tools/html-editor/tests/
./node_modules/.bin/vite build
git diff --check
```

15 test files, 124 tests passed. The new regression first reproduced global CSS matches against unrelated tool panels and now verifies isolation through imported stylesheets, plus cancellation of stale tab work when switching editor models. Production bundling passed with the bundle-size warning. Targeted ESLint completed with zero errors and 20 warnings.

Verification covers the local web application. Native Tauri behavior and narrower viewports were not exercised.
