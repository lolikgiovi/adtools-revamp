# ADTools Auto-Update — Technical Development Plan

This document is the end-to-end technical development plan to implement and operate auto-updates for ADTools on macOS using Cloudflare R2 and a Cloudflare Worker. It includes requirements, architecture, implementation steps, CI/CD, testing, rollout, observability, security, risks, and acceptance criteria. The original reference details (object structure, manifest schema, CI examples) remain intact below as an appendix.

## Table of Contents

- Scope and Objectives
- Functional Requirements
- Non-Functional Requirements
- System Architecture
- Environments and Configuration
- Implementation Plan
  - Cloudflare Worker
  - Cloudflare R2 Layout
  - Desktop App (Tauri) Changes
  - Web UI Integration
  - CI/CD and Release Automation
- Phased To-Do Plan
- Testing Strategy
- Rollout and Backout Strategy
- Observability and Telemetry
- Security and Compliance
- Risks and Mitigations
- Work Breakdown Structure and Milestones
- Definition of Done and Acceptance Criteria
- Operational Runbook
- Appendix A — Reference Details

---

## Scope and Objectives

- Provide reliable in-app updates for macOS (Apple Silicon and Intel) via HTTPS.
- Host artifacts in Cloudflare R2 (`adtools-updates`) and serve through `https://adtools.lolik.workers.dev`.
- Support two channels: `stable` and `beta`.
- Allow optional and forced updates via manifest policy (`minVersion`).
- Ensure short-cached manifests and immutable artifacts for safe rollout/rollback.

## Functional Requirements

- Channels
  - `stable` for production users; `beta` for opt-in testers.
- Update Detection
  - On app launch and on a schedule (3× daily: ~9 am, 12 pm, 3 pm local).
  - Manual check from Settings (“Check for Update”).
- Platform Targeting
  - Detect `aarch64` or `x86_64`; pick correct payload from `platforms[arch]`.
- Forced Updates
  - If `version < minVersion`, download and apply update, then restart (no deferral).
- Optional Updates
  - Show header banner with “Update Now” and “Later”. Provide progress states.
- Integrity Verification
  - Use Tauri updater signature (`.sig`) and embedded public key.
- Settings
  - `update.autoCheck` (boolean) and `update.allowBeta` (boolean) persisted locally.

## Non-Functional Requirements

- Performance
  - Artifact delivery supports range requests; large downloads stream through Worker.
  - Manifests served with low latency; artifacts can be heavily cached.
- Reliability
  - Immutable artifacts; rollback by repointing manifest.
  - Graceful handling of network failures and invalid manifests.
- Security
  - HTTPS-only URLs, no `r2://` in client manifests.
  - Signature verification with embedded public key; no Apple notarization.
  - R2 bucket public read for objects; write restricted to CI.
- Maintainability
  - Single manifest per channel; deterministic CI manifest generation.
  - Clear separation of Worker, CI, and App logic.

## System Architecture

- Components
  - Desktop App (Tauri + Web UI): Performs checks, downloads payload, verifies signature, applies update, restarts.
  - Cloudflare R2 Bucket `adtools-updates`: Stores `manifest/*` and `releases/*` objects.
  - Cloudflare Worker at `https://adtools.lolik.workers.dev`: Fronts R2; sets headers, supports range requests, and streams artifacts.
  - CI Pipeline: Builds, signs, uploads artifacts, and publishes manifests.

- High-level Flow
  1) App determines channel and architecture.
  2) App fetches `https://adtools.lolik.workers.dev/manifest/<channel>.json`.
  3) App reads `platforms[arch]` → `url` and `signature`.
  4) App downloads `.app.tar.gz` from `url`, verifies signature.
  5) App applies update and restarts (forced) or prompts (optional).

## Environments and Configuration

- Buckets and Domains
  - R2 bucket: `adtools-updates` (public read for objects).
  - Worker: `https://adtools.lolik.workers.dev` proxies to R2.
- CORS and Headers
  - Manifests: `Content-Type: application/json`, `Cache-Control: public, max-age=60`.
  - Artifacts: `Content-Type: application/gzip`, `Cache-Control: public, max-age=31536000, immutable`.
  - Support `Range`, `ETag`, and `Accept-Ranges` for artifacts.
- Tauri Config
  - Embed updater public key in `src-tauri/tauri.conf.json` under `updater.pubkey`.
- Local Dev
  - Web dev: `npm run dev` (port 5173).
  - Worker dev: `wrangler dev` (configure R2 binding and routes).

## Implementation Plan

### Cloudflare Worker

- Configuration (`wrangler.toml`)
  - Bind R2 bucket `adtools-updates`.
  - Route all `GET /manifest/*` and `GET /releases/*` to the Worker.

- Worker Behavior (`src/worker.js`)
  - Routing
    - `/manifest/:channel.json` → fetch `manifest/<channel>.json` from R2, set JSON headers.
    - `/releases/*` → stream object from `releases/...` in R2 with correct content-type, cache, `ETag`, and `Accept-Ranges`.
  - Range Support
    - Respect `Range` header for resumable downloads.
  - Error Handling
    - 404 for missing keys; JSON error for manifest; plain text for artifact 404s.
  - CORS
    - Allow GET from `http://localhost:5173` and Tauri origins (`tauri://localhost`), headers `*`.

### Cloudflare R2 Layout

- Directory structure under `r2://adtools-updates/` as documented in the appendix (`manifest/` and `releases/`).
- Artifacts are immutable; only manifests change.

### Desktop App (Tauri) Changes

- Core Update Module
  - Add `app/core/Updater.js` exporting:
    - `getCurrentVersionSafe()`
    - `checkUpdate(channel, arch)`
    - `performUpdate(manifestEntry)`
    - `evaluatePolicy({ currentVersion, minVersion })`
    - `setupAutoUpdate()` to schedule checks and wire UI events
  - Responsibilities
    - Decide manifest URL based on `update.allowBeta`.
    - Detect arch (`aarch64` or `x86_64`).
    - Fetch manifest, pick platform entry, verify policy (`minVersion`).
    - Download `.app.tar.gz`, verify signature, apply update.

- App Integration
  - Wire `setupAutoUpdate()` from `app/App.js` on startup.
  - Use `app/core/EventBus.js` to display a header banner (`update:show-banner`) for optional updates and a modal overlay for forced updates.
  - Honor `update.autoCheck` and `update.allowBeta` from `app/pages/settings/service.js`.

### Web UI Integration

- Settings (already present)
  - Category: “Check for Update” with `update.autoCheck` and `update.allowBeta` toggles.
  - Add the “Check Now” button to trigger `checkUpdate()` and show banner if applicable.

### CI/CD and Release Automation

- Build for `aarch64-apple-darwin` and `x86_64-apple-darwin`.
- Sign `.app.tar.gz` with Tauri updater key and produce `.sig`.
- Upload artifacts and checksums to `r2://adtools-updates/releases/...`.
- Generate and upload manifests to `r2://adtools-updates/manifest/<channel>.json` with URLs pointing to `https://adtools.lolik.workers.dev/...`.
- Keep manifests short-cached; artifacts immutable.

## Phased To-Do Plan

1. Phase 1: Infrastructure and Cloudflare Worker
   - Scope: Infrastructure (Cloudflare R2 + Worker); backend delivery surface for updates
   - Steps:
     * Create Cloudflare R2 bucket `adtools-updates` with public GET and restricted write (CI-only) using the Cloudflare Dashboard; deny bucket listing to anonymous users.
     * Configure `wrangler.toml` to bind the bucket, add routes for `GET /manifest/*` and `GET /releases/*`, and set any required environment variables (e.g., `ALLOWED_ORIGINS`).
     * Implement `src/worker.js` routing: `/manifest/:channel.json` (serve JSON with `Cache-Control: public, max-age=60`) and `/releases/*` (stream with `Cache-Control: public, max-age=31536000, immutable`).
     * Add range support: respect `Range` requests, return `206 Partial Content`, set `Accept-Ranges: bytes`, `ETag`, and correct `Content-Type` headers.
     * Add error handling: JSON errors for manifest 404/5xx; plain text 404 for artifacts; handle `HEAD` efficiently.
     * Add CORS: allow `GET, HEAD` from `http://localhost:5173` and `tauri://localhost`; allow `Range` header; expose `ETag`, `Content-Length`; set `Vary: Origin`.
     * Write Worker tests (Wrangler/Miniflare) for routing, headers, `Range` semantics, and CORS.
     * Seed R2 for smoke testing: upload `manifest/stable.json` and a small artifact under `releases/0.0.1/stable/aarch64/test.bin`.
     * Deploy with `wrangler publish`; verify both manifest and artifact URLs end-to-end.
     * Dependencies/Prerequisites: Cloudflare account, R2 bucket created, Wrangler installed and authenticated, R2 binding configured.

   - Deliverables:
     * Public Worker endpoint serving manifests and artifacts with correct headers and `206` support.
     * R2 bucket initialized with `manifest/` and `releases/` prefixes.
     * Passing Worker tests for routing, CORS, and range streaming.

2. Phase 2: Desktop App Updater Core
   - Scope: Desktop (Tauri Rust + JS) and core frontend hooks
   - Steps:
     * Add `updater.pubkey` to `src-tauri/tauri.conf.json` under `updater` for signature verification of `.app.tar.gz` payloads.
     * Create `app/core/Updater.js` exporting: `getCurrentVersionSafe`, `checkUpdate`, `performUpdate`, `evaluatePolicy`, `setupAutoUpdate`.
     * Implement channel detection using `update.allowBeta` (default: `stable`) to compute `https://adtools.lolik.workers.dev/manifest/<channel>.json`.
     * Detect architecture via `@tauri-apps/api/os` `arch()` and normalize to `aarch64` or `x86_64`.
     * Fetch manifest JSON; select `platforms[arch]` → `url`, `signature`; evaluate policy comparing `minVersion` vs current version (SemVer).
     * Implement download with progress callbacks; verify signature using the embedded public key; stage and apply the update.
     * Implement forced update flow: skip banner, auto-download and stage; trigger modal overlay; restart when ready.
     * Persist `update.autoCheck` and `update.allowBeta` via `app/pages/settings/service.js` with defaults `true` and `false` respectively.
     * Schedule checks in `setupAutoUpdate()`: on launch and approximately at 9:00, 12:00, and 15:00 local time.
     * Add unit tests (Vitest): version comparison, channel/arch selection, policy evaluation with mocked manifests.
     * Dependencies/Prerequisites: Worker manifest reachable; public key embedded; Tauri dev environment set up.

   - Deliverables:
     * `Updater.js` integrated and callable; safe current version retrieval.
     * Optional and forced update paths implemented with restart behavior verified.
     * Passing unit tests for policy and selection logic.

3. Phase 3: Web UI Integration
   - Scope: Frontend UI/UX
   - Steps:
     * Add “Check for Update” button in Settings to call `checkUpdate()` and surface outcome.
     * Implement header update banner (left of reload) with actions “Update Now” and “Later”; show states: Checking → Downloading → Installing → Restarting.
     * Implement forced-update modal overlay triggered by Updater events; block background interactions; provide accessible labels and focus management.
     * Wire using `app/core/EventBus.js` events: `update:show-banner`, `update:hide-banner`, `update:progress`, `update:forced`, `update:error`.
     * Style via `styles.css` consistent with existing theme; ensure light/dark parity and responsive layout.
     * Optionally emit anonymous analytics via `app/core/AnalyticsSender.js` for checks, downloads, and failures (privacy-respecting, opt-in).
     * Perform manual UI QA to validate flows and edge cases.
     * Dependencies/Prerequisites: Updater core implemented; EventBus operational.

   - Deliverables:
     * Settings “Check Now” works; header banner and modal overlay behave per spec.
     * Visible progress/error states; no layout regressions; accessible modal.

4. Phase 4: CI/CD and Release Automation
   - Scope: Infrastructure and release engineering
   - Steps:
     * Generate Tauri updater keypair (one-time); store private key and password in CI secrets; commit public key to `tauri.conf.json`.
     * Create CI workflow (e.g., GitHub Actions) to build for `aarch64-apple-darwin` and `x86_64-apple-darwin`.
     * Sign `.app.tar.gz` with the Tauri updater key; produce `.sig`; compute `sha256.txt` for each artifact.
     * Upload artifacts to `r2://adtools-updates/releases/<version>/<channel>/<arch>/` using `rclone` or `wrangler r2`.
     * Generate channel manifest with `jq` pointing URLs to `https://adtools.lolik.workers.dev/...`; upload to `manifest/<channel>.json`.
     * Add validation gates: verify URLs, signatures, checksums; maintain last-known-good manifest for quick rollback.
     * Implement promotion job to copy `beta` manifest to `stable` when approved; never mutate existing artifacts (immutable policy).
     * Publish release notes and tag; attach CI artifacts to releases if desired.
     * Dependencies/Prerequisites: R2 credentials, macOS runner with Tauri toolchain, updater private key in secrets.

   - Deliverables:
     * On tag push, CI builds, signs, uploads, and publishes manifests to R2.
     * Reproducible, validated release pipeline with documented rollback procedure.

5. Phase 5: Testing, Rollout, Observability, and Docs
   - Scope: QA, observability, documentation, and operations
   - Steps:
     * Expand unit tests for `Updater.js`; add tests for Settings persistence and EventBus wiring.
     * Add Worker tests for `Range` (206), headers, CORS, and 404/5xx handling (Wrangler/Miniflare).
     * Add integration tests to validate optional vs forced update behavior with mocked manifests.
     * Perform manual QA on Apple Silicon and Intel; test both `stable` and `beta`; simulate network failures and rollback.
     * Establish observability: `wrangler tail` dashboards; log artifact hits, range usage, and errors for capacity planning.
     * Rollout: publish to `beta`, validate, then promote to `stable`; practice backout by repointing manifest.
     * Finalize documentation: update this runbook, risks, and acceptance criteria with real URLs, keys, and commands.
     * Dependencies/Prerequisites: Previous phases complete; test devices available; Worker and CI accessible.

   - Deliverables:
     * All tests passing; QA checklist completed; beta and stable rollouts validated.
     * Monitoring in place; operational runbook finalized with escalation steps.

## Testing Strategy

- Unit Tests
  - `Updater.js`: version comparison, policy evaluation, channel/arch selection.
  - Settings service: booleans persist correctly.
- Integration Tests
  - Manifest parsing and selection of the correct platform URL.
  - Forced update path (`minVersion`) bypasses banner, shows overlay workflow.
  - Optional update path shows header banner and handles states.
- Worker Tests
  - Range requests, headers, and streaming for large files.
  - Correct content types and cache headers for manifests and artifacts.
- Manual QA
  - Apple Silicon and Intel devices.
  - Beta and stable channels.
  - Network failure and rollback scenarios.

## Rollout and Backout Strategy

- Rollout
  - Publish to `beta` first and validate on a small cohort.
  - Promote to `stable` by updating `manifest/stable.json`.
- Backout
  - Repoint manifest to previous version; artifacts remain immutable.
  - In case of bad manifest, restore the last known good manifest.

## Observability and Telemetry

- Worker
  - Use `wrangler tail` to monitor requests, errors, and timing.
  - Log artifact hits and range usage for capacity planning.
- App
  - Consider adding anonymous event counts for update checks and outcomes (success/failure), respecting privacy.

## Security and Compliance

- HTTPS-only; no plain HTTP or `r2://` in client.
- Signature verification with embedded public key.
- R2 policy: public `GET` for objects; private writes restricted to CI.
- No Apple notarization; provide user guidance for Gatekeeper prompts.

## Risks and Mitigations

- Stale cached manifest → Use `max-age=60`, allow manual “Check Now”.
- Broken manifest or missing artifact → Validate in CI before publish; keep last-known-good manifest.
- Forced update loop → Guard against applying the same version repeatedly; store last attempted version.
- Range support bugs → Add Worker tests and fallback to full download if needed.
- Gatekeeper friction → Document open instructions; optionally ship a signed DMG later.

## Work Breakdown Structure and Milestones

- Milestone 1: Infrastructure and Worker (2–3 days)
  - Configure R2 bucket and Worker routing, headers, CORS, range support.
  - Smoke-test with a sample artifact.
- Milestone 2: App Core Updater (3–4 days)
  - Implement `app/core/Updater.js`, policy evaluation, scheduling, and integration with `App.js`.
- Milestone 3: UI and Settings (1–2 days)
  - Wire “Check Now” action, header banner states, and forced-update overlay.
- Milestone 4: CI/CD (1–2 days)
  - Build/sign/upload; manifest generation pointing to Worker URLs.
- Milestone 5: Testing and Rollout (2–3 days)
  - Automated tests, manual QA on both architectures, beta rollout, then stable.

## Definition of Done and Acceptance Criteria

- App checks for updates at launch and on schedule; manual “Check Now” works.
- Optional updates show banner with correct progress; forced updates show overlay and restart automatically.
- Correct artifact selected by architecture and channel; signatures verified.
- Worker streams artifacts with correct headers and supports range requests.
- CI publishes manifests and artifacts to R2/Worker; rollback verified.
- Documentation updated; risks and runbook present; tests passing.

## Operational Runbook

- Publish
  - Run CI job to build/sign/upload and publish manifest to `manifest/<channel>.json`.
- Rollback
  - Re-upload previous manifest version or point `stable.json` to prior release.
- Monitoring
  - Tail Worker logs; monitor error rates and download volumes.
- Common Issues
  - 404 on artifact: verify R2 path and manifest URL.
  - Signature mismatch: ensure correct signing key and artifact pairing.

---

## Appendix A — Reference Details

## 1) Goals

- Seamless auto-update for macOS (Apple Silicon & Intel).
- Hosted on **Cloudflare R2 (bucket: `adtools-updates`)**.
- Immutable, cache-friendly release artifacts.
- Short-cached manifests for fast rollout and rollback.
- Clear separation between **stable** and **beta** channels.
- Atomic publishing: upload artifacts first, then manifest.

---

## 2) Versioning & Channels

- **SemVer** pattern: `MAJOR.MINOR.PATCH[-beta.N]`.
- Example flow:

  - Stable: `1.0.0`
  - Next beta: `1.1.0-beta.1`

- Channels:

  - `stable` → production users.
  - `beta` → early access testers.

---

## 3) Cloudflare R2 Object Structure (Bucket: `adtools-updates`)

```
r2://adtools-updates/
├─ manifest/
│  ├─ stable.json
│  └─ beta.json
│
├─ releases/
│  ├─ 1.0.0/stable/
│  │  ├─ aarch64/
│  │  │     ├─ ADTools-1.0.0-aarch64.dmg
│  │  │     ├─ ADTools-1.0.0-aarch64.app.tar.gz
│  │  │     ├─ ADTools-1.0.0-aarch64.app.tar.gz.sig
│  │  │     └─ sha256.txt
│  │  └─ x86_64/
│  │        ├─ ADTools-1.0.0-x86_64.dmg
│  │        ├─ ADTools-1.0.0-x86_64.app.tar.gz
│  │        ├─ ADTools-1.0.0-x86_64.app.tar.gz.sig
│  │        └─ sha256.txt
│  │
│  ├─ 1.1.0-beta.1/beta/
│  │  ├─ aarch64/
│  │  │     ├─ ADTools-1.1.0-beta.1-aarch64.dmg
│  │  │     ├─ ADTools-1.1.0-beta.1-aarch64.app.tar.gz
│  │  │     ├─ ADTools-1.1.0-beta.1-aarch64.app.tar.gz.sig
│  │  │     └─ sha256.txt
│  │  └─ x86_64/
│  │        ├─ ADTools-1.1.0-beta.1-x86_64.dmg
│  │        ├─ ADTools-1.1.0-beta.1-x86_64.app.tar.gz
│  │        ├─ ADTools-1.1.0-beta.1-x86_64.app.tar.gz.sig
│  │        └─ sha256.txt
│  │
│  └─ 1.1.0/stable/ ... (same pattern)
```

**Rules:**

- Artifacts are immutable.
- `.app.tar.gz` → auto-updater payload.
- `.dmg` → manual installer.
- `sha256.txt` → integrity verification.
- `.sig` → detached Tauri signature.

**Cache Headers:**

- Artifacts: `Cache-Control: public, max-age=31536000, immutable`
- Manifests: `Cache-Control: public, max-age=60`

---

## 4) Manifest Schema (macOS-only)

```json
{
  "version": "1.1.0-beta.1",
  "minVersion": "1.0.0",
  "notes": "Beta build for Apple Silicon and Intel Macs.",
  "pub_date": "2025-11-02T00:00:00Z",
  "platforms": {
    "aarch64": {
      "signature": "BASE64_SIGNATURE==",
      "url": "https://adtools.lolik.workers.dev/releases/1.1.0-beta.1/beta/aarch64/ADTools-1.1.0-beta.1-aarch64.app.tar.gz"
    },
    "x86_64": {
      "signature": "BASE64_SIGNATURE==",
      "url": "https://adtools.lolik.workers.dev/releases/1.1.0-beta.1/beta/x86_64/ADTools-1.1.0-beta.1-x86_64.app.tar.gz"
    }
  }
}
```

**Notes:**

- Safe to expose both `url` and `signature`.
- The app verifies authenticity using `updater.pubkey` embedded in `tauri.conf.json`.

Additionally:

- We do not use Apple code signing or notarization. Integrity is provided by the detached Tauri signature (`.sig`) validated against the embedded public key. First-time installs may require users to bypass Gatekeeper (e.g., right-click Open or adjust Privacy & Security).

---

## 5) App Updater Logic

**Architecture Mapping:**

```rust
#[cfg(target_arch = "aarch64")]
const PLATFORM_KEY: &str = "aarch64";
#[cfg(target_arch = "x86_64")]
const PLATFORM_KEY: &str = "x86_64";
```

**Channel Selection:**

- Default → `manifest/stable.json`
- Beta opt-in → `manifest/beta.json`

**Update Flow:**

1. Detect channel & architecture.
2. Fetch manifest via HTTPS.
3. Read `platforms[PLATFORM_KEY]`.
4. Download `.app.tar.gz`.
5. Verify signature using embedded pubkey.
6. Apply update if valid.

**UX Flow:**

- Check every 24h.
- Show toast: “Restart to update.”
- Show “Beta Channel” in About screen if applicable.

---

## 10) User Flow

This section describes how users encounter updates in the app UI and how the updater behaves under both optional and forced conditions.

### A) Automatic Checks

- App launch: On opening the app, it checks for updates using the current channel (`stable` by default, `beta` if enabled) and the device architecture (`aarch64` or `x86_64`).
- Scheduled checks: The app performs an additional check three times daily at approximately 9 am, 12 pm, and 3 pm local time.
- If an update is available for the current channel and architecture, an Update banner appears in the header, positioned to the left of the reload button, with two actions:
  - Update Now: Starts the update process immediately.
  - Later: Dismisses the banner until the next scheduled or manual check.

### B) Manual Check in Settings

- Settings ➝ Check for Update ➝ Check for Update button.
- The app checks for updates using the same channel and architecture rules as automatic checks.
- If an update exists, the same Update banner appears in the header with Update Now and Later options.

### C) Forced Update

- The manifest supports a top-level field `minVersion` (SemVer).
- If the running app version is lower than `minVersion`, the app initiates a forced update:
  - No banner is shown; instead, the app proceeds to download the update in the background.
  - Once the update is ready to apply, a modal overlay informs the user that the app will restart to complete the update.
  - The app then restarts to activate the new version.

### D) Update Process

- Download: The updater downloads the `.app.tar.gz` payload for the current `channel` and `platforms[arch]` entry.
- Verify: The payload’s detached signature (`.sig`) is validated against the embedded public key. No Apple code signing or notarization is used.
- Apply: The update is staged and applied. During optional updates, the banner progresses through states (Checking → Downloading → Installing → Restarting). For forced updates, a modal overlay is shown before restart.
- Restart: The app restarts to complete the update.

Notes:

- Platform keys are standardized as `aarch64` (Apple Silicon) and `x86_64` (Intel).
- Manifests are served from `manifest/stable.json` or `manifest/beta.json`; artifacts are under `releases/<version>/<channel>/<arch>/`.

---

## 6) CI/CD Publishing Workflow

1. **Build:**

   ```bash
   tauri build --target aarch64-apple-darwin
   tauri build --target x86_64-apple-darwin
   ```

2. **Sign:** Generate `.sig` for each `.app.tar.gz` using the Tauri updater key. No Apple code signing or notarization is performed.
3. **Upload:** Push to `r2://adtools-updates/releases/...`.
4. **Verify:** Confirm checksums.
5. **Publish:** Update manifest in `r2://adtools-updates/manifest/`.
6. (Optional) Promote beta → stable by copying manifests.
7. Tag and publish release notes.

**Rollback:**

- Repoint manifest to previous version.
- Immutable artifacts make rollback instant.

---

## 7) File Naming Convention

- `ADTools-<version>-aarch64.app.tar.gz`
- `ADTools-<version>-x86_64.app.tar.gz`
- `ADTools-<version>-aarch64.dmg`
- `ADTools-<version>-x86_64.dmg`
- `sha256.txt`
- `<payload>.sig`

---

## 8) macOS Code Signing and Notarization Policy

- Apple code signing and notarization are intentionally not used.
- Expect macOS Gatekeeper prompts on first install; provide user guidance to open the app (right-click Open) or allow from unidentified developer in Privacy & Security.
- Auto-update relies on Tauri’s signature verification of the `.app.tar.gz` payload to ensure integrity and authenticity.
- DMG and application bundles remain unsigned; distribution and support materials should reflect this policy.

---

## 9) CI Publish Script (pseudo-bash)

```bash
set -euo pipefail
VERSION="$1"      # e.g., 1.1.0-beta.1
CHANNEL="$2"      # stable|beta
BUCKET="r2://adtools-updates"
CDN_BASE="https://adtools.lolik.workers.dev"

for ARCH in aarch64 x86_64; do
  rclone copy dist/${VERSION}/${ARCH}/ADTools-${VERSION}-*.dmg \
    ${BUCKET}/releases/${VERSION}/${CHANNEL}/${ARCH}/
  rclone copy dist/${VERSION}/${ARCH}/ADTools-${VERSION}-*.app.tar.gz* \
    ${BUCKET}/releases/${VERSION}/${CHANNEL}/${ARCH}/
  rclone copy dist/${VERSION}/${ARCH}/sha256.txt \
    ${BUCKET}/releases/${VERSION}/${CHANNEL}/${ARCH}/
done

# Generate manifest
jq -n \
  --arg ver "$VERSION" \
  --arg ch "$CHANNEL" \
  --arg base "$CDN_BASE" \
  --arg sig_aarch64 "$(cat dist/${VERSION}/aarch64/ADTools-${VERSION}-aarch64.app.tar.gz.sig)" \
  --arg sig_x86_64 "$(cat dist/${VERSION}/x86_64/ADTools-${VERSION}-x86_64.app.tar.gz.sig)" \
  '{
     version: $ver,
     notes: "",
     pub_date: (now | strftime("%Y-%m-%dT%H:%M:%SZ")),
     platforms: {
       aarch64: {
         signature: $sig_aarch64,
         url: ($base + "/releases/" + $ver + "/" + $ch + "/aarch64/ADTools-" + $ver + "-aarch64.app.tar.gz")
       },
       x86_64: {
         signature: $sig_x86_64,
         url: ($base + "/releases/" + $ver + "/" + $ch + "/x86_64/ADTools-" + $ver + "-x86_64.app.tar.gz")
       }
     }
   }' > /tmp/${CHANNEL}.json

rclone copy /tmp/${CHANNEL}.json ${BUCKET}/manifest/
```
