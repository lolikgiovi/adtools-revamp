/// Tauri commands for Oracle operations
///
/// This module exposes Oracle functionality to the frontend via Tauri commands.

use super::client::{check_client_ready, prime_client};
use super::models::{ConnectionConfig, Credentials};
use super::connection::DatabaseConnection;
use crate::credentials::CredentialManager;

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
/// Phase 2: Full implementation with actual Oracle connectivity
#[tauri::command]
pub fn test_oracle_connection(
    config: ConnectionConfig,
    username: String,
    password: String,
) -> Result<String, String> {
    log::info!("Testing Oracle connection for: {}", config.name);

    // Validate inputs
    config.validate()?;

    let credentials = Credentials::new(username, password);
    credentials.validate()?;

    // Create and test connection
    let conn = DatabaseConnection::new(config.clone(), credentials)?;
    conn.test_connection()?;

    Ok(format!(
        "Connection to {} successful",
        config.connection_string()
    ))
}

/// Tests an Oracle database connection using saved credentials
///
/// # Arguments
/// * `connection_name` - Name of the saved connection (to retrieve credentials from keychain)
/// * `config` - Connection configuration
///
/// # Returns
/// Success message if connection works, error message otherwise
#[tauri::command]
pub fn test_oracle_connection_saved(
    connection_name: String,
    config: ConnectionConfig,
) -> Result<String, String> {
    log::info!("Testing saved Oracle connection: {}", connection_name);

    // Retrieve credentials from keychain
    let (username, password) = CredentialManager::get_oracle_credentials(&connection_name)?;

    // Use the existing test function
    test_oracle_connection(config, username, password)
}

/// Fetches available schemas from a database
///
/// # Arguments
/// * `connection_name` - Name of the saved connection (to retrieve credentials)
/// * `config` - Connection configuration
///
/// # Returns
/// List of schema names or an error message
#[tauri::command]
pub fn fetch_schemas(
    connection_name: String,
    config: ConnectionConfig,
) -> Result<Vec<String>, String> {
    log::info!("Fetching schemas for connection: {}", connection_name);

    // Retrieve credentials from keychain
    let (username, password) = CredentialManager::get_oracle_credentials(&connection_name)?;
    let credentials = Credentials::new(username, password);

    // Create connection and fetch schemas
    let conn = DatabaseConnection::new(config, credentials)?;
    conn.fetch_schemas()
}

/// Fetches tables for a specific schema
///
/// # Arguments
/// * `connection_name` - Name of the saved connection (to retrieve credentials)
/// * `config` - Connection configuration
/// * `owner` - Schema/owner name
///
/// # Returns
/// List of table names or an error message
#[tauri::command]
pub fn fetch_tables(
    connection_name: String,
    config: ConnectionConfig,
    owner: String,
) -> Result<Vec<String>, String> {
    log::info!("Fetching tables for schema: {} (connection: {})", owner, connection_name);

    // Retrieve credentials from keychain
    let (username, password) = CredentialManager::get_oracle_credentials(&connection_name)?;
    let credentials = Credentials::new(username, password);

    // Create connection and fetch tables
    let conn = DatabaseConnection::new(config, credentials)?;
    conn.fetch_tables(&owner)
}

/// Fetches metadata for a specific table
///
/// # Arguments
/// * `connection_name` - Name of the saved connection (to retrieve credentials)
/// * `config` - Connection configuration
/// * `owner` - Schema/owner name
/// * `table_name` - Table name
///
/// # Returns
/// TableMetadata structure or an error message
#[tauri::command]
pub fn fetch_table_metadata(
    connection_name: String,
    config: ConnectionConfig,
    owner: String,
    table_name: String,
) -> Result<super::models::TableMetadata, String> {
    log::info!("Fetching metadata for table: {}.{} (connection: {})", owner, table_name, connection_name);

    // Retrieve credentials from keychain
    let (username, password) = CredentialManager::get_oracle_credentials(&connection_name)?;
    let credentials = Credentials::new(username, password);

    // Create connection and fetch metadata
    let conn = DatabaseConnection::new(config, credentials)?;
    conn.fetch_table_metadata(&owner, &table_name)
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
