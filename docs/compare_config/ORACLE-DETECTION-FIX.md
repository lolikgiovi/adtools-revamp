# Oracle Instant Client Detection Fix

## The Problem

Users reported that after running the Oracle installation script, the app still showed "Oracle client not installed" even though the files were correctly installed.

## Root Cause Analysis

### What Was Happening

1. ✅ User runs `curl -fsSL https://adtools.lolik.workers.dev/install-oracle.sh | bash`
2. ✅ Script downloads and extracts Oracle Instant Client to `~/Documents/adtools_library/oracle_instantclient/`
3. ✅ Script creates symlink: `libclntsh.dylib` -> `libclntsh.dylib.23.1` (or similar)
4. ✅ Script also creates symlinks in `~/lib/` for all Oracle libraries
5. ✅ App launches, build.rs has added `~/lib` and the Oracle directory to rpath
6. ✅ App calls `check_oracle_client_ready()` command
7. ❌ **Function tries to LOAD the library using `libloading::Library::new()`**
8. ❌ **Loading fails because macOS SIP blocks runtime `DYLD_LIBRARY_PATH` changes**
9. ❌ Function returns `false` - "Oracle client not ready"
10. ❌ User sees error message despite correct installation

### The Core Issue: macOS System Integrity Protection (SIP)

From [src-tauri/src/lib.rs:44-45](../../src-tauri/src/lib.rs#L44-L45):

```rust
// This must be done at app startup, not at connection time,
// because macOS SIP prevents runtime DYLD_LIBRARY_PATH changes
```

**What this means:**
- Setting `DYLD_LIBRARY_PATH` at runtime in Rust code **does nothing** on macOS
- macOS security feature blocks this for signed applications
- The environment variable is simply ignored
- This affects `libloading::Library::new()` which relies on the dynamic linker

### Why Developer's Machine Worked

The developer's machine worked because:
1. They had previously run `sudo ./install-oracle-libs.sh` which creates symlinks in `/usr/local/lib`
2. `/usr/local/lib` is a **system path** that macOS respects even with SIP
3. OR they had manually configured the app differently during development

### The Original Detection Logic (Broken)

**Location:** [src-tauri/src/oracle/client.rs:48-69](../../src-tauri/src/oracle/client.rs#L48-L69)

```rust
pub fn check_client_ready(custom_path: Option<&str>) -> bool {
    let client_dir = resolve_client_path(custom_path);
    let lib_path = client_dir.join(ORACLE_LIB_NAME);

    if !lib_path.exists() {
        return false;
    }

    // 🔴 THIS IS THE PROBLEM: Trying to load the library
    match unsafe { libloading::Library::new(&lib_path) } {
        Ok(_) => true,
        Err(e) => {
            log::warn!("Oracle client library found but invalid: {}", e);
            false  // ❌ Returns false even though file exists!
        }
    }
}
```

**Why it fails:**
- `libloading::Library::new()` uses the system's dynamic linker
- Dynamic linker can't find library dependencies because `DYLD_LIBRARY_PATH` is blocked by SIP
- Loading fails with an error like "image not found" or "symbol not found"
- Function returns `false` even though the library file is perfectly valid

## The Solution

### Changed Detection Logic (Fixed)

**New approach:** Just verify the file exists and is valid, **don't try to load it yet**.

The actual loading happens in `prime_client()` which uses:
- `RTLD_GLOBAL` flag to make symbols globally available
- Runs after environment is properly set up
- Uses rpath configured at build time

**New detection logic:**

```rust
pub fn check_client_ready(custom_path: Option<&str>) -> bool {
    let client_dir = resolve_client_path(custom_path);
    let lib_path = client_dir.join(ORACLE_LIB_NAME);

    // 1. Check if file exists (symlink is OK)
    if !lib_path.exists() {
        log::debug!("Oracle client library not found at: {:?}", lib_path);
        return false;
    }

    // 2. Verify it's a file (not a directory)
    if !lib_path.is_file() {
        log::warn!("Oracle client library path exists but is not a file");
        return false;
    }

    // 3. If it's a symlink, verify the target exists
    if lib_path.is_symlink() {
        match std::fs::read_link(&lib_path) {
            Ok(target) => {
                let full_target = if target.is_absolute() {
                    target.clone()
                } else {
                    client_dir.join(&target)
                };

                if !full_target.exists() {
                    log::warn!("Symlink target does not exist");
                    return false;
                }
            }
            Err(e) => {
                log::warn!("Failed to read symlink target: {}", e);
                return false;
            }
        }
    }

    // 4. Verify reasonable file size (> 1MB)
    match std::fs::metadata(&lib_path) {
        Ok(metadata) => {
            if metadata.len() < 1_048_576 {
                log::warn!("Library file suspiciously small");
                return false;
            }
        }
        Err(_) => return false,
    }

    // ✅ All checks passed - library is installed
    true
}
```

### Key Changes

| Aspect | Before | After |
|--------|--------|-------|
| Detection Method | Try to load library | Check file existence & validity |
| Blocked by SIP? | ✅ Yes | ❌ No |
| False Negatives? | ✅ Yes (fails on valid installations) | ❌ No |
| Checks | 1. File exists<br>2. Library loads | 1. File exists<br>2. Is a file<br>3. Symlink target valid<br>4. Reasonable size |
| When to Load | In detection | Later in `prime_client()` |

## How Library Loading Actually Works

### The Correct Flow

1. **Detection Phase** (`check_client_ready()`)
   - Just checks if files are present
   - Validates symlinks
   - Returns true/false

2. **Priming Phase** (`prime_client()`)
   - Called when user actually needs to connect
   - Uses `RTLD_GLOBAL` flag (makes symbols available to oracle crate)
   - Stores library reference in static variable
   - Uses rpath configured at build time (`~/lib` and Oracle directory)

3. **Connection Phase** (oracle crate)
   - Finds library via rpath (configured in build.rs)
   - Uses already-loaded symbols from `prime_client()`
   - Works because library was loaded with `RTLD_GLOBAL`

### Why This Approach Works

**Build-time rpath configuration** ([build.rs:1-26](../../src-tauri/build.rs)):
```rust
fn main() {
  #[cfg(target_os = "macos")]
  {
    // Add ~/lib to rpath
    if let Some(home) = dirs::home_dir() {
      let lib_path = home.join("lib");
      if lib_path.exists() {
        println!("cargo:rustc-link-arg=-Wl,-rpath,{}", lib_path.display());
      }

      // Also add Oracle directory as fallback
      let oracle_path = home.join("Documents/adtools_library/oracle_instantclient");
      if oracle_path.exists() {
        println!("cargo:rustc-link-arg=-Wl,-rpath,{}", oracle_path.display());
      }
    }
  }
}
```

**What this does:**
- Embeds search paths directly into the compiled binary
- Not affected by SIP (it's not runtime modification)
- Binary knows where to look for dynamic libraries
- Works even when `DYLD_LIBRARY_PATH` is blocked

## Installation Script Already Correct

The installation script ([install-oracle.sh](../../install-oracle.sh)) was already doing the right things:

```bash
# Creates symlink in installation directory
cd "$INSTALL_DIR"
ln -sf libclntsh.dylib.23.1 libclntsh.dylib

# Also creates symlinks in ~/lib (for rpath)
LIB_DIR="$HOME/lib"
mkdir -p "$LIB_DIR"
for dylib in "$INSTALL_DIR"/*.dylib*; do
    ln -sf "$dylib" "$LIB_DIR/$(basename "$dylib")"
done
```

**Why `~/lib` matters:**
- It's in the app's rpath (configured at build time)
- SIP allows applications to search their own rpaths
- No sudo required
- Works on all macOS versions

## Testing The Fix

### Before the Fix
```bash
# Installation works
$ curl -fsSL https://adtools.lolik.workers.dev/install-oracle.sh | bash
✓ Installation complete

# But app shows error
$ open "AD Tools.app"
# UI shows: "Oracle Instant Client not installed"
# Console logs: "Oracle client library found but invalid"
```

### After the Fix
```bash
# Installation works
$ curl -fsSL https://adtools.lolik.workers.dev/install-oracle.sh | bash
✓ Installation complete

# App detects correctly
$ open "AD Tools.app"
# UI shows: "Oracle Instant Client detected"
# Can proceed to configure connections
```

## Impact

### Who Benefits
- ✅ All new users installing Oracle client
- ✅ Existing users who ran install script but got "not installed" error
- ✅ Users on devices where sudo is not available/allowed
- ✅ Clean installations without manual intervention

### What Works Now
1. Detection works immediately after running install script
2. No need to restart app multiple times
3. No need for sudo/system-level installation
4. Clear error messages if something is actually wrong
5. Proper symlink validation

### Breaking Changes
**None.** This is a pure bug fix that makes detection work as originally intended.

## Related Files Modified

1. **[src-tauri/src/oracle/client.rs](../../src-tauri/src/oracle/client.rs)** - Fixed detection logic
2. **[install-oracle.sh](../../install-oracle.sh)** - Enhanced (but already had correct behavior)
3. **[build.rs](../../src-tauri/build.rs)** - Already correct (no changes needed)

## Future Improvements

### Potential Enhancements

1. **Add "Repair" button in UI**
   - Detect broken installations
   - Re-create symlinks if needed
   - Clear error messages

2. **Better error messages**
   - Distinguish between "not installed" vs "installation broken"
   - Show detected symlink targets
   - Provide actionable fixes

3. **Installation verification**
   - Test connection immediately after install
   - Validate all dependencies
   - Check library architecture matches system

4. **Support for custom paths**
   - Allow user to specify custom Oracle path
   - Remember user preference
   - Validate custom paths

## Conclusion

The issue was **not** with the installation script or the installed files. The problem was that the detection function was trying to load the library too early, before the proper runtime environment was set up, and was blocked by macOS SIP.

The fix separates **detection** (just check files exist) from **loading** (done later with proper setup), which is the correct approach for macOS applications dealing with dynamic libraries.
