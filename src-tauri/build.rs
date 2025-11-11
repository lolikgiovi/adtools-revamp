fn main() {
  // Configure rpath so a bundled app can locate Oracle libraries
  // Use a relative rpath pointing into the app bundle Resources directory.
  #[cfg(target_os = "macos")]
  {
    // At runtime for a bundled app: AD Tools.app/Contents/MacOS/<bin>
    // We place libraries under:     AD Tools.app/Contents/Resources/instantclient
    // Add rpath: @executable_path/../Resources/instantclient
    println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Resources/instantclient");
    println!("cargo:warning=Added rpath to @executable_path/../Resources/instantclient");
  }

  tauri_build::build()
}