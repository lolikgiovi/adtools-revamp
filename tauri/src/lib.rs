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
      jenkins_get_env_choices,
      jenkins_trigger_job,
      jenkins_trigger_batch_job,
      jenkins_poll_queue_for_build,
      jenkins_stream_logs,
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
      oracle::compare_configurations,
      oracle::compare_raw_sql,
      oracle::export_comparison_result,
      oracle::set_oracle_credentials,
      oracle::get_oracle_credentials,
      oracle::delete_oracle_credentials,
      oracle::has_oracle_credentials,
      // Oracle connection pool commands
      oracle::get_active_connections,
      oracle::close_all_connections,
      oracle::close_connection
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
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
  let token_entry = Entry::new(KEYCHAIN_SERVICE, &username).map_err(|e| e.to_string())?;
  let token = token_entry.get_password().map_err(|e| e.to_string())?;
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
fn set_jenkins_token(username: String, token: String) -> Result<(), String> {
  let token_entry = Entry::new(KEYCHAIN_SERVICE, &username).map_err(|e| e.to_string())?;
  token_entry.set_password(&token).map_err(|e| e.to_string())
}

#[tauri::command]
fn has_jenkins_token(username: String) -> Result<bool, String> {
  if username.is_empty() {
    return Ok(false);
  }
  let token_entry = match Entry::new(KEYCHAIN_SERVICE, &username) { Ok(e) => e, Err(_) => return Ok(false) };
  match token_entry.get_password() { Ok(_) => Ok(true), Err(_) => Ok(false) }
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

  tauri::async_runtime::spawn(async move {
    let mut start: u64 = 0;
    loop {
      match jenkins::progressive_log_once(&client, &base_url, &job, build_number, start, &creds).await {
        Ok((text, next, more)) => {
          let _ = app.emit("jenkins:log", serde_json::json!({ "chunk": text, "next_offset": next, "more": more }));
          if !more {
            let _ = app.emit("jenkins:log-complete", serde_json::json!({ "build_number": build_number }));
            break;
          }
          start = next;
        }
        Err(e) => {
          let _ = app.emit("jenkins:log-error", e);
          break;
        }
      }
      tokio::time::sleep(Duration::from_millis(800)).await;
    }
  });

  Ok(())
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
  let entry = Entry::new(CONFLUENCE_KEYCHAIN_SERVICE, "pat").map_err(|e| e.to_string())?;
  entry.set_password(&pat).map_err(|e| e.to_string())
}

#[tauri::command]
fn has_confluence_pat() -> Result<bool, String> {
  let entry = match Entry::new(CONFLUENCE_KEYCHAIN_SERVICE, "pat") {
    Ok(e) => e,
    Err(_) => return Ok(false),
  };
  match entry.get_password() {
    Ok(_) => Ok(true),
    Err(_) => Ok(false),
  }
}

async fn load_confluence_pat() -> Result<String, String> {
  let entry = Entry::new(CONFLUENCE_KEYCHAIN_SERVICE, "pat").map_err(|e| e.to_string())?;
  entry.get_password().map_err(|e| format!("PAT not found in keychain: {}", e))
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