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

# Create necessary symlinks in installation directory
echo -e "${GREEN}Creating symlinks in installation directory...${NC}"
cd "$INSTALL_DIR"

# Find the actual libclntsh.dylib version (e.g., libclntsh.dylib.23.1)
ACTUAL_LIB=$(find . -maxdepth 1 -name "libclntsh.dylib.*" | head -1)

if [ -n "$ACTUAL_LIB" ]; then
    # Create symlink without version number
    ln -sf "$(basename "$ACTUAL_LIB")" libclntsh.dylib
    echo -e "${GREEN}Created symlink: libclntsh.dylib -> $(basename "$ACTUAL_LIB")${NC}"
fi

# Create ~/lib directory and symlink Oracle libraries there
# This allows the Tauri app to find Oracle libraries via rpath without sudo
echo ""
echo -e "${GREEN}Setting up ~/lib for Oracle libraries...${NC}"
LIB_DIR="$HOME/lib"
mkdir -p "$LIB_DIR"

# Symlink key Oracle libraries to ~/lib
echo -e "${GREEN}Creating symlinks in ~/lib...${NC}"
ln -sf "$INSTALL_DIR/libclntsh.dylib" "$LIB_DIR/"
ln -sf "$INSTALL_DIR/libclntsh.dylib.23.1" "$LIB_DIR/" 2>/dev/null || true
ln -sf "$INSTALL_DIR/libclntshcore.dylib" "$LIB_DIR/"
ln -sf "$INSTALL_DIR/libclntshcore.dylib.23.1" "$LIB_DIR/" 2>/dev/null || true
ln -sf "$INSTALL_DIR/libnnz.dylib" "$LIB_DIR/" 2>/dev/null || true
ln -sf "$INSTALL_DIR/libnnz23.dylib" "$LIB_DIR/" 2>/dev/null || true

# Symlink all other .dylib files found
for dylib in "$INSTALL_DIR"/*.dylib*; do
    if [ -f "$dylib" ]; then
        filename=$(basename "$dylib")
        ln -sf "$dylib" "$LIB_DIR/$filename" 2>/dev/null || true
    fi
done

echo -e "${GREEN}✓ Symlinks created in ~/lib${NC}"

# Verify installation
echo ""
echo -e "${GREEN}=== Verification ===${NC}"

if [ -f "$INSTALL_DIR/libclntsh.dylib" ]; then
    echo -e "${GREEN}✓ libclntsh.dylib found in installation directory${NC}"

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

# Verify ~/lib symlinks
if [ -L "$LIB_DIR/libclntsh.dylib" ]; then
    echo -e "${GREEN}✓ ~/lib symlinks created successfully${NC}"
    SYMLINK_COUNT=$(find "$LIB_DIR" -name "*.dylib*" -type l | wc -l)
    echo -e "${GREEN}✓ $SYMLINK_COUNT Oracle library symlinks in ~/lib${NC}"
else
    echo -e "${YELLOW}⚠ Warning: ~/lib symlinks may not have been created${NC}"
    echo -e "${YELLOW}  You may need to create them manually${NC}"
fi

echo ""
echo -e "${GREEN}=== Installation Complete! ===${NC}"
echo -e "${GREEN}Oracle Instant Client installed at:${NC}"
echo -e "${YELLOW}$INSTALL_DIR${NC}"
echo ""
echo -e "${GREEN}Libraries also symlinked to:${NC}"
echo -e "${YELLOW}$LIB_DIR${NC}"
echo -e "${GREEN}This allows AD Tools to find Oracle libraries without sudo.${NC}"
echo ""
echo -e "${GREEN}You can now use the Compare Config feature in AD Tools.${NC}"
echo -e "${GREEN}Please restart AD Tools if it's currently running.${NC}"
echo ""
echo -e "${YELLOW}Note: If you encounter library loading issues, ensure:${NC}"
echo -e "${YELLOW}  1. AD Tools was rebuilt after running this script${NC}"
echo -e "${YELLOW}  2. The ~/lib directory exists and contains Oracle library symlinks${NC}"
echo -e "${YELLOW}  3. You've restarted AD Tools to pick up the new libraries${NC}"

exit 0
