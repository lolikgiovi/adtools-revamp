#!/bin/bash
# Local Oracle Instant Client Installation Test Script
# This script helps you test the installation process locally

set -e

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Oracle Instant Client Local Installation Test ===${NC}"
echo ""

# Configuration - CHANGE THIS to point to your downloaded DMG file
DMG_FILE="$HOME/Downloads/instantclient-basic-macos.arm64-23.4.0.24.05.dmg"
INSTALL_DIR="$HOME/Documents/adtools_library/oracle_instantclient"

echo "Configuration:"
echo "  DMG File: $DMG_FILE"
echo "  Install Directory: $INSTALL_DIR"
echo ""

# Detect architecture
ARCH=$(uname -m)
echo "System Architecture: ${YELLOW}$ARCH${NC}"
echo ""

# Check if DMG exists
if [ ! -f "$DMG_FILE" ]; then
    echo -e "${RED}Error: DMG file not found at: $DMG_FILE${NC}"
    echo ""
    echo "Please download Oracle Instant Client from:"
    if [ "$ARCH" = "arm64" ]; then
        echo "  ARM64: https://www.oracle.com/database/technologies/instant-client/macos-arm64-downloads.html"
    else
        echo "  x86_64: https://www.oracle.com/database/technologies/instant-client/macos-intel-x86-downloads.html"
    fi
    echo ""
    echo "Then edit this script and set DMG_FILE to the downloaded file path."
    exit 1
fi

echo -e "${GREEN}✓ DMG file found${NC}"

# Create installation directory
echo -e "${GREEN}Creating installation directory...${NC}"
mkdir -p "$INSTALL_DIR"

# Mount DMG
echo -e "${GREEN}Mounting DMG...${NC}"
MOUNT_POINT=$(hdiutil attach "$DMG_FILE" | grep Volumes | awk '{print $3}')

if [ -z "$MOUNT_POINT" ]; then
    echo -e "${RED}✗ Failed to mount DMG${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Mounted at: ${YELLOW}$MOUNT_POINT${NC}"

# Find instantclient directory
echo -e "${GREEN}Locating Instant Client files...${NC}"
IC_DIR=$(find "$MOUNT_POINT" -maxdepth 2 -type d -name "instantclient*" | head -1)

if [ -z "$IC_DIR" ]; then
    echo -e "${RED}✗ Could not find instantclient directory in DMG${NC}"
    hdiutil detach "$MOUNT_POINT"
    exit 1
fi

echo -e "${GREEN}✓ Found: ${YELLOW}$IC_DIR${NC}"

# Copy files
echo -e "${GREEN}Copying files to installation directory...${NC}"
cp -R "$IC_DIR"/* "$INSTALL_DIR/"

# Unmount DMG
echo -e "${GREEN}Unmounting DMG...${NC}"
hdiutil detach "$MOUNT_POINT"

# Set permissions
echo -e "${GREEN}Setting permissions...${NC}"
chmod -R 755 "$INSTALL_DIR"

# Create symlink
echo -e "${GREEN}Creating symlinks...${NC}"
cd "$INSTALL_DIR"
ACTUAL_LIB=$(find . -maxdepth 1 -name "libclntsh.dylib.*" | head -1)

if [ -n "$ACTUAL_LIB" ]; then
    ln -sf "$(basename "$ACTUAL_LIB")" libclntsh.dylib
    echo -e "${GREEN}✓ Created symlink: libclntsh.dylib -> $(basename "$ACTUAL_LIB")${NC}"
fi

# Verification
echo ""
echo -e "${GREEN}=== Verification ===${NC}"

if [ -f "$INSTALL_DIR/libclntsh.dylib" ]; then
    echo -e "${GREEN}✓ libclntsh.dylib found${NC}"

    # Check architecture
    INSTALLED_ARCH=$(file "$INSTALL_DIR/libclntsh.dylib" | grep -o "arm64\|x86_64")

    echo "  System architecture: $ARCH"
    echo "  Library architecture: $INSTALLED_ARCH"

    if [ "$ARCH" = "$INSTALLED_ARCH" ]; then
        echo -e "${GREEN}✓ Architecture matches!${NC}"
    else
        echo -e "${RED}✗ Architecture mismatch!${NC}"
        echo -e "${RED}  This installation will NOT work.${NC}"
        echo -e "${YELLOW}  Please download the correct version for your system.${NC}"
        exit 1
    fi

    # Test if library is valid
    if otool -L "$INSTALL_DIR/libclntsh.dylib" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Library is valid${NC}"
    else
        echo -e "${RED}✗ Library may be corrupted${NC}"
        exit 1
    fi
else
    echo -e "${RED}✗ libclntsh.dylib not found${NC}"
    echo -e "${RED}Installation failed${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}=== Installation Complete! ===${NC}"
echo -e "${GREEN}Oracle Instant Client installed at:${NC}"
echo -e "${YELLOW}$INSTALL_DIR${NC}"
echo ""
echo -e "${GREEN}Next steps:${NC}"
echo "1. Restart AD Tools if it's running"
echo "2. Open Compare Config tool"
echo "3. Oracle client should now be detected"
echo ""
echo "To verify with Rust tests:"
echo "  cd src-tauri"
echo "  cargo test --test oracle_client_tests test_1_1_check_actual_installation -- --nocapture --ignored"

exit 0
