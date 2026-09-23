# AGENTS.md

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

Do not install or download packages, dependencies, runtimes, applications, binaries, CLIs, or development tools.

This includes commands such as:

* `npm install`, `npm i`, `npm add`
* `pnpm install`, `pnpm add`
* `yarn install`, `yarn add`
* `bun install`, `bun add`
* `brew install`, `brew upgrade`
* `pip install`, `pip3 install`
* `python -m pip install`, `python3 -m pip install`
* `cargo install`
* `mise install`
* `nvm install`
* `wget`
* installer scripts or equivalent package-management commands

Do not work around this restriction by downloading an installer, package, archive, script, or binary manually.

`curl` may be used for normal HTTP/API development and debugging, but must not be used to download installers, packages, scripts, executables, or other dependencies.

Avoid `npx` when executing project tooling because it may download a missing package. Prefer the existing local binary under `node_modules/.bin/`.

If something required for the task is not installed:

1. Continue the task as far as reasonably possible without it.
2. Tell the user exactly what dependency, runtime, CLI, or tool is missing.
3. Provide the exact installation command the user should run manually.
4. Do not execute the installation command yourself.
5. Continue the rest of the task if it does not depend on the missing item.
6. After the user confirms it is installed, continue normally.

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
* Frontend code uses Vanilla JS, not a framework.
* Use ES modules with explicit `.js` extensions in imports.
* Frontend tool tests belong in `frontend/tools/<tool>/tests/*.test.js`.
* Backend Worker tests belong in `backend-workers/**/*.test.js`.

When creating a new frontend tool:

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