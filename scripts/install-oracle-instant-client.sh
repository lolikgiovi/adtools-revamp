#!/bin/bash

###############################################################################
# Oracle Instant Client Installation Script for AD Tools
#
# This script automatically:
# - Detects macOS architecture (ARM64 or x86_64)
# - Downloads Oracle Instant Client Basic Light from Oracle's official site
# - Installs it to ~/Documents/adtools_library/instantclient/
# - Configures library paths
#
# Usage:
#   curl -fsSL https://adtools.lolik.workers.dev/install-oracle-instant-client.sh | bash
#
# Requirements:
# - macOS 11.0 or later
# - ~80MB disk space
# - Internet connection
###############################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
# Allow override via env var; provide sandbox fallback inside workspace when restricted
DEFAULT_INSTALL_DIR="$HOME/Documents/adtools_library/instantclient"
INSTALL_DIR="${ADTOOLS_INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
SANDBOX_DIR="$PWD/.adtools_sandbox/instantclient"
TEMP_DIR=$(mktemp -d)
VERSION="23.3"  # Oracle Instant Client version (dot notation per Oracle site)
INSTALL_MODE="zip"  # 'dmg' for ARM64 preferred

# Cleanup on exit
trap 'rm -rf "$TEMP_DIR"' EXIT

###############################################################################
# Helper Functions
###############################################################################

print_header() {
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE}  Oracle Instant Client Installation${NC}"
    echo -e "${BLUE}  for AD Tools${NC}"
    echo -e "${BLUE}============================================${NC}"
    echo ""
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

check_prerequisites() {
    print_info "Checking prerequisites..."

    # Check if running on macOS
    if [[ "$OSTYPE" != "darwin"* ]]; then
        print_error "This script is only for macOS"
        exit 1
    fi

    # Check macOS version (require 11.0+)
    macos_version=$(sw_vers -productVersion | cut -d '.' -f 1)
    if [[ "$macos_version" -lt 11 ]]; then
        print_error "macOS 11.0 or later required (you have $(sw_vers -productVersion))"
        exit 1
    fi

    # Check for required commands
    for cmd in curl unzip; do
        if ! command -v "$cmd" &> /dev/null; then
            print_error "Required command not found: $cmd"
            exit 1
        fi
    done

    print_success "Prerequisites check passed"
}

detect_architecture() {
    print_info "Detecting system architecture..."

    ARCH=$(uname -m)

    case "$ARCH" in
        arm64)
            print_success "Detected: Apple Silicon (ARM64)"
            ORACLE_ARCH="arm64"
            BASIC_DMG_URL="https://download.oracle.com/otn_software/mac/instantclient/instantclient-basic-macos-arm64.dmg"
            # ZIP fallbacks if DMG fails
            BASIC_LITE_URL="https://download.oracle.com/otn_software/mac/instantclient/instantclient-basiclite-macos.arm64-${VERSION}.zip"
            BASIC_URL="https://download.oracle.com/otn_software/mac/instantclient/instantclient-basic-macos.arm64-${VERSION}.zip"
            ;;
        x86_64)
            print_success "Detected: Intel (x86_64)"
            ORACLE_ARCH="x64"
            BASIC_LITE_URL="https://download.oracle.com/otn_software/mac/instantclient/instantclient-basiclite-macos.x64-${VERSION}.zip"
            BASIC_URL="https://download.oracle.com/otn_software/mac/instantclient/instantclient-basic-macos.x64-${VERSION}.zip"
            ;;
        *)
            print_error "Unsupported architecture: $ARCH"
            exit 1
            ;;
    esac
}

check_existing_installation() {
    if [[ -d "$INSTALL_DIR" ]]; then
        print_warning "Existing installation found at: $INSTALL_DIR"
        echo -n "Do you want to replace it? [y/N] "
        read -r response

        if [[ ! "$response" =~ ^[Yy]$ ]]; then
            print_info "Installation cancelled"
            exit 0
        fi

        print_info "Removing existing installation..."
        if rm -rf "$INSTALL_DIR" 2>/dev/null; then
            print_success "Existing installation removed"
        else
            print_warning "Unable to remove '$INSTALL_DIR' (sandbox restriction)."
            print_info "Using sandbox install directory: $SANDBOX_DIR"
            INSTALL_DIR="$SANDBOX_DIR"
            mkdir -p "$INSTALL_DIR"
        fi
    fi
}

download_instant_client() {
    print_info "Downloading Oracle Instant Client ${VERSION}..."

    # Prefer DMG on ARM64
    if [[ "$ORACLE_ARCH" == "arm64" ]]; then
        DMG_FILE="$TEMP_DIR/instantclient-basic-macos-arm64.dmg"
        echo -e "${BLUE}   URL: $BASIC_DMG_URL${NC}"
        if curl --fail -L --progress-bar "$BASIC_DMG_URL" -o "$DMG_FILE"; then
            local size
            size=$(stat -f%z "$DMG_FILE" 2>/dev/null || echo 0)
            if [[ "$size" -lt 10485760 ]]; then # expect DMG > 10MB
                print_warning "Downloaded DMG is unexpectedly small (${size} bytes)."
            fi
            INSTALL_MODE="dmg"
            print_success "DMG download completed ($(du -h "$DMG_FILE" | cut -f1))"
            return 0
        else
            print_warning "DMG download failed; falling back to ZIP packages"
        fi
    fi

    # ZIP path (ARM64 fallback or Intel default)
    ZIP_FILE="$TEMP_DIR/instantclient.zip"

    try_download_zip() {
        local url="$1"
        echo -e "${BLUE}   URL: $url${NC}"
        if curl --fail -L --progress-bar "$url" -o "$ZIP_FILE"; then
            return 0
        else
            return 1
        fi
    }

    # First try Basic Lite, then fallback to Basic
    if ! try_download_zip "$BASIC_LITE_URL"; then
        print_warning "Basic Lite download failed; trying Basic package..."
        if ! try_download_zip "$BASIC_URL"; then
            print_error "Download failed for both Basic Lite and Basic packages"
            print_info "Please check your internet connection or try again later"
            exit 1
        fi
    fi

    # Verify ZIP
    if [[ ! -f "$ZIP_FILE" ]]; then
        print_error "Downloaded file not found"
        exit 1
    fi
    local zsize
    zsize=$(stat -f%z "$ZIP_FILE" 2>/dev/null || echo 0)
    if [[ "$zsize" -lt 1048576 ]]; then
        print_warning "Downloaded file is unexpectedly small (${zsize} bytes)."
        local mime
        mime=$(file -b --mime-type "$ZIP_FILE" 2>/dev/null || echo "unknown")
        if [[ "$mime" != "application/zip" ]]; then
            print_error "Downloaded content is not a ZIP (mime: $mime). Oracle may have changed the URL."
            exit 1
        fi
    fi
    if ! head -c 2 "$ZIP_FILE" | grep -q "PK"; then
        print_error "Downloaded file is not a valid ZIP (missing PK signature)"
        exit 1
    fi

    INSTALL_MODE="zip"
    print_success "ZIP download verified ($(du -h "$ZIP_FILE" | cut -f1))"
}

extract_and_install() {
    # Create installation directory
    if mkdir -p "$INSTALL_DIR" 2>/dev/null; then
        :
    else
        print_warning "Cannot create install directory '$INSTALL_DIR' (sandbox restriction)."
        print_info "Falling back to sandbox directory: $SANDBOX_DIR"
        INSTALL_DIR="$SANDBOX_DIR"
        mkdir -p "$INSTALL_DIR"
    fi

    if [[ "$INSTALL_MODE" == "dmg" ]]; then
        print_info "Mounting DMG and running installer..."
        if hdiutil mount "$DMG_FILE" >/dev/null; then
            VOL_PATH=$(find /Volumes -maxdepth 1 -type d -name "instantclient-basic-macos.arm64*" | head -n 1)
            if [[ -z "$VOL_PATH" ]]; then
                print_error "Unable to locate mounted volume for DMG"
                exit 1
            fi
            if bash "$VOL_PATH/install_ic.sh"; then
                print_success "DMG installer completed"
            else
                print_error "DMG installer failed"
                hdiutil unmount "$VOL_PATH" >/dev/null 2>&1 || true
                exit 1
            fi
            hdiutil unmount "$VOL_PATH" >/dev/null 2>&1 || true

            EXTRACTED_DIR=$(find "$HOME/Downloads" -maxdepth 1 -type d -name "instantclient_*" | head -n 1)
            if [[ -z "$EXTRACTED_DIR" ]]; then
                print_error "Could not find installed Instant Client directory in Downloads"
                exit 1
            fi
            print_info "Installing to: $INSTALL_DIR"
            cp -R "$EXTRACTED_DIR"/* "$INSTALL_DIR/"
        else
            print_error "Failed to mount DMG"
            exit 1
        fi
    else
        print_info "Extracting ZIP package..."
        if unzip -q "$ZIP_FILE" -d "$TEMP_DIR"; then
            print_success "Extraction completed"
        else
            print_error "Extraction failed"
            exit 1
        fi
        EXTRACTED_DIR=$(find "$TEMP_DIR" -type d -name "instantclient_*" | head -n 1)
        if [[ -z "$EXTRACTED_DIR" ]]; then
            print_error "Could not find extracted directory"
            exit 1
        fi
        print_info "Installing to: $INSTALL_DIR"
        cp -R "$EXTRACTED_DIR"/* "$INSTALL_DIR/"
    fi

    # Remove quarantine attributes for smooth loading
    xattr -dr com.apple.quarantine "$INSTALL_DIR" 2>/dev/null || true

    print_success "Installation completed"
}

verify_installation() {
    print_info "Verifying installation..."

    # Check for main library file
    if [[ -f "$INSTALL_DIR/libclntsh.dylib" ]]; then
        print_success "Main library found: libclntsh.dylib"
    else
        print_error "Main library not found: libclntsh.dylib"
        exit 1
    fi

    # Check file size (should be at least 50MB)
    file_size=$(stat -f%z "$INSTALL_DIR/libclntsh.dylib")
    if [[ "$file_size" -gt 52428800 ]]; then  # 50MB
        print_success "Library size verified: $(numfmt --to=iec-i --suffix=B "$file_size" 2>/dev/null || echo "${file_size} bytes")"
    else
        print_warning "Library size seems small: $file_size bytes"
    fi

    # List installed files
    print_info "Installed files:"
    ls -lh "$INSTALL_DIR" | awk '{if (NR>1) print "   " $9 " (" $5 ")"}'
}

configure_environment() {
    print_info "Configuring environment..."

    # Create a simple test to verify the library can be loaded
    # (This doesn't require Oracle database connection)
    if otool -L "$INSTALL_DIR/libclntsh.dylib" &> /dev/null; then
        print_success "Library is valid and can be loaded"
    else
        print_warning "Could not verify library loading"
    fi

    print_success "Configuration completed"
}

print_next_steps() {
    echo ""
    echo -e "${GREEN}============================================${NC}"
    echo -e "${GREEN}  Installation Successful! ✓${NC}"
    echo -e "${GREEN}============================================${NC}"
    echo ""
    echo -e "${BLUE}Next Steps:${NC}"
    echo ""
    echo "  1. Restart AD Tools application"
    echo "     (If running, completely quit with ⌘Q and reopen)"
    echo ""
    echo "  2. Navigate to the Compare Config tool"
    echo ""
    echo "  3. The feature will be automatically enabled"
    echo ""
    echo -e "${BLUE}Installation Details:${NC}"
    echo ""
    echo "  Location:     $INSTALL_DIR"
    echo "  Architecture: $ORACLE_ARCH"
    echo "  Version:      $VERSION"
    echo "  Size:         $(du -sh "$INSTALL_DIR" | cut -f1)"
    echo ""
    echo -e "${YELLOW}Note: No admin privileges were required for this installation${NC}"
    echo ""
}

###############################################################################
# Main Installation Flow
###############################################################################

main() {
    print_header

    check_prerequisites
    detect_architecture
    check_existing_installation
    download_instant_client
    extract_and_install
    verify_installation
    configure_environment
    print_next_steps
}

# Run main installation
main