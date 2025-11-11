/// Oracle Instant Client detection and initialization
///
/// This module handles Oracle client library detection, validation, and loading.

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

/// Static reference to the Oracle client library (loaded via libloading)
static ORACLE_CLIENT: OnceLock<Mutex<Option<libloading::Library>>> = OnceLock::new();

/// Default Oracle Instant Client installation path (user-space, no sudo)
/// New default: ~/Library/Application Support/AD Tools/instantclient
const DEFAULT_ORACLE_PATH: &str = "~/Library/Application Support/AD Tools/instantclient";

/// Legacy Oracle Instant Client installation path (kept for backward compatibility)
const LEGACY_ORACLE_PATH: &str = "~/Documents/adtools_library/oracle_instantclient";

/// Oracle client library filename for macOS
#[cfg(target_os = "macos")]
const ORACLE_LIB_NAME: &str = "libclntsh.dylib";

/// Resolves the Oracle client directory path
///
/// # Arguments
/// * `custom_path` - Optional custom directory path. If None, uses default path.
///
/// # Returns
/// Resolved PathBuf with tilde expansion applied
pub fn resolve_client_path(custom_path: Option<&str>) -> PathBuf {
    // If a custom path is provided, expand and return it directly
    if let Some(path_str) = custom_path {
        if path_str.starts_with("~/") {
            if let Some(home) = dirs::home_dir() {
                return home.join(&path_str[2..]);
            }
        }
        return PathBuf::from(path_str);
    }

    // 1) Prefer app bundle Resources when running a packaged app
    //    AD Tools.app/Contents/Resources/instantclient
    #[cfg(target_os = "macos")]
    {
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(mac_os_dir) = exe_path.parent() { // .../Contents/MacOS
                if let Some(contents_dir) = mac_os_dir.parent() { // .../Contents
                    let resources_dir = contents_dir.join("Resources").join("instantclient");
                    let lib_path = resources_dir.join(ORACLE_LIB_NAME);
                    if lib_path.exists() {
                        return resources_dir;
                    }
                }
            }
        }
    }

    // Helper to expand "~/..." safely
    let expand_home = |p: &str| -> PathBuf {
        if p.starts_with("~/") {
            if let Some(home) = dirs::home_dir() {
                return home.join(&p[2..]);
            }
        }
        PathBuf::from(p)
    };

    // 2) New default under Application Support (no sudo, user-specific)
    let app_support_dir = expand_home(DEFAULT_ORACLE_PATH);
    if app_support_dir.join(ORACLE_LIB_NAME).exists() {
        return app_support_dir;
    }

    // 3) Legacy location under Documents (kept for users who previously installed)
    let legacy_dir = expand_home(LEGACY_ORACLE_PATH);
    if legacy_dir.join(ORACLE_LIB_NAME).exists() {
        return legacy_dir;
    }

    // 4) Fallback: ~/lib (used by older installs that symlinked libraries)
    if let Some(home) = dirs::home_dir() {
        let lib_dir = home.join("lib");
        if lib_dir.join(ORACLE_LIB_NAME).exists() {
            return lib_dir;
        }
    }

    // If nothing is found, return the new default (so diagnostics show the expected location)
    app_support_dir
}

/// Checks if Oracle Instant Client is ready to use
///
/// Verifies that the Oracle client library exists at the expected location.
/// Note: This function does NOT attempt to load the library because macOS SIP
/// prevents DYLD_LIBRARY_PATH from working at this stage. The actual loading
/// happens in prime_client() with RTLD_GLOBAL flag.
///
/// # Arguments
/// * `custom_path` - Optional custom directory path
///
/// # Returns
/// `true` if the client library file exists, `false` otherwise
pub fn check_client_ready(custom_path: Option<&str>) -> bool {
    let client_dir = resolve_client_path(custom_path);
    let lib_path = client_dir.join(ORACLE_LIB_NAME);

    // Check if file exists (could be a symlink, that's fine)
    if !lib_path.exists() {
        log::debug!("Oracle client library not found at: {:?}", lib_path);
        return false;
    }

    // Verify it's a file (not a directory)
    if !lib_path.is_file() {
        log::warn!("Oracle client library path exists but is not a file: {:?}", lib_path);
        return false;
    }

    // Check if it's a symlink and if so, verify the target exists
    if lib_path.is_symlink() {
        match std::fs::read_link(&lib_path) {
            Ok(target) => {
                let full_target = if target.is_absolute() {
                    target.clone()
                } else {
                    client_dir.join(&target)
                };

                if !full_target.exists() {
                    log::warn!("Oracle client library symlink target does not exist: {:?} -> {:?}",
                              lib_path, full_target);
                    return false;
                }
                log::info!("Oracle client library found (symlink): {:?} -> {:?}", lib_path, target);
            }
            Err(e) => {
                log::warn!("Failed to read symlink target: {:?} - {}", lib_path, e);
                return false;
            }
        }
    } else {
        log::info!("Oracle client library found: {:?}", lib_path);
    }

    // Additional check: verify the file has reasonable size (> 1MB)
    // Oracle Instant Client library should be at least a few MB
    match std::fs::metadata(&lib_path) {
        Ok(metadata) => {
            let size = metadata.len();
            if size < 1_048_576 {  // 1MB
                log::warn!("Oracle client library file is suspiciously small ({} bytes): {:?}",
                          size, lib_path);
                return false;
            }
            log::debug!("Oracle client library size: {} bytes", size);
        }
        Err(e) => {
            log::warn!("Failed to get file metadata: {:?} - {}", lib_path, e);
            return false;
        }
    }

    true
}

/// Primes (loads) the Oracle client library into memory
///
/// This function loads the Oracle Instant Client library and stores a reference
/// to it in the static ORACLE_CLIENT mutex. This ensures the library remains
/// loaded for the lifetime of the application.
///
/// This also sets DYLD_LIBRARY_PATH (macOS) / LD_LIBRARY_PATH (Linux) to help
/// the oracle crate find the library when creating connections.
///
/// # Arguments
/// * `custom_path` - Optional custom directory path
///
/// # Returns
/// `Ok(())` if successful, or an error message describing what went wrong
pub fn prime_client(custom_path: Option<&str>) -> Result<(), String> {
    let client_dir = resolve_client_path(custom_path);
    let lib_path = client_dir.join(ORACLE_LIB_NAME);

    // Check if file exists
    if !lib_path.exists() {
        return Err(format!(
            "Oracle client library not found at: {}. Please install Oracle Instant Client.",
            lib_path.display()
        ));
    }

    // IMPORTANT: Set the library path BEFORE loading the library
    // This helps the oracle crate find it later
    #[cfg(target_os = "macos")]
    {
        std::env::set_var("DYLD_LIBRARY_PATH", client_dir.to_string_lossy().to_string());
        log::info!("Set DYLD_LIBRARY_PATH in prime_client to: {:?}", client_dir);
    }

    #[cfg(target_os = "linux")]
    {
        std::env::set_var("LD_LIBRARY_PATH", client_dir.to_string_lossy().to_string());
        log::info!("Set LD_LIBRARY_PATH in prime_client to: {:?}", client_dir);
    }

    // Load the library with RTLD_GLOBAL flag to make symbols available globally
    // This is crucial for the oracle crate to find and use the already-loaded library
    #[cfg(unix)]
    let library = unsafe {
        use libloading::os::unix::{Library as UnixLibrary, RTLD_NOW, RTLD_GLOBAL};
        let unix_lib = UnixLibrary::open(Some(&lib_path), RTLD_NOW | RTLD_GLOBAL)
            .map_err(|e| format!("Failed to load Oracle client library: {}", e))?;
        libloading::Library::from(unix_lib)
    };

    #[cfg(not(unix))]
    let library = unsafe {
        libloading::Library::new(&lib_path)
            .map_err(|e| format!("Failed to load Oracle client library: {}", e))?
    };

    // Store in static reference
    let mutex = ORACLE_CLIENT.get_or_init(|| Mutex::new(None));
    let mut guard = mutex.lock().map_err(|e| {
        format!("Failed to acquire lock on Oracle client: {}", e)
    })?;

    *guard = Some(library);

    log::info!("Oracle client library loaded successfully with RTLD_GLOBAL from: {:?}", lib_path);
    Ok(())
}

/// Checks if the Oracle client has been primed (loaded)
///
/// # Returns
/// `true` if the client library is loaded, `false` otherwise
pub fn is_client_primed() -> bool {
    if let Some(mutex) = ORACLE_CLIENT.get() {
        if let Ok(guard) = mutex.lock() {
            return guard.is_some();
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_client_path_default() {
        let path = resolve_client_path(None);
        assert!(path.to_string_lossy().contains("Library/Application Support/AD Tools/instantclient"));
    }

    #[test]
    fn test_resolve_client_path_custom() {
        let custom = "/opt/oracle/instantclient";
        let path = resolve_client_path(Some(custom));
        assert_eq!(path.to_string_lossy(), custom);
    }
}
