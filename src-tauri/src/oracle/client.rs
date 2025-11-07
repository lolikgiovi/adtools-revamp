use crate::oracle::types::OracleClientStatus;
use std::env;
use std::fs;
use std::path::PathBuf;

fn candidate_dirs() -> Vec<PathBuf> {
  let mut dirs: Vec<PathBuf> = Vec::new();

  // Explicit override via environment variable
  if let Ok(custom) = env::var("ADTOOLS_ORACLE_LIB_DIR") {
    if !custom.is_empty() { dirs.push(PathBuf::from(custom)); }
  }

  // Default expected install directory
  if let Ok(home) = env::var("HOME") {
    dirs.push(PathBuf::from(&home).join("Documents").join("adtools_library").join("instantclient"));

    // Common DMG installer output: ~/Downloads/instantclient_XX_X
    let downloads = PathBuf::from(&home).join("Downloads");
    if downloads.is_dir() {
      if let Ok(rd) = fs::read_dir(&downloads) {
        for entry in rd.flatten() {
          let path = entry.path();
          if path.is_dir() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
              if name.starts_with("instantclient_") {
                dirs.push(path);
              }
            }
          }
        }
      }
    }
  }

  // Workspace sandbox path (used during development/testing)
  if let Ok(cwd) = env::current_dir() {
    dirs.push(cwd.join(".adtools_sandbox").join("instantclient"));
  }

  // Common system-wide locations used by the DMG installer or manual installs
  let bases = vec![
    PathBuf::from("/opt/oracle"),
    PathBuf::from("/opt"),
    PathBuf::from("/Library/Oracle"),
    PathBuf::from("/Library/Oracle/InstantClient"),
    PathBuf::from("/Applications"),
  ];
  for base in bases {
    if base.is_dir() {
      // If the base itself contains the library, include it directly
      if base.join("libclntsh.dylib").exists() { dirs.push(base.clone()); }
      if let Ok(rd) = fs::read_dir(&base) {
        for entry in rd.flatten() {
          let path = entry.path();
          if path.is_dir() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
              // Match common patterns like instantclient_23_3, InstantClient, etc.
              let lower = name.to_lowercase();
              if lower.starts_with("instantclient") || lower.contains("instantclient") {
                dirs.push(path);
              }
            }
          }
        }
      }
    }
  }

  dirs
}

pub fn detect_client() -> OracleClientStatus {
  let candidates = candidate_dirs();
  for dir in &candidates {
    let lib = dir.join("libclntsh.dylib");
    if lib.exists() {
      return OracleClientStatus {
        installed: true,
        version: None, // Optional: derive via otool or metadata in a later phase
        lib_paths: Some(vec![dir.to_string_lossy().to_string()]),
        message: Some(format!("Oracle Instant Client detected at {}", dir.to_string_lossy())),
      };
    }
  }

  OracleClientStatus {
    installed: false,
    version: None,
    lib_paths: if candidates.is_empty() { None } else { Some(candidates.into_iter().map(|d| d.to_string_lossy().to_string()).collect()) },
    message: Some("Oracle Instant Client not detected. Install via the provided script and restart AD Tools.".to_string()),
  }
}

pub fn prime() -> Result<(), String> {
  let status = detect_client();
  if !status.installed {
    return Err("Oracle client not ready; cannot prime environment".into());
  }

  let lib_paths = status
    .lib_paths
    .ok_or_else(|| "Missing library path information".to_string())?;
  let dir = lib_paths.first().ok_or_else(|| "No library path found".to_string())?;

  // Best-effort: Set multiple loader paths so rust-oracle/ODPI can locate the dylib.
  // Note: On macOS newer versions, DYLD_* variables can be constrained by SIP for protected processes,
  // but setting both PATH and FALLBACK typically works for user-launched apps.
  env::set_var("DYLD_LIBRARY_PATH", dir);
  env::set_var("DYLD_FALLBACK_LIBRARY_PATH", dir);
  // ODPI-specific hints: these are read at runtime by ODPI to construct absolute paths
  // and avoid relying on dyld environment captured at process launch.
  env::set_var("ODPI_LIB_DIR", dir);
  env::set_var("OCI_LIB_DIR", dir);

  // Sanity check: try to load the library explicitly.
  unsafe {
    // Load with global visibility so downstream ODPI dlopen can resolve symbols reliably.
    #[cfg(target_os = "macos")]
    {
      use libloading::os::unix::{Library, RTLD_GLOBAL, RTLD_NOW};
      let path = PathBuf::from(dir).join("libclntsh.dylib");
      match Library::open(Some(path.as_os_str()), RTLD_NOW | RTLD_GLOBAL) {
        Ok(_lib) => Ok(()),
        Err(e) => Err(format!("Failed to load libclntsh.dylib at {}: {}", path.to_string_lossy(), e)),
      }
    }
    #[cfg(not(target_os = "macos"))]
    {
      match libloading::Library::new(PathBuf::from(dir).join("libclntsh.dylib")) {
        Ok(_lib) => Ok(()),
        Err(e) => Err(format!("Failed to load libclntsh.dylib: {}", e)),
      }
    }
  }
}