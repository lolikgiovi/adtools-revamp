#!/usr/bin/env bash
set -euo pipefail

# Upload a built release directory to Cloudflare R2 using Wrangler.
# Usage:
#   upload_to_r2.sh <release_dir> [version] [bucket]
# Defaults:
#   version is parsed from <release_dir>/stable.json if not provided
#   bucket defaults to 'adtools-updates'
# Env:
#   LIST_ONLY=1  Print the directory list and exit without prompting

# Resolve script, src-tauri, and repository root directories.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_TAURI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$SRC_TAURI_DIR/.." && pwd)"
RELEASES_DIR="$SRC_TAURI_DIR/releases"

RELEASE_DIR="${1:-}"
VERSION_ARG="${2:-}"
BUCKET="${3:-adtools-updates}"

# Use Cloudflare remote API by default. Set WRANGLER_LOCAL=1 to use local.
WRANGLER_REMOTE_FLAG="--remote"
if [[ "${WRANGLER_LOCAL:-}" == "1" ]]; then
  WRANGLER_REMOTE_FLAG=""
fi

ensure_prereqs() {
  if ! command -v wrangler >/dev/null 2>&1; then
    echo "ERROR: wrangler CLI not found. Install with: npm i -g wrangler" >&2
    exit 1
  fi
  if ! command -v jq >/dev/null 2>&1; then
    echo "ERROR: jq is required. Please install jq (e.g., brew install jq)." >&2
    exit 1
  fi
}

choose_release_dir() {
  local preset="$1"
  local base="$RELEASES_DIR"
  if [[ ! -d "$base" ]]; then
    echo "ERROR: Releases directory not found at $base" >&2
    exit 1
  fi
  local -a dirs
  dirs=()
  while IFS= read -r d; do
    d="${d%/}"
    dirs+=("$d")
  done < <(ls -1dt "$base"/*/ 2>/dev/null | head -n 5)

  # If a preset was provided and not in the list, include it at the top
  if [[ -n "$preset" && -d "$preset" ]]; then
    local found=0
    for x in "${dirs[@]}"; do [[ "$x" == "$preset" ]] && found=1 && break; done
    if [[ $found -eq 0 ]]; then
      dirs=("$preset" "${dirs[@]}")
    fi
  fi

  if [[ ${#dirs[@]} -eq 0 ]]; then
    echo "ERROR: No release directories found under $base" >&2
    exit 1
  fi

  echo "Select release directory to upload:" >&2
  local i=1
  for d in "${dirs[@]}"; do
    local bn ver chans
    bn="$(basename "$d")"
    ver=""
    chans=""
    if [[ -f "$d/stable.json" ]]; then
      ver="$(parse_version_from_manifest "$d/stable.json")"
      chans="stable"
    fi
    if [[ -f "$d/beta.json" ]]; then
      [[ -z "$ver" ]] && ver="$(parse_version_from_manifest "$d/beta.json")"
      if [[ -n "$chans" ]]; then
        chans="${chans},beta"
      else
        chans="beta"
      fi
    fi
    if [[ -z "$ver" ]]; then
      ver="-"
    fi
    if [[ -z "$chans" ]]; then
      chans="none"
    fi
    printf "  %d) %s - version: %s; channels: %s\n" "$i" "$bn" "$ver" "$chans" >&2
    i=$((i+1))
  done
  echo >&2
  # If in list-only mode, return without prompting
  if [[ "${LIST_ONLY:-}" == "1" ]]; then
    return 0
  fi
  local default_bn="$(basename "${dirs[0]}")"
  local default_path="${dirs[0]}"
  printf "Directory [%s or 1-%d or name or path]: " "$default_bn" "${#dirs[@]}" >&2
  IFS= read -r input < /dev/tty
  input="${input:-$default_path}"
  if [[ "$input" =~ ^[0-9]+$ ]]; then
    local idx=$((input-1))
    if (( idx >= 0 && idx < ${#dirs[@]} )); then
      echo "${dirs[$idx]}"
      return 0
    else
      echo "ERROR: Invalid selection index $input" >&2
      exit 1
    fi
  else
    # Allow selecting by basename
    for d in "${dirs[@]}"; do
      if [[ "$(basename "$d")" == "$input" ]]; then
        echo "$d"
        return 0
      fi
    done
    if [[ -d "$input" ]]; then
      echo "$input"
      return 0
    else
      echo "ERROR: Directory not found: $input" >&2
      exit 1
    fi
  fi
}

# Canonicalize release dir to an absolute path if provided, and ensure commands run from repo root
if [[ -n "$RELEASE_DIR" ]]; then
  RELEASE_DIR="$(cd "$RELEASE_DIR" && pwd)"
fi
pushd "$ROOT_DIR" >/dev/null
trap 'popd >/dev/null' EXIT

parse_version_from_manifest() {
  local mf="$1"
  jq -r '.version // empty' "$mf"
}

RELEASE_DIR="$(choose_release_dir "$RELEASE_DIR")"
if [[ "${LIST_ONLY:-}" == "1" ]]; then
  exit 0
fi
RELEASE_DIR="$(cd "$RELEASE_DIR" && pwd)"
ensure_prereqs

# Determine available channels from manifests present
CHANNELS=()
for ch in stable beta; do
  if [[ -f "$RELEASE_DIR/$ch.json" ]]; then
    CHANNELS+=("$ch")
  fi
done
if [[ ${#CHANNELS[@]} -eq 0 ]]; then
  echo "ERROR: No manifests found in $RELEASE_DIR (expected stable.json and/or beta.json)" >&2
  exit 1
fi

VERSION="$VERSION_ARG"
if [[ -z "$VERSION" ]]; then
  # Prefer stable.json if present; otherwise use beta.json
  if [[ -f "$RELEASE_DIR/stable.json" ]]; then
    VERSION="$(parse_version_from_manifest "$RELEASE_DIR/stable.json")"
  else
    VERSION="$(parse_version_from_manifest "$RELEASE_DIR/beta.json")"
  fi
fi
if [[ -z "$VERSION" ]]; then
  echo "ERROR: Unable to determine version from manifests. Pass it explicitly as the second argument." >&2
  exit 1
fi

# Cross-check manifest versions against selected VERSION
for ch in "${CHANNELS[@]}"; do
  mvv="$(parse_version_from_manifest "$RELEASE_DIR/$ch.json")"
  if [[ -z "$mvv" ]]; then
    echo "ERROR: Manifest $ch.json has no version field" >&2
    exit 1
  fi
  if [[ "$mvv" != "$VERSION" ]]; then
    echo "ERROR: Version mismatch: selected $VERSION but $ch.json has $mvv" >&2
    exit 1
  fi
done

echo "Uploading manifests to bucket '$BUCKET'..."
for ch in "${CHANNELS[@]}"; do
  mf="$RELEASE_DIR/$ch.json"
  wrangler r2 object put "$BUCKET/update/$ch.json" $WRANGLER_REMOTE_FLAG --file="$mf" --content-type "application/json"
done

echo "Uploading artifacts for version $VERSION..."
upload_artifact() {
  local channel="$1" arch_dir="$2" arch_key="$3" base_name="$4"
  local tar_path sig_path dmg_path
  tar_path="$RELEASE_DIR/$arch_dir/ADTools-$VERSION-$base_name.app.tar.gz"
  sig_path="$RELEASE_DIR/$arch_dir/ADTools-$VERSION-$base_name.app.tar.gz.sig"
  dmg_path="$RELEASE_DIR/$arch_dir/ADTools-$VERSION-$base_name.dmg"

  if [[ -f "$tar_path" ]]; then
    wrangler r2 object put "$BUCKET/releases/$VERSION/$channel/$arch_key/ADTools-$VERSION-$base_name.app.tar.gz" $WRANGLER_REMOTE_FLAG --file="$tar_path" --content-type "application/gzip"
  else
    echo "ERROR: Missing tarball: $tar_path" >&2
    exit 1
  fi
  if [[ -f "$sig_path" ]]; then
    wrangler r2 object put "$BUCKET/releases/$VERSION/$channel/$arch_key/ADTools-$VERSION-$base_name.app.tar.gz.sig" $WRANGLER_REMOTE_FLAG --file="$sig_path" --content-type "text/plain"
  else
    echo "ERROR: Missing signature: $sig_path" >&2
    exit 1
  fi
  if [[ -f "$dmg_path" ]]; then
    wrangler r2 object put "$BUCKET/releases/$VERSION/$channel/$arch_key/ADTools-$VERSION-$base_name.dmg" $WRANGLER_REMOTE_FLAG --file="$dmg_path" --content-type "application/x-apple-diskimage"
  else
    echo "WARN: DMG not found: $dmg_path (skipping)" >&2
  fi
}

# Upload artifacts only for channels that have manifests present
for ch in "${CHANNELS[@]}"; do
  upload_artifact "$ch" darwin-aarch64 darwin-aarch64 mac-arm64
  upload_artifact "$ch" darwin-x86_64 darwin-x86_64 mac-intel
done

echo "Upload complete. Verify with:"
for ch in "${CHANNELS[@]}"; do
  echo "  curl -I https://adtools.lolik.workers.dev/update/$ch.json"
  echo "  curl -I https://adtools.lolik.workers.dev/releases/$VERSION/$ch/darwin-aarch64/ADTools-$VERSION-mac-arm64.app.tar.gz"
done