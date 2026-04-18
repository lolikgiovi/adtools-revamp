# AD Tools

A suite of developer tools for internal use, available as a **Web App** (deployed on Cloudflare Workers) and a **Desktop App** (Tauri for macOS).

## Project Structure

```
ad-tools-revamp/
├── frontend/                 # Web SPA (Vanilla JS + Vite)
│   ├── index.html            # Entry point
│   ├── styles.css            # Global styles
│   ├── App.js                # Main application
│   ├── components/           # Shared UI components
│   ├── core/                 # Router, EventBus, ThemeManager, etc.
│   ├── pages/                # Page components (about, settings, etc.)
│   ├── tools/                # Individual tools (each with its own folder)
│   │   └── */tests/          # Tests in tests/ subdirectory
│   └── public/               # Static assets
│
├── backend-workers/          # Cloudflare Worker API
│   ├── worker.js             # Main worker entry point
│   ├── migrations/           # D1 database migrations
│   └── scripts/              # Build & utility scripts
│
├── tauri/                    # Tauri Desktop App (macOS)
│   ├── src/                  # Rust source code
│   ├── keys/                 # Signing keys (gitignored)
│   ├── .env                  # Tauri environment variables
│   └── tauri.conf.json       # Tauri configuration
│
├── docs/                     # Documentation
├── vite.config.mjs           # Vite configuration
├── vitest.config.mjs         # Vitest test configuration
├── wrangler.toml             # Cloudflare Workers configuration
└── package.json              # Dependencies & scripts
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Vanilla JS, Vite |
| Backend | Cloudflare Workers (D1, KV, R2) |
| Desktop | Tauri 2.x (Rust) |
| Testing | Vitest |

## Development

### Prerequisites
- Node.js 18+
- Rust toolchain (for Tauri builds only)

### Setup
```bash
npm install
```

### Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server (http://localhost:5173) |
| `npm run test` | Run tests in watch mode |
| `npm run test:ci` | Run tests once |
| `npm run build` | Build for production |
| `npm run cf:dev` | Build + run Wrangler locally (http://localhost:8787) |
| `npm run cf:publish` | Build, deploy to Cloudflare Workers, and apply production D1 migrations |
| `npm run cf:deploy` | Same as `cf:publish` |
| `npm run cf:deploy:worker` | Deploy Worker and then apply production D1 migrations |
| `npm run cf:versions:upload` | Upload a preview Worker version without production migration |
| `npm run db:migrate:local` | Apply D1 migrations locally |
| `npm run db:migrate:remote` | Apply D1 migrations to production |
| `npm run release:build` | Build Tauri desktop app |
| `npm run release:upload` | Upload release to R2 |

## Architecture

### Web App Flow
```
Browser → Cloudflare Workers → D1/KV/R2
              ↓
         Serves Vite-built
         static assets from dist/
```

### Desktop App Flow  
```
Tauri WebView → Same frontend code → API calls to CF Workers
```

## Adding a New Tool

1. Create folder: `frontend/tools/[tool-name]/`
2. Add files:
   - `main.js` - Tool class extending BaseTool
   - `service.js` - Business logic
   - `styles.css` - Tool-specific styles
   - `*.test.js` - Tests (colocated)
3. Register in `frontend/config/tools.json`
4. Add stylesheet link in `frontend/index.html`

## Database Migrations

Migrations are in `backend-workers/migrations/`. To apply:
```bash
npm run db:migrate:local   # Local
npm run db:migrate:remote  # Production
```

Keep `npm run build` free of database changes. Use `npm run cf:publish` or `npm run cf:deploy` when the Worker deploy should also apply production D1 migrations.

## Deployment

### Web App (Cloudflare Workers)
```bash
npm run cf:publish
```

For Cloudflare Workers Builds connected to Git:

| Cloudflare setting | Value |
|--------------------|-------|
| Build command | `npm run build` |
| Deploy command | `npm run cf:deploy:worker` |
| Non-production branch deploy command | `npm run cf:versions:upload` |

This keeps the order as build, deploy the new Worker, then apply production D1 migrations. Preview builds should not run production D1 migrations.

### Desktop App (Tauri)
```bash
npm run release:build    # Build .dmg
npm run release:upload   # Upload to R2 for auto-updates
```
