#!/bin/bash
set -e

# Oracle Instant Client Installation Script for AD Tools
# This script downloads and installs Oracle Instant Client for macOS
# Supports both Apple Silicon (ARM64) and Intel (x86_64) architectures

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Installation directory
INSTALL_DIR="$HOME/Documents/adtools_library/oracle_instantclient"

# Oracle download URLs (update these with actual Oracle download links)
# Note: Oracle requires acceptance of license terms
ARM64_URL="https://download.oracle.com/otn_software/mac/instantclient/233023/instantclient-basic-macos.arm64-23.3.0.23.09-2.dmg"
X86_64_URL="https://download.oracle.com/otn_software/mac/instantclient/198000/instantclient-basiclite-macos.x64-19.8.0.0.0dbru.dmg"

# Detect architecture
ARCH=$(uname -m)

echo -e "${GREEN}=== Oracle Instant Client Installation Script ===${NC}"
echo -e "${GREEN}Architecture detected: ${YELLOW}$ARCH${NC}"
echo ""

# Determine download URL based on architecture
if [ "$ARCH" = "arm64" ]; then
    DOWNLOAD_URL="$ARM64_URL"
    echo -e "${GREEN}Using ARM64 (Apple Silicon) version${NC}"
elif [ "$ARCH" = "x86_64" ]; then
    DOWNLOAD_URL="$X86_64_URL"
    echo -e "${GREEN}Using x86_64 (Intel) version${NC}"
else
    echo -e "${RED}Error: Unsupported architecture: $ARCH${NC}"
    echo -e "${RED}This script supports only arm64 and x86_64${NC}"
    exit 1
fi

# Create installation directory
echo -e "${GREEN}Creating installation directory: ${YELLOW}$INSTALL_DIR${NC}"
mkdir -p "$INSTALL_DIR"

# Download Oracle Instant Client
echo -e "${GREEN}Downloading Oracle Instant Client...${NC}"
echo -e "${YELLOW}Note: This requires accepting Oracle's license terms${NC}"
echo ""

TEMP_DMG="/$HOME/Documents/oracle-instantclient.dmg"
TEMP_DIR="/$HOME/Documents/oracle-instantclient-extract"

# Download the DMG file with progress bar
echo -e "${GREEN}Progress:${NC}"
if ! curl -# -L -o "$TEMP_DMG" "$DOWNLOAD_URL"; then
    echo -e "${RED}Error: Failed to download Oracle Instant Client${NC}"
    echo -e "${RED}Please download manually from:${NC}"
    echo -e "${YELLOW}https://www.oracle.com/database/technologies/instant-client/downloads.html${NC}"
    exit 1
fi

echo -e "${GREEN}Download complete!${NC}"
echo ""

# Mount the DMG
echo -e "${GREEN}Mounting DMG...${NC}"
MOUNT_POINT=$(hdiutil attach "$TEMP_DMG" | grep Volumes | awk '{print $3}')

if [ -z "$MOUNT_POINT" ]; then
    echo -e "${RED}Error: Failed to mount DMG${NC}"
    exit 1
fi

# Extract files
echo -e "${GREEN}Extracting files...${NC}"
mkdir -p "$TEMP_DIR"

# Find the instantclient directory in the mounted volume
IC_DIR=$(find "$MOUNT_POINT" -maxdepth 2 -type d -name "instantclient*" | head -1)

if [ -z "$IC_DIR" ]; then
    echo -e "${RED}Error: Could not find instantclient directory in DMG${NC}"
    hdiutil detach "$MOUNT_POINT"
    exit 1
fi

# Copy files to installation directory
cp -R "$IC_DIR"/* "$INSTALL_DIR/"

# Unmount DMG
echo -e "${GREEN}Unmounting DMG...${NC}"
hdiutil detach "$MOUNT_POINT"

# Clean up temporary files
rm -f "$TEMP_DMG"
rm -rf "$TEMP_DIR"

# Set permissions
echo -e "${GREEN}Setting permissions...${NC}"
chmod -R 755 "$INSTALL_DIR"

# Create necessary symlinks
echo -e "${GREEN}Creating symlinks...${NC}"
cd "$INSTALL_DIR"

# Find the actual libclntsh.dylib version (e.g., libclntsh.dylib.23.1)
ACTUAL_LIB=$(find . -maxdepth 1 -name "libclntsh.dylib.*" | head -1)

if [ -n "$ACTUAL_LIB" ]; then
    # Create symlink without version number
    ln -sf "$(basename "$ACTUAL_LIB")" libclntsh.dylib
    echo -e "${GREEN}Created symlink: libclntsh.dylib -> $(basename "$ACTUAL_LIB")${NC}"
fi

# Verify installation
echo ""
echo -e "${GREEN}=== Verification ===${NC}"

if [ -f "$INSTALL_DIR/libclntsh.dylib" ]; then
    echo -e "${GREEN}✓ libclntsh.dylib found${NC}"

    # Check architecture matches
    INSTALLED_ARCH=$(file "$INSTALL_DIR/libclntsh.dylib" | grep -o "arm64\|x86_64")

    if [ "$INSTALLED_ARCH" = "$ARCH" ]; then
        echo -e "${GREEN}✓ Architecture matches: $INSTALLED_ARCH${NC}"
    else
        echo -e "${RED}✗ Architecture mismatch!${NC}"
        echo -e "${RED}  System: $ARCH${NC}"
        echo -e "${RED}  Installed: $INSTALLED_ARCH${NC}"
        echo -e "${YELLOW}  This may cause issues. Please reinstall with the correct architecture.${NC}"
        exit 1
    fi

    # Test if library can be loaded
    if otool -L "$INSTALL_DIR/libclntsh.dylib" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Library is valid${NC}"
    else
        echo -e "${RED}✗ Library may be corrupted${NC}"
        exit 1
    fi
else
    echo -e "${RED}✗ libclntsh.dylib not found${NC}"
    echo -e "${RED}Installation may have failed${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}=== Installation Complete! ===${NC}"
echo -e "${GREEN}Oracle Instant Client installed at:${NC}"
echo -e "${YELLOW}$INSTALL_DIR${NC}"
echo ""
echo -e "${GREEN}You can now use the Compare Config feature in AD Tools.${NC}"
echo -e "${GREEN}Please restart AD Tools if it's currently running.${NC}"

exit 0
