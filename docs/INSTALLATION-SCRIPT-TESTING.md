# Installation Script Testing Guide (Test 1.2)

This guide explains how to test the Oracle Instant Client installation script locally.

## Prerequisites

1. Download Oracle Instant Client manually from Oracle's website:
   - **ARM64 (Apple Silicon)**: https://www.oracle.com/database/technologies/instant-client/macos-arm64-downloads.html
   - **x86_64 (Intel)**: https://www.oracle.com/database/technologies/instant-client/macos-intel-x86-downloads.html

2. Download the **Basic Package** DMG file for your architecture

## Test 1.2.1: Test with Valid ARM64 Installation (if you have Apple Silicon)

```bash
# 1. Check your architecture
uname -m
# Should output: arm64

# 2. Download ARM64 version from Oracle website
# Save it to: ~/Downloads/instantclient-basic-macos.arm64-23.4.0.24.05.dmg

# 3. Create a test version of the script that uses local file
cp install-oracle.sh test-install-oracle-arm64.sh

# 4. Edit test-install-oracle-arm64.sh to use local file instead of downloading
# Change the download section to use a local file:
# Replace the curl download with:
TEMP_DMG="$HOME/Downloads/instantclient-basic-macos.arm64-23.4.0.24.05.dmg"

# 5. Run the test script
bash test-install-oracle-arm64.sh

# 6. Expected result:
# ✓ Downloads and mounts DMG
# ✓ Extracts files to ~/Documents/adtools_library/oracle_instantclient/
# ✓ Creates symlinks
# ✓ Verifies architecture matches (arm64)
# ✓ Library is valid
# ✓ Installation complete message
```

## Test 1.2.2: Test with Valid x86_64 Installation (if you have Intel Mac)

```bash
# 1. Check your architecture
uname -m
# Should output: x86_64

# 2. Download x86_64 version from Oracle website
# Save it to: ~/Downloads/instantclient-basic-macos.x64-23.4.0.24.05.dmg

# 3. Create a test version of the script
cp install-oracle.sh test-install-oracle-x64.sh

# 4. Edit test-install-oracle-x64.sh to use local file
TEMP_DMG="$HOME/Downloads/instantclient-basic-macos.x64-23.4.0.24.05.dmg"

# 5. Run the test script
bash test-install-oracle-x64.sh

# Expected result: Same as ARM64 but with x86_64 architecture
```

## Test 1.2.3: Test with Wrong Architecture

```bash
# On ARM64 Mac, try to install x86_64 version (or vice versa)

# 1. If you're on ARM64, download the x86_64 DMG
# 2. Create test script
cp install-oracle.sh test-install-wrong-arch.sh

# 3. Edit to use the wrong architecture DMG
# On ARM64 Mac:
TEMP_DMG="$HOME/Downloads/instantclient-basic-macos.x64-23.4.0.24.05.dmg"

# 4. Run the script
bash test-install-wrong-arch.sh

# Expected result:
# ✗ Architecture mismatch error
# "System: arm64"
# "Installed: x86_64"
# "This may cause issues. Please reinstall with the correct architecture."
# Exit code: 1
```

## Test 1.2.4: Test with Missing File

```bash
# Test what happens when DMG file doesn't exist

# 1. Create a test that tries to use non-existent file
TEMP_DMG="/tmp/nonexistent-oracle-client.dmg"

# 2. The script will try to download, which will fail
# Or you can modify the script to skip download and go straight to mounting

# Expected result:
# Error message: "Failed to download Oracle Instant Client"
# Exit code: 1
```

## Test 1.2.5: Test with Existing Installation

```bash
# Test what happens when Oracle client is already installed

# 1. First install Oracle client successfully (Test 1.2.1 or 1.2.2)

# 2. Run the installation script again
bash install-oracle.sh

# Expected result:
# Should overwrite existing installation
# All files replaced
# Installation completes successfully
```

## Simplified Local Testing (Recommended)

Instead of modifying the script each time, create a local test script:

```bash
#!/bin/bash
# test-oracle-install-local.sh

set -e

# Configuration - CHANGE THESE
DMG_FILE="$HOME/Downloads/instantclient-basic-macos.arm64-23.4.0.24.05.dmg"
INSTALL_DIR="$HOME/Documents/adtools_library/oracle_instantclient"

echo "=== Oracle Installation Test ==="
echo "DMG File: $DMG_FILE"
echo "Install Dir: $INSTALL_DIR"
echo ""

# Check if DMG exists
if [ ! -f "$DMG_FILE" ]; then
    echo "Error: DMG file not found at: $DMG_FILE"
    echo "Please download it from Oracle website first"
    exit 1
fi

# Create installation directory
mkdir -p "$INSTALL_DIR"

# Mount DMG
echo "Mounting DMG..."
MOUNT_POINT=$(hdiutil attach "$DMG_FILE" | grep Volumes | awk '{print $3}')

if [ -z "$MOUNT_POINT" ]; then
    echo "Error: Failed to mount DMG"
    exit 1
fi

echo "Mounted at: $MOUNT_POINT"

# Find instantclient directory
IC_DIR=$(find "$MOUNT_POINT" -maxdepth 2 -type d -name "instantclient*" | head -1)

if [ -z "$IC_DIR" ]; then
    echo "Error: Could not find instantclient directory"
    hdiutil detach "$MOUNT_POINT"
    exit 1
fi

echo "Found: $IC_DIR"

# Copy files
echo "Copying files..."
cp -R "$IC_DIR"/* "$INSTALL_DIR/"

# Unmount
echo "Unmounting..."
hdiutil detach "$MOUNT_POINT"

# Set permissions
chmod -R 755 "$INSTALL_DIR"

# Create symlink
cd "$INSTALL_DIR"
ACTUAL_LIB=$(find . -maxdepth 1 -name "libclntsh.dylib.*" | head -1)

if [ -n "$ACTUAL_LIB" ]; then
    ln -sf "$(basename "$ACTUAL_LIB")" libclntsh.dylib
    echo "Created symlink: libclntsh.dylib -> $(basename "$ACTUAL_LIB")"
fi

# Verify
if [ -f "$INSTALL_DIR/libclntsh.dylib" ]; then
    echo "✓ Installation successful"
    echo "✓ Library: $INSTALL_DIR/libclntsh.dylib"

    # Check architecture
    ARCH=$(uname -m)
    INSTALLED_ARCH=$(file "$INSTALL_DIR/libclntsh.dylib" | grep -o "arm64\|x86_64")

    echo "System architecture: $ARCH"
    echo "Library architecture: $INSTALLED_ARCH"

    if [ "$ARCH" = "$INSTALLED_ARCH" ]; then
        echo "✓ Architecture matches!"
    else
        echo "✗ Architecture mismatch!"
        exit 1
    fi
else
    echo "✗ Installation failed"
    exit 1
fi

echo ""
echo "Installation complete!"
```

Save this as `test-oracle-install-local.sh` and run:

```bash
chmod +x test-oracle-install-local.sh

# Edit the DMG_FILE path to point to your downloaded DMG
nano test-oracle-install-local.sh

# Run the test
./test-oracle-install-local.sh
```

## Verification After Installation

After any installation test, verify with:

```bash
# Check file exists
ls -la ~/Documents/adtools_library/oracle_instantclient/libclntsh.dylib

# Check architecture
file ~/Documents/adtools_library/oracle_instantclient/libclntsh.dylib

# Check if library is valid
otool -L ~/Documents/adtools_library/oracle_instantclient/libclntsh.dylib

# Test with Rust code
cd src-tauri
cargo test --test oracle_client_tests test_1_1_check_actual_installation -- --nocapture
```

## Cleanup After Testing

To remove the installation and test again:

```bash
# Remove installation directory
rm -rf ~/Documents/adtools_library/oracle_instantclient

# Remove test scripts
rm -f test-install-*.sh
```

## Test Results Checklist

- [ ] ✓ Test 1.2.1: Valid ARM64 installation works
- [ ] ✓ Test 1.2.2: Valid x86_64 installation works
- [ ] ✓ Test 1.2.3: Wrong architecture shows error
- [ ] ✓ Test 1.2.4: Missing file shows error
- [ ] ✓ Test 1.2.5: Existing installation handled gracefully
