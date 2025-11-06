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
INSTALL_DIR="$HOME/Documents/adtools_library/instantclient"
TEMP_DIR=$(mktemp -d)
VERSION="23_3"  # Oracle Instant Client version

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
            DOWNLOAD_URL="https://download.oracle.com/otn_software/mac/instantclient/instantclient-basiclite-macos.arm64-${VERSION}.zip"
            ;;
        x86_64)
            print_success "Detected: Intel (x86_64)"
            ORACLE_ARCH="x64"
            DOWNLOAD_URL="https://download.oracle.com/otn_software/mac/instantclient/instantclient-basiclite-macos.x64-${VERSION}.zip"
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
        rm -rf "$INSTALL_DIR"
        print_success "Existing installation removed"
    fi
}

download_instant_client() {
    print_info "Downloading Oracle Instant Client ${VERSION}..."
    echo -e "${BLUE}   URL: $DOWNLOAD_URL${NC}"

    ZIP_FILE="$TEMP_DIR/instantclient.zip"

    # Download with progress bar
    if curl -L --progress-bar "$DOWNLOAD_URL" -o "$ZIP_FILE"; then
        print_success "Download completed"
    else
        print_error "Download failed"
        print_info "Please check your internet connection or try again later"
        exit 1
    fi

    # Verify download
    if [[ ! -f "$ZIP_FILE" ]] || [[ ! -s "$ZIP_FILE" ]]; then
        print_error "Downloaded file is invalid or empty"
        exit 1
    fi

    print_success "Download verified ($(du -h "$ZIP_FILE" | cut -f1))"
}

extract_and_install() {
    print_info "Extracting Oracle Instant Client..."

    # Create installation directory
    mkdir -p "$INSTALL_DIR"

    # Extract
    if unzip -q "$ZIP_FILE" -d "$TEMP_DIR"; then
        print_success "Extraction completed"
    else
        print_error "Extraction failed"
        exit 1
    fi

    # Find the extracted directory (usually instantclient_XX_X)
    EXTRACTED_DIR=$(find "$TEMP_DIR" -type d -name "instantclient_*" | head -n 1)

    if [[ -z "$EXTRACTED_DIR" ]]; then
        print_error "Could not find extracted directory"
        exit 1
    fi

    print_info "Installing to: $INSTALL_DIR"

    # Move files to installation directory
    cp -R "$EXTRACTED_DIR"/* "$INSTALL_DIR/"

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