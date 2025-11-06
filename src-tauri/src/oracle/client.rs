use crate::oracle::types::OracleClientStatus;
use std::env;
use std::path::PathBuf;

fn install_dir() -> Option<PathBuf> {
  let home = env::var("HOME").ok()?;
  let dir = PathBuf::from(home)
    .join("Documents")
    .join("adtools_library")
    .join("instantclient");
  Some(dir)
}

pub fn detect_client() -> OracleClientStatus {
  let dir_opt = install_dir();
  if let Some(dir) = dir_opt.as_ref() {
    let lib = dir.join("libclntsh.dylib");
    if lib.exists() {
      return OracleClientStatus {
        installed: true,
        version: None, // Optional: derive via otool or metadata in a later phase
        lib_paths: Some(vec![dir.to_string_lossy().to_string()]),
        message: Some("Oracle Instant Client detected".to_string()),
      };
    }
  }

  OracleClientStatus {
    installed: false,
    version: None,
    lib_paths: dir_opt.map(|d| vec![d.to_string_lossy().to_string()]),
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

  // Best-effort: Set DYLD_LIBRARY_PATH so rust-oracle can locate the dylib.
  // Note: On macOS newer versions, DYLD_* variables can be constrained by SIP for protected processes,
  // but for our app this typically works.
  env::set_var("DYLD_LIBRARY_PATH", dir);

  // Sanity check: try to load the library explicitly.
  unsafe {
    match libloading::Library::new(PathBuf::from(dir).join("libclntsh.dylib")) {
      Ok(_lib) => Ok(()),
      Err(e) => Err(format!("Failed to load libclntsh.dylib: {}", e)),
    }
  }
}