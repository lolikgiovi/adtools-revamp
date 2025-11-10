# Troubleshooting: DPI-1047 "Cannot locate Oracle Client library"

## The Error

```
Connection failed: DPI Error: DPI-1047: Cannot locate a 64-bit Oracle Client library:
"dlopen(libclntsh.dylib, 0x0001): tried: 'libclntsh.dylib' (no such file),
'/Users/laptopmco/Documents/adtools_library/oracle_instantclient/libclntsh.dylib' (no such file),
...
```

## What This Means

The Oracle crate (through ODPI-C) is trying to load `libclntsh.dylib` but can't find it, even though:
- The file may exist on disk
- `check_oracle_client_ready()` returns `true`
- The installation script completed successfully

## Why This Happens

### Root Cause

There's a **gap between file existence and dynamic library loading**:

1. ✅ **File Check** (`check_client_ready()`) - Uses `PathBuf::exists()` to check if the file is there
2. ❌ **Library Loading** (Oracle crate) - Uses `dlopen()` to actually load the library at runtime

**macOS `dlopen()` has different search rules** than simple file existence checks.

### Common Scenarios

#### Scenario 1: Installation Not Completed
The installation script started but didn't finish, leaving partial files.

**Symptoms:**
- Symlink exists: `libclntsh.dylib -> libclntsh.dylib.23.1`
- Target missing: `libclntsh.dylib.23.1` doesn't exist

**Fix:**
```bash
# Reinstall
curl -fsSL https://adtools.lolik.workers.dev/install-oracle.sh | bash
```

#### Scenario 2: Broken Symlink
The symlink was created but points to the wrong file or the target was deleted.

**Check:**
```bash
ls -la ~/Documents/adtools_library/oracle_instantclient/libclntsh.dylib
# Should show: libclntsh.dylib -> libclntsh.dylib.XX.X

# Check target exists
ls -la ~/Documents/adtools_library/oracle_instantclient/libclntsh.dylib.*
```

**Fix:**
```bash
cd ~/Documents/adtools_library/oracle_instantclient
# Find the actual library
ls -la libclntsh.dylib.*.* | grep -v "^l"

# Recreate symlink (replace 23.1 with your version)
rm -f libclntsh.dylib
ln -s libclntsh.dylib.23.1 libclntsh.dylib
```

#### Scenario 3: Library Not in Search Path
The library exists but `dlopen()` can't find it because it's not in any of the standard search paths or rpath.

**What dlopen searches (in order):**
1. Paths in `DYLD_LIBRARY_PATH` (blocked by SIP on macOS)
2. Paths in the binary's rpath (configured in build.rs)
3. `/usr/local/lib`
4. `/usr/lib`
5. Current directory

**Our rpath configuration:**
- `~/lib` (primary)
- `~/Documents/adtools_library/oracle_instantclient` (fallback)

**Check rpath:**
```bash
otool -l "AD Tools.app/Contents/MacOS/ad-tools" | grep -A 3 RPATH
```

**Fix:**
The installation script should create symlinks in `~/lib`:
```bash
mkdir -p ~/lib
cd ~/Documents/adtools_library/oracle_instantclient
for dylib in *.dylib*; do
    ln -sf "$(pwd)/$dylib" ~/lib/
done
```

#### Scenario 4: Architecture Mismatch
The installed Oracle library is for a different architecture (ARM64 vs x86_64).

**Check:**
```bash
file ~/Documents/adtools_library/oracle_instantclient/libclntsh.dylib
# Should show your architecture:
#   arm64 for Apple Silicon (M1/M2/M3)
#   x86_64 for Intel

# Check your system
uname -m
```

**Fix:**
```bash
# Remove old installation
rm -rf ~/Documents/adtools_library/oracle_instantclient

# Reinstall (will auto-detect architecture)
curl -fsSL https://adtools.lolik.workers.dev/install-oracle.sh | bash
```

#### Scenario 5: Permissions Issue
The library files exist but can't be read due to permissions.

**Check:**
```bash
ls -la ~/Documents/adtools_library/oracle_instantclient/libclntsh.dylib
# Should show: -rwxr-xr-x (executable permissions)
```

**Fix:**
```bash
chmod -R 755 ~/Documents/adtools_library/oracle_instantclient
```

## Enhanced Diagnostics (After Fix)

With the latest code changes, you'll now get better error messages:

### Before Connection Attempt

The app now checks:
1. ✅ File exists
2. ✅ Symlink target exists
3. ✅ Library can be loaded (prime_client)
4. ✅ Then attempts connection

### New Error Messages

**Broken Symlink:**
```
Oracle Instant Client installation is broken.

The symlink exists but points to a missing file:
- Symlink: /Users/laptopmco/Documents/adtools_library/oracle_instantclient/libclntsh.dylib
- Target: /Users/laptopmco/Documents/adtools_library/oracle_instantclient/libclntsh.dylib.23.1 (NOT FOUND)

Solution: Reinstall Oracle Instant Client by running:
curl -fsSL https://adtools.lolik.workers.dev/install-oracle.sh | bash
```

**Architecture Mismatch:**
```
⚠️  ARCHITECTURE MISMATCH DETECTED

The installed Oracle library doesn't match your system architecture.

Your System: ARM64 (Apple Silicon)

Solution:
1. Remove the current installation
2. Reinstall with the correct architecture:
curl -fsSL https://adtools.lolik.workers.dev/install-oracle.sh | bash
```

## Step-by-Step Debugging

### 1. Verify Installation Exists
```bash
ls -la ~/Documents/adtools_library/oracle_instantclient/
```

**Expected:** Directory exists with multiple `.dylib` files

### 2. Check Main Symlink
```bash
ls -la ~/Documents/adtools_library/oracle_instantclient/libclntsh.dylib
```

**Expected:**
```
lrwxr-xr-x ... libclntsh.dylib -> libclntsh.dylib.23.1
```

### 3. Verify Target Exists
```bash
ls -la ~/Documents/adtools_library/oracle_instantclient/libclntsh.dylib.23.1
```

**Expected:**
```
-rwxr-xr-x ... libclntsh.dylib.23.1
```

**Size should be ~50MB**

### 4. Check Architecture
```bash
file ~/Documents/adtools_library/oracle_instantclient/libclntsh.dylib
```

**Expected (Apple Silicon):**
```
... Mach-O 64-bit dynamically linked shared library arm64
```

**Expected (Intel):**
```
... Mach-O 64-bit dynamically linked shared library x86_64
```

### 5. Verify ~/lib Symlinks
```bash
ls -la ~/lib/libclntsh.dylib*
```

**Expected:** Multiple symlinks pointing to the Oracle installation

### 6. Test Library Loading
```bash
otool -L ~/Documents/adtools_library/oracle_instantclient/libclntsh.dylib | head -5
```

**Expected:** List of library dependencies (should not error)

### 7. Check App Logs
Open the app with Console.app to see detailed logs:

```bash
# Terminal 1: Start logging
log stream --predicate 'process == "AD Tools"' --level debug

# Terminal 2: Open the app
open "AD Tools.app"
```

Look for:
- `Oracle client library found (symlink): ... -> ...`
- `Oracle client library size: ... bytes`
- `Set DYLD_LIBRARY_PATH...`
- `Successfully primed Oracle client`

## Quick Fix (Most Common)

For **most cases**, this works:

```bash
# Complete reinstall
rm -rf ~/Documents/adtools_library/oracle_instantclient
curl -fsSL https://adtools.lolik.workers.dev/install-oracle.sh | bash

# Restart the app
# killall "AD Tools" 2>/dev/null
open "AD Tools.app"
```

## Still Not Working?

### Collect Diagnostic Information

```bash
echo "=== System Info ==="
uname -a
echo ""

echo "=== Oracle Installation ==="
ls -la ~/Documents/adtools_library/oracle_instantclient/ 2>&1
echo ""

echo "=== Main Library ==="
ls -la ~/Documents/adtools_library/oracle_instantclient/libclntsh.dylib 2>&1
file ~/Documents/adtools_library/oracle_instantclient/libclntsh.dylib 2>&1
echo ""

echo "=== ~/lib Symlinks ==="
ls -la ~/lib/libclntsh* 2>&1
echo ""

echo "=== App Rpath ==="
otool -l "AD Tools.app/Contents/MacOS/AD Tools" | grep -A 3 RPATH 2>&1
```

Save this output and share it for further troubleshooting.

## Related Files

- [ORACLE-DETECTION-FIX.md](./ORACLE-DETECTION-FIX.md) - Why detection was improved
- [ENHANCED-ERROR-MESSAGES.md](./ENHANCED-ERROR-MESSAGES.md) - Better error messages
- [install-oracle.sh](../../install-oracle.sh) - Installation script

## Technical Details

### Why Check Passes But Load Fails

**check_client_ready():**
```rust
if !lib_path.exists() { return false; }  // Simple existence check
```

**Oracle crate (dlopen):**
```c
void* handle = dlopen("libclntsh.dylib", RTLD_NOW);  // Full dynamic linking
```

The difference:
- `exists()` - Just checks if file/symlink is in filesystem
- `dlopen()` - Attempts to load library, resolve dependencies, check architecture, etc.

### macOS SIP (System Integrity Protection)

SIP prevents `DYLD_LIBRARY_PATH` from affecting signed binaries:

```rust
// ❌ This is ignored by macOS for signed apps
std::env::set_var("DYLD_LIBRARY_PATH", "...");
```

**Solution:** Use **rpath** (configured at build time):
```rust
// build.rs
println!("cargo:rustc-link-arg=-Wl,-rpath,{}", home.join("lib").display());
```

This embeds the search path into the binary itself, which SIP allows.

## Prevention

To avoid this issue in the future:

1. **Always use the installation script** - Don't try to manually install
2. **Complete the installation** - Don't interrupt the script
3. **Check the completion message** - Script should say "Installation Complete!"
4. **Restart the app** - After installation, fully quit and reopen the app
5. **Check logs** - If unsure, check Console.app for "Successfully primed Oracle client"

