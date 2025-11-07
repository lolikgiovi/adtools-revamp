/// Oracle Instant Client detection and initialization
///
/// This module handles Oracle client library detection, validation, and loading.

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

/// Static reference to the Oracle client library (loaded via libloading)
static ORACLE_CLIENT: OnceLock<Mutex<Option<libloading::Library>>> = OnceLock::new();

/// Default Oracle Instant Client installation path
const DEFAULT_ORACLE_PATH: &str = "~/Documents/adtools_library/oracle_instantclient";

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
    let path_str = custom_path.unwrap_or(DEFAULT_ORACLE_PATH);

    // Expand tilde to home directory
    if path_str.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(&path_str[2..]);
        }
    }

    PathBuf::from(path_str)
}

/// Checks if Oracle Instant Client is ready to use
///
/// Verifies that the Oracle client library exists at the expected location
/// and is a valid loadable library.
///
/// # Arguments
/// * `custom_path` - Optional custom directory path
///
/// # Returns
/// `true` if the client library is available and valid, `false` otherwise
pub fn check_client_ready(custom_path: Option<&str>) -> bool {
    let client_dir = resolve_client_path(custom_path);
    let lib_path = client_dir.join(ORACLE_LIB_NAME);

    // Check if file exists
    if !lib_path.exists() {
        log::debug!("Oracle client library not found at: {:?}", lib_path);
        return false;
    }

    // Try to load the library to verify it's valid
    match unsafe { libloading::Library::new(&lib_path) } {
        Ok(_) => {
            log::info!("Oracle client library found and valid at: {:?}", lib_path);
            true
        }
        Err(e) => {
            log::warn!("Oracle client library found but invalid: {}", e);
            false
        }
    }
}

/// Primes (loads) the Oracle client library into memory
///
/// This function loads the Oracle Instant Client library and stores a reference
/// to it in the static ORACLE_CLIENT mutex. This ensures the library remains
/// loaded for the lifetime of the application.
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

    // Load the library
    let library = unsafe {
        libloading::Library::new(&lib_path).map_err(|e| {
            format!("Failed to load Oracle client library: {}", e)
        })?
    };

    // Store in static reference
    let mutex = ORACLE_CLIENT.get_or_init(|| Mutex::new(None));
    let mut guard = mutex.lock().map_err(|e| {
        format!("Failed to acquire lock on Oracle client: {}", e)
    })?;

    *guard = Some(library);

    log::info!("Oracle client library loaded successfully from: {:?}", lib_path);
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
        assert!(path.to_string_lossy().contains("Documents/adtools_library/oracle_instantclient"));
    }

    #[test]
    fn test_resolve_client_path_custom() {
        let custom = "/opt/oracle/instantclient";
        let path = resolve_client_path(Some(custom));
        assert_eq!(path.to_string_lossy(), custom);
    }
}
