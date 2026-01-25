use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

// Zoom state: stores current zoom level (default 90%, range 80%-110%)
struct ZoomState(Mutex<f64>);

const ZOOM_DEFAULT: f64 = 0.9;
const ZOOM_MIN: f64 = 0.8;
const ZOOM_MAX: f64 = 1.1;
const ZOOM_STEP: f64 = 0.05;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_clipboard_manager::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .manage(ZoomState(Mutex::new(ZOOM_DEFAULT)))
    // Install opener capability via a simple Rust command (no plugin required)
    .invoke_handler(tauri::generate_handler![
      get_jenkins_username,
      set_jenkins_username,
      set_jenkins_token,
      has_jenkins_token,
      migrate_to_unified_keychain,
      jenkins_get_env_choices,
      jenkins_trigger_job,
      jenkins_trigger_batch_job,
      jenkins_poll_queue_for_build,
      jenkins_stream_logs,
      jenkins_get_build_status,
      open_url,
      get_arch,
      fetch_lockey_json,
      save_lockey_cache,
      load_lockey_cache,
      clear_lockey_cache,
      // Confluence commands
      set_confluence_pat,
      has_confluence_pat,
      confluence_fetch_page,
      confluence_fetch_by_space_title,
      confluence_search_pages,
      // Oracle commands
      oracle::check_oracle_client_ready,
      oracle::prime_oracle_client,
      oracle::test_oracle_connection,
      oracle::fetch_schemas,
      oracle::fetch_tables,
      oracle::fetch_table_metadata,
      oracle::export_comparison_result,
      oracle::set_oracle_credentials,
      oracle::get_oracle_credentials,
      oracle::delete_oracle_credentials,
      oracle::has_oracle_credentials,
      // Oracle connection pool commands
      oracle::get_active_connections,
      oracle::close_all_connections,
      oracle::close_connection,
      // Unified data fetch command
      oracle::fetch_oracle_data
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Setup Oracle Instant Client library path (must be done before any Oracle operations)
      #[cfg(feature = "oracle")]
      {
        if let Err(e) = oracle::setup_oracle_library_path() {
          eprintln!("Warning: Failed to setup Oracle library path: {}", e);
        }
      }

      // Build custom menu with zoom controls
      let menu = build_menu(app.handle())?;
      app.set_menu(menu)?;

      // Set default zoom level to 90%
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_zoom(ZOOM_DEFAULT);
      }
      Ok(())
    })
    .on_menu_event(|app, event| {
      let id = event.id().as_ref();
      match id {
        "zoom_in" => adjust_zoom(app, ZOOM_STEP),
        "zoom_out" => adjust_zoom(app, -ZOOM_STEP),
        "zoom_reset" => set_zoom(app, ZOOM_DEFAULT),
        _ => {}
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

fn build_menu(handle: &tauri::AppHandle) -> Result<Menu<tauri::Wry>, tauri::Error> {
  let menu = Menu::new(handle)?;

  // App menu (macOS)
  #[cfg(target_os = "macos")]
  {
    let app_menu = Submenu::with_items(
      handle,
      "AD Tools",
      true,
      &[
        &PredefinedMenuItem::about(handle, Some("About AD Tools"), None)?,
        &PredefinedMenuItem::separator(handle)?,
        &PredefinedMenuItem::services(handle, None)?,
        &PredefinedMenuItem::separator(handle)?,
        &PredefinedMenuItem::hide(handle, None)?,
        &PredefinedMenuItem::hide_others(handle, None)?,
        &PredefinedMenuItem::show_all(handle, None)?,
        &PredefinedMenuItem::separator(handle)?,
        &PredefinedMenuItem::quit(handle, None)?,
      ],
    )?;
    menu.append(&app_menu)?;
  }

  // Edit menu
  let edit_menu = Submenu::with_items(
    handle,
    "Edit",
    true,
    &[
      &PredefinedMenuItem::undo(handle, None)?,
      &PredefinedMenuItem::redo(handle, None)?,
      &PredefinedMenuItem::separator(handle)?,
      &PredefinedMenuItem::cut(handle, None)?,
      &PredefinedMenuItem::copy(handle, None)?,
      &PredefinedMenuItem::paste(handle, None)?,
      &PredefinedMenuItem::select_all(handle, None)?,
    ],
  )?;
  menu.append(&edit_menu)?;

  // View menu with zoom controls
  let zoom_in = MenuItem::with_id(handle, "zoom_in", "Zoom In", true, Some("CmdOrCtrl+="))?;
  let zoom_out = MenuItem::with_id(handle, "zoom_out", "Zoom Out", true, Some("CmdOrCtrl+-"))?;
  let zoom_reset = MenuItem::with_id(handle, "zoom_reset", "Reset Zoom", true, Some("CmdOrCtrl+0"))?;

  let view_menu = Submenu::with_items(
    handle,
    "View",
    true,
    &[
      &zoom_in,
      &zoom_out,
      &zoom_reset,
      &PredefinedMenuItem::separator(handle)?,
      &PredefinedMenuItem::fullscreen(handle, None)?,
    ],
  )?;
  menu.append(&view_menu)?;

  // Window menu
  let window_menu = Submenu::with_items(
    handle,
    "Window",
    true,
    &[
      &PredefinedMenuItem::minimize(handle, None)?,
      &PredefinedMenuItem::maximize(handle, None)?,
      &PredefinedMenuItem::separator(handle)?,
      &PredefinedMenuItem::close_window(handle, None)?,
    ],
  )?;
  menu.append(&window_menu)?;

  Ok(menu)
}

fn adjust_zoom(app: &tauri::AppHandle, delta: f64) {
  let state = app.state::<ZoomState>();
  let mut zoom = state.0.lock().unwrap();
  let new_zoom = (*zoom + delta).clamp(ZOOM_MIN, ZOOM_MAX);
  // Round to avoid floating point drift
  let new_zoom = (new_zoom * 100.0).round() / 100.0;
  *zoom = new_zoom;
  drop(zoom);
  apply_zoom(app, new_zoom);
}

fn set_zoom(app: &tauri::AppHandle, level: f64) {
  let state = app.state::<ZoomState>();
  let mut zoom = state.0.lock().unwrap();
  *zoom = level;
  drop(zoom);
  apply_zoom(app, level);
}

fn apply_zoom(app: &tauri::AppHandle, level: f64) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.set_zoom(level);
  }
}
pub mod jenkins;
pub mod confluence;
pub mod oracle;
use keyring::Entry;
use reqwest::Client;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use jenkins::Credentials;

const KEYCHAIN_SERVICE: &str = "ad-tools:jenkins";
const CONFLUENCE_KEYCHAIN_SERVICE: &str = "ad-tools:confluence";
const UNIFIED_KEYCHAIN_SERVICE: &str = "ad-tools:credentials";
const UNIFIED_KEYCHAIN_KEY: &str = "secrets";

#[derive(serde::Serialize, serde::Deserialize, Default, Clone)]
struct UnifiedSecrets {
    jenkins_token: Option<String>,
    confluence_pat: Option<String>,
}

fn load_unified_secrets() -> Result<UnifiedSecrets, String> {
    let entry = Entry::new(UNIFIED_KEYCHAIN_SERVICE, UNIFIED_KEYCHAIN_KEY).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(json_str) => serde_json::from_str(&json_str).map_err(|e| format!("Failed to parse secrets: {}", e)),
        // NoEntry means no credential exists yet - return empty defaults
        Err(keyring::Error::NoEntry) => Ok(UnifiedSecrets::default()),
        // NoStorageAccess means user cancelled prompt or permission denied - propagate error
        Err(keyring::Error::NoStorageAccess(e)) => Err(format!("Keychain access denied: {}", e)),
        // Other errors (PlatformFailure, etc.) - propagate for debugging
        Err(e) => Err(format!("Keychain error: {}", e)),
    }
}

fn save_unified_secrets(secrets: &UnifiedSecrets) -> Result<(), String> {
    let entry = Entry::new(UNIFIED_KEYCHAIN_SERVICE, UNIFIED_KEYCHAIN_KEY).map_err(|e| e.to_string())?;
    let json_str = serde_json::to_string(secrets).map_err(|e| format!("Failed to serialize secrets: {}", e))?;
    entry.set_password(&json_str).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
struct MigrationResult {
    migrated_jenkins: bool,
    migrated_confluence: bool,
    already_unified: bool,
    no_credentials: bool,
}

#[tauri::command]
fn migrate_to_unified_keychain(username: String) -> Result<MigrationResult, String> {
    let mut secrets = load_unified_secrets()?;
    let had_jenkins = secrets.jenkins_token.is_some();
    let had_confluence = secrets.confluence_pat.is_some();

    let mut migrated_jenkins = false;
    let mut migrated_confluence = false;
    let mut found_old_jenkins = false;
    let mut found_old_confluence = false;

    // Try migrating Jenkins token if not already in unified
    if secrets.jenkins_token.is_none() && !username.is_empty() {
        if let Ok(entry) = Entry::new(KEYCHAIN_SERVICE, &username) {
            if let Ok(token) = entry.get_password() {
                secrets.jenkins_token = Some(token);
                migrated_jenkins = true;
                found_old_jenkins = true;
            }
        }
    }

    // Try migrating Confluence PAT if not already in unified
    if secrets.confluence_pat.is_none() {
        if let Ok(entry) = Entry::new(CONFLUENCE_KEYCHAIN_SERVICE, "pat") {
            if let Ok(pat) = entry.get_password() {
                secrets.confluence_pat = Some(pat);
                migrated_confluence = true;
                found_old_confluence = true;
            }
        }
    }

    // Save if anything changed
    if migrated_jenkins || migrated_confluence {
        save_unified_secrets(&secrets)?;

        // Delete old entries after successful migration
        if migrated_jenkins {
            if let Ok(entry) = Entry::new(KEYCHAIN_SERVICE, &username) {
                let _ = entry.delete_password();
            }
        }
        if migrated_confluence {
            if let Ok(entry) = Entry::new(CONFLUENCE_KEYCHAIN_SERVICE, "pat") {
                let _ = entry.delete_password();
            }
        }
    }

    // no_credentials = true if there's nothing in unified AND nothing was found in old locations
    let no_credentials = !had_jenkins && !had_confluence && !found_old_jenkins && !found_old_confluence;

    Ok(MigrationResult {
        migrated_jenkins,
        migrated_confluence,
        already_unified: had_jenkins || had_confluence,
        no_credentials,
    })
}

fn http_client() -> Client {
  Client::builder()
    .timeout(Duration::from_secs(30))
    .build()
    .expect("failed to build reqwest client")
}

// HTTP client for Confluence that accepts invalid/self-signed SSL certs
// Needed for Confluence instances on IP addresses or with internal certs
fn confluence_http_client() -> Client {
  Client::builder()
    .timeout(Duration::from_secs(30))
    .danger_accept_invalid_certs(true)
    .build()
    .expect("failed to build confluence http client")
}

pub async fn load_credentials(username: String) -> Result<Credentials, String> {
  let secrets = load_unified_secrets()?;
  let token = secrets.jenkins_token.ok_or("Jenkins token not found in keychain")?;
  Ok(Credentials { username, token })
}

/// Get the Jenkins username from keychain (for migration to localStorage)
#[tauri::command]
fn get_jenkins_username() -> Result<Option<String>, String> {
  let entry = match Entry::new(KEYCHAIN_SERVICE, "__username__") {
    Ok(e) => e,
    Err(_) => return Ok(None),
  };
  match entry.get_password() {
    Ok(u) => Ok(Some(u)),
    Err(_) => Ok(None),
  }
}

#[tauri::command]
fn set_jenkins_username(username: String) -> Result<(), String> {
  let entry = Entry::new(KEYCHAIN_SERVICE, "__username__").map_err(|e| e.to_string())?;
  entry.set_password(&username).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_jenkins_token(_username: String, token: String) -> Result<(), String> {
  let mut secrets = load_unified_secrets()?;
  secrets.jenkins_token = Some(token);
  save_unified_secrets(&secrets)
}

#[tauri::command]
fn has_jenkins_token(username: String) -> Result<bool, String> {
  if username.is_empty() {
    return Ok(false);
  }
  let secrets = load_unified_secrets()?;
  Ok(secrets.jenkins_token.is_some())
}


#[tauri::command]
async fn jenkins_get_env_choices(base_url: String, job: String, username: String) -> Result<Vec<String>, String> {
  let creds = load_credentials(username).await?;
  let client = http_client();
  jenkins::fetch_env_choices(&client, &base_url, &job, &creds).await
}

#[tauri::command]
async fn jenkins_trigger_job(base_url: String, job: String, env: String, sql_text: String, username: String) -> Result<String, String> {
  let creds = load_credentials(username).await?;
  let client = http_client();
  jenkins::trigger_job(&client, &base_url, &job, &env, &sql_text, &creds).await
}

#[tauri::command]
async fn jenkins_poll_queue_for_build(_base_url: String, queue_url: String, username: String) -> Result<(Option<u64>, Option<String>), String> {
  let creds = load_credentials(username).await?;
  let client = http_client();
  jenkins::poll_queue_for_build(&client, &queue_url, &creds).await
}

#[tauri::command]
async fn jenkins_stream_logs(app: AppHandle, base_url: String, job: String, build_number: u64, username: String) -> Result<(), String> {
  let creds = load_credentials(username).await?;
  let client = http_client();

  println!("[jenkins_stream_logs] Starting stream for build #{}", build_number);
  let _ = app.emit("jenkins:log-debug", serde_json::json!({ "message": format!("Starting stream for build #{}", build_number) }));

  let base_url_clone = base_url.clone();
  let job_clone = job.clone();
  let creds_clone = jenkins::Credentials { username: creds.username.clone(), token: creds.token.clone() };

  tauri::async_runtime::spawn(async move {
    let mut start: u64 = 0;
    let mut iteration: u64 = 0;
    let mut stale_count: u64 = 0; // Count iterations with no new data
    let mut last_offset: u64 = 0;
    let stream_start = std::time::Instant::now();
    
    loop {
      iteration += 1;
      let iter_start = std::time::Instant::now();
      println!("[jenkins_stream_logs] Build #{} iteration {} (offset {})", build_number, iteration, start);
      
      match jenkins::progressive_log_once(&client, &base_url, &job, build_number, start, &creds).await {
        Ok((text, next, more)) => {
          let elapsed_ms = iter_start.elapsed().as_millis();
          println!("[jenkins_stream_logs] Build #{} iteration {} OK: next={}, more={}, text_len={}, took {}ms", 
                   build_number, iteration, next, more, text.len(), elapsed_ms);
          
          let _ = app.emit("jenkins:log", serde_json::json!({ 
            "chunk": text, 
            "next_offset": next, 
            "more": more,
            "build_number": build_number,
            "iteration": iteration
          }));
          
          if !more {
            let total_elapsed = stream_start.elapsed().as_secs();
            println!("[jenkins_stream_logs] Build #{} COMPLETE (more=false) after {} iterations, {}s total", build_number, iteration, total_elapsed);
            let _ = app.emit("jenkins:log-complete", serde_json::json!({ "build_number": build_number }));
            break;
          }
          
          // Track if we're getting new data
          if next == last_offset {
            stale_count += 1;
            println!("[jenkins_stream_logs] Build #{} stale data (count: {})", build_number, stale_count);
          } else {
            stale_count = 0;
            last_offset = next;
          }
          
          // If stale for too long, check build status directly
          if stale_count >= 10 {
            println!("[jenkins_stream_logs] Build #{} checking build status due to stale data", build_number);
            match jenkins::get_build_status(&client, &base_url_clone, &job_clone, build_number, &creds_clone).await {
              Ok((is_building, result)) => {
                println!("[jenkins_stream_logs] Build #{} status: is_building={}, result={:?}", build_number, is_building, result);
                if !is_building {
                  // Build is done but X-More-Data was true - force complete
                  let total_elapsed = stream_start.elapsed().as_secs();
                  println!("[jenkins_stream_logs] Build #{} COMPLETE (forced via status check) after {} iterations, {}s total", build_number, iteration, total_elapsed);
                  let _ = app.emit("jenkins:log-complete", serde_json::json!({ "build_number": build_number }));
                  break;
                }
              }
              Err(e) => {
                println!("[jenkins_stream_logs] Build #{} status check failed: {}", build_number, e);
              }
            }
            stale_count = 0; // Reset and continue trying
          }
          
          start = next;
        }
        Err(e) => {
          let elapsed_ms = iter_start.elapsed().as_millis();
          println!("[jenkins_stream_logs] Build #{} iteration {} ERROR after {}ms: {}", build_number, iteration, elapsed_ms, e);
          let _ = app.emit("jenkins:log-error", serde_json::json!({ 
            "error": e.clone(), 
            "build_number": build_number,
            "iteration": iteration 
          }));
          break;
        }
      }
      tokio::time::sleep(Duration::from_millis(800)).await;
    }
    println!("[jenkins_stream_logs] Build #{} stream task exiting", build_number);
  });

  Ok(())
}

#[tauri::command]
async fn jenkins_get_build_status(base_url: String, job: String, build_number: u64, username: String) -> Result<(bool, Option<String>), String> {
  let creds = load_credentials(username).await?;
  let client = http_client();
  jenkins::get_build_status(&client, &base_url, &job, build_number, &creds).await
}

#[tauri::command]
async fn jenkins_trigger_batch_job(base_url: String, env: String, batch_name: String, job_name: String, username: String) -> Result<String, String> {
  let creds = load_credentials(username).await?;
  let client = http_client();
  jenkins::trigger_batch_job(&client, &base_url, &env, &batch_name, &job_name, &creds).await
}

// Open an external URL using the system default browser
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
  open::that(url).map_err(|e| e.to_string())
}

// Report the current target architecture, e.g., "aarch64" or "x86_64"
#[tauri::command]
fn get_arch() -> String {
  std::env::consts::ARCH.to_string()
}

// Fetch JSON data from a URL (bypasses browser CORS restrictions)
// Used by Master Lockey tool to fetch localization data
#[tauri::command]
async fn fetch_lockey_json(url: String) -> Result<serde_json::Value, String> {
  // Build a more permissive client for development (accepts invalid SSL certs)
  let client = Client::builder()
    .timeout(Duration::from_secs(30))
    .danger_accept_invalid_certs(true) // Allow self-signed/invalid SSL certs
    .build()
    .map_err(|e| format!("Failed to build HTTP client: {}", e))?;
  
  // Validate URL format
  if !url.starts_with("http://") && !url.starts_with("https://") {
    return Err(format!("Invalid URL format: must start with http:// or https://"));
  }
  
  let response = client
    .get(&url)
    .send()
    .await
    .map_err(|e| {
      // Provide more specific error messages based on error type
      if e.is_timeout() {
        format!("Request timed out after 30 seconds")
      } else if e.is_connect() {
        format!("Connection error: Unable to connect to server. Check the URL and network connection.")
      } else if e.is_request() {
        format!("Request error: {}", e)
      } else {
        format!("Network error: {}", e)
      }
    })?;
  
  let status = response.status();
  if !status.is_success() {
    let status_code = status.as_u16();
    let reason = status.canonical_reason().unwrap_or("Unknown");
    return Err(format!("HTTP {}: {} - Server returned an error", status_code, reason));
  }
  
  let json = response
    .json::<serde_json::Value>()
    .await
    .map_err(|e| format!("Failed to parse JSON response: {}", e))?;
  
  Ok(json)
}

// Cache management for Master Lockey
// Stores cache files in app data directory

fn get_cache_dir(app: AppHandle) -> Result<std::path::PathBuf, String> {
  let app_data = app.path().app_data_dir()
    .map_err(|e| format!("Failed to get app data dir: {}", e))?;
  let cache_dir = app_data.join("lockey_cache");
  
  // Create cache directory if it doesn't exist
  std::fs::create_dir_all(&cache_dir)
    .map_err(|e| format!("Failed to create cache directory: {}", e))?;
  
  Ok(cache_dir)
}

fn sanitize_domain_name(domain: &str) -> String {
  domain.chars()
    .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
    .collect()
}

#[tauri::command]
async fn save_lockey_cache(
  app: AppHandle,
  domain: String,
  data: serde_json::Value
) -> Result<(), String> {
  let cache_dir = get_cache_dir(app)?;
  let safe_domain = sanitize_domain_name(&domain);
  let cache_file = cache_dir.join(format!("{}.json", safe_domain));
  
  let cache_data = serde_json::json!({
    "domain": domain,
    "data": data,
    "timestamp": chrono::Utc::now().timestamp_millis()
  });
  
  let json_string = serde_json::to_string_pretty(&cache_data)
    .map_err(|e| format!("Failed to serialize cache: {}", e))?;
  
  std::fs::write(&cache_file, json_string)
    .map_err(|e| format!("Failed to write cache file: {}", e))?;
  
  Ok(())
}

#[tauri::command]
async fn load_lockey_cache(
  app: AppHandle,
  domain: String
) -> Result<Option<serde_json::Value>, String> {
  let cache_dir = get_cache_dir(app)?;
  let safe_domain = sanitize_domain_name(&domain);
  let cache_file = cache_dir.join(format!("{}.json", safe_domain));
  
  if !cache_file.exists() {
    return Ok(None);
  }
  
  let content = std::fs::read_to_string(&cache_file)
    .map_err(|e| format!("Failed to read cache file: {}", e))?;
  
  let cache_data: serde_json::Value = serde_json::from_str(&content)
    .map_err(|e| format!("Failed to parse cache file: {}", e))?;
  
  Ok(Some(cache_data))
}

#[tauri::command]
async fn clear_lockey_cache(
  app: AppHandle,
  domain: Option<String>
) -> Result<(), String> {
  let cache_dir = get_cache_dir(app)?;
  
  if let Some(domain_name) = domain {
    // Clear specific domain cache
    let safe_domain = sanitize_domain_name(&domain_name);
    let cache_file = cache_dir.join(format!("{}.json", safe_domain));
    
    if cache_file.exists() {
      std::fs::remove_file(&cache_file)
        .map_err(|e| format!("Failed to remove cache file: {}", e))?;
    }
  } else {
    // Clear all caches
    if cache_dir.exists() {
      std::fs::remove_dir_all(&cache_dir)
        .map_err(|e| format!("Failed to remove cache directory: {}", e))?;
      std::fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Failed to recreate cache directory: {}", e))?;
    }
  }
  
  Ok(())
}

// Confluence integration commands

#[tauri::command]
fn set_confluence_pat(pat: String) -> Result<(), String> {
  let mut secrets = load_unified_secrets()?;
  secrets.confluence_pat = Some(pat);
  save_unified_secrets(&secrets)
}

#[tauri::command]
fn has_confluence_pat() -> Result<bool, String> {
  let secrets = load_unified_secrets().unwrap_or_default();
  Ok(secrets.confluence_pat.is_some())
}

async fn load_confluence_pat() -> Result<String, String> {
  let secrets = load_unified_secrets()?;
  secrets.confluence_pat.ok_or_else(|| "Confluence PAT not found in keychain".to_string())
}

#[tauri::command]
async fn confluence_fetch_page(
  domain: String,
  page_id: String,
  username: String
) -> Result<confluence::PageContent, String> {
  let pat = load_confluence_pat().await?;
  let client = confluence_http_client();
  confluence::fetch_page_content(&client, &domain, &page_id, &username, &pat).await
}

#[tauri::command]
async fn confluence_search_pages(
  domain: String,
  query: String,
  username: String
) -> Result<Vec<confluence::PageInfo>, String> {
  let pat = load_confluence_pat().await?;
  let client = confluence_http_client();
  confluence::search_pages(&client, &domain, &query, &username, &pat).await
}

#[tauri::command]
async fn confluence_fetch_by_space_title(
  domain: String,
  space_key: String,
  title: String,
  username: String
) -> Result<confluence::PageContent, String> {
  let pat = load_confluence_pat().await?;
  let client = confluence_http_client();
  confluence::fetch_page_by_space_title(&client, &domain, &space_key, &title, &username, &pat).await
}