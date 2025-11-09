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
/// This command:
/// 1. Retrieves credentials for both environments from keychain
/// 2. Connects to both Oracle databases
/// 3. Fetches table metadata to get primary key
/// 4. Fetches records from both environments
/// 5. Runs comparison engine
/// 6. Returns structured comparison results
#[tauri::command]
pub fn compare_configurations(
    request: super::models::ComparisonRequest,
) -> Result<super::models::ComparisonResult, String> {
    log::info!(
        "Starting comparison: {}.{} vs {}.{} (table: {})",
        request.env1_name,
        request.env1_schema,
        request.env2_name,
        request.env2_schema,
        request.table_name
    );

    // Get credentials for both environments
    let (username1, password1) = CredentialManager::get_oracle_credentials(&request.env1_name)?;
    let credentials1 = Credentials::new(username1, password1);

    let (username2, password2) = CredentialManager::get_oracle_credentials(&request.env2_name)?;
    let credentials2 = Credentials::new(username2, password2);

    // Connect to both environments
    let conn1 = DatabaseConnection::new(request.env1_connection.clone(), credentials1)?;
    let conn2 = DatabaseConnection::new(request.env2_connection.clone(), credentials2)?;

    // Fetch metadata to determine primary key
    let metadata = conn1.fetch_table_metadata(&request.env1_schema, &request.table_name)?;

    // Determine which primary key to use: custom > table PK > first field fallback
    let primary_key = if !request.custom_primary_key.is_empty() {
        log::info!(
            "Using custom primary key: {:?} (overriding table PK: {:?})",
            request.custom_primary_key,
            metadata.primary_key
        );
        request.custom_primary_key.clone()
    } else if !metadata.primary_key.is_empty() {
        log::info!(
            "Using table's primary key: {:?} for comparison",
            metadata.primary_key
        );
        metadata.primary_key.clone()
    } else {
        // Fallback: use the first field as primary key
        if metadata.columns.is_empty() {
            return Err(format!(
                "Table {}.{} has no columns. Cannot perform comparison.",
                request.env1_schema, request.table_name
            ));
        }
        let first_field = metadata.columns[0].name.clone();
        log::warn!(
            "Table {}.{} has no primary key defined. Using first field '{}' as fallback primary key.",
            request.env1_schema, request.table_name, first_field
        );
        vec![first_field]
    };

    // Determine which fields to fetch and compare
    let fields_to_fetch = if request.fields.is_empty() {
        // If no fields specified, fetch all columns
        metadata
            .columns
            .iter()
            .map(|c| c.name.clone())
            .collect::<Vec<_>>()
    } else {
        request.fields.clone()
    };

    // Fetch records from both environments
    log::info!("Fetching records from environment 1...");
    let env1_records = conn1.fetch_records(
        &request.env1_schema,
        &request.table_name,
        request.where_clause.as_deref(),
        &fields_to_fetch,
    )?;

    log::info!("Fetching records from environment 2...");
    let env2_records = conn2.fetch_records(
        &request.env2_schema,
        &request.table_name,
        request.where_clause.as_deref(),
        &fields_to_fetch,
    )?;

    log::info!(
        "Fetched {} records from env1, {} records from env2",
        env1_records.len(),
        env2_records.len()
    );

    // Perform comparison
    let result = super::comparison::ComparisonEngine::compare(
        request.env1_name,
        request.env2_name,
        env1_records,
        env2_records,
        &primary_key,
        &fields_to_fetch,
    )?;

    log::info!("Comparison complete");
    Ok(result)
}

/// Exports comparison results to a file
///
/// Supports JSON and CSV formats
#[tauri::command]
pub fn export_comparison_result(
    result: super::models::ComparisonResult,
    format: String,
) -> Result<String, String> {
    use std::fs;

    log::info!("Exporting comparison result as {}", format);

    // Create export directory
    let home_dir = dirs::home_dir().ok_or("Could not find home directory")?;
    let export_dir = home_dir.join("Documents").join("adtools_library").join("comparisons");

    if !export_dir.exists() {
        fs::create_dir_all(&export_dir)
            .map_err(|e| format!("Failed to create export directory: {}", e))?;
    }

    // Generate timestamped filename
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let extension = match format.as_str() {
        "json" => "json",
        "csv" => "csv",
        _ => return Err(format!("Unsupported format: {}", format)),
    };

    let filename = format!(
        "comparison_{}_{}.{}",
        result.env1_name.replace(" ", "_"),
        timestamp,
        extension
    );
    let filepath = export_dir.join(&filename);

    // Generate content
    let content = match format.as_str() {
        "json" => {
            serde_json::to_string_pretty(&result)
                .map_err(|e| format!("Failed to serialize to JSON: {}", e))?
        }
        "csv" => export_to_csv(&result)?,
        _ => unreachable!(),
    };

    // Write file
    fs::write(&filepath, content)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    let filepath_str = filepath.to_string_lossy().to_string();
    log::info!("Exported comparison to: {}", filepath_str);

    Ok(filepath_str)
}

/// Converts comparison result to CSV format
fn export_to_csv(result: &super::models::ComparisonResult) -> Result<String, String> {
    let mut csv = String::new();

    // Header
    csv.push_str("Primary Key,Status,Env1 Name,Env2 Name,Field,Env1 Value,Env2 Value\n");

    // Rows
    for comparison in &result.comparisons {
        let pk = &comparison.primary_key;
        let status = format!("{:?}", comparison.status);

        if comparison.differences.is_empty() {
            // No differences - just show status
            csv.push_str(&format!(
                "\"{}\",\"{}\",\"{}\",\"{}\",,,\n",
                escape_csv(pk),
                escape_csv(&status),
                escape_csv(&result.env1_name),
                escape_csv(&result.env2_name)
            ));
        } else {
            // Show each field difference
            for diff in &comparison.differences {
                let empty = String::new();
                let env1_value = diff.env1_value.as_ref().unwrap_or(&empty);
                let env2_value = diff.env2_value.as_ref().unwrap_or(&empty);

                csv.push_str(&format!(
                    "\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\"\n",
                    escape_csv(pk),
                    escape_csv(&status),
                    escape_csv(&result.env1_name),
                    escape_csv(&result.env2_name),
                    escape_csv(&diff.field_name),
                    escape_csv(env1_value),
                    escape_csv(env2_value)
                ));
            }
        }
    }

    Ok(csv)
}

/// Escapes CSV values
fn escape_csv(value: &str) -> String {
    value.replace("\"", "\"\"")
}
