#!/bin/bash
set -e

# Oracle Instant Client Installation Script for AD Tools
# This script downloads and installs Oracle Instant Client for macOS
# Supports both Apple Silicon (ARM64) and Intel (x86_64) architectures

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Installation directory (user-space, no sudo)
# New default: ~/Library/Application Support/AD Tools/instantclient
INSTALL_DIR="$HOME/Library/Application Support/AD Tools/instantclient"

# Oracle download URLs
# Note: Oracle requires acceptance of license terms
ARM64_URL="https://download.oracle.com/otn_software/mac/instantclient/233023/instantclient-basic-macos.arm64-23.3.0.23.09-2.dmg"
X86_64_URL="https://download.oracle.com/otn_software/mac/instantclient/198000/instantclient-basiclite-macos.x64-19.8.0.0.0dbru.dmg"

# Detect architecture
ARCH=$(uname -m)

echo -e "${GREEN}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Oracle Instant Client Installation Script            ║${NC}"
echo -e "${GREEN}║  for AD Tools Compare Config Feature                   ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}System Architecture: ${YELLOW}$ARCH${NC}"
echo ""

# Determine download URL based on architecture
if [ "$ARCH" = "arm64" ]; then
    DOWNLOAD_URL="$ARM64_URL"
    echo -e "${GREEN}✓ Using ARM64 (Apple Silicon) version${NC}"
elif [ "$ARCH" = "x86_64" ]; then
    DOWNLOAD_URL="$X86_64_URL"
    echo -e "${GREEN}✓ Using x86_64 (Intel) version${NC}"
else
    echo -e "${RED}✗ Error: Unsupported architecture: $ARCH${NC}"
    echo -e "${RED}  This script supports only arm64 and x86_64${NC}"
    exit 1
fi

# Check if already installed
if [ -f "$INSTALL_DIR/libclntsh.dylib" ]; then
    echo -e "${YELLOW}⚠ Oracle Instant Client appears to be already installed.${NC}"
    echo -e "${YELLOW}  Location: $INSTALL_DIR${NC}"
    echo ""
    read -p "Do you want to reinstall? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${GREEN}Installation cancelled.${NC}"
        exit 0
    fi
    echo -e "${BLUE}Removing existing installation...${NC}"
    rm -rf "$INSTALL_DIR"
fi

# Create installation directory
echo -e "${BLUE}[1/7] Creating installation directory...${NC}"
mkdir -p "$INSTALL_DIR"
echo -e "${GREEN}✓ Created: ${YELLOW}$INSTALL_DIR${NC}"
echo ""

# Temporary files
TEMP_DMG="$HOME/Documents/oracle-instantclient-temp.dmg"
TEMP_DIR="$HOME/Documents/oracle-instantclient-extract"

# Clean up any previous temp files
rm -f "$TEMP_DMG"
rm -rf "$TEMP_DIR"

# Download Oracle Instant Client
echo -e "${BLUE}[2/7] Downloading Oracle Instant Client...${NC}"
echo -e "${YELLOW}Note: This requires accepting Oracle's license terms${NC}"
echo -e "${YELLOW}Download URL: $DOWNLOAD_URL${NC}"
echo ""

if ! curl -# -L -o "$TEMP_DMG" "$DOWNLOAD_URL"; then
    echo ""
    echo -e "${RED}✗ Error: Failed to download Oracle Instant Client${NC}"
    echo -e "${RED}  This may be due to network issues or Oracle download restrictions.${NC}"
    echo ""
    echo -e "${YELLOW}Please download manually from:${NC}"
    echo -e "${BLUE}https://www.oracle.com/database/technologies/instant-client/downloads.html${NC}"
    echo ""
    echo -e "${YELLOW}After downloading, extract to: $INSTALL_DIR${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Download complete!${NC}"
echo ""

# Verify DMG file
echo -e "${BLUE}[3/7] Verifying DMG file...${NC}"
if [ ! -f "$TEMP_DMG" ] || [ ! -s "$TEMP_DMG" ]; then
    echo -e "${RED}✗ Error: DMG file is missing or empty${NC}"
    exit 1
fi
echo -e "${GREEN}✓ DMG file verified ($(du -h "$TEMP_DMG" | cut -f1))${NC}"
echo ""

# Mount the DMG
echo -e "${BLUE}[4/7] Mounting DMG...${NC}"
MOUNT_OUTPUT=$(hdiutil attach "$TEMP_DMG" -nobrowse -quiet 2>&1)
MOUNT_POINT=$(echo "$MOUNT_OUTPUT" | grep Volumes | awk '{print $3}')

if [ -z "$MOUNT_POINT" ]; then
    echo -e "${RED}✗ Error: Failed to mount DMG${NC}"
    echo -e "${RED}  Output: $MOUNT_OUTPUT${NC}"
    rm -f "$TEMP_DMG"
    exit 1
fi

echo -e "${GREEN}✓ Mounted at: ${YELLOW}$MOUNT_POINT${NC}"
echo ""

# Extract files
echo -e "${BLUE}[5/7] Extracting files...${NC}"

# Find the instantclient directory in the mounted volume
IC_DIR=$(find "$MOUNT_POINT" -maxdepth 2 -type d -name "instantclient*" | head -1)

if [ -z "$IC_DIR" ]; then
    echo -e "${RED}✗ Error: Could not find instantclient directory in DMG${NC}"
    hdiutil detach "$MOUNT_POINT" -quiet
    rm -f "$TEMP_DMG"
    exit 1
fi

echo -e "${GREEN}✓ Found: ${YELLOW}$(basename "$IC_DIR")${NC}"

# Copy files to installation directory
echo -e "${BLUE}  Copying files...${NC}"
cp -R "$IC_DIR"/* "$INSTALL_DIR/" 2>/dev/null || {
    echo -e "${RED}✗ Error: Failed to copy files${NC}"
    hdiutil detach "$MOUNT_POINT" -quiet
    rm -f "$TEMP_DMG"
    exit 1
}

# Count files copied
FILE_COUNT=$(find "$INSTALL_DIR" -type f | wc -l | tr -d ' ')
echo -e "${GREEN}✓ Copied $FILE_COUNT files to installation directory${NC}"
echo ""

# Unmount DMG
echo -e "${BLUE}Unmounting DMG...${NC}"
hdiutil detach "$MOUNT_POINT" -quiet || hdiutil unmount "$MOUNT_POINT" -quiet 2>/dev/null

# Clean up temporary files
rm -f "$TEMP_DMG"
rm -rf "$TEMP_DIR"
echo -e "${GREEN}✓ Cleanup complete${NC}"
echo ""

# Set permissions
echo -e "${BLUE}[6/7] Setting permissions...${NC}"
chmod -R 755 "$INSTALL_DIR"
echo -e "${GREEN}✓ Permissions set (755)${NC}"
echo ""

# Create necessary symlinks
echo -e "${BLUE}[7/7] Creating symlinks...${NC}"
cd "$INSTALL_DIR"

# Find versioned libclntsh library files
FOUND_LIBS=$(find . -maxdepth 1 -name "libclntsh.dylib.*" -type f 2>/dev/null | sort -V)

if [ -z "$FOUND_LIBS" ]; then
    echo -e "${RED}✗ Error: No libclntsh.dylib.* files found${NC}"
    echo -e "${YELLOW}  Files in directory:${NC}"
    ls -la "$INSTALL_DIR"
    exit 1
fi

# Display found libraries
echo -e "${GREEN}  Found Oracle libraries:${NC}"
echo "$FOUND_LIBS" | while read lib; do
    if [ -n "$lib" ]; then
        echo -e "${YELLOW}    - $(basename "$lib")${NC}"
    fi
done

# Create symlink for the primary library (use the highest version)
ACTUAL_LIB=$(echo "$FOUND_LIBS" | tail -1)

if [ -n "$ACTUAL_LIB" ]; then
    ACTUAL_LIB_NAME=$(basename "$ACTUAL_LIB")

    # Remove old symlink if exists
    rm -f libclntsh.dylib

    # Create new symlink
    ln -sf "$ACTUAL_LIB_NAME" libclntsh.dylib

    if [ -L libclntsh.dylib ]; then
        echo -e "${GREEN}✓ Created symlink: libclntsh.dylib -> $ACTUAL_LIB_NAME${NC}"
    else
        echo -e "${RED}✗ Failed to create symlink${NC}"
        exit 1
    fi
else
    echo -e "${RED}✗ Error: Could not determine library version${NC}"
    exit 1
fi

# Create ~/lib directory and symlink Oracle libraries there (optional fallback)
echo ""
echo -e "${BLUE}Setting up ~/lib for additional compatibility...${NC}"
LIB_DIR="$HOME/lib"
mkdir -p "$LIB_DIR"

# Symlink all .dylib files to ~/lib
SYMLINK_COUNT=0
for dylib in "$INSTALL_DIR"/*.dylib*; do
    if [ -f "$dylib" ]; then
        filename=$(basename "$dylib")
        ln -sf "$dylib" "$LIB_DIR/$filename" 2>/dev/null && ((SYMLINK_COUNT++))
    fi
done

if [ $SYMLINK_COUNT -gt 0 ]; then
    echo -e "${GREEN}✓ Created $SYMLINK_COUNT symlinks in ~/lib${NC}"
else
    echo -e "${YELLOW}⚠ Warning: No symlinks created in ~/lib${NC}"
fi

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║            Installation Verification                   ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════╝${NC}"
echo ""

# Verify installation
VERIFICATION_PASSED=true

# Check 1: Main library exists
if [ -f "$INSTALL_DIR/libclntsh.dylib" ]; then
    echo -e "${GREEN}✓ libclntsh.dylib found${NC}"
else
    echo -e "${RED}✗ libclntsh.dylib NOT found${NC}"
    VERIFICATION_PASSED=false
fi

# Check 2: Symlink is valid
if [ -L "$INSTALL_DIR/libclntsh.dylib" ]; then
    SYMLINK_TARGET=$(readlink "$INSTALL_DIR/libclntsh.dylib")
    echo -e "${GREEN}✓ Symlink is valid (-> $SYMLINK_TARGET)${NC}"
else
    echo -e "${RED}✗ Symlink is invalid or missing${NC}"
    VERIFICATION_PASSED=false
fi

# Check 3: Architecture matches
if [ -f "$INSTALL_DIR/libclntsh.dylib" ]; then
    INSTALLED_ARCH=$(file "$INSTALL_DIR/libclntsh.dylib" | grep -o "arm64\|x86_64")

    if [ "$INSTALLED_ARCH" = "$ARCH" ]; then
        echo -e "${GREEN}✓ Architecture matches: $INSTALLED_ARCH${NC}"
    else
        echo -e "${RED}✗ Architecture mismatch!${NC}"
        echo -e "${RED}  System: $ARCH${NC}"
        echo -e "${RED}  Installed: $INSTALLED_ARCH${NC}"
        VERIFICATION_PASSED=false
    fi
fi

# Check 4: Library can be inspected
if [ -f "$INSTALL_DIR/libclntsh.dylib" ]; then
    if otool -L "$INSTALL_DIR/libclntsh.dylib" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Library is valid and loadable${NC}"
    else
        echo -e "${RED}✗ Library may be corrupted${NC}"
        VERIFICATION_PASSED=false
    fi
fi

# Check 5: Installation directory size
INSTALL_SIZE=$(du -sh "$INSTALL_DIR" | cut -f1)
echo -e "${GREEN}✓ Installation size: $INSTALL_SIZE${NC}"

echo ""

if [ "$VERIFICATION_PASSED" = true ]; then
    echo -e "${GREEN}╔════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║          ✓ Installation Successful!                    ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════╝${NC}"
    echo ""
echo -e "${GREEN}Oracle Instant Client installed at:${NC}"
echo -e "${YELLOW}  $INSTALL_DIR${NC}"
    echo ""
    echo -e "${GREEN}Next steps:${NC}"
    echo -e "${BLUE}  1. Restart AD Tools if it's currently running${NC}"
    echo -e "${BLUE}  2. Open Compare Config feature${NC}"
    echo -e "${BLUE}  3. The Oracle client should now be detected automatically${NC}"
    echo ""
    echo -e "${GREEN}You're all set to compare Oracle configurations!${NC}"
else
    echo -e "${RED}╔════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║          ✗ Installation Failed                         ║${NC}"
    echo -e "${RED}╚════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${YELLOW}Some verification checks failed. Please:${NC}"
    echo -e "${YELLOW}  1. Review the errors above${NC}"
    echo -e "${YELLOW}  2. Try running the script again${NC}"
    echo -e "${YELLOW}  3. Or install manually from Oracle's website${NC}"
    exit 1
fi

exit 0
