# React migration: requirements and foundation

Status: agreed migration direction and recommended implementation contract. This document describes the target; it does not claim that
the React foundation is implemented or verified. Recorded on 2026-10-10 for the `ad-tools-revamp-react` worktree and branch.

Read this document before designing the foundation or migrating a frontend tool. The existing architecture document describes the
vanilla implementation; this document owns the React migration direction. Keep implementation status and dated verification evidence
distinct from requirements.

## 1. User requirements

- Migrate the entire AD Tools frontend from vanilla JavaScript and custom UI infrastructure to React and TypeScript.
- Build a familiar, maintainable foundation that developers and agents can extend efficiently. Replace custom templating, pub/sub,
  notifications, and lifecycle infrastructure with established React and library patterns.
- Preserve business processes, calculations, service behavior, generated output, and user data. A visual port alone is insufficient.
- Use current stable React and Vite, shadcn components, Handsontable for editable spreadsheets, and TanStack Table for display tables.
  Initial display-table targets include Compare Config, Master Lockey, and Image Checker.
- Apply shadcn preset `b1Zzq9tHk`: Mira, neutral base/theme, Inter, Hugeicons, medium radius, subtle menu accents, default menu color,
  and blue chart palette. These values were confirmed through the shadcn CLI. Hugeicons is the chosen icon library.
- Reuse existing shadcn components and their composition patterns. Create custom UI only for a concrete capability they do not provide.
- Work in this isolated worktree. Intermediate app usability is not required; the branch may remain incomplete while tools migrate.
- Proceed autonomously with routine implementation choices. Raise material product or architecture decisions when necessary.
- The user explicitly authorized installing dependencies needed for this migration. This is a migration-specific exception to the
  existing repository installation restriction; it does not authorize unrelated downloads, production publishing, or deployment.

The scope is the frontend. Preserve the Worker API, Rust/Tauri backend commands, Oracle sidecar contracts, and deployment interfaces.
Frontend integration and configuration changes are in scope. A requirement to change backend behavior should be surfaced explicitly.

## 2. Recommended stack and rationale

| Area                  | Decision                                                            | Rationale                                                                                  |
| --------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Runtime and build     | React, React DOM, Vite, strict TypeScript                           | Fits a browser application distributed as static assets and embedded in Tauri.             |
| React tooling         | React Compiler, Strict Mode, TypeScript and React Hooks linting     | Establishes modern React conventions and exposes unsafe effects and lifecycle ownership.   |
| UI                    | shadcn with the supplied preset; Base UI primitives recommended     | Provides common accessible controls and overlays with consistent composition.              |
| Styling               | Tailwind CSS using shadcn semantic tokens                           | Keeps themes and component styling consistent; layout remains feature-specific.            |
| Routing               | React Router declarative mode with lazy tool routes                 | Gives navigation a standard owner without requiring an application server.                 |
| Remote data           | TanStack Query for reads that benefit from caching/invalidation     | Handles asynchronous data state without recreating request coordination throughout the UI. |
| Display tables        | TanStack React Table; TanStack Virtual where large datasets need it | Separates table state from rendering and preserves bounded rendering costs.                |
| Editable spreadsheets | Handsontable with its official React wrapper                        | Preserves spreadsheet editing, paste, selection, and existing processing workflows.        |
| Source editors        | Existing Monaco engine behind a focused React integration           | Preserves language behavior and editor capabilities while clarifying resource ownership.   |
| Verification          | E2E journeys plus existing meaningful engine tests                  | Verifies complete workflows while retaining coverage of precise processing rules.          |

Use latest compatible stable releases when implementation begins. Verify package engines, peer dependencies, compiler integration, and
widget compatibility; commit the resolved lockfile. Version observations from this discussion are not permanent pins. Introduce runtime
validation at API, import, and persistence boundaries where malformed data can reach business logic; TypeScript cannot validate them.
Add form or state libraries only when a migrated workflow establishes a concrete need.

### Why Vite rather than Next.js

AD Tools is dominated by client interactions: Monaco, spreadsheet editing, file processing, workers, IndexedDB, and native integrations.
The existing backend already supplies server operations, and the same frontend must run on the web and in a Tauri WebView.

Next.js supports SPAs and static export, but its server rendering and server functions offer limited benefit for this scope. Static export
also excludes features requiring a Next.js server. Adopting it would introduce additional rendering and export conventions without
removing the need to manage client data, drafts, or jobs. Reconsider it if requirements expand to server-rendered pages, SEO, or an
integrated application server.

Routing and remote-data management are separate responsibilities. Next.js would not automatically replace TanStack Query for client
reads against the existing backend. React Router owns navigation; TanStack Query owns suitable remote-data state. Use hash routing for
Web/Desktop compatibility and preserve existing `#<tool-id>` links, normalizing them at the routing boundary if the library requires a
different hash shape. Preserve handoff payloads such as generated SQL passed from Quick Query to Run Query.

## 3. Architecture and ownership

Recommended structure, with each tool recognizable and colocated:

```text
frontend/src/
  app/                       # entry, router, shell, providers
  components/
    ui/                      # generated shadcn components
    data-table/              # shared display-table composition
    editor/                  # Monaco integration
    spreadsheet/             # Handsontable integration
  platform/                  # browser/Tauri capabilities and native subscriptions
  services/                  # genuinely shared API/integration clients
  tools/
    compare-config/
      CompareConfigPage.tsx
      components/
      model.ts               # types, state transitions, derived values
      service.ts             # processing and workflow operations
      storage.ts             # persisted data ownership
      workers/
```

Create files and shared abstractions when needed. Small tools need fewer files; larger features may split engines, clients, and storage
further. Share modules after identifying actual shared behavior. Business services may remain ordinary functions or useful existing
classes; React does not require every operation to become a hook.

| Concern                   | Owner and rules                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Rendering and interaction | Components render JSX and call explicit operations. Use shadcn controls, feedback, and overlays.                                     |
| Navigation                | One React Router instance owns routes, redirects, and guards. Preserve existing tool IDs, deep links, and cross-tool handoffs.       |
| Transient state           | Keep inputs and selection near their consumers. Use reducers for complex transitions and derive values from source state.            |
| Persistent sessions       | Storage modules own keys, schemas, migrations, and save timing. Feature session state can survive route unmount where required.      |
| Remote reads              | Query keys include relevant environment/identity/input. Define freshness, cancellation, invalidation, and retry behavior explicitly. |
| Business operations       | Typed services process values and return typed results/errors. Keep UI notifications and navigation at workflow boundaries.          |
| Native capabilities       | Platform adapters expose typed operations and capability checks. Preserve supported web fallbacks and native-only visibility.        |
| Background jobs           | Feature job/session ownership determines start, stop, progress, and navigation behavior independently of rendered DOM.               |
| Imperative widgets        | A focused component owns its host element, updates, and cleanup for grids, editors, models, subscriptions, and workers.              |
| Shell integrations        | Focused modules own registration, theme, analytics, release tour, updates, search, and connection indicators.                        |

Replace event-bus UI communication with callbacks, navigation, focused providers/stores, and library notifications. Native event
subscriptions remain where required, with typed payloads and explicit cleanup. Avoid a universal global store or a new generic tool
framework. Split large controllers by responsibility rather than translating them into equally large hooks.

Effects synchronize external systems. Compute derived values during render or in pure model functions. Every created resource must have
a defined owner and cleanup path, including Strict Mode setup/cleanup cycles and asynchronous initialization that finishes after unmount.

### Execution and lifecycle rules

- Configure Query retries, refetch-on-focus, and reconnect behavior by operation. SQL execution, Kafka publishing, Jenkins triggers, and
  other side effects require explicit user execution and must not rerun through automatic read refresh or retry.
- Preserve per-tool inactive-route behavior. Determine which drafts persist, which jobs continue, and which subscriptions stop before
  replacing the current warm cache. Retaining every DOM tree or unmounting every job is not a general solution.
- Preserve workers and bounded concurrency for expensive work. React scheduling and virtualization do not replace computation workers.
- TanStack Table supplies table behavior; the React composition supplies rendering. Preserve selection, copy/export, sorting, filtering,
  pagination, keyboard behavior, and large-data performance. Handsontable remains the spreadsheet editor.

## 4. Business compatibility contract

Before converting each route, record its existing behavior and the new owner of:

1. Route IDs, registration/access guards, web/Desktop visibility, and incoming handoff payloads.
2. Inputs, defaults, validation, processing rules, error/cancellation behavior, and exact generated outputs.
3. Drafts, tabs, selections, background operations, and behavior when navigating away and returning.
4. localStorage/sessionStorage keys, IndexedDB names/versions/stores, legacy migrations, and credential handling.
5. Worker endpoints, Tauri commands/events, sidecar operations, timeouts, request identity, and cancellation.
6. Clipboard/download/file behavior, keyboard shortcuts, focus, notifications, analytics names, and usage boundaries.

Preserve existing persisted data formats unless an explicit, verified migration is needed. Preserve HTML preview sandboxing, credential
boundaries, SQL quoting/encoding, NULL handling, and other processing semantics. UI layouts may improve while maintaining the workflow.
Compare actual call paths rather than assuming every `service.js` is pure or framework-independent.

Specific high-risk examples:

- **Quick Query:** generated SQL, schema/data paste, Oracle imports, attachments, autosave, tabs, and SQL handoff to Run Query.
- **Compare Config:** key matching, NULL/duplicate handling, mixed Oracle/file sources, workers, differing-row inspection, row queries,
  selection, and exports.
- **HTML/Splunk:** HTML/VTL behavior, encoding, preview isolation, documents, editor model identity, and cleanup after rapid navigation.
- **Native execution tools:** Kafka/Jenkins streaming, event listeners, credentials, cancellation, and inactive-route behavior.
- **Master Lockey/Image Checker:** parsing, lookup workflows, existing virtual rendering, native/web differences, and concurrency limits.

## 5. Implementation sequence and completion criteria

### A. Assess and record the baseline

Inspect the current route registry, services, persistence, platform integrations, workers, and tests. There are 19 registered tools in the
assessed checkout; shell pages are additional scope. `html-template` maps to `tools/html-editor`, and `check-image` to `tools/image-checker`.
The existing JSX preview is scaffolding, not proof of a complete shell or verified tool migration.

**Done when:** every tool and shell workflow has an owner, dependencies, a compatibility checklist, and identified verification paths.
Capture representative old behavior before removing its implementation.

### B. Build the foundation

Configure the React entry, strict TypeScript, compiler, linting, Tailwind, aliases, shadcn preset, router, providers, and platform boundaries.
Use the shadcn skill and CLI to initialize the existing frontend with `--preset b1Zzq9tHk`; select the recommended Base UI base explicitly
because preset codes do not encode the primitive base. Inspect generated files and component documentation before composing them.

Retain the `dist` output contract, relative asset base, API proxy/environment configuration, and Tauri packaging/CSP requirements. Keep
frontend toolchain changes compatible with existing Worker and CommonJS scripts. Enable `.ts`/`.tsx` lint and test discovery and an explicit
typecheck; Vite transpilation alone is not type verification. Temporary JavaScript reuse must be bounded to unconverted modules.

**Done when:** the shell renders with the preset, a lazy route works, typecheck/lint/build cover the new sources, and browser plus Tauri
smoke evidence records the actual environment and result. Record unavailable verification as incomplete.

### C. Prove the patterns with representative tools

Migrate UUID Generator for the simple workflow, then Compare Config as the first substantial architecture exercise. Establish editor
integration as needed. Exercise table rendering, worker processing, storage, capability checks, and Oracle boundaries before copying the
pattern across the application.

**Done when:** both tools meet their compatibility checklists, with reproducible E2E evidence and relevant integration verification.
A mock Oracle response proves the UI path only; record real Oracle verification separately.

### D. Migrate the remaining tools and shell integrations

Sequence work by dependencies and risk: simple processing tools, display-table tools, editor/spreadsheet workflows, and native execution.
Establish Quick Query storage/schema contracts before Querify. Complete shell registration, search, settings, theme, analytics, release
tour, updates, connection indicators, and applicable authorization workflows.

**Done when:** all registered tools and shell pages have React implementations, preserved data/workflow contracts, and recorded checks.
Unconverted routes may remain unavailable during development; a permanently usable hybrid app is not required.

### E. Remove migration infrastructure and hand off

Retire obsolete templates, `BaseTool`, custom router/event-bus UI ownership, preview scaffolding, and unused legacy CSS after their
responsibilities are covered. Any temporary bridge has an explicit removal task. Update architecture and executor guidance to match
the implemented frontend.

**Done when:** the production entry uses React, the frontend is typed, required Web/Desktop workflows are verified, legacy infrastructure
has no active consumers, and remaining limitations are recorded without claiming full migration completion.

## 6. Verification and evidence

Prefer E2E journeys for workflow behavior. Retain existing meaningful engine tests for exact SQL, parsing, encoding, and other concrete
E2E gaps. Follow repository rules: isolation tests are designed before implementation, with failure modes written down first; run the
smallest relevant non-watch scope and serialize Vitest runs.

Cover normal and failure/cancellation paths, rapid navigation, reload persistence, clipboard/export, supported platform behavior, and
large datasets. Check widget/listener/worker cleanup and that navigation cannot commit stale asynchronous results or duplicate jobs.

Save repeatable evidence under `docs/`: environment, source revision, commands/steps, fixtures, assertions, result, and relevant artifacts.
Distinguish source assessment, typecheck/build, automated tests, browser E2E, live integrations, and packaged Desktop verification.
Foundation completion and full migration completion are separate milestones.

## References

- [React Compiler with Vite](https://react.dev/learn/react-compiler/installation)
- [React Router modes](https://reactrouter.com/start/modes)
- [TanStack Query overview](https://tanstack.com/query/latest/docs/framework/react/overview)
- [TanStack React Table](https://tanstack.com/table/latest/docs/framework/react)
- [TanStack Virtual](https://tanstack.com/virtual/latest/docs/introduction)
- [Handsontable React installation](https://handsontable.com/docs/react-data-grid/installation/)
- [shadcn Vite setup](https://ui.shadcn.com/docs/installation/vite)
- [Next.js SPAs](https://nextjs.org/docs/app/guides/single-page-applications) and
  [static exports](https://nextjs.org/docs/app/guides/static-exports)
