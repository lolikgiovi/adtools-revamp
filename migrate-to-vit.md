# Migration Plan: Move adtools-ui-test to Vite

This document lays out a pragmatic, incremental plan to migrate the current static vanilla JS site to Vite, while keeping Monaco Editor and the QR library working throughout. It prioritizes a fast first win (Vite dev server + tests) and safe, staged refactors to ESM.

## Goals
- Faster dev experience (HMR, modern tooling) without breaking current functionality.
- Unified build artifacts (`dist/`) for desktop (Tauri) and web hosting.
- Introduce a reliable unit testing setup (Vitest + JSDOM) targeting service logic.
- Migrate to ES modules progressively; handle Monaco Editor workers cleanly.

## Prerequisites
- Node.js 18+ and a package manager (`npm` or `pnpm`).
- No immediate code rewrites required; we start by serving existing `index.html` as-is.

---

## Phase 1 — Initialize Vite (no breaking changes)
Outcome: Run Vite dev server with the current app and script tags intact.

1) Create project tooling
- `npm init -y`
- `npm i -D vite`

2) Move vendor libraries to `public/` so Vite serves them statically
- Create `public/` and move `libs/` into `public/libs/` (keep the same internal structure):
  - `public/libs/monaco-editor/...`
  - `public/libs/qrcode/qrcode.min.js`

3) Keep `index.html` in the repo root
- Vite serves root `index.html` automatically.
- Update script tags to point to `/libs/...` (root-relative) if needed after moving.

4) Add `vite.config.js`
```js
// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  server: { open: true },
  resolve: {
    alias: {
      '@': '/app', // optional: import from '@/core', '@/tools', etc.
    },
  },
});
```

5) Run dev server
- `npm run dev` with script: `{ "scripts": { "dev": "vite", "build": "vite build", "preview": "vite preview" } }`
- Verify the site loads: Monaco and QR still via script tags from `public/libs`.

---

## Phase 2 — Testing setup (Vitest + JSDOM)
Outcome: Write and run unit tests for pure service logic.

1) Install testing deps
- `npm i -D vitest jsdom @vitest/coverage-v8`

2) Add `vitest.config.js`
```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
});
```

3) Create `tests/` and add initial tests targeting service files
- Focus on `app/tools/json-tools/service.js`, `app/tools/base64-tools/service.js`, `app/tools/qr-tools/service.js`.
- If services attach to `window.*`, import the file in tests to populate globals, or refactor to exports (Phase 3).

4) Run tests
- `npx vitest` or `npm run test` with script: `{ "test": "vitest" }`.

---

## Phase 3 — Gradual ESM refactor (tool-by-tool)
Outcome: Tools import/export modules instead of relying on `window.*` globals.

Recommended pattern per tool (start with `qr-tools` as a simple POC):

1) Convert service to exports
```js
// app/tools/qr-tools/service.js (example)
export function isValidUrl(str) { /* existing logic */ }
export function hexToRgb(hex) { /* existing logic */ }
// ...export other pure functions
```

2) Adapt the tool’s `main.js` to import from the service
```js
// app/tools/qr-tools/main.js
import { isValidUrl, hexToRgb } from './service.js';
// use imports instead of window.QRToolsService
```

3) Temporary adapter (optional) if other code still expects globals
```js
// app/tools/qr-tools/service.global.js (temporary)
import * as svc from './service.js';
window.QRToolsService = svc;
```
- Include `service.global.js` via `<script type="module">` or import it once centrally until the whole app is migrated.
- Remove adapters once all consumers use ESM imports.

4) Repeat for `json-tools` and `base64-tools`.

---

## Phase 4 — QR library integration
Outcome: Keep working immediately; later simplify with npm.

- Option A (no change now): keep `public/libs/qrcode/qrcode.min.js` and continue using the global `QRCode`.
- Option B (cleaner later): `npm i qrcode` and import:
```js
import QRCode from 'qrcode';
await QRCode.toCanvas(canvasEl, 'text', { width: 256 });
```
- In tests, mock either the npm import or the global:
```js
// npm import mock
import { vi } from 'vitest';
vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn(), toString: vi.fn() } }));

// global mock (if using script tag)
globalThis.QRCode = { toCanvas: vi.fn(), toString: vi.fn() };
```

---

## Phase 5 — Monaco Editor migration
Outcome: Two-step approach to avoid churn.

### Step A — Keep current AMD loader via `public/` (lowest effort)
- Continue using `public/libs/monaco-editor/min/vs/loader.js` and AMD `require.config(...)`.
- Ensure workers remain disabled initially to avoid bundling complexity:
```js
self.MonacoEnvironment = {
  getWorker: () => null,
};
```
- This runs fine under Vite since assets come from `public/`.

### Step B — Migrate to ESM + bundled workers (optional, medium effort)
- Install npm package: `npm i monaco-editor`.
- Update code to import ESM and configure workers using Vite’s `?worker` helper:
```js
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

self.MonacoEnvironment = {
  getWorker(_, label) {
    switch (label) {
      case 'json': return new jsonWorker();
      case 'css': return new cssWorker();
      case 'html': return new htmlWorker();
      case 'typescript':
      case 'javascript': return new tsWorker();
      default: return new editorWorker();
    }
  },
};

const editor = monaco.editor.create(document.getElementById('jsonInput'), { /* ... */ });
```
- If desired, use a community helper/plugin later; start with the above for minimal moving parts.

---

## Phase 6 — Builds and deployment
Outcome: A single, consistent artifact for desktop and web.

1) Build
- `npm run build` produces `dist/` with hashed assets, minified JS/CSS.
- `npm run preview` to sanity-check the built output.

2) Tauri integration (example)
- Point dev to Vite server and build to `dist/`.
```json
// tauri.conf.json (illustrative)
{
  "build": { "beforeDevCommand": "vite", "beforeBuildCommand": "vite build" },
  "tauri": {
    "windows": [{ "title": "AD Tools" }],
    "bundle": {},
    "updater": {}
  },
  "package": {},
  "plugins": {},
  "frontendDist": "dist"
}
```
- Adjust keys to match your Tauri version; the idea is: dev = Vite server, build = Vite `dist/`.

3) Cloudflare Pages
- Connect repo and set build: `npm run build`, output directory: `dist`.
- No Workers needed unless you add server-side logic.

---

## Phase 7 — Cleanup
Outcome: Fully ESM app with no globals or vendor script tags.

- Remove `service.global.js` adapters and `window.*` references.
- Replace remaining script tags with imports (QR via npm, Monaco via ESM).
- Delete unused `public/libs/` copies once npm imports are in place.

---

## File changes checklist
- `package.json`: add scripts (`dev`, `build`, `preview`, `test`).
- `vite.config.js`: add alias and any needed options.
- `vitest.config.js`: JSDOM and coverage.
- `index.html`: ensure vendor paths come from `/libs/...` (Phase 1), later remove script tags.
- `app/tools/*/service.js`: convert to ESM exports.
- `app/tools/*/main.js`: import services; remove use of `window.*`.
- `tests/**/*.test.js`: add unit tests.

---

## Risks & tips
- Monaco workers: path or MIME errors manifest as silent failures; verify devtools network requests when migrating to ESM.
- Tauri CSP: if you tighten CSP, ensure `worker-src` and `script-src` allow Vite dev server in dev.
- Aliases: keep imports stable with `@` alias to `/app` to reduce relative path churn.
- Incremental PRs: migrate one tool at a time to keep changes reviewable.

---

## Suggested timeline
- Day 1: Phase 1 + Phase 2 (Vite + Vitest running; libs under `public/`).
- Day 2: Phase 3 POC on `qr-tools`; add tests.
- Day 3–4: Migrate `json-tools` and `base64-tools` to ESM; stabilize tests.
- Day 5+: Phase 5 Step B for Monaco if desired; wire builds to Tauri and Cloudflare.

---

## Success criteria
- `npm run dev` serves the current app with HMR and no regressions.
- `npm run test` runs unit tests with coverage for services.
- `npm run build` produces a working `dist/` used by Tauri and Cloudflare Pages.
- No remaining reliance on `window.*` or vendor script tags (once fully migrated).