/// Tauri commands for Oracle operations
///
/// This module exposes Oracle functionality to the frontend via Tauri commands.

use super::client::{check_client_ready, prime_client};
use super::models::{ConnectionConfig, Credentials};
use super::connection::DatabaseConnection;

/// Checks if Oracle Instant Client is ready to use
///
/// # Returns
/// `true` if Oracle client is installed and valid, `false` otherwise
#[tauri::command]
pub fn check_oracle_client_ready() -> bool {
    check_client_ready(None)
}

/// Primes (loads) the Oracle Instant Client library
///
/// This should be called after the user installs the Oracle client
/// to load it into memory for use.
///
/// # Returns
/// `Ok(())` if successful, or an error message
#[tauri::command]
pub fn prime_oracle_client() -> Result<(), String> {
    prime_client(None)
}

/// Tests an Oracle database connection
///
/// # Arguments
/// * `config` - Connection configuration
/// * `username` - Database username
/// * `password` - Database password
///
/// # Returns
/// Success message if connection works, error message otherwise
///
/// NOTE: Phase 1 implementation - basic validation only.
/// Full Oracle connectivity will be added in Phase 2.
#[tauri::command]
pub fn test_oracle_connection(
    config: ConnectionConfig,
    username: String,
    password: String,
) -> Result<String, String> {
    // Validate inputs
    config.validate()?;

    let credentials = Credentials::new(username, password);
    credentials.validate()?;

    // Create and test connection
    let conn = DatabaseConnection::new(config.clone(), credentials)?;
    conn.test_connection()?;

    Ok(format!(
        "Connection to {} successful (Phase 1 validation)",
        config.connection_string()
    ))
}

/// Fetches available schemas from a database
///
/// NOTE: Placeholder for Phase 3
#[tauri::command]
pub fn fetch_schemas(
    _config: ConnectionConfig,
    _username: String,
    _password: String,
) -> Result<Vec<String>, String> {
    Err("Not implemented yet - Phase 3".to_string())
}

/// Fetches tables for a specific schema
///
/// NOTE: Placeholder for Phase 3
#[tauri::command]
pub fn fetch_tables(
    _config: ConnectionConfig,
    _username: String,
    _password: String,
    _owner: String,
) -> Result<Vec<String>, String> {
    Err("Not implemented yet - Phase 3".to_string())
}

/// Fetches metadata for a specific table
///
/// NOTE: Placeholder for Phase 3
#[tauri::command]
pub fn fetch_table_metadata(
    _config: ConnectionConfig,
    _username: String,
    _password: String,
    _owner: String,
    _table_name: String,
) -> Result<super::models::TableMetadata, String> {
    Err("Not implemented yet - Phase 3".to_string())
}

/// Compares configurations between two environments
///
/// NOTE: Placeholder for Phase 4
#[tauri::command]
pub fn compare_configurations(
    _request: super::models::ComparisonRequest,
) -> Result<super::models::ComparisonResult, String> {
    Err("Not implemented yet - Phase 4".to_string())
}

/// Exports comparison results to a file
///
/// NOTE: Placeholder for Phase 5
#[tauri::command]
pub fn export_comparison_result(
    _result: super::models::ComparisonResult,
    _format: String,
) -> Result<String, String> {
    Err("Not implemented yet - Phase 5".to_string())
}
