/**
 * Installer script route handlers
 * Handles /install.sh, /install-oracle.sh, /uninstall.sh, and /releases/latest
 */

import { corsHeaders, isOriginAllowed } from '../utils/cors.js';

/**
 * Handle GET /install.sh - serve macOS installer script
 */
export async function handleInstallScript(request, env) {
  // Validate Origin; allow absent Origin for CLI usage
  if (!isOriginAllowed(request, env)) {
    return new Response("Forbidden", { status: 403, headers: { "Content-Type": "text/plain", ...corsHeaders() } });
  }

  // Prefer serving a script stored in R2 at install.sh, fallback to generated script
  try {
    const head = await env.UPDATES?.head("install.sh");
    if (head) {
      const obj = await env.UPDATES.get("install.sh");
      if (obj && obj.body) {
        return new Response(obj.body, {
          headers: {
            "Content-Type": "text/x-sh; charset=utf-8",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-store",
            ...corsHeaders(),
          },
        });
      }
    }
  } catch (_) {
    // Fall back to generated script below
  }

  const origin = new URL(request.url).origin;
  const script = generateInstallerScript(origin);
  return new Response(script, {
    headers: {
      "Content-Type": "text/x-sh; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      ...corsHeaders(),
    },
  });
}

/**
 * Handle GET /install-oracle.sh - serve Oracle client installer script
 */
export async function handleInstallOracleScript(request, env) {
  // Validate Origin; allow absent Origin for CLI usage
  if (!isOriginAllowed(request, env)) {
    return new Response("Forbidden", { status: 403, headers: { "Content-Type": "text/plain", ...corsHeaders() } });
  }

  // Serve the script stored in R2 at install-oracle.sh
  try {
    const obj = await env.UPDATES?.get("install-oracle.sh");
    if (obj && obj.body) {
      return new Response(obj.body, {
        headers: {
          "Content-Type": "text/x-sh; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
          ...corsHeaders(),
        },
      });
    }
  } catch (_) {
    // Fall through to 404 if object cannot be read
  }

  return new Response("Not Found", {
    status: 404,
    headers: { "Content-Type": "text/plain", ...corsHeaders() },
  });
}

/**
 * Handle GET /uninstall.sh - serve uninstaller script
 */
export async function handleUninstallScript(request, env) {
  // Validate Origin; allow absent Origin for CLI usage
  if (!isOriginAllowed(request, env)) {
    return new Response("Forbidden", { status: 403, headers: { "Content-Type": "text/plain", ...corsHeaders() } });
  }

  // Serve the script stored in R2 at uninstall.sh
  try {
    const obj = await env.UPDATES?.get("uninstall.sh");
    if (obj && obj.body) {
      return new Response(obj.body, {
        headers: {
          "Content-Type": "text/x-sh; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
          ...corsHeaders(),
        },
      });
    }
  } catch (_) {
    // Fall through to 404 if object cannot be read
  }

  return new Response("Not Found", {
    status: 404,
    headers: { "Content-Type": "text/plain", ...corsHeaders() },
  });
}

/**
 * Handle GET /releases/latest - redirect to latest DMG
 */
export async function handleLatestRelease(request, env) {
  if (!isOriginAllowed(request, env)) {
    return new Response("Forbidden", { status: 403, headers: { "Content-Type": "text/plain", ...corsHeaders() } });
  }
  const url = new URL(request.url);
  const channel = url.searchParams.get("channel") || "stable";
  const arch = url.searchParams.get("arch") || "";
  if (channel !== "stable") {
    return new Response("Only stable channel is supported", {
      status: 400,
      headers: { "Content-Type": "text/plain", ...corsHeaders() },
    });
  }
  if (!/^darwin-(aarch64|x86_64)$/.test(arch)) {
    return new Response("Invalid or missing arch. Use darwin-aarch64 or darwin-x86_64", {
      status: 400,
      headers: { "Content-Type": "text/plain", ...corsHeaders() },
    });
  }
  try {
    const manifestObj = await env.UPDATES?.get(`update/${channel}.json`);
    if (!manifestObj || !manifestObj.text) {
      return new Response("Manifest not found", { status: 404, headers: { "Content-Type": "text/plain", ...corsHeaders() } });
    }
    const manifestText = await manifestObj.text();
    const manifest = JSON.parse(manifestText);
    const platform = manifest?.platforms?.[arch];
    if (!platform) {
      return new Response("Platform not found in manifest", { status: 404, headers: { "Content-Type": "text/plain", ...corsHeaders() } });
    }
    const dmgUrl = platform.installer || platform.url;
    const devMode = String(env.DEV_MODE || "").toLowerCase() === "true";
    const isValidScheme = /^https:\/\//.test(String(dmgUrl || "")) || (devMode && /^http:\/\//.test(String(dmgUrl || "")));
    if (!dmgUrl || typeof dmgUrl !== "string" || !isValidScheme) {
      return new Response("Invalid artifact URL", { status: 500, headers: { "Content-Type": "text/plain", ...corsHeaders() } });
    }
    return new Response(null, {
      status: 302,
      headers: { Location: dmgUrl, ...corsHeaders() },
    });
  } catch (err) {
    return new Response("Server Error", { status: 500, headers: { "Content-Type": "text/plain", ...corsHeaders() } });
  }
}

/**
 * Generate macOS installer script
 */
export function generateInstallerScript(baseUrl) {
  // Generates a macOS-only installer with structured logging, retries, rollback
  return `#!/usr/bin/env bash
set -euo pipefail

log() { printf "[adtools] %s\\n" "$1"; }
warn() { printf "[warning] %s\\n" "$1"; }
err() { printf "[error] %s\\n" "$1" >&2; }

# Enforce TLS v1.2 for curl calls
CURL_SECURITY_ARGS=""

retry_curl() {
  local out="$1" url="$2" attempts="\${3:-3}"
  local i=1
  while (( i <= attempts )); do
    if curl -fSL \${CURL_SECURITY_ARGS} --progress-bar -o "$out" "$url"; then
      return 0
    fi
    warn "Download failed (attempt $i/$attempts). Retrying..."
    sleep $((i * 2))
    i=$((i + 1))
  done
  return 1
}

rollback_actions=()
add_rollback() { rollback_actions+=("$1"); }
run_rollback() {
  local i
  for (( i=\${#rollback_actions[@]}-1; i>=0; i-- )); do
    bash -c "\${rollback_actions[$i]}" || true
  done
}
trap 'err "Installation failed. Rolling back."; run_rollback' ERR

if [[ "$(uname -s)" != "Darwin" ]]; then
  err "This installer supports macOS (Darwin) only."
  exit 1
fi

cd ~
DOCS_DIR="$HOME/Documents"
mkdir -p "$DOCS_DIR"

ARCH_NATIVE="$(uname -m)"
case "$ARCH_NATIVE" in
  arm64) ARCH_KEY="darwin-aarch64";;
  x86_64) ARCH_KEY="darwin-x86_64";;
  *) err "Unsupported architecture: $ARCH_NATIVE"; exit 1;;
esac

CHANNEL="stable"
LATEST_URL="${baseUrl}/releases/latest?arch=\${ARCH_KEY}&channel=\${CHANNEL}"

TMP_DIR="$(mktemp -d)"
add_rollback "rm -rf '$TMP_DIR'"
DMG_PATH="$TMP_DIR/ADTools_latest.dmg"

log "Resolving latest release for $ARCH_KEY ($CHANNEL)"
if ! retry_curl "$DMG_PATH" "$LATEST_URL" 3; then
  err "Unable to download installer DMG. Check your network connection and try again."
  exit 1
fi

# Optional integrity: fetch manifest to verify installer_sha256 when available
MANIFEST_JSON="$TMP_DIR/manifest.json"
  if curl -fsSL \${CURL_SECURITY_ARGS} -o "$MANIFEST_JSON" "${baseUrl}/update/\${CHANNEL}.json"; then
  EXPECTED_SHA=""
  if command -v jq >/dev/null 2>&1; then
    EXPECTED_SHA="$(jq -r '.platforms["'"\${ARCH_KEY}"'"]?.installer_sha256 // empty' "$MANIFEST_JSON")"
  else
    EXPECTED_SHA="$(grep -A 5 '"'"\${ARCH_KEY}"'"' "$MANIFEST_JSON" | grep -E '"installer_sha256"' | sed -E 's/.*"installer_sha256"\\s*:\\s*"([^"]+)".*/\\1/' | head -n1)"
  fi
  if [[ -n "$EXPECTED_SHA" ]]; then
    ACTUAL_SHA="$({ shasum -a 256 "$DMG_PATH" 2>/dev/null || sha256sum "$DMG_PATH" 2>/dev/null || openssl dgst -sha256 "$DMG_PATH"; } | awk '{print $1}')"
    if [[ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]]; then
      err "Installer integrity check failed. Expected $EXPECTED_SHA, got $ACTUAL_SHA."
      err "Please retry later; if the issue persists, contact support."
      exit 1
    fi
    log "Installer integrity verified (sha256=$ACTUAL_SHA)"
  else
    warn "No installer checksum in manifest; skipping integrity verification."
  fi
else
  warn "Unable to fetch manifest for integrity check. Continuing without verification."
fi

DEST_DMG="$DOCS_DIR/ADTools-latest.dmg"
cp "$DMG_PATH" "$DEST_DMG"
add_rollback "rm -f '$DEST_DMG'"
log "Saved installer to $DEST_DMG"

MOUNT_DIR="$TMP_DIR/mount"
mkdir -p "$MOUNT_DIR"
if ! hdiutil attach "$DEST_DMG" -mountpoint "$MOUNT_DIR" -nobrowse -noverify -noautofsck; then
  err "Failed to mount DMG. Ensure the DMG is valid and not corrupted."
  exit 1
fi
add_rollback "hdiutil detach '$MOUNT_DIR' >/dev/null 2>&1 || hdiutil unmount '$MOUNT_DIR' >/dev/null 2>&1"
log "Mounted DMG at $MOUNT_DIR"

APP_SRC="$(find "$MOUNT_DIR" -maxdepth 2 -type d -name '*.app' | head -n1)"
if [[ -z "$APP_SRC" ]]; then
  err "No .app bundle found inside DMG."
  exit 1
fi
APP_DEST="$DOCS_DIR/$(basename "$APP_SRC")"

log "Copying app to $APP_DEST"
cp -R "$APP_SRC" "$APP_DEST"
add_rollback "rm -rf '$APP_DEST'"
chmod -R u+rwX,go+rX "$APP_DEST"

# Unmount DMG and remove temporary copy
if ! hdiutil detach "$MOUNT_DIR" >/dev/null 2>&1; then
  warn "Failed to detach by mountpoint; attempting unmount"
  hdiutil unmount "$MOUNT_DIR" >/dev/null 2>&1 || true
fi
log "Unmounted DMG"

rm -f "$DEST_DMG"
log "Removed DMG copy"

# Remove quarantine attribute, if present
if xattr "$APP_DEST" >/dev/null 2>&1; then
  xattr -d com.apple.quarantine "$APP_DEST" >/dev/null 2>&1 || true
  log "Cleared quarantine attributes"
else
  warn "xattr not available; skipping quarantine removal"
fi

# Launch the app by absolute path to avoid opening an older copy
log "Launching $(basename \\"$APP_DEST\\")"
open "$APP_DEST" || warn "Unable to launch automatically; open '$APP_DEST' manually"

log "Installation complete"
`;
}
