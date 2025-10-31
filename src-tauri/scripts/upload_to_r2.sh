#!/usr/bin/env bash
set -euo pipefail

# Upload a built release directory to Cloudflare R2 using Wrangler.
# Usage:
#   upload_to_r2.sh <release_dir> [version] [bucket]
# Defaults:
#   version is parsed from <release_dir>/stable.json if not provided
#   bucket defaults to 'adtools-updates'

# Resolve script, src-tauri, and repository root directories.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_TAURI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$SRC_TAURI_DIR/.." && pwd)"

RELEASE_DIR="${1:-}"
VERSION_ARG="${2:-}"
BUCKET="${3:-adtools-updates}"

# Use Cloudflare remote API by default. Set WRANGLER_LOCAL=1 to use local.
WRANGLER_REMOTE_FLAG="--remote"
if [[ "${WRANGLER_LOCAL:-}" == "1" ]]; then
  WRANGLER_REMOTE_FLAG=""
fi

if [[ -z "$RELEASE_DIR" ]]; then
  echo "Usage: $0 <release_dir> [version] [bucket]" >&2
  exit 1
fi

if ! command -v wrangler >/dev/null 2>&1; then
  echo "ERROR: wrangler CLI not found. Install with: npm i -g wrangler" >&2
  exit 1
fi

# Canonicalize release dir to an absolute path and ensure commands run from repo root
RELEASE_DIR="$(cd "$RELEASE_DIR" && pwd)"
pushd "$ROOT_DIR" >/dev/null

parse_version_from_manifest() {
  local mf="$1"
  if command -v jq >/dev/null 2>&1; then
    jq -r '.version' "$mf"
  else
    grep -E '"version"\s*:\s*"' "$mf" | sed -E 's/.*"version"\s*:\s*"([^"]+)".*/\1/' | head -n1
  fi
}

VERSION="$VERSION_ARG"
if [[ -z "$VERSION" ]]; then
  if [[ -f "$RELEASE_DIR/stable.json" ]]; then
    VERSION="$(parse_version_from_manifest "$RELEASE_DIR/stable.json")"
  elif [[ -f "$RELEASE_DIR/beta.json" ]]; then
    VERSION="$(parse_version_from_manifest "$RELEASE_DIR/beta.json")"
  fi
fi

if [[ -z "$VERSION" ]]; then
  echo "ERROR: Unable to determine version. Pass it explicitly as the second argument." >&2
  exit 1
fi

echo "Uploading manifests to bucket '$BUCKET'..."
for ch in stable beta; do
  mf="$RELEASE_DIR/$ch.json"
  if [[ -f "$mf" ]]; then
    wrangler r2 object put "$BUCKET/update/$ch.json" $WRANGLER_REMOTE_FLAG --file="$mf"
  else
    echo "WARN: manifest missing: $mf" >&2
  fi
done

echo "Uploading artifacts for version $VERSION..."
upload_artifact() {
  local channel="$1" arch_dir="$2" arch_key="$3" base_name="$4"
  local tar_path sig_path dmg_path
  tar_path="$RELEASE_DIR/$arch_dir/ADTools-$VERSION-$base_name.app.tar.gz"
  sig_path="$RELEASE_DIR/$arch_dir/ADTools-$VERSION-$base_name.app.tar.gz.sig"
  dmg_path="$RELEASE_DIR/$arch_dir/ADTools-$VERSION-$base_name.dmg"

  if [[ -f "$tar_path" ]]; then
    wrangler r2 object put "$BUCKET/releases/$VERSION/$channel/$arch_key/ADTools-$VERSION-$base_name.app.tar.gz" $WRANGLER_REMOTE_FLAG --file="$tar_path"
  else
    echo "ERROR: Missing tarball: $tar_path" >&2
    exit 1
  fi
  if [[ -f "$sig_path" ]]; then
    wrangler r2 object put "$BUCKET/releases/$VERSION/$channel/$arch_key/ADTools-$VERSION-$base_name.app.tar.gz.sig" $WRANGLER_REMOTE_FLAG --file="$sig_path"
  else
    echo "ERROR: Missing signature: $sig_path" >&2
    exit 1
  fi
  if [[ -f "$dmg_path" ]]; then
    wrangler r2 object put "$BUCKET/releases/$VERSION/$channel/$arch_key/ADTools-$VERSION-$base_name.dmg" $WRANGLER_REMOTE_FLAG --file="$dmg_path"
  else
    echo "WARN: DMG not found: $dmg_path (skipping)" >&2
  fi
}

# stable channel
upload_artifact stable darwin-aarch64 darwin-aarch64 mac-arm64
upload_artifact stable darwin-x86_64 darwin-x86_64 mac-intel

# beta channel
upload_artifact beta darwin-aarch64 darwin-aarch64 mac-arm64
upload_artifact beta darwin-x86_64 darwin-x86_64 mac-intel

echo "Upload complete. Verify with:"
echo "  curl -I https://adtools.lolik.workers.dev/update/stable.json"
echo "  curl -I https://adtools.lolik.workers.dev/releases/$VERSION/stable/darwin-aarch64/ADTools-$VERSION-mac-arm64.app.tar.gz"
popd >/dev/null