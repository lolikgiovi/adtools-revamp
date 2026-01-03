#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
log() { printf "%b\n" "${GREEN}[adtools] $1${NC}"; }
warn() { printf "%b\n" "${YELLOW}[warning] $1${NC}"; }
err() { printf "%b\n" "${RED}[error] $1${NC}" >&2; }

if [[ "$(uname -s)" != "Darwin" ]]; then
  err "This script supports macOS (Darwin) only."
  exit 1
fi

DRY=0
PURGE=0
case "${1:-}" in
  --dry-run) DRY=1 ;;
  --purge) PURGE=1 ;;
  "") ;;
  *) warn "Unknown option: $1" ;;
esac

log "Quitting AD Tools if running"
osascript -e 'tell application "AD Tools" to quit' >/dev/null 2>&1 || true
sleep 1

# Known install locations
APP_CANDIDATES=(
  "/Applications/AD Tools.app"
  "$HOME/Applications/AD Tools.app"
  "$HOME/Documents/AD Tools.app"
)

# Search additional common locations for stray copies
while IFS= read -r p; do
  # Avoid duplicates
  for k in "${APP_CANDIDATES[@]}"; do [[ "$p" == "$k" ]] && continue 2; done
  APP_CANDIDATES+=("$p")
done < <(find "$HOME/Desktop" "$HOME/Downloads" "$HOME" -maxdepth 3 -type d -name 'AD Tools*.app' 2>/dev/null || true)

remove_path() {
  local p="$1"
  if [[ -e "$p" ]]; then
    if [[ "$DRY" -eq 1 ]]; then
      log "Would remove: $p"
    else
      log "Removing: $p"
      rm -rf "$p"
    fi
  fi
}

for p in "${APP_CANDIDATES[@]}"; do remove_path "$p"; done

# User data and caches
DATA_ITEMS=(
  "$HOME/Library/Application Support/com.adtools.desktop"
  "$HOME/Library/Caches/com.adtools.desktop"
  "$HOME/Library/Preferences/com.adtools.desktop.plist"
  "$HOME/Library/Saved Application State/com.adtools.desktop.savedState"
  "$HOME/Library/Application Support/com.adtools.desktop/updates"
)
for d in "${DATA_ITEMS[@]}"; do remove_path "$d"; done

# WKWebView website data (localStorage/IndexedDB) used by Tauri
WEBKIT_ITEMS=(
  "$HOME/Library/WebKit/com.adtools.desktop"
  "$HOME/Library/Containers/com.adtools.desktop/Data/Library/WebKit"
  "$HOME/Library/Containers/com.adtools.desktop/Data/Library/Caches/com.apple.WebKit.Networking"
  "$HOME/Library/Containers/com.adtools.desktop/Data/Library/Caches/com.apple.WebKit.WebContent"
)
for d in "${WEBKIT_ITEMS[@]}"; do remove_path "$d"; done

if [[ "$PURGE" -eq 1 ]]; then
  # Refresh LaunchServices registration so the system forgets removed app paths
  log "Purging LaunchServices registration"
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister" -kill -r -domain local -domain system -domain user >/dev/null 2>&1 || true
fi

log "AD Tools has been removed${DRY:+ (dry-run)}."