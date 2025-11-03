#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

# AD Tools installer script (macOS)
# Usage:
#   curl -fsSL https://adtools.lolik.workers.dev/install.sh | bash

log() {
  printf "[adtools] %s\n" "$*"
}
err() {
  printf "[adtools:ERROR] %s\n" "$*" >&2
}

OS_NAME="$(uname -s)"
if [[ "$OS_NAME" != "Darwin" ]]; then
  err "This installer supports macOS only."
  exit 1
fi

ARCH_RAW="$(uname -m)"
ARCH_KEY=""
ARCH_BASE=""
DEVICE_LABEL=""
case "$ARCH_RAW" in
  arm64)
    ARCH_KEY="darwin-aarch64"
    ARCH_BASE="mac-arm64"
    DEVICE_LABEL="MacOS Apple Silicon"
    ;;
  x86_64)
    ARCH_KEY="darwin-x86_64"
    ARCH_BASE="mac-intel"
    DEVICE_LABEL="MacOS Intel"
    ;;
  *)
    err "Unsupported architecture: $ARCH_RAW"
    exit 1
    ;;
esac

# Happy flow: announce device
printf "Performing Installation for AD Tools in %s Device\n" "$DEVICE_LABEL"

# Paths
DOCS_DIR="$HOME/Documents"
mkdir -p "$DOCS_DIR"
DMG_PATH="$DOCS_DIR/ADTools-latest.dmg"
TAR_PATH="$DOCS_DIR/ADTools-latest.app.tar.gz"
APP_DEST="$DOCS_DIR/AD Tools.app"
MOUNT_DIR="/Volumes/ADToolsInstaller"

BASE_URL="https://adtools.lolik.workers.dev"

log "Resolving latest artifact URL for $ARCH_KEY..."
printf "Downloading the App\n"
FINAL_URL="$(curl -fsSL -o /dev/null -w '%{url_effective}' "$BASE_URL/releases/latest?arch=$ARCH_KEY&channel=stable")"
if [[ -z "$FINAL_URL" ]]; then
  err "Failed to resolve latest artifact URL."
  exit 1
fi

if [[ "$FINAL_URL" == *.dmg ]]; then
  log "Downloading DMG..."
  curl -fsSL -o "$DMG_PATH" "$FINAL_URL"
  log "Mounting disk image..."
  if [[ -d "$MOUNT_DIR" ]]; then
    hdiutil detach "$MOUNT_DIR" >/dev/null 2>&1 || true
    rmdir "$MOUNT_DIR" >/dev/null 2>&1 || true
  fi
  mkdir -p "$MOUNT_DIR"
  hdiutil attach -nobrowse -noverify -mountpoint "$MOUNT_DIR" "$DMG_PATH" >/dev/null

  APP_SRC="$(find "$MOUNT_DIR" -maxdepth 1 -type d -name "*.app" | head -n 1 || true)"
  if [[ -z "$APP_SRC" ]]; then
    err "No .app found in mounted image."
    hdiutil detach "$MOUNT_DIR" >/dev/null 2>&1 || true
    rm -f "$DMG_PATH"
    exit 1
  fi

  log "Installing app to $APP_DEST..."
  rm -rf "$APP_DEST" 2>/dev/null || true
  ditto "$APP_SRC" "$APP_DEST"
  printf "Installing the App to Documents directory\n"

  log "Detaching image and cleaning up..."
  hdiutil detach "$MOUNT_DIR" >/dev/null 2>&1 || true
  rm -f "$DMG_PATH" || true
else
  log "DMG not available; downloading tar.gz artifact..."
  curl -fsSL -o "$TAR_PATH" "$FINAL_URL"
  TMP_DIR="$(mktemp -d)"
  log "Extracting app..."
  tar -xzf "$TAR_PATH" -C "$TMP_DIR"
  APP_SRC="$(find "$TMP_DIR" -maxdepth 2 -type d -name "*.app" | head -n 1 || true)"
  if [[ -z "$APP_SRC" ]]; then
    err "No .app found in tarball."
    rm -rf "$TMP_DIR" "$TAR_PATH"
    exit 1
  fi
  log "Installing app to $APP_DEST..."
  rm -rf "$APP_DEST" 2>/dev/null || true
  ditto "$APP_SRC" "$APP_DEST"
  printf "Installing the App to Documents directory\n"
  rm -rf "$TMP_DIR" "$TAR_PATH"
fi


printf "Removing quarantine attributes\n"
log "Removing quarantine attributes..."
xattr -dr com.apple.quarantine "$APP_DEST" >/dev/null 2>&1 || true

log "Opening AD Tools..."
open "$APP_DEST" >/dev/null 2>&1 || true

log "Installation complete."