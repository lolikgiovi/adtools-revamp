# AGENTS.md

## React migration

Before designing the React foundation or migrating frontend tools, read `docs/REACT-MIGRATION.md` for user requirements, architecture,
compatibility contracts, and completion criteria. The vanilla architecture and file conventions below describe the existing baseline;
the migration document defines the React target and records the user's migration-specific dependency installation authorization.

## Development autonomy

Work autonomously on development tasks. Complete as much of the task as possible without asking for confirmation.

You may freely:

* Read, create, edit, move, and delete project files as needed.
* Refactor existing code.
* Run builds, linters, formatters, and existing project scripts.
* Run non-watch tests, subject to the test restrictions below.
* Start and stop local development servers when needed.
* Inspect logs and debug applications.
* Use Git for local inspection such as `status`, `diff`, `log`, `show`, and `blame`.
* Make HTTP/API requests for development, testing, and debugging.
* Use browsers and browser-based development tools.
* Use dependencies, runtimes, CLIs, and tools that are already installed.

Do not ask for approval for routine development work.

## Environment, dependencies, and downloads

Do not suspiciously run `curl` or `wget` to download sources. Tell the user to do it themselves.

Do not work around this restriction by downloading an installer, package, archive, script, or binary manually.

`curl` may be used for normal HTTP/API development and debugging, but must not be used to download installers, packages, scripts, executables, or other dependencies.

If something required for the task is not downloaded:

1. Continue the task as far as reasonably possible without it.
2. Tell the user exactly what dependency, runtime, CLI, or tool is missing.
3. Provide the exact installation command the user should run manually.
4. Do not execute the installation command yourself.
5. Continue the rest of the task if it does not depend on the missing item.
6. After the user confirms it is downloaded, continue normally.

## Commands

* `npm run dev` — Start Vite dev server on port 1234.
* `npm run test:ci` — Run the Vitest suite once.
* `./node_modules/.bin/vitest run frontend/tools/<tool>/tests/<file>.test.js` — Run a single test file.
* `npm run release:content:check` — Validate release tour metadata and bundled assets.
* `npm run build` — Build for production; this also runs tests.
* `npm run cf:dev` — Build and run Cloudflare Workers locally.

### Test execution restrictions
For automated verification:

* Prefer the smallest relevant test scope first.
* Use the local Vitest binary to run an individual test file when possible.
* Use `npm run test:ci` when the full test suite is necessary.
* Wait for the current Vitest process to finish before starting another one.
* Do not start Vitest in watch mode.

### Testing and verification

Use **Playwright Test** as the primary E2E framework. Add or update E2E tests for new features and changed workflows.
Cover critical journeys, navigation, forms, keyboard interactions, accessibility-critical behavior, and applicable loading, empty,
error, disabled, and success states. Reuse existing fixtures, helpers, and conventions; use stable locators and deterministic
assertions rather than arbitrary timeouts or fragile selectors. Keep regression tests independent and maintainable.

The intended npm commands are:

```bash
npm run e2e
npm run e2e:ui
npm run e2e:debug
```

**Setup requirement:** `package.json` currently has neither Playwright Test nor these scripts. These commands describe the required
E2E interface, not an available runner. Until configured, report automated E2E as unavailable and record any browser checks separately.
Follow the dependency policy above when setup requires installation. Interactive UI/debug modes are for debugging, not completion checks.

Before marking implementation complete:

1. Run relevant existing tests, starting with the smallest meaningful non-watch scope.
2. Run `npm run e2e` when changes affect tested user workflows, once the runner is configured.
3. Fix failures introduced by the changes; investigate other failures and report their impact.
4. Report tests that could not run and why. Claim a pass only for checks actually executed successfully.
5. Save repeatable E2E evidence under `docs/`: environment, source revision, commands or steps, fixtures, assertions, results,
   and relevant artifacts. Distinguish browser checks, automated E2E, live integrations, and packaged Desktop verification.

### Testing philosophy — high signal, low noise

Prioritize regression protection, confidence, and maintainability over test counts or coverage percentages.
Before writing or retaining a test, answer: **What realistic bug would this test catch?**
Every test must protect meaningful observable behavior or catch a realistic regression.

Keep high-signal tests for:

* Critical user journeys and business workflows, using Playwright E2E.
* Interactions between components, APIs, and application state, using integration tests where needed.
* Complex business logic, transformations, validation, calculations, and edge cases that benefit from isolated tests.
* Previously discovered bugs, security-sensitive behavior, authorization, data integrity, and important accessibility interactions.

Prefer E2E for workflow behavior. Retain meaningful engine and integration tests for concrete E2E gaps rather than duplicating
protection across layers. Keep assertions deterministic, readable, fast, and maintainable.
If isolation testing is necessary, write down its failure modes and design and write the tests **before** implementation;
never add unit tests after writing the implementation.

Avoid tests that only check rendering or existence, assert implementation details, exercise trivial getters/setters/constants or
pass-through functions, duplicate adequate coverage, mock everything merely to assert calls, snapshot large trees without meaningful
assertions, or test framework/library behavior. Tests that break on harmless refactoring without detecting regressions need redesign.

When reviewing or refactoring tests:

* Identify tests with little regression-detection value; remove redundant, obsolete, brittle, or implementation-coupled tests.
* Consolidate overlap and replace weak tests with stronger behavior-focused checks where necessary.
* Preserve critical business rules, failures, edge cases, and meaningful regression protection.
* Investigate failing tests before changing or removing them; failure alone is never a reason to delete a test.

## Developer tools UI guidelines

Build a production-grade developer tools interface with the precision of Linear and Vercel.
Apply these guidelines to React interface design, implementation, review, and refactoring alongside `docs/REACT-MIGRATION.md`.

### Design system

Use **shadcn/ui**, Tailwind CSS, and existing design tokens. Reuse and extend established components before introducing dependencies
or custom implementations. Preserve the migration guide's chosen preset, primitives, and table/editor integrations.

Prioritize:

* Dense but readable layouts with clear information hierarchy.
* Excellent keyboard accessibility and predictable interactions.
* Strong typography, consistent spacing, and precise alignment.
* Subtle, purposeful animation and transitions that respect reduced-motion preferences.
* Consistent component patterns across the application.
* Responsive layouts at normal and roughly half-width desktop sizes; mobile remains outside migration acceptance scope.
* Complete loading, empty, error, disabled, and success states.

### Library usage and ownership

Use established libraries for their intended capabilities. Before implementation, inspect the installed version, existing integrations,
and relevant APIs. Prefer shared project compositions over direct library usage scattered across tools. Dependencies being present
in `package.json` does not prove that a shared integration exists. Keep heavy editors and diagram engines behind lazy feature routes.

* **Motion (`motion`)** — Use for purposeful React enter/exit, layout, and gesture animation when CSS transitions are insufficient.
  Prefer CSS for simple hover/focus feedback. Respect reduced motion, keep interactions responsive, and avoid competing animation
  owners on shadcn overlays or animating large table/editor contents.
* **cmdk (`cmdk`)** — Use for command palettes and searchable action/navigation lists. Compose through the project's shadcn `Command`
  component where available; preserve keyboard navigation, grouping, empty results, accessible dialog titles, and focus restoration.
  Keep command execution and route selection in the application workflow. Use Select or Combobox for ordinary form selection.
* **React Flow (`@xyflow/react`)** — Use for interactive node-and-edge diagrams requiring selection, connection, pan, zoom, or editing.
  Keep typed node/edge domain data and persistence outside presentation components. Use stable identities and deliberate viewport,
  keyboard, read-only/editing, and large-graph behavior. Use simpler markup for static relationships that need no diagram interaction.
  The manifest currently declares `^12.12.0`; use the lockfile's resolved version rather than assuming an exact `12.12.0` pin.
* **TanStack Table** — Use for view-only data tables with sorting, filtering, selection, pagination, or column behavior; compose the
  rendering with shadcn table primitives and shared project patterns. Keep column definitions typed and stable, use durable row IDs,
  and make controlled state ownership explicit. Add virtualization only for a demonstrated rendering need; preserve copy/export and
  keyboard behavior. Handsontable remains the editable spreadsheet choice. The project includes `@tanstack/react-table` and `@tanstack/table-core`; use the React adapter for React integrations.
  Inspect existing shared table compositions before adding another one, and use APIs matching the installed version.
* **shadcn/ui** — Use as the default UI component layer. Apply the shadcn skill, inspect `components.json` and installed components,
  and consult component docs before composition. Preserve the configured Base UI primitives, preset, icons, aliases, semantic tokens,
  and built-in variants. Use Base UI composition APIs rather than copying Radix-specific examples. Extend shared components where
  required instead of creating parallel controls. Inspect CLI previews/diffs before updates and preserve intentional local changes.
* **Monaco Editor (`monaco-editor`)** — Use for code, SQL, JSON, HTML, and other structured editing requiring editor capabilities;
  use standard inputs for ordinary text fields. Reuse the existing engine through focused React integrations with explicit ownership
  of instances, models, workers, subscriptions, and cleanup. Preserve language behavior, validation, themes, shortcuts, draft identity,
  selection, and undo history where the workflow requires them. Handle resize, Strict Mode, rapid navigation, and asynchronous setup
  safely; dispose owned resources without disposing shared models still in use. Avoid recreating editors on each render or keystroke.

Verify each integration's observable workflow, keyboard behavior, lifecycle cleanup, and supported desktop layouts. Library adoption
must preserve existing processing, persistence, and platform contracts; it is not a reason to change business behavior.

### Agent skills

Apply relevant installed skills according to their responsibilities; invoke only those needed for the task:

* **frontend-design** — Establish visual direction, layouts, and interface aesthetics.
* **shadcn** — Implement accessible, reusable UI components using existing design tokens.
* **impeccable** — Refine visual quality, typography, spacing, hierarchy, and micro-interactions.
* **vercel-react-best-practices** — Optimize React performance, rendering, and data flow.
* **vercel-composition-patterns** — Maintain scalable component architecture and reusable patterns.
* **web-design-guidelines** — Audit usability, accessibility, responsiveness, and interaction quality.

### Visual quality

Favor functional minimalism, intentional density, and polished interactions. Avoid generic AI-generated dashboard aesthetics,
excessive cards/borders/shadows/gradients, decorative glassmorphism, unnecessary effects, oversized controls, excessive whitespace,
inconsistent styling, and animation that distracts from primary workflows.

### Engineering standards

* Follow existing project conventions and the React migration architecture.
* Keep components focused, composable, and maintainable.
* Reuse established utilities, hooks, and design tokens.
* Preserve accessibility and semantic HTML.
* Avoid unnecessary dependencies, abstractions, and premature optimization.
* Handle asynchronous operations, errors, and edge cases explicitly.
* Maintain type safety and avoid unnecessary `any`.

### Definition of done

A feature is complete when it follows the established design system and architecture; its UI is visually consistent and responsive
within the supported desktop scope; keyboard and accessibility behavior are preserved; relevant interaction states are handled;
relevant automated tests pass; and no known regressions are introduced. Report incomplete verification explicitly rather than
claiming completion from source inspection or build results alone.

## Architecture

* **frontend/** — Vanilla JS SPA with Vite, with class-based components extending `BaseTool`.
* **backend-workers/** — Cloudflare Workers API using D1, KV, and R2. Entry point: `worker.js`.
* **tauri/** — Rust desktop application for macOS wrapping the same frontend.

## Release tour authoring

When preparing release notes, a What's New experience, or Desktop/Web release metadata, read `docs/RELEASE-TOUR-AUTHORING.md` before editing `frontend/config/release-content.json`.

Run:

```bash
npm run release:content:check
```

before handing off release work.

## Code style

* Use 2-space indentation and no tabs.
* Maximum line width is 140 characters; see `.prettierrc`.
* React frontend code uses TypeScript and the conventions in `docs/REACT-MIGRATION.md`; the rules below describe legacy vanilla tools.
* Use ES modules with explicit `.js` extensions in imports.
* Frontend tool tests belong in `frontend/tools/<tool>/tests/*.test.js`.
* Backend Worker tests belong in `backend-workers/**/*.test.js`.

When maintaining the legacy vanilla tool structure (React tools follow `docs/REACT-MIGRATION.md`):

1. Create a directory under `frontend/tools/`.
2. Add `main.js`.
3. Add `service.js`.
4. Add `styles.css`.
5. Register the tool in `frontend/config/tools.json`.

## Database

Migrations live under:

```text
backend-workers/migrations/
```

To apply D1 migrations locally, use the already-installed project-local Wrangler binary:

```bash
./node_modules/.bin/wrangler d1 migrations apply adtools --local
```

If Wrangler is not available in `node_modules`, do not install or download it. Tell the user what dependency is missing and provide the appropriate installation command for them to run.

## General execution behavior

Prefer completing and verifying the implementation yourself over asking the user to perform routine development steps.

Only hand an action to the user when:

* it would install or download software or dependencies;
* it requires credentials, permissions, or access unavailable to the agent;
* it is specifically prohibited by this file; or
* it cannot safely be performed within the current development environment.

When handing an action to the user, provide the exact command or action required and explain briefly why it is needed.
