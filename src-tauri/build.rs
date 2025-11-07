fn main() {
  // Set up Oracle Instant Client library path for runtime linking
  // Strategy: Add ~/lib to rpath so the dynamic linker can find Oracle libraries

  #[cfg(target_os = "macos")]
  {
    // Add ~/lib to rpath (where we symlinked Oracle libraries)
    if let Some(home) = dirs::home_dir() {
      let lib_path = home.join("lib");
      if lib_path.exists() {
        println!("cargo:rustc-link-search=native={}", lib_path.display());
        println!("cargo:rustc-link-arg=-Wl,-rpath,{}", lib_path.display());
        println!("cargo:warning=Added ~/lib to rpath for Oracle libraries");
      }

      // Also add the original Oracle path as fallback
      let oracle_path = home.join("Documents/adtools_library/oracle_instantclient");
      if oracle_path.exists() {
        println!("cargo:rustc-link-search=native={}", oracle_path.display());
        println!("cargo:rustc-link-arg=-Wl,-rpath,{}", oracle_path.display());
      }
    }
  }

  tauri_build::build()
}