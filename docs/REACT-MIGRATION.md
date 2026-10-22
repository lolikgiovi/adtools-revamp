# Frontend migration to React

Status: migration planning reference. React migration work continues in a separate worktree; the unused preview scaffolding has been removed from this checkout. The production entry point remains `frontend/index.html`.

## Goal and boundaries

Keep Vite, the Worker API, and the Tauri wrapper. Move UI ownership from string templates and DOM mutation to React components so tools have a familiar structure and explicit state and cleanup. New UI code should use TypeScript once the React toolchain is installed. Preserve existing route IDs, web/Desktop capability checks, storage formats, usage events, and service behavior.

Use shadcn/ui for common controls and surfaces. Use TanStack React Table for hand-built _display_ tables, starting with a focused comparison of Feature Lockey, Image Checker, and Compare Config. Preserve Handsontable in Quick Query and Splunk Template for spreadsheet editing; TanStack Table is not its replacement.

## Recommended frontend choices

| Choice       | Recommendation                                                                                                                                                                       | Reason and limit                                                                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language     | Write new React components and their public contracts in TypeScript.                                                                                                                 | Type route data, service inputs/results, Worker responses, and Tauri capability results. Convert existing JavaScript services when their owner tool moves; avoid a repository-wide translation pass.                                  |
| Routing      | Keep `#<tool-id>` URLs. Evaluate React Router's `HashRouter` when the production shell moves.                                                                                        | Existing links and the Worker static asset fallback continue to work. Only one router may own URL changes, redirects, and route data at a time. Choose the production router in the migration worktree. |
| State        | Keep transient input/selection in the nearest component; put shared shell state in a small provider or external-store adapter; keep persisted data behind existing storage services. | Do not create a universal global store or mirror storage values in several components. Define ownership before choosing a state library.                                                                                              |
| Network data | Keep existing Worker API clients. Consider TanStack Query only when repeated remote reads, caching, invalidation, or request races warrant it.                                       | Query caching must not silently change authentication, freshness, or write behavior. It is not a prerequisite for the first React route.                                                                                              |
| Forms        | Start with controlled React inputs and shadcn fields. Introduce a form/validation library when several converted forms share substantial validation behavior.                        | Avoid adding a second source of truth for settings currently saved by services.                                                                                                                                                       |
| Tables       | Use `@tanstack/react-table` for suitable display tables; keep Handsontable for spreadsheet editing.                                                                                  | TanStack Table supplies table state, not spreadsheet editing or rendering. Preserve each screen's selection, copy, filters, pagination, and large-data behavior.                                                                      |
| Tests        | Prefer browser journeys for the migrated route and focused component tests for isolated interaction rules.                                                                           | A Vitest or build pass does not prove web or Tauri behavior. Keep a reproducible result artifact for significant end-to-end checks.                                                                                                   |

These are migration recommendations, not dependencies already installed or features already implemented. React's guidance on [state and effects](https://react.dev/learn/you-might-not-need-an-effect) is useful here: calculate values from existing state during render; use effects to synchronize with external systems such as Monaco, Handsontable, subscriptions, or browser APIs.

## Ownership contract for each converted route

Record this map before converting a tool. Keep it beside the tool or in its migration task so reviewers can compare old and new behavior.

| Question            | Required answer                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Route and access    | Exact hash path, startup redirect, web/Desktop visibility, and authorization checks.                                           |
| Transient state     | Inputs, tabs, selection, loading/error states, and whether navigation should retain or discard them.                           |
| Persisted state     | Exact localStorage/sessionStorage/IndexedDB/keychain keys and schema; when reads/writes occur; migration or fallback behavior. |
| Remote data         | Worker endpoints, request identity/cancellation, freshness rules, retry behavior, and mutation confirmation.                   |
| Native capability   | Tauri command/plugin/sidecar use and the behavior when running on the web.                                                     |
| Imperative widget   | Which component owns its DOM node, initialization, update, model/resource disposal, and cleanup after rapid navigation.        |
| Background work     | Timers, listeners, workers, streaming jobs, unsaved work, and whether inactive routes stay warm.                               |
| Observable behavior | Usage events, clipboard/download output, notifications, keyboard shortcuts, and focus restoration.                             |

React owns the markup inside a converted route. A legacy `BaseTool` owns only the DOM node handed to it by the bridge; React must not render children inside that node. An adapter for Monaco or Handsontable should likewise own one dedicated element and pair every created editor/grid/model/listener with cleanup. Preserve the current warm-cache behavior where a tool has active work; replacing it with unconditional unmount needs a deliberate behavior decision.

## Verification gates

1. **Before conversion:** capture the old route's behavior and storage contract. Include at least one normal path and its important failure or cancellation path.
2. **For each route:** exercise navigation into and away from the tool, rapid back-and-forth navigation, persistence after reload, relevant clipboard/download behavior, and any background work. Compare usage event names and payloads where they are a contract.
3. **For display tables:** verify sort/filter/pagination/selection semantics, empty and large datasets, keyboard behavior, and copy/export output. Keep Handsontable checks separate.
4. **Before production shell switch:** verify registration, global search, theme, release tour, update handling, connection indicators, analytics, and native-only visibility in both web and Tauri. Check the relative Vite asset base and packaged CSP.
5. **Evidence:** record the command, environment, result, and repeatable browser/Desktop steps. Label source checks, automated tests, browser runs, and packaged Desktop runs separately.

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
3. In the migration worktree, exercise an isolated proof: React owns navigation and UUID Generator; a legacy host mounts an unconverted tool. Check navigation, cleanup, clipboard, and analytics. Desktop capability gating remains a production-shell checkpoint.
4. Move the production shell to React. Preserve existing service behavior through adapters; keep legacy tools under a single host element. Test web and Tauri before each further tranche.
5. Convert simple tools and pages one at a time, reusing pure `service.js` modules. Convert complex editors/native tools only after their lifecycle, persisted state, background work, and cleanup contracts are documented.
6. Convert hand-built display tables by behavior, beginning with one of Feature Lockey, Image Checker, or Compare Config. A table is done only when its previous interactions and large-data behavior are preserved.
7. Remove the legacy host, old router, templates, and redundant CSS after the final route moves. Update `AGENTS.md` and `docs/AD_TOOLS_ARCHITECTURE.md` to describe the implemented architecture.

## Proof of concept status

The unused React preview entry point and source scaffolding have been removed from this checkout. Continue implementation and verification in the separate React migration worktree. This checkout retains the Vanilla JS production app and does not require React dependencies.
