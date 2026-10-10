# Frontend migration to React

Status: proposed migration contract and isolated proof of concept. The production entry point remains `frontend/index.html`.

## Goal and boundaries

Keep Vite, the Worker API, and the Tauri wrapper. Move UI ownership from string templates and DOM mutation to React components so tools have a familiar structure and explicit state and cleanup. New UI code should use TypeScript once the React toolchain is installed. Preserve existing route IDs, web/Desktop capability checks, storage formats, usage events, and service behavior.

Use shadcn/ui for common controls and surfaces. Use TanStack React Table for hand-built _display_ tables, starting with a focused comparison of Feature Lockey, Image Checker, and Compare Config. Preserve Handsontable in Quick Query and Splunk Template for spreadsheet editing; TanStack Table is not its replacement.

## Source-level gap assessment

| Concern              | Current implementation                                                                                                      | Migration contract                                                                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry and deployment | `frontend/index.html`, `frontend/App.js`, `vite.config.mjs`; one `dist` for web and Tauri                                   | Keep the same output path, relative base, proxy, and Tauri CSP behavior. Add a React root only after a web and Desktop smoke pass.                                               |
| Navigation           | Hash router and tool IDs in `frontend/core/Router.js` and `frontend/config/tools.json`                                      | Preserve URLs and startup registration behavior. Move route ownership to one React router adapter, then remove the old router.                                                   |
| Tool lifecycle       | `BaseTool` mount/activate/deactivate, lazy imports, warm cache and background-work checks in `App.js`                       | Use one DOM boundary for legacy tools. React must not render inside that boundary. Migrate each tool to React before removing its `BaseTool` contract.                           |
| Shell services       | Registration, analytics, updates, release tour, theme, connection indicators, and global search are coordinated by `App.js` | Extract services or adapters before replacing the shell. Verify behavior in web and Tauri independently.                                                                         |
| UI                   | String templates, page/tool CSS, custom shared controls                                                                     | Add shadcn tokens/components; convert shell first, then simple tools, then editor/native tools. Retire old CSS by route as ownership changes.                                    |
| Tables               | Several hand-built display tables plus Handsontable spreadsheet grids                                                       | Audit sort/filter/pagination/selection/clipboard/virtualization on each display table. Move suitable tables to `@tanstack/react-table`; leave spreadsheet grids on Handsontable. |

## Sequence and checkpoints

1. Record a baseline: route list, storage keys, feature visibility, registration flow, representative screenshots, and web/Desktop smoke steps. Do not use only unit tests as evidence of browser behavior.
2. Install React, React DOM, the Vite React plugin, and shadcn prerequisites. Configure JSX/TypeScript, `@/` alias, theme tokens, and `components.json` without changing the production entry yet.
3. Exercise the isolated `frontend/react-preview.html` proof: React owns navigation and UUID Generator; a legacy host mounts unconverted tools. Check navigation, cleanup, clipboard, analytics, and Desktop capability gating.
4. Move the production shell to React. Preserve existing service behavior through adapters; keep legacy tools under a single host element. Test web and Tauri before each further tranche.
5. Convert simple tools and pages one at a time, reusing pure `service.js` modules. Convert complex editors/native tools only after their lifecycle, persisted state, background work, and cleanup contracts are documented.
6. Convert hand-built display tables by behavior, beginning with one of Feature Lockey, Image Checker, or Compare Config. A table is done only when its previous interactions and large-data behavior are preserved.
7. Remove the legacy host, old router, templates, and redundant CSS after the final route moves. Update `AGENTS.md` and `docs/AD_TOOLS_ARCHITECTURE.md` to describe the implemented architecture.

## Proof of concept status

`frontend/react-preview.html` and `frontend/react-migration/` are source scaffolding only. The required React packages are absent in this checkout and repository instructions prohibit agent installs. They are not part of the production build and have not been runtime verified. The preview is intentionally limited to UUID Generator and a legacy JSON Tools route; it does not substitute for the production shell's registration, updates, search, or Tauri workflows.

To enable the preview, a developer must run `npm install react react-dom` manually. The later production migration also needs `@vitejs/plugin-react`, Tailwind/shadcn prerequisites, and `@tanstack/react-table`; add those when their corresponding stage begins. Then run `npm run dev` and open `/react-preview.html`, followed by the unchanged production app at `/`. Promote the preview architecture only after the checkpoint above passes.
