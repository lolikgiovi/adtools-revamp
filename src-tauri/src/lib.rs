#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    // Install opener capability via a simple Rust command (no plugin required)
    .invoke_handler(tauri::generate_handler![
      set_jenkins_username,
      set_jenkins_token,
      has_jenkins_token,
      jenkins_get_env_choices,
      jenkins_trigger_job,
      jenkins_poll_queue_for_build,
      jenkins_stream_logs,
      open_url,
      get_arch,
      fetch_lockey_json
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
pub mod jenkins;
use keyring::Entry;
use reqwest::Client;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use jenkins::Credentials;

const KEYCHAIN_SERVICE: &str = "ad-tools:jenkins";

fn http_client() -> Client {
  Client::builder()
    .timeout(Duration::from_secs(30))
    .build()
    .expect("failed to build reqwest client")
}

pub async fn load_credentials() -> Result<Credentials, String> {
  let user_entry = Entry::new(KEYCHAIN_SERVICE, "__username__").map_err(|e| e.to_string())?;
  let username = user_entry.get_password().map_err(|e| e.to_string())?;
  let token_entry = Entry::new(KEYCHAIN_SERVICE, &username).map_err(|e| e.to_string())?;
  let token = token_entry.get_password().map_err(|e| e.to_string())?;
  Ok(Credentials { username, token })
}

#[tauri::command]
fn set_jenkins_username(username: String) -> Result<(), String> {
  let entry = Entry::new(KEYCHAIN_SERVICE, "__username__").map_err(|e| e.to_string())?;
  entry.set_password(&username).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_jenkins_token(token: String) -> Result<(), String> {
  let entry = Entry::new(KEYCHAIN_SERVICE, "__username__").map_err(|e| e.to_string())?;
  let username = entry.get_password().map_err(|e| e.to_string())?;
  let token_entry = Entry::new(KEYCHAIN_SERVICE, &username).map_err(|e| e.to_string())?;
  token_entry.set_password(&token).map_err(|e| e.to_string())
}

#[tauri::command]
fn has_jenkins_token() -> Result<bool, String> {
  let entry = Entry::new(KEYCHAIN_SERVICE, "__username__").map_err(|e| e.to_string())?;
  let username = match entry.get_password() { Ok(u) => u, Err(_) => return Ok(false) };
  let token_entry = match Entry::new(KEYCHAIN_SERVICE, &username) { Ok(e) => e, Err(_) => return Ok(false) };
  match token_entry.get_password() { Ok(_) => Ok(true), Err(_) => Ok(false) }
}


#[tauri::command]
async fn jenkins_get_env_choices(base_url: String, job: String) -> Result<Vec<String>, String> {
  let creds = load_credentials().await?;
  let client = http_client();
  jenkins::fetch_env_choices(&client, &base_url, &job, &creds).await
}

#[tauri::command]
async fn jenkins_trigger_job(base_url: String, job: String, env: String, sql_text: String) -> Result<String, String> {
  let creds = load_credentials().await?;
  let client = http_client();
  jenkins::trigger_job(&client, &base_url, &job, &env, &sql_text, &creds).await
}

#[tauri::command]
async fn jenkins_poll_queue_for_build(_base_url: String, queue_url: String) -> Result<(Option<u64>, Option<String>), String> {
  let creds = load_credentials().await?;
  let client = http_client();
  jenkins::poll_queue_for_build(&client, &queue_url, &creds).await
}

#[tauri::command]
async fn jenkins_stream_logs(app: AppHandle, base_url: String, job: String, build_number: u64) -> Result<(), String> {
  let creds = load_credentials().await?;
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