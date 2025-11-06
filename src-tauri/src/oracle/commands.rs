use tauri::State;

use crate::oracle::client;
use crate::oracle::credentials::CredentialManager;
use crate::oracle::types::{OracleClientStatus, OracleConnectionConfig, OracleCredentialStatus};
use crate::oracle::query;
use crate::oracle::comparison;

// Readiness
#[tauri::command]
pub fn check_oracle_client_ready() -> Result<OracleClientStatus, String> {
  Ok(client::detect_client())
}

#[tauri::command]
pub fn prime_oracle_client() -> Result<(), String> {
  let status = client::detect_client();
  if status.installed { client::prime() } else { Err("Oracle client not ready".into()) }
}

// Credentials
#[tauri::command]
pub fn set_oracle_credentials(state: State<CredentialManager>, connection_id: String, username: String, password: String) -> Result<(), String> {
  state.set(&connection_id, &username, &password)
}

#[tauri::command]
pub fn get_oracle_credentials(state: State<CredentialManager>, connection_id: String) -> Result<OracleCredentialStatus, String> {
  state.get(&connection_id)
}

// Connectivity test (stubbed in Phase 0)
#[tauri::command]
pub async fn test_oracle_connection(state: tauri::State<'_, CredentialManager>, config: OracleConnectionConfig) -> Result<bool, String> {
  let status = client::detect_client();
  if !status.installed { return Err("Oracle client not ready; cannot test connection".into()); }

  // Prime environment variables and load library.
  client::prime()?;

  // Load credentials from keychain
  let (username, password) = state.get_secret(&config.id)?;

  // Build EZCONNECT string: host:port/service_name
  let connect_str = format!("{}:{}/{}", config.host, config.port, config.service_name);

  // Connect in a blocking thread to avoid stalling async runtime
  let res = tauri::async_runtime::spawn_blocking(move || {
    match oracle::Connection::connect(&username, &password, &connect_str) {
      Ok(conn) => {
        // immediate close
        drop(conn);
        Ok(true)
      }
      Err(e) => Err(e.to_string()),
    }
  })
  .await
  .map_err(|e| e.to_string())?;

  res
}

// Metadata fetch (stubbed in Phase 0)
#[tauri::command]
pub async fn fetch_table_metadata(_state: tauri::State<'_, CredentialManager>, config: OracleConnectionConfig, schema: Option<String>, table: String) -> Result<serde_json::Value, String> {
  let status = client::detect_client();
  if !status.installed { return Err("Oracle client not ready; cannot fetch metadata".into()); }

  let res = tauri::async_runtime::spawn_blocking(move || {
    match query::fetch_table_metadata(&CredentialManager::new(), &config, schema.as_deref(), &table) {
      Ok(meta) => serde_json::to_value(meta).map_err(|e| e.to_string()),
      Err(e) => Err(e),
    }
  })
  .await
  .map_err(|e| e.to_string())?;

  res
}

// Comparison (stubbed in Phase 0)
#[tauri::command]
pub async fn compare_configurations(
  env1: OracleConnectionConfig,
  env2: OracleConnectionConfig,
  table: String,
  where_clause: Option<String>,
  fields: Option<Vec<String>>,
) -> Result<serde_json::Value, String> {
  let status = client::detect_client();
  if !status.installed { return Err("Oracle client not ready; cannot compare configurations".into()); }

  client::prime()?;

  let res = tauri::async_runtime::spawn_blocking(move || {
    let cm = CredentialManager::new();
    let field_slice = fields.as_ref().map(|v| v.as_slice());
    comparison::compare(&cm, &env1, &env2, &table, where_clause.as_deref(), field_slice)
      .and_then(|val| serde_json::to_value(val).map_err(|e| e.to_string()))
  })
  .await
  .map_err(|e| e.to_string())?;

  res
}

// Export (stubbed in Phase 0)
#[tauri::command]
pub fn export_comparison_result(format: String, payload: String) -> Result<String, String> {
  // Parse payload
  let json: serde_json::Value = serde_json::from_str(&payload).map_err(|e| e.to_string())?;

  // Determine output content
  let (content, ext) = match format.to_lowercase().as_str() {
    "json" => (serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?, "json"),
    "csv" => (comparison::to_csv(&json)?, "csv"),
    other => return Err(format!("Unsupported export format: {}", other)),
  };

  // Destination path: ~/Documents/adtools_library/comparisons
  let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
  let dir = format!("{}/Documents/adtools_library/comparisons", home);
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

  let timestamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
  let path = format!("{}/comparison-{}.{}", dir, timestamp, ext);
  std::fs::write(&path, content).map_err(|e| e.to_string())?;
  Ok(path)
}