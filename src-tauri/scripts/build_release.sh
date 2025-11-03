#!/usr/bin/env bash
set -euo pipefail

# Build and sign AD Tools desktop packages for macOS (aarch64 and x86_64)
# - Produces .dmg, .app.tar.gz, .app.tar.gz.sig for each arch
# - Writes manifests stable.json and beta.json including generated signatures
# - Output directory: src-tauri/releases/YYYY-MM-DD_HH-MM/

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_TAURI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$SRC_TAURI_DIR/.." && pwd)"
RELEASES_DIR="$SRC_TAURI_DIR/releases"
KEY_DIR="$ROOT_DIR/keys"
KEY_FILE="$KEY_DIR/updater.key"
PASSPHRASE_FILE="$KEY_DIR/passphrase.key"
BASE_URL="${BASE_URL:-https://adtools.lolik.workers.dev}"
# Trim trailing slash to avoid double slashes in URLs
BASE_URL="${BASE_URL%/}"

# Resolve version: CLI arg $1 overrides tauri.conf.json version
VERSION_ARG="${1:-}"
TAURI_CONF="$SRC_TAURI_DIR/tauri.conf.json"

timestamp() {
  date +"%Y-%m-%d_%H-%M"
}

read_version_from_conf() {
  local conf="$1"
  # Prefer jq for robust JSON parsing; fallback to grep/sed when jq is unavailable
  if command -v jq >/dev/null 2>&1; then
    jq -r '.version // empty' "$conf"
  else
    grep -E '"version"[[:space:]]*:[[:space:]]*"' "$conf" \
      | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' \
      | head -n1
  fi
}

# Sanitize arbitrary version strings that may accidentally include JSON fragments
sanitize_version() {
  local v="$1"
  # If it looks like a JSON line, extract the quoted value; otherwise pass through
  echo "$v" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'
}

ensure_prereqs() {
  if [[ ! -f "$KEY_FILE" ]]; then
    echo "ERROR: Missing updater key at $KEY_FILE" >&2
    echo "       Expected: repo-root/keys/updater.key (Ed25519 private key)" >&2
    echo "       Also required: repo-root/keys/passphrase.key (matching passphrase)" >&2
    echo "       See docs/update.md → Quick Start — Release Scripts for setup." >&2
    exit 1
  fi
  if [[ ! -f "$PASSPHRASE_FILE" ]]; then
    echo "ERROR: Missing passphrase file at $PASSPHRASE_FILE" >&2
    echo "       Create repo-root/keys/passphrase.key containing your key's passphrase." >&2
    exit 1
  fi
  if ! command -v npx >/dev/null 2>&1; then
    echo "ERROR: npx not found; install Node.js/npm" >&2
    exit 1
  fi
  if ! command -v tar >/dev/null 2>&1; then
    echo "ERROR: tar not found" >&2
    exit 1
  fi
  if ! command -v jq >/dev/null 2>&1; then
    echo "INFO: jq not found; falling back to grep/sed for version parsing and skipping JSON validation." >&2
  fi
}

# Validate JSON file using jq when available
validate_json() {
  local conf="$1"
  if command -v jq >/dev/null 2>&1; then
    if ! jq -e '.' "$conf" >/dev/null 2>&1; then
      echo "ERROR: Invalid JSON in $conf" >&2
      exit 1
    fi
  fi
}

build_tauri_targets() {
  # Ensure we run Node/Vite/Tauri from the repository root (one level above src-tauri)
  pushd "$ROOT_DIR" >/dev/null
  echo "Building web assets (vite build --mode tauri)..."
  npm run build:tauri

  echo "Building Tauri app for aarch64-apple-darwin..."
  npx tauri build --target aarch64-apple-darwin

  echo "Building Tauri app for x86_64-apple-darwin..."
  npx tauri build --target x86_64-apple-darwin
  popd >/dev/null
}

find_artifacts() {
  local target="$1"
  local base="$SRC_TAURI_DIR/target/$target/release/bundle"
  local app_path dmg_path
  app_path="$(find "$base/macos" -maxdepth 1 -name '*.app' -type d | head -n1 || true)"
  dmg_path="$(find "$base/dmg" -maxdepth 1 -name '*.dmg' -type f | head -n1 || true)"
  if [[ -z "$app_path" ]]; then
    echo "ERROR: .app not found for $target under $base/macos" >&2
    exit 1
  fi
  if [[ -z "$dmg_path" ]]; then
    echo "WARN: .dmg not found for $target under $base/dmg; continuing" >&2
  fi
  echo "$app_path|$dmg_path"
}

compress_app() {
  local app_dir="$1" out_file="$2"
  local app_parent app_name
  app_parent="$(dirname "$app_dir")"
  app_name="$(basename "$app_dir")"
  # Create a tarball without macOS extended attributes or AppleDouble files to avoid `._` entries.
  # This prevents plugin-updater from mistakenly unpacking `._AD Tools.app`.
  COPYFILE_DISABLE=1 tar --no-mac-metadata --no-xattrs --exclude='.DS_Store' --exclude='._*' -czf "$out_file" -C "$app_parent" "$app_name"
}

sign_file() {
  local file="$1" key="$2" passphrase="$3"
  # Capture signer output and extract only the base64 public signature.
  # Some versions print human-friendly text; we need just the base64 token.
  local out sig
  out="$(npx tauri signer sign -f "$key" -p "$passphrase" "$file")"
  if echo "$out" | grep -q "Public signature:"; then
    # Read from the "Public signature:" section and stop before the trailing note.
    # Select the first pure base64 line to avoid concatenating any human text.
    sig="$(printf "%s" "$out" \
      | sed -n '/Public signature:/,$p' \
      | sed '/Make sure/q' \
      | grep -E '^[A-Za-z0-9+/=]+$' \
      | head -n 1)"
  else
    # Fallback: find the first pure base64-looking line anywhere in the output.
    sig="$(printf "%s" "$out" | grep -E '^[A-Za-z0-9+/=]+$' | head -n 1)"
  fi
  printf "%s" "$sig"
}

write_manifest() {
  local out_json="$1" version="$2" channel="$3" sig_arm64="$4" sig_x64="$5" sha_arm64="$6" sha_x64="$7"
  local pubdate
  pubdate="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  cat > "$out_json" <<JSON
{
  "version": "$version",
  "minVersion": "0.0.0",
  "notes": "$channel release $version",
  "pub_date": "$pubdate",
  "platforms": {
    "darwin-aarch64": {
      "signature": "$sig_arm64",
      "url": "$BASE_URL/releases/$version/$channel/darwin-aarch64/ADTools-$version-mac-arm64.app.tar.gz",
      "installer": "$BASE_URL/releases/$version/$channel/darwin-aarch64/ADTools-$version-mac-arm64.dmg",
      "installer_sha256": "${sha_arm64}"
    },
    "darwin-x86_64": {
      "signature": "$sig_x64",
      "url": "$BASE_URL/releases/$version/$channel/darwin-x86_64/ADTools-$version-mac-intel.app.tar.gz",
      "installer": "$BASE_URL/releases/$version/$channel/darwin-x86_64/ADTools-$version-mac-intel.dmg",
      "installer_sha256": "${sha_x64}"
    }
  }
}
JSON
}

main() {
  ensure_prereqs

  validate_json "$TAURI_CONF"

  local version timestamp_dir release_dir passphrase
  # Read passphrase as raw text, preserve spaces, strip trailing newlines/CR
  passphrase="$(tr -d '\r\n' < "$PASSPHRASE_FILE")"
  version="$VERSION_ARG"
  if [[ -z "$version" ]]; then
    version="$(read_version_from_conf "$TAURI_CONF")"
  fi
  # Final guard to strip any accidental JSON fragments
  version="$(sanitize_version "$version")"
  # Basic validation to catch obvious parsing failures
  if [[ ! "$version" =~ ^[0-9]+(\.[0-9]+){1,2}([-a-zA-Z0-9\.]+)?$ ]]; then
    echo "ERROR: Parsed version '$version' is invalid. Check tauri.conf.json or pass a version argument." >&2
    exit 1
  fi
  if [[ -z "$version" ]]; then
    echo "ERROR: Unable to determine version; pass it as first argument" >&2
    exit 1
  fi

  timestamp_dir="$(timestamp)"
  release_dir="$RELEASES_DIR/$timestamp_dir"
  mkdir -p "$release_dir/darwin-aarch64" "$release_dir/darwin-x86_64"

  build_tauri_targets

  # Locate built artifacts
  IFS='|' read -r APP_ARM64 DMG_ARM64 <<<"$(find_artifacts aarch64-apple-darwin)"
  IFS='|' read -r APP_X64 DMG_X64 <<<"$(find_artifacts x86_64-apple-darwin)"

  # Copy DMGs with naming convention
  if [[ -n "$DMG_ARM64" && -f "$DMG_ARM64" ]]; then
    cp "$DMG_ARM64" "$release_dir/darwin-aarch64/ADTools-$version-mac-arm64.dmg"
  fi
  if [[ -n "$DMG_X64" && -f "$DMG_X64" ]]; then
    cp "$DMG_X64" "$release_dir/darwin-x86_64/ADTools-$version-mac-intel.dmg"
  fi

  # Create .app.tar.gz for each arch
  compress_app "$APP_ARM64" "$release_dir/darwin-aarch64/ADTools-$version-mac-arm64.app.tar.gz"
  compress_app "$APP_X64" "$release_dir/darwin-x86_64/ADTools-$version-mac-intel.app.tar.gz"

  # Sign tarballs and save .sig files
  local SIG_ARM64 SIG_X64
  SIG_ARM64="$(sign_file "$release_dir/darwin-aarch64/ADTools-$version-mac-arm64.app.tar.gz" "$KEY_FILE" "$passphrase")"
  SIG_X64="$(sign_file "$release_dir/darwin-x86_64/ADTools-$version-mac-intel.app.tar.gz" "$KEY_FILE" "$passphrase")"
  echo "$SIG_ARM64" > "$release_dir/darwin-aarch64/ADTools-$version-mac-arm64.app.tar.gz.sig"
  echo "$SIG_X64" > "$release_dir/darwin-x86_64/ADTools-$version-mac-intel.app.tar.gz.sig"

  # Compute installer DMG checksums (optional if DMG exists)
  sha256_file() {
    local f="$1"
    if command -v shasum >/dev/null 2>&1; then
      shasum -a 256 "$f" | awk '{print $1}'
    elif command -v sha256sum >/dev/null 2>&1; then
      sha256sum "$f" | awk '{print $1}'
    else
      openssl dgst -sha256 "$f" | awk '{print $2}'
    fi
  }
  local SHA_ARM64 SHA_X64
  SHA_ARM64=""
  SHA_X64=""
  if [[ -f "$release_dir/darwin-aarch64/ADTools-$version-mac-arm64.dmg" ]]; then
    SHA_ARM64="$(sha256_file "$release_dir/darwin-aarch64/ADTools-$version-mac-arm64.dmg")"
  fi
  if [[ -f "$release_dir/darwin-x86_64/ADTools-$version-mac-intel.dmg" ]]; then
    SHA_X64="$(sha256_file "$release_dir/darwin-x86_64/ADTools-$version-mac-intel.dmg")"
  fi

  # Write manifests for both channels
  write_manifest "$release_dir/stable.json" "$version" "stable" "$SIG_ARM64" "$SIG_X64" "$SHA_ARM64" "$SHA_X64"
  write_manifest "$release_dir/beta.json" "$version" "beta" "$SIG_ARM64" "$SIG_X64" "$SHA_ARM64" "$SHA_X64"

  echo "Release built: $release_dir"
  echo "Artifacts:"
  ls -la "$release_dir/darwin-aarch64" "$release_dir/darwin-x86_64"
  echo "Manifests:"
  ls -la "$release_dir" | grep -E 'beta.json|stable.json' || true
}

main "$@"