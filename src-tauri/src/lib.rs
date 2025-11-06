#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .manage(CredentialManager::new())
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
      // Oracle feature (optional) commands
      check_oracle_client_ready,
      prime_oracle_client,
      set_oracle_credentials,
      get_oracle_credentials,
      test_oracle_connection,
      fetch_table_metadata,
      compare_configurations,
      export_comparison_result
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
pub mod oracle;
use oracle::commands::*;
use oracle::credentials::CredentialManager;
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