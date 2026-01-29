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

TAURI_CONF="$SRC_TAURI_DIR/tauri.conf.json"

# Globals for auto-revert handling
FILES_MODIFIED=0
BUILD_OK=0
TAURI_CONF_BACKUP=""
PACKAGE_JSON_BACKUP=""

timestamp() {
  date +"%Y-%m-%d_%H-%M"
}

read_version_from_conf() {
  local conf="$1"
  jq -r '.version // empty' "$conf"
}

# Sanitize arbitrary version strings that may accidentally include JSON fragments
sanitize_version() {
  local v="$1"
  echo "$v"
}

# -------- Interactive prompt helpers --------
prompt_version() {
  local current="$1" input
  while true; do
    read -r -p "Version [${current}]: " input || true
    input="${input:-$current}"
    if [[ "$input" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "$input"
      return 0
    fi
    echo "Invalid version format. Use X.Y.Z (e.g., 1.2.3)."
  done
}

prompt_force_update() {
  local ans
  read -r -p "Force update? (y/N) [N]: " ans || true
  ans="${ans:-N}"
  if [[ "$ans" == "y" || "$ans" == "Y" ]]; then
    echo "y"
  else
    echo "n"
  fi
}

prompt_channel() {
  local ch
  while true; do
    read -r -p "Channel (stable/beta/both) [stable]: " ch || true
    ch="${ch:-stable}"
    case "$ch" in
      stable|beta|both)
        echo "$ch"
        return 0
        ;;
      *)
        echo "Invalid channel. Choose stable, beta, or both."
        ;;
    esac
  done
}

prompt_release_message() {
  local default_msg="$1" msg
  read -r -p "Release message [${default_msg}]: " msg || true
  echo "${msg:-$default_msg}"
}

# Removed: JSON is constructed via jq directly in write_manifest

# Revert version changes using backups when a failure occurs
revert_versions() {
  if [[ "$FILES_MODIFIED" -eq 1 ]]; then
    [[ -n "$TAURI_CONF_BACKUP" && -f "$TAURI_CONF_BACKUP" ]] && cp "$TAURI_CONF_BACKUP" "$TAURI_CONF" || true
    [[ -n "$PACKAGE_JSON_BACKUP" && -f "$PACKAGE_JSON_BACKUP" ]] && cp "$PACKAGE_JSON_BACKUP" "$ROOT_DIR/package.json" || true
    echo "Version files reverted due to error."
  fi
}

# Update the top-level "version" field in a JSON file using jq
update_json_version() {
  local file="$1" new_version="$2" tmp
  tmp="$(mktemp)"
  jq --arg v "$new_version" '.version = $v' "$file" > "$tmp" && mv "$tmp" "$file"
}

ensure_prereqs() {
  if [[ ! -f "$KEY_FILE" ]]; then
    echo "ERROR: Missing updater key at $KEY_FILE" >&2
    echo "       Expected: repo-root/keys/updater.key - Ed25519 private key" >&2
    echo "       Also required: repo-root/keys/passphrase.key - matching passphrase" >&2
    echo "       See docs/update.md -> Quick Start — Release Scripts for setup." >&2
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
    echo "ERROR: jq is required. Please install jq (e.g., brew install jq)." >&2
    exit 1
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

  # Build the Python sidecar first (includes ad-hoc signing)
  echo "Building Oracle sidecar..."
  npm run sidecar:build

  echo "Building web assets (vite build --mode tauri)..."
  npm run build:tauri

  # NOTE: Oracle Instant Client is no longer needed for builds.
  # The Python sidecar uses oracledb in "thin mode" which connects directly
  # to Oracle without native client libraries.

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
      # Extract the base64 signature line after the marker without using sed
      sig="$(printf "%s" "$out" | awk 'BEGIN{found=0} /Public signature:/ {found=1; next} found && /^[A-Za-z0-9+\/=]+$/ {print; exit}')"
    else
      # Fallback: find the first pure base64-looking line anywhere in the output.
      sig="$(printf "%s" "$out" | grep -E '^[A-Za-z0-9+/=]+$' | head -n 1)"
    fi
    printf "%s" "$sig"
  }

write_manifest() {
  local out_json="$1" version="$2" min_version="$3" channel="$4" notes="$5" sig_arm64="$6" sig_x64="$7" sha_arm64="$8" sha_x64="$9"
  local pubdate
  pubdate="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  jq -n \
    --arg base_url "$BASE_URL" \
    --arg version "$version" \
    --arg min_version "$min_version" \
    --arg notes "$notes" \
    --arg pubdate "$pubdate" \
    --arg channel "$channel" \
    --arg sig_arm64 "$sig_arm64" \
    --arg sig_x64 "$sig_x64" \
    --arg sha_arm64 "$sha_arm64" \
    --arg sha_x64 "$sha_x64" \
    '{
      version: $version,
      minVersion: $min_version,
      notes: $notes,
      pub_date: $pubdate,
      platforms: {
        "darwin-aarch64": (
          {
            signature: $sig_arm64,
            url: ($base_url+"/releases/"+$version+"/"+$channel+"/darwin-aarch64/ADTools-"+$version+"-mac-arm64.app.tar.gz"),
            installer: ($base_url+"/releases/"+$version+"/"+$channel+"/darwin-aarch64/ADTools-"+$version+"-mac-arm64.dmg")
          }
          + ( if $sha_arm64 != "" then { installer_sha256: $sha_arm64 } else {} end )
        ),
        "darwin-x86_64": (
          {
            signature: $sig_x64,
            url: ($base_url+"/releases/"+$version+"/"+$channel+"/darwin-x86_64/ADTools-"+$version+"-mac-intel.app.tar.gz"),
            installer: ($base_url+"/releases/"+$version+"/"+$channel+"/darwin-x86_64/ADTools-"+$version+"-mac-intel.dmg")
          }
          + ( if $sha_x64 != "" then { installer_sha256: $sha_x64 } else {} end )
        )
      }
    }' > "$out_json"
}

main() {
  ensure_prereqs

  validate_json "$TAURI_CONF"

  local version current_version selected_version timestamp_dir release_dir passphrase channel force min_version notes
  # Read passphrase as raw text, preserve spaces, strip trailing newlines/CR
  passphrase="$(tr -d '\r\n' < "$PASSPHRASE_FILE")"
  current_version="$(read_version_from_conf "$TAURI_CONF")"
  current_version="$(sanitize_version "$current_version")"
  if [[ -z "$current_version" ]]; then
    echo "ERROR: Unable to determine current version from $TAURI_CONF" >&2
    exit 1
  fi

  # Strictly interactive prompts
  selected_version="$(prompt_version "$current_version")"
  force="$(prompt_force_update)"  # y or n
  channel="$(prompt_channel)"     # stable | beta | both
  # Default notes depend on channel selection
  if [[ "$channel" == "both" ]]; then
    notes="Release $selected_version"
  else
    notes="$channel release $selected_version"
  fi
  notes="$(prompt_release_message "$notes")"
  # Compute minVersion
  if [[ "$force" == "y" ]]; then
    min_version="$selected_version"
  else
    min_version="0.0.0"
  fi

  # Prepare auto-revert backups only if we will change versions
  trap 'revert_versions' ERR
  trap '[[ "$BUILD_OK" -eq 1 ]] || revert_versions' EXIT

  # Update versions only when changed
  if [[ "$selected_version" != "$current_version" ]]; then
    FILES_MODIFIED=1
    TAURI_CONF_BACKUP="$(mktemp)"; cp "$TAURI_CONF" "$TAURI_CONF_BACKUP"
    PACKAGE_JSON_BACKUP="$(mktemp)"; cp "$ROOT_DIR/package.json" "$PACKAGE_JSON_BACKUP"
    update_json_version "$TAURI_CONF" "$selected_version"
    update_json_version "$ROOT_DIR/package.json" "$selected_version"
    validate_json "$TAURI_CONF"
    validate_json "$ROOT_DIR/package.json"
  fi

  timestamp_dir="$(timestamp)"
  release_dir="$RELEASES_DIR/$timestamp_dir"
  mkdir -p "$release_dir/darwin-aarch64" "$release_dir/darwin-x86_64"

  build_tauri_targets

  # Locate built artifacts
  IFS='|' read -r APP_ARM64 DMG_ARM64 <<<"$(find_artifacts aarch64-apple-darwin)"
  IFS='|' read -r APP_X64 DMG_X64 <<<"$(find_artifacts x86_64-apple-darwin)"

  # NOTE: Oracle Instant Client bundling is no longer needed.
  # The Python sidecar uses oracledb in "thin mode" which connects directly
  # to Oracle without native client libraries.

  # Copy DMGs from Tauri build output
  echo "Copying DMGs..."
  cp "$DMG_ARM64" "$release_dir/darwin-aarch64/ADTools-$selected_version-mac-arm64.dmg"
  cp "$DMG_X64" "$release_dir/darwin-x86_64/ADTools-$selected_version-mac-intel.dmg"

  # Create .app.tar.gz for each arch
  compress_app "$APP_ARM64" "$release_dir/darwin-aarch64/ADTools-$selected_version-mac-arm64.app.tar.gz"
  compress_app "$APP_X64" "$release_dir/darwin-x86_64/ADTools-$selected_version-mac-intel.app.tar.gz"

  # Sign tarballs and save .sig files
  local SIG_ARM64 SIG_X64
  SIG_ARM64="$(sign_file "$release_dir/darwin-aarch64/ADTools-$selected_version-mac-arm64.app.tar.gz" "$KEY_FILE" "$passphrase")"
  SIG_X64="$(sign_file "$release_dir/darwin-x86_64/ADTools-$selected_version-mac-intel.app.tar.gz" "$KEY_FILE" "$passphrase")"
  echo "$SIG_ARM64" > "$release_dir/darwin-aarch64/ADTools-$selected_version-mac-arm64.app.tar.gz.sig"
  echo "$SIG_X64" > "$release_dir/darwin-x86_64/ADTools-$selected_version-mac-intel.app.tar.gz.sig"

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
  if [[ -f "$release_dir/darwin-aarch64/ADTools-$selected_version-mac-arm64.dmg" ]]; then
    SHA_ARM64="$(sha256_file "$release_dir/darwin-aarch64/ADTools-$selected_version-mac-arm64.dmg")"
  fi
  if [[ -f "$release_dir/darwin-x86_64/ADTools-$selected_version-mac-intel.dmg" ]]; then
    SHA_X64="$(sha256_file "$release_dir/darwin-x86_64/ADTools-$selected_version-mac-intel.dmg")"
  fi

  # Write manifests according to selection
  if [[ "$channel" == "stable" || "$channel" == "both" ]]; then
    write_manifest "$release_dir/stable.json" "$selected_version" "$min_version" "stable" "$notes" "$SIG_ARM64" "$SIG_X64" "$SHA_ARM64" "$SHA_X64"
  fi
  if [[ "$channel" == "beta" || "$channel" == "both" ]]; then
    write_manifest "$release_dir/beta.json" "$selected_version" "$min_version" "beta" "$notes" "$SIG_ARM64" "$SIG_X64" "$SHA_ARM64" "$SHA_X64"
  fi

  echo "Release built: $release_dir"
  echo "Artifacts:"
  ls -la "$release_dir/darwin-aarch64" "$release_dir/darwin-x86_64"
  echo "Manifests:"
  ls -la "$release_dir" | grep -E 'beta.json|stable.json' || true

  # Mark success and cleanup backups if any
  BUILD_OK=1
  [[ -n "${TAURI_CONF_BACKUP:-}" && -f "${TAURI_CONF_BACKUP:-}" ]] && rm -f "$TAURI_CONF_BACKUP" || true
  [[ -n "${PACKAGE_JSON_BACKUP:-}" && -f "${PACKAGE_JSON_BACKUP:-}" ]] && rm -f "$PACKAGE_JSON_BACKUP" || true
}

main "$@"