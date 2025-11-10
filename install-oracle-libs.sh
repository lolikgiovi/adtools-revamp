#!/bin/bash
# Install Oracle Instant Client libraries to system location
# This makes the libraries available to the Tauri app without needing DYLD_LIBRARY_PATH
#
# Usage: sudo ./install-oracle-libs.sh

set -e

ORACLE_SRC="$HOME/Documents/adtools_library/oracle_instantclient"
INSTALL_DIR="/usr/local/lib"

echo "Oracle Instant Client Library Installer"
echo "========================================"
echo ""
echo "Source: $ORACLE_SRC"
echo "Target: $INSTALL_DIR"
echo ""

# Check if source exists
if [ ! -d "$ORACLE_SRC" ]; then
    echo "ERROR: Oracle Instant Client not found at: $ORACLE_SRC"
    exit 1
fi

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "ERROR: This script must be run with sudo"
    echo "Usage: sudo ./install-oracle-libs.sh"
    exit 1
fi

# Create symlinks for all .dylib files
echo "Creating symlinks in $INSTALL_DIR..."
for lib in "$ORACLE_SRC"/*.dylib*; do
    if [ -f "$lib" ]; then
        filename=$(basename "$lib")
        target="$INSTALL_DIR/$filename"

        # Remove existing symlink if it exists
        if [ -L "$target" ]; then
            echo "  Removing existing symlink: $filename"
            rm "$target"
        fi

        # Create new symlink
        echo "  Linking: $filename"
        ln -s "$lib" "$target"
    fi
done

echo ""
echo "✅ Installation complete!"
echo ""
echo "Installed libraries:"
ls -lh "$INSTALL_DIR"/libclntsh* 2>/dev/null || echo "  (none found)"
echo ""
echo "You can now run the Tauri app without setting DYLD_LIBRARY_PATH"
