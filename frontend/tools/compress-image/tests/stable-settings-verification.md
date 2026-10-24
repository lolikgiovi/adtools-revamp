# Stable compression settings — 2026-10-24

Implemented a full-width settings grid, persistent disabled resize dimensions, a native PNG mode select,
and one PNG quality preset select that stays visible and is disabled in lossless mode. The PNG quality
selector reuses the existing codec presets independently of JPEG/WebP: High quality 90–100, Balanced 80–95,
Smaller file 65–85. Lossless remains the default. Selects retain native keyboard and mobile behavior.

## Repeat

With the existing dependencies installed, run `npm run dev` and open:

- `http://localhost:1234/tools/compress-image/tests/stable-settings-check.html`
- `http://localhost:1234/tools/compress-image/tests/browser.html`
- `http://localhost:1234/tools/compress-image/tests/layout.html?sample`
- `http://localhost:1234/tools/compress-image/tests/stable-settings-check.html?width=390`

The first page checks 390, 768, 1024, 1440, and 2390 CSS px. It verifies identical panel width and height
across all resize / PNG mode combinations, visible disabled controls, correct enabling, full-width alignment,
field containment, and no page overflow. It waits for sample image dimensions before measuring.

## Results

- 115 responsive settings browser checks passed.
- 138 existing integration browser checks passed with updated select hooks. These exercise real WASM codecs,
  lossless defaults, named quality selection, resizing, quality-floor fallback, PNG offers and Undo,
  preview interactions, file handling, and ZIP downloads. Strict quality-floor fixtures are injected at the
  settings boundary because numeric quality thresholds are no longer user controls.
- 67 focused Vitest checks passed across the five compressor test files.
- Focused ESLint, Prettier, and `git diff --check` passed.
- Production Vite build passed; existing chunk-size and mixed-import warnings remain.
- Desktop and 390px embedded viewport screenshots were visually reviewed.

Evidence: `stable-settings-browser-evidence.txt`, `stable-settings-responsive-evidence.txt`,
`stable-settings-desktop.png`, `stable-settings-mobile.png`.

Scope: local browser and build verification. Packaged Tauri and deployed production were not tested.
