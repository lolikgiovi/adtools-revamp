# AGENTS.md

## Commands
- `npm run dev` — Start Vite dev server on port 1234
- `npm run test` — Run tests in watch mode (Vitest)
- `npm run test:ci` — Run tests once
- `npx vitest run frontend/tools/<tool>/tests/<file>.test.js` — Run a single test file
- `npm run build` — Build for production (runs tests first)
- `npm run cf:dev` — Build + run Cloudflare Workers locally

## Architecture
- **frontend/** — Vanilla JS SPA with Vite, class-based components extending `BaseTool`
- **backend-workers/** — Cloudflare Workers API (D1, KV, R2); entry point: `worker.js`
- **tauri/** — Rust desktop app (macOS) wrapping the same frontend

## Code Style
- 2-space indentation, no tabs, 140 char line width (see `.prettierrc`)
- Vanilla JS (no framework), ES modules with explicit `.js` extensions in imports
- Tests go in `frontend/tools/<tool>/tests/*.test.js` or `backend-workers/**/*.test.js`
- New tools: create folder in `frontend/tools/`, add `main.js`, `service.js`, `styles.css`, register in `frontend/config/tools.json`

## Database
- Migrations: `backend-workers/migrations/`; apply with `npx wrangler d1 migrations apply adtools --local`

# Client Performance Note
Do not run `npm run test` directly, and never run more than one vitest instance, it will hang client computer. Tell user to run the `npm run test` themselves
