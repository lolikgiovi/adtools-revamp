//! Oracle database integration for Compare Config tool
//!
//! This module provides Oracle connectivity for comparing database configurations
//! between environments. It requires the `oracle` feature to be enabled and
//! Oracle Instant Client to be installed.

use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
#[cfg(feature = "oracle")]
use std::time::{Duration, Instant};

#[cfg(feature = "oracle")]
use oracle::sql_type::OracleType;
#[cfg(feature = "oracle")]
use oracle::Connection;

const ORACLE_KEYCHAIN_SERVICE: &str = "ad-tools:oracle";

// ============================================================================
// Error Types
// ============================================================================

#[derive(Debug, Clone, Serialize)]
pub struct OracleError {
    pub code: i32,
    pub message: String,
    pub hint: Option<String>,
}

impl OracleError {
    pub fn new(code: i32, message: impl Into<String>) -> Self {
        let message = message.into();
        let hint = match code {
            1017 => Some("Check your username and password.".into()),
            12154 => Some("Verify connection string format: host:port/service_name".into()),
            12170 => Some("Connection timed out. Check network and firewall.".into()),
            12541 => Some("No listener at specified host:port. Verify the address.".into()),
            12545 => Some("Target host or object does not exist.".into()),
            942 => Some("Table or view does not exist, or you lack permissions.".into()),
            1031 => Some("Insufficient privileges. Contact your DBA.".into()),
            1405 => Some("NULL value encountered where not allowed.".into()),
            3136 => Some("Query exceeded timeout limit. Try a simpler query or increase timeout.".into()),
            3114 => Some("Connection to database lost. Check network connectivity.".into()),
            _ => None,
        };
        Self { code, message, hint }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self {
            code: 0,
            message: message.into(),
            hint: None,
        }
    }
}

impl std::fmt::Display for OracleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "ORA-{:05}: {}", self.code, self.message)
    }
}

impl std::error::Error for OracleError {}

#[cfg(feature = "oracle")]
impl From<oracle::Error> for OracleError {
    fn from(e: oracle::Error) -> Self {
        let code = e.db_error().map(|o| o.code()).unwrap_or(0);
        OracleError::new(code, e.to_string())
    }
}

// For Tauri command returns
impl From<OracleError> for String {
    fn from(e: OracleError) -> String {
        serde_json::to_string(&e).unwrap_or_else(|_| e.message)
    }
}

// ============================================================================
// Data Types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub name: String,
    pub connect_string: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ColumnInfo {
    pub column_id: i32,
    pub column_name: String,
    #[serde(rename = "name")]
    pub name: String, // Alias for column_name (for frontend compatibility)
    pub data_type: String,
    pub data_length: Option<i32>,
    pub data_precision: Option<i32>,
    pub data_scale: Option<i32>,
    pub nullable: bool,
    pub data_default: Option<String>,
    pub is_pk: bool, // Indicates if this column is part of the primary key
}

#[derive(Debug, Clone, Serialize)]
pub struct TableMetadata {
    pub columns: Vec<ColumnInfo>,
    pub primary_key: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompareRequest {
    pub env1_connection_name: String,
    pub env1_config: ConnectionConfig,
    pub env2_connection_name: String,
    pub env2_config: ConnectionConfig,
    pub owner: String,
    pub table_name: String,
    pub primary_key: Vec<String>,
    pub fields: Vec<String>,
    pub where_clause: Option<String>,
    pub max_rows: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawSqlRequest {
    pub env1_connection_name: String,
    pub env1_config: ConnectionConfig,
    pub env2_connection_name: String,
    pub env2_config: ConnectionConfig,
    pub sql: String,
    pub primary_key: Option<String>,
    pub max_rows: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompareSummary {
    pub total: usize,
    pub matches: usize,
    pub differs: usize,
    pub only_in_env1: usize,
    pub only_in_env2: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompareRow {
    pub status: String, // "match", "differ", "only_in_env1", "only_in_env2"
    pub key: HashMap<String, serde_json::Value>,
    pub env1_data: Option<HashMap<String, serde_json::Value>>,
    pub env2_data: Option<HashMap<String, serde_json::Value>>,
    pub differences: Option<Vec<String>>, // Field names that differ
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompareResult {
    pub env1_name: String,
    pub env2_name: String,
    pub table: String,
    pub summary: CompareSummary,
    pub rows: Vec<CompareRow>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExportData {
    pub filename: String,
    pub content: String,
    pub format: String,
}

// ============================================================================
// Unified Fetch Data Types (for mixed source comparison)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchDataRequest {
    pub connection_name: String,
    pub config: ConnectionConfig,
    pub mode: String,              // "table" or "raw-sql"
    // Table mode fields
    pub owner: Option<String>,
    pub table_name: Option<String>,
    pub where_clause: Option<String>,
    pub fields: Option<Vec<String>>,
    // Raw SQL mode fields
    pub sql: Option<String>,
    pub max_rows: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FetchDataResult {
    pub headers: Vec<String>,
    pub rows: Vec<HashMap<String, serde_json::Value>>,
    pub row_count: usize,
    pub source_name: String,
}

// ============================================================================
// Oracle Client State (OnceLock for lazy initialization)
// ============================================================================

#[cfg(feature = "oracle")]
static ORACLE_INITIALIZED: OnceLock<bool> = OnceLock::new();

/// Path where Oracle Instant Client is bundled within the app
const BUNDLED_IC_SUBPATH: &str = "Frameworks/instantclient";

/// Sets up the Oracle Instant Client library path for the bundled IC.
/// This must be called at app startup, before any Oracle operations.
///
/// On macOS, this sets DYLD_LIBRARY_PATH to point to the bundled IC location.
///
/// Returns Ok(true) if bundled IC was found and configured,
/// Ok(false) if IC was not bundled (development mode - uses system IC),
/// Err if there was an error determining paths.
pub fn setup_oracle_library_path() -> Result<bool, String> {
    let exe_path = std::env::current_exe()
        .map_err(|e| format!("Failed to get executable path: {}", e))?;

    // Navigate from MacOS/binary -> Contents -> Frameworks/instantclient
    let ic_path = exe_path
        .parent()  // MacOS/
        .and_then(|p| p.parent())  // Contents/
        .map(|p| p.join(BUNDLED_IC_SUBPATH));

    if let Some(path) = ic_path {
        if path.exists() && path.join("libclntsh.dylib").exists() {
            // Bundled IC found - set environment variable
            std::env::set_var("DYLD_LIBRARY_PATH", &path);
            log::info!("Oracle Instant Client configured from bundle: {:?}", path);
            return Ok(true);
        }
    }

    // No bundled IC found - rely on system installation (development mode)
    log::info!("No bundled Oracle IC found, using system installation");
    Ok(false)
}

/// Get the path to the bundled Oracle Instant Client, if it exists.
pub fn get_bundled_ic_path() -> Option<std::path::PathBuf> {
    let exe_path = std::env::current_exe().ok()?;
    let ic_path = exe_path
        .parent()?  // MacOS/
        .parent()?  // Contents/
        .join(BUNDLED_IC_SUBPATH);

    if ic_path.exists() && ic_path.join("libclntsh.dylib").exists() {
        Some(ic_path)
    } else {
        None
    }
}

/// Check if Oracle client library can be loaded
#[cfg(feature = "oracle")]
pub fn check_oracle_available() -> Result<bool, OracleError> {
    // Check if DYLD_LIBRARY_PATH is set (bundled or system)
    // The oracle crate will fail at connection time if libs aren't found
    Ok(true)
}

#[cfg(not(feature = "oracle"))]
pub fn check_oracle_available() -> Result<bool, OracleError> {
    Err(OracleError::internal("Oracle support not compiled. Rebuild with --features oracle"))
}

/// Prime/initialize the Oracle client
#[cfg(feature = "oracle")]
fn init_oracle_client() -> Result<(), OracleError> {
    let _ = ORACLE_INITIALIZED.get_or_init(|| true);
    Ok(())
}

#[cfg(not(feature = "oracle"))]
fn init_oracle_client() -> Result<(), OracleError> {
    Err(OracleError::internal("Oracle support not compiled. Rebuild with --features oracle"))
}

// ============================================================================
// Connection Pool Management
// ============================================================================

/// Maximum number of pooled connections
#[cfg(feature = "oracle")]
const MAX_CONNECTIONS: usize = 4;

/// Idle timeout before connection is closed (5 minutes)
#[cfg(feature = "oracle")]
const IDLE_TIMEOUT_SECS: u64 = 300;

/// Query timeout to prevent hung connections (5 minutes)
#[cfg(feature = "oracle")]
const QUERY_TIMEOUT_SECS: u64 = 300;

/// Tracks a pooled connection with metadata
#[cfg(feature = "oracle")]
struct PooledConnection {
    connection: Connection,
    connect_string: String,
    username: String,
    last_used: Instant,
}

/// Connection pool state
#[cfg(feature = "oracle")]
struct ConnectionPool {
    connections: Vec<PooledConnection>,
}

#[cfg(feature = "oracle")]
impl ConnectionPool {
    fn new() -> Self {
        Self { connections: Vec::new() }
    }

    /// Get or create a connection. Reuses existing connection if available.
    fn get_connection(
        &mut self,
        connect_string: &str,
        username: &str,
        password: &str,
    ) -> Result<&Connection, OracleError> {
        // Clean up idle connections first
        self.cleanup_idle();

        // Look for existing connection with same credentials
        let idx = self.connections.iter().position(|pc| {
            pc.connect_string == connect_string && pc.username == username
        });

        if let Some(idx) = idx {
            // Update last used time and return existing connection
            self.connections[idx].last_used = Instant::now();

            // Check if connection is still valid
            if self.connections[idx].connection.ping().is_ok() {
                return Ok(&self.connections[idx].connection);
            }

            // Connection is dead, remove it
            self.connections.remove(idx);
        }

        // Check if we're at capacity
        if self.connections.len() >= MAX_CONNECTIONS {
            // Remove oldest connection
            if let Some(oldest_idx) = self.connections
                .iter()
                .enumerate()
                .min_by_key(|(_, pc)| pc.last_used)
                .map(|(i, _)| i)
            {
                self.connections.remove(oldest_idx);
            }
        }

        // Create new connection with query timeout
        let conn = Connection::connect(username, password, connect_string)
            .map_err(OracleError::from)?;
        conn.set_call_timeout(Some(Duration::from_secs(QUERY_TIMEOUT_SECS)))
            .map_err(OracleError::from)?;

        self.connections.push(PooledConnection {
            connection: conn,
            connect_string: connect_string.to_string(),
            username: username.to_string(),
            last_used: Instant::now(),
        });

        Ok(&self.connections.last().unwrap().connection)
    }

    /// Remove connections that have been idle too long
    fn cleanup_idle(&mut self) {
        let timeout = Duration::from_secs(IDLE_TIMEOUT_SECS);
        self.connections.retain(|pc| pc.last_used.elapsed() < timeout);
    }

    /// Get information about active connections for UI
    fn get_status(&self) -> Vec<ConnectionStatus> {
        self.connections
            .iter()
            .map(|pc| ConnectionStatus {
                connect_string: pc.connect_string.clone(),
                username: pc.username.clone(),
                idle_seconds: pc.last_used.elapsed().as_secs(),
                is_alive: pc.connection.ping().is_ok(),
            })
            .collect()
    }

    /// Close all connections
    fn close_all(&mut self) {
        self.connections.clear();
    }

    /// Close a specific connection
    fn close_connection(&mut self, connect_string: &str, username: &str) -> bool {
        if let Some(idx) = self.connections.iter().position(|pc| {
            pc.connect_string == connect_string && pc.username == username
        }) {
            self.connections.remove(idx);
            true
        } else {
            false
        }
    }
}

/// Connection status for UI display
#[derive(Debug, Clone, Serialize)]
pub struct ConnectionStatus {
    pub connect_string: String,
    pub username: String,
    pub idle_seconds: u64,
    pub is_alive: bool,
}

/// Global connection pool
#[cfg(feature = "oracle")]
static CONNECTION_POOL: OnceLock<Mutex<ConnectionPool>> = OnceLock::new();

#[cfg(feature = "oracle")]
fn get_pool() -> &'static Mutex<ConnectionPool> {
    CONNECTION_POOL.get_or_init(|| Mutex::new(ConnectionPool::new()))
}

/// Execute a function with a pooled connection
/// This handles connection lifecycle: get/create, execute, and keeps connection alive
#[cfg(feature = "oracle")]
pub fn with_pooled_connection<T, F>(
    connect_string: &str,
    username: &str,
    password: &str,
    f: F,
) -> Result<T, OracleError>
where
    F: FnOnce(&Connection) -> Result<T, OracleError>,
{
    let pool = get_pool();
    let mut guard = pool.lock().map_err(|_| OracleError::internal("Connection pool lock poisoned"))?;
    let conn = guard.get_connection(connect_string, username, password)?;
    f(conn)
}

/// Get connection pool status for UI
#[cfg(feature = "oracle")]
pub fn get_connection_pool_status() -> Vec<ConnectionStatus> {
    let pool = get_pool();
    if let Ok(guard) = pool.lock() {
        guard.get_status()
    } else {
        Vec::new()
    }
}

/// Close all pooled connections
#[cfg(feature = "oracle")]
pub fn close_all_pool_connections() {
    let pool = get_pool();
    if let Ok(mut guard) = pool.lock() {
        guard.close_all();
    }
}

/// Close a specific pooled connection
#[cfg(feature = "oracle")]
pub fn close_pool_connection(connect_string: &str, username: &str) -> bool {
    let pool = get_pool();
    if let Ok(mut guard) = pool.lock() {
        guard.close_connection(connect_string, username)
    } else {
        false
    }
}

/// Create a one-off connection (for testing, not pooled)
#[cfg(feature = "oracle")]
pub fn create_connection(connect_string: &str, username: &str, password: &str) -> Result<Connection, OracleError> {
    let conn = Connection::connect(username, password, connect_string)
        .map_err(OracleError::from)?;
    conn.set_call_timeout(Some(Duration::from_secs(QUERY_TIMEOUT_SECS)))
        .map_err(OracleError::from)?;
    Ok(conn)
}

#[cfg(not(feature = "oracle"))]
pub fn create_connection(_connect_string: &str, _username: &str, _password: &str) -> Result<(), OracleError> {
    Err(OracleError::internal("Oracle support not compiled"))
}

// ============================================================================
// Credential Management (Keychain) - Single Entry JSON Storage
// ============================================================================
//
// All Oracle credentials are stored in a SINGLE keychain entry as JSON.
// This minimizes macOS keychain permission prompts - user only needs to
// approve access once instead of once per environment.
//
// Structure: { "envName": { "username": "...", "password": "..." }, ... }

const CREDENTIALS_ACCOUNT: &str = "oracle-credentials";

/// In-memory cache of credentials to minimize keychain reads
static CREDENTIALS_CACHE: OnceLock<Mutex<Option<HashMap<String, CredentialEntry>>>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CredentialEntry {
    username: String,
    password: String,
}

fn get_cache() -> &'static Mutex<Option<HashMap<String, CredentialEntry>>> {
    CREDENTIALS_CACHE.get_or_init(|| Mutex::new(None))
}

/// Load all credentials from keychain into cache (single keychain read)
fn load_credentials_from_keychain() -> Result<HashMap<String, CredentialEntry>, String> {
    let entry = Entry::new(ORACLE_KEYCHAIN_SERVICE, CREDENTIALS_ACCOUNT)
        .map_err(|e| format!("Failed to access keychain: {}", e))?;

    match entry.get_password() {
        Ok(json_str) => {
            serde_json::from_str(&json_str)
                .map_err(|e| format!("Failed to parse credentials: {}", e))
        }
        Err(keyring::Error::NoEntry) => {
            // No credentials stored yet - return empty map
            Ok(HashMap::new())
        }
        Err(e) => Err(format!("Failed to read keychain: {}", e)),
    }
}

/// Save all credentials to keychain (single keychain write)
fn save_credentials_to_keychain(creds: &HashMap<String, CredentialEntry>) -> Result<(), String> {
    let entry = Entry::new(ORACLE_KEYCHAIN_SERVICE, CREDENTIALS_ACCOUNT)
        .map_err(|e| format!("Failed to access keychain: {}", e))?;

    let json_str = serde_json::to_string(creds)
        .map_err(|e| format!("Failed to serialize credentials: {}", e))?;

    entry.set_password(&json_str)
        .map_err(|e| format!("Failed to save to keychain: {}", e))
}

/// Get credentials map, loading from keychain if not cached
fn get_credentials_map() -> Result<HashMap<String, CredentialEntry>, String> {
    let cache = get_cache();
    let mut guard = cache.lock().map_err(|e| format!("Lock error: {}", e))?;

    if guard.is_none() {
        *guard = Some(load_credentials_from_keychain()?);
    }

    Ok(guard.as_ref().unwrap().clone())
}

/// Update credentials map and persist to keychain
fn update_credentials_map<F>(updater: F) -> Result<(), String>
where
    F: FnOnce(&mut HashMap<String, CredentialEntry>),
{
    let cache = get_cache();
    let mut guard = cache.lock().map_err(|e| format!("Lock error: {}", e))?;

    // Load from keychain if not cached
    if guard.is_none() {
        *guard = Some(load_credentials_from_keychain()?);
    }

    // Apply the update
    let creds = guard.as_mut().unwrap();
    updater(creds);

    // Persist to keychain
    save_credentials_to_keychain(creds)
}

pub fn set_credentials(name: &str, username: &str, password: &str) -> Result<(), String> {
    update_credentials_map(|creds| {
        creds.insert(name.to_string(), CredentialEntry {
            username: username.to_string(),
            password: password.to_string(),
        });
    })
}

pub fn get_credentials(name: &str) -> Result<(String, String), String> {
    let creds = get_credentials_map()?;

    creds.get(name)
        .map(|entry| (entry.username.clone(), entry.password.clone()))
        .ok_or_else(|| format!("Credentials not found for '{}'", name))
}

pub fn delete_credentials(name: &str) -> Result<(), String> {
    update_credentials_map(|creds| {
        creds.remove(name);
    })
}

pub fn has_credentials(name: &str) -> Result<bool, String> {
    let creds = get_credentials_map()?;
    Ok(creds.contains_key(name))
}

// ============================================================================
// Identifier Validation (SQL Injection Prevention)
// ============================================================================

pub fn validate_identifier(s: &str) -> Result<String, OracleError> {
    if s.is_empty() {
        return Err(OracleError::internal("Identifier cannot be empty"));
    }
    if s.len() > 128 {
        return Err(OracleError::internal("Identifier too long (max 128 chars)"));
    }

    let first_char = s.chars().next().unwrap();
    if !first_char.is_ascii_alphabetic() && first_char != '_' {
        return Err(OracleError::internal(format!(
            "Invalid identifier '{}': must start with a letter",
            s
        )));
    }

    let valid = s
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$' || c == '#');

    if !valid {
        return Err(OracleError::internal(format!(
            "Invalid identifier '{}': contains invalid characters",
            s
        )));
    }

    Ok(s.to_uppercase())
}

// ============================================================================
// Database Queries (with oracle feature)
// ============================================================================

#[cfg(feature = "oracle")]
fn query_schemas(conn: &Connection) -> Result<Vec<String>, OracleError> {
    let sql = "SELECT DISTINCT OWNER FROM ALL_TABLES ORDER BY OWNER";
    let mut schemas = Vec::new();
    let rows = conn.query(sql, &[])?;
    for row_result in rows {
        let row = row_result?;
        let owner: String = row.get(0)?;
        schemas.push(owner);
    }
    Ok(schemas)
}

#[cfg(feature = "oracle")]
fn query_tables(conn: &Connection, owner: &str) -> Result<Vec<String>, OracleError> {
    let sql = "SELECT TABLE_NAME FROM ALL_TABLES WHERE OWNER = :1 ORDER BY TABLE_NAME";
    let mut tables = Vec::new();
    let rows = conn.query(sql, &[&owner.to_uppercase()])?;
    for row_result in rows {
        let row = row_result?;
        let table_name: String = row.get(0)?;
        tables.push(table_name);
    }
    Ok(tables)
}

#[cfg(feature = "oracle")]
fn query_table_metadata(conn: &Connection, owner: &str, table_name: &str) -> Result<TableMetadata, OracleError> {
    let owner = validate_identifier(owner)?;
    let table = validate_identifier(table_name)?;

    // Fetch primary key columns FIRST (needed to populate is_pk field)
    let pk_sql = r#"
        SELECT cc.COLUMN_NAME
        FROM ALL_CONSTRAINTS cons
        JOIN ALL_CONS_COLUMNS cc ON cons.OWNER = cc.OWNER
            AND cons.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
        WHERE cons.OWNER = :1 AND cons.TABLE_NAME = :2
            AND cons.CONSTRAINT_TYPE = 'P'
        ORDER BY cc.POSITION
    "#;

    let mut primary_key = Vec::new();
    let pk_rows = conn.query(pk_sql, &[&owner, &table])?;
    for row_result in pk_rows {
        let row = row_result?;
        let col_name: String = row.get(0)?;
        primary_key.push(col_name);
    }

    // Fetch columns
    let columns_sql = r#"
        SELECT COLUMN_ID, COLUMN_NAME, DATA_TYPE, DATA_LENGTH,
               DATA_PRECISION, DATA_SCALE, NULLABLE, DATA_DEFAULT
        FROM ALL_TAB_COLUMNS
        WHERE OWNER = :1 AND TABLE_NAME = :2
        ORDER BY COLUMN_ID
    "#;

    let mut columns = Vec::new();
    let rows = conn.query(columns_sql, &[&owner, &table])?;
    for row_result in rows {
        let row = row_result?;
        let col_name: String = row.get(1)?;
        let is_pk = primary_key.contains(&col_name);
        columns.push(ColumnInfo {
            column_id: row.get::<_, Option<i32>>(0)?.unwrap_or(0),
            column_name: col_name.clone(),
            name: col_name, // Frontend expects 'name' field
            data_type: row.get(2)?,
            data_length: row.get(3)?,
            data_precision: row.get(4)?,
            data_scale: row.get(5)?,
            nullable: row.get::<_, String>(6)? == "Y",
            data_default: row.get(7)?,
            is_pk, // Indicates if column is part of primary key
        });
    }

    Ok(TableMetadata { columns, primary_key })
}

/// Maximum size for CLOB/text data (1MB)
#[cfg(feature = "oracle")]
const MAX_LOB_SIZE_BYTES: usize = 1_048_576;

#[cfg(feature = "oracle")]
pub fn execute_select(
    conn: &Connection,
    sql: &str,
    max_rows: Option<u32>,
) -> Result<Vec<HashMap<String, serde_json::Value>>, OracleError> {
    let limit = max_rows.unwrap_or(10000);
    let limited_sql = format!("SELECT * FROM ({}) WHERE ROWNUM <= {}", sql, limit);

    let mut results = Vec::new();
    let rows = conn.query(&limited_sql, &[])?;

    // Get column info including types
    let col_info = rows.column_info();
    let columns: Vec<(String, OracleType)> = col_info
        .iter()
        .map(|c| (c.name().to_string(), c.oracle_type().clone()))
        .collect();

    for row_result in rows {
        let row = row_result?;
        let mut record = HashMap::new();
        for (i, (col_name, col_type)) in columns.iter().enumerate() {
            let value = row_to_json_value(&row, i, col_type)?;
            record.insert(col_name.clone(), value);
        }
        results.push(record);
    }

    Ok(results)
}

#[cfg(feature = "oracle")]
fn row_to_json_value(
    row: &oracle::Row,
    idx: usize,
    col_type: &OracleType,
) -> Result<serde_json::Value, OracleError> {

    match col_type {
        // BLOB: Show placeholder with size
        OracleType::BLOB => {
            match row.get::<_, Option<Vec<u8>>>(idx) {
                Ok(Some(bytes)) => {
                    Ok(serde_json::Value::String(format!("[BLOB: {} bytes]", bytes.len())))
                }
                Ok(None) => Ok(serde_json::Value::Null),
                Err(_) => Ok(serde_json::Value::String("[BLOB: unable to read]".to_string())),
            }
        }

        // RAW/LONG RAW: Also show placeholder
        OracleType::Raw(_) | OracleType::LongRaw => {
            match row.get::<_, Option<Vec<u8>>>(idx) {
                Ok(Some(bytes)) => {
                    Ok(serde_json::Value::String(format!("[RAW: {} bytes]", bytes.len())))
                }
                Ok(None) => Ok(serde_json::Value::Null),
                Err(_) => Ok(serde_json::Value::String("[RAW: unable to read]".to_string())),
            }
        }

        // CLOB/NCLOB: Return as string, truncate if > 1MB
        OracleType::CLOB | OracleType::NCLOB => {
            match row.get::<_, Option<String>>(idx) {
                Ok(Some(s)) => {
                    if s.len() > MAX_LOB_SIZE_BYTES {
                        // Truncate at 1MB and add indicator
                        let truncated = format!(
                            "{}... [truncated, total {} bytes]",
                            &s[..MAX_LOB_SIZE_BYTES],
                            s.len()
                        );
                        Ok(serde_json::Value::String(truncated))
                    } else {
                        Ok(serde_json::Value::String(s))
                    }
                }
                Ok(None) => Ok(serde_json::Value::Null),
                Err(_) => Ok(serde_json::Value::String("[CLOB: unable to read]".to_string())),
            }
        }

        // BFILE: External file reference, show placeholder
        OracleType::BFILE => {
            Ok(serde_json::Value::String("[BFILE: external file]".to_string()))
        }

        // All other types: use default handling
        _ => row_to_json_value_default(row, idx),
    }
}

/// Default value extraction for non-LOB types
#[cfg(feature = "oracle")]
fn row_to_json_value_default(row: &oracle::Row, idx: usize) -> Result<serde_json::Value, OracleError> {
    // Try to get as different types
    if let Ok(v) = row.get::<_, Option<String>>(idx) {
        return Ok(v.map(serde_json::Value::String).unwrap_or(serde_json::Value::Null));
    }
    if let Ok(v) = row.get::<_, Option<i64>>(idx) {
        return Ok(v.map(|n| serde_json::Value::Number(n.into())).unwrap_or(serde_json::Value::Null));
    }
    if let Ok(v) = row.get::<_, Option<f64>>(idx) {
        return Ok(v.and_then(|n| serde_json::Number::from_f64(n).map(serde_json::Value::Number)).unwrap_or(serde_json::Value::Null));
    }
    // Fallback: try as string
    match row.get::<_, Option<String>>(idx) {
        Ok(v) => Ok(v.map(serde_json::Value::String).unwrap_or(serde_json::Value::Null)),
        Err(_) => Ok(serde_json::Value::Null),
    }
}

// ============================================================================
// Comparison Logic
// ============================================================================

#[cfg(feature = "oracle")]
pub fn compare_data(
    env1_data: Vec<HashMap<String, serde_json::Value>>,
    env2_data: Vec<HashMap<String, serde_json::Value>>,
    primary_key: &[String],
    env1_name: &str,
    env2_name: &str,
    table: &str,
) -> CompareResult {
    use std::collections::HashSet;

    // Build lookup maps by primary key
    // Note: Oracle returns column names in uppercase, but user may specify lowercase
    // So we do case-insensitive matching by looking up with uppercase key
    let build_key = |row: &HashMap<String, serde_json::Value>| -> String {
        primary_key
            .iter()
            .map(|k| {
                // Try exact match first, then uppercase
                row.get(k)
                    .or_else(|| row.get(&k.to_uppercase()))
                    .map(|v| v.to_string())
                    .unwrap_or_default()
            })
            .collect::<Vec<_>>()
            .join("|")
    };

    let env1_map: HashMap<String, &HashMap<String, serde_json::Value>> =
        env1_data.iter().map(|r| (build_key(r), r)).collect();
    let env2_map: HashMap<String, &HashMap<String, serde_json::Value>> =
        env2_data.iter().map(|r| (build_key(r), r)).collect();

    let all_keys: HashSet<String> = env1_map.keys().chain(env2_map.keys()).cloned().collect();

    let mut rows = Vec::new();
    let mut matches = 0;
    let mut differs = 0;
    let mut only_in_env1 = 0;
    let mut only_in_env2 = 0;

    for key_str in all_keys {
        let env1_row = env1_map.get(&key_str);
        let env2_row = env2_map.get(&key_str);

        // Build key map for output (case-insensitive lookup)
        let key: HashMap<String, serde_json::Value> = primary_key
            .iter()
            .map(|k| {
                let v = env1_row
                    .or(env2_row)
                    .and_then(|r| r.get(k).or_else(|| r.get(&k.to_uppercase())))
                    .cloned()
                    .unwrap_or(serde_json::Value::Null);
                (k.clone(), v)
            })
            .collect();

        let (status, differences) = match (env1_row, env2_row) {
            (Some(r1), Some(r2)) => {
                // Compare all fields (exclude primary key fields, case-insensitive)
                let pk_upper: Vec<String> = primary_key.iter().map(|s| s.to_uppercase()).collect();
                let diffs: Vec<String> = r1
                    .keys()
                    .filter(|k| !pk_upper.contains(&k.to_uppercase()))
                    .filter(|k| r1.get(*k) != r2.get(*k))
                    .cloned()
                    .collect();

                if diffs.is_empty() {
                    matches += 1;
                    ("match".to_string(), None)
                } else {
                    differs += 1;
                    ("differ".to_string(), Some(diffs))
                }
            }
            (Some(_), None) => {
                only_in_env1 += 1;
                ("only_in_env1".to_string(), None)
            }
            (None, Some(_)) => {
                only_in_env2 += 1;
                ("only_in_env2".to_string(), None)
            }
            (None, None) => continue,
        };

        rows.push(CompareRow {
            status,
            key,
            env1_data: env1_row.map(|r| (*r).clone()),
            env2_data: env2_row.map(|r| (*r).clone()),
            differences,
        });
    }

    // Sort rows: differs first, then only_in_env1, then only_in_env2, then matches
    rows.sort_by(|a, b| {
        let order = |s: &str| match s {
            "differ" => 0,
            "only_in_env1" => 1,
            "only_in_env2" => 2,
            "match" => 3,
            _ => 4,
        };
        order(&a.status).cmp(&order(&b.status))
    });

    CompareResult {
        env1_name: env1_name.to_string(),
        env2_name: env2_name.to_string(),
        table: table.to_string(),
        summary: CompareSummary {
            total: rows.len(),
            matches,
            differs,
            only_in_env1,
            only_in_env2,
        },
        rows,
    }
}

// ============================================================================
// Export Functions
// ============================================================================

pub fn export_to_json(result: &CompareResult) -> Result<String, OracleError> {
    serde_json::to_string_pretty(result)
        .map_err(|e| OracleError::internal(format!("JSON serialization failed: {}", e)))
}

pub fn export_to_csv(result: &CompareResult) -> Result<String, OracleError> {
    let mut csv = String::new();

    // Header
    csv.push_str("Status,");

    // Get all field names from first row
    let field_names: Vec<String> = result
        .rows
        .first()
        .and_then(|r| r.env1_data.as_ref().or(r.env2_data.as_ref()))
        .map(|data| data.keys().cloned().collect())
        .unwrap_or_default();

    for (i, field) in field_names.iter().enumerate() {
        csv.push_str(&format!("Env1_{},Env2_{}", field, field));
        if i < field_names.len() - 1 {
            csv.push(',');
        }
    }
    csv.push('\n');

    // Data rows
    for row in &result.rows {
        csv.push_str(&row.status);
        csv.push(',');

        for (i, field) in field_names.iter().enumerate() {
            let env1_val = row
                .env1_data
                .as_ref()
                .and_then(|d| d.get(field))
                .map(|v| csv_escape(v))
                .unwrap_or_default();
            let env2_val = row
                .env2_data
                .as_ref()
                .and_then(|d| d.get(field))
                .map(|v| csv_escape(v))
                .unwrap_or_default();

            csv.push_str(&format!("{},{}", env1_val, env2_val));
            if i < field_names.len() - 1 {
                csv.push(',');
            }
        }
        csv.push('\n');
    }

    Ok(csv)
}

fn csv_escape(value: &serde_json::Value) -> String {
    let s = match value {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Null => String::new(),
        v => v.to_string(),
    };

    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s
    }
}

// ============================================================================
// Tauri Commands
// ============================================================================

#[tauri::command]
pub fn check_oracle_client_ready() -> Result<bool, String> {
    check_oracle_available().map_err(|e| e.message)
}

#[tauri::command]
pub fn prime_oracle_client() -> Result<(), String> {
    init_oracle_client().map_err(|e| e.message)
}

#[tauri::command]
pub fn set_oracle_credentials(name: String, username: String, password: String) -> Result<(), String> {
    set_credentials(&name, &username, &password)
}

#[tauri::command]
pub fn get_oracle_credentials(name: String) -> Result<(String, String), String> {
    get_credentials(&name)
}

#[tauri::command]
pub fn delete_oracle_credentials(name: String) -> Result<(), String> {
    delete_credentials(&name)
}

#[tauri::command]
pub fn has_oracle_credentials(name: String) -> Result<bool, String> {
    has_credentials(&name)
}

#[tauri::command]
#[allow(unused_variables)]
pub fn test_oracle_connection(
    config: ConnectionConfig,
    username: String,
    password: String,
) -> Result<String, String> {
    #[cfg(feature = "oracle")]
    {
        let conn = create_connection(&config.connect_string, &username, &password)
            .map_err(|e| e.message)?;
        // Simple query to verify connection
        conn.query_row_as::<String>("SELECT 'OK' FROM DUAL", &[])
            .map_err(|e| OracleError::from(e).message)?;
        Ok("Connection successful".into())
    }
    #[cfg(not(feature = "oracle"))]
    {
        Err("Oracle support not compiled".into())
    }
}

#[tauri::command]
#[allow(unused_variables)]
pub fn fetch_schemas(
    connection_name: String,
    config: ConnectionConfig,
) -> Result<Vec<String>, String> {
    #[cfg(feature = "oracle")]
    {
        let (username, password) = get_credentials(&connection_name)?;
        with_pooled_connection(&config.connect_string, &username, &password, |conn| {
            query_schemas(conn)
        })
        .map_err(|e| e.message)
    }
    #[cfg(not(feature = "oracle"))]
    {
        Err("Oracle support not compiled".into())
    }
}

#[tauri::command]
#[allow(unused_variables)]
pub fn fetch_tables(
    connection_name: String,
    config: ConnectionConfig,
    owner: String,
) -> Result<Vec<String>, String> {
    #[cfg(feature = "oracle")]
    {
        let (username, password) = get_credentials(&connection_name)?;
        with_pooled_connection(&config.connect_string, &username, &password, |conn| {
            query_tables(conn, &owner)
        })
        .map_err(|e| e.message)
    }
    #[cfg(not(feature = "oracle"))]
    {
        Err("Oracle support not compiled".into())
    }
}

#[tauri::command]
#[allow(unused_variables)]
pub fn fetch_table_metadata(
    connection_name: String,
    config: ConnectionConfig,
    owner: String,
    table_name: String,
) -> Result<TableMetadata, String> {
    #[cfg(feature = "oracle")]
    {
        let (username, password) = get_credentials(&connection_name)?;
        with_pooled_connection(&config.connect_string, &username, &password, |conn| {
            query_table_metadata(conn, &owner, &table_name)
        })
        .map_err(|e| e.message)
    }
    #[cfg(not(feature = "oracle"))]
    {
        Err("Oracle support not compiled".into())
    }
}

#[tauri::command]
#[allow(unused_variables)]
pub fn compare_configurations(request: CompareRequest) -> Result<CompareResult, String> {
    #[cfg(feature = "oracle")]
    {
        // Get credentials for both environments
        let (user1, pass1) = get_credentials(&request.env1_connection_name)?;
        let (user2, pass2) = get_credentials(&request.env2_connection_name)?;

        // Validate identifiers
        let owner = validate_identifier(&request.owner).map_err(|e| e.message)?;
        let table = validate_identifier(&request.table_name).map_err(|e| e.message)?;

        // Build SELECT query
        let fields = if request.fields.is_empty() {
            "*".to_string()
        } else {
            request.fields.join(", ")
        };

        let mut sql = format!("SELECT {} FROM \"{}\".\"{}\"", fields, owner, table);
        if let Some(ref where_clause) = request.where_clause {
            if !where_clause.trim().is_empty() {
                sql.push_str(&format!(" WHERE {}", where_clause));
            }
        }

        // Fetch data from env1 (uses pooled connection)
        let max_rows = request.max_rows;
        let sql_clone = sql.clone();
        let env1_data = with_pooled_connection(
            &request.env1_config.connect_string,
            &user1,
            &pass1,
            |conn| execute_select(conn, &sql_clone, max_rows),
        )
        .map_err(|e| format!("Env1 query failed: {}", e.message))?;

        // Fetch data from env2 (uses pooled connection)
        let env2_data = with_pooled_connection(
            &request.env2_config.connect_string,
            &user2,
            &pass2,
            |conn| execute_select(conn, &sql, max_rows),
        )
        .map_err(|e| format!("Env2 query failed: {}", e.message))?;

        // Compare
        let result = compare_data(
            env1_data,
            env2_data,
            &request.primary_key,
            &request.env1_config.name,
            &request.env2_config.name,
            &format!("{}.{}", owner, table),
        );

        Ok(result)
    }
    #[cfg(not(feature = "oracle"))]
    {
        Err("Oracle support not compiled".into())
    }
}

#[tauri::command]
#[allow(unused_variables)]
pub fn compare_raw_sql(request: RawSqlRequest) -> Result<CompareResult, String> {
    #[cfg(feature = "oracle")]
    {
        // Get credentials for both environments
        let (user1, pass1) = get_credentials(&request.env1_connection_name)?;
        let (user2, pass2) = get_credentials(&request.env2_connection_name)?;

        // Fetch data from env1 (uses pooled connection)
        let max_rows = request.max_rows;
        let sql = request.sql.clone();
        let env1_data = with_pooled_connection(
            &request.env1_config.connect_string,
            &user1,
            &pass1,
            |conn| execute_select(conn, &sql, max_rows),
        )
        .map_err(|e| format!("Env1 query failed: {}", e.message))?;

        // Fetch data from env2 (uses pooled connection)
        let env2_data = with_pooled_connection(
            &request.env2_config.connect_string,
            &user2,
            &pass2,
            |conn| execute_select(conn, &request.sql, max_rows),
        )
        .map_err(|e| format!("Env2 query failed: {}", e.message))?;

        // Determine primary key
        let primary_key: Vec<String> = if let Some(pk) = &request.primary_key {
            pk.split(',').map(|s| s.trim().to_string()).collect()
        } else {
            // Use first column as primary key
            env1_data
                .first()
                .map(|row| row.keys().next().cloned().unwrap_or_default())
                .map(|k| vec![k])
                .unwrap_or_default()
        };

        // Compare
        let result = compare_data(
            env1_data,
            env2_data,
            &primary_key,
            &request.env1_config.name,
            &request.env2_config.name,
            "Raw SQL Query",
        );

        Ok(result)
    }
    #[cfg(not(feature = "oracle"))]
    {
        Err("Oracle support not compiled".into())
    }
}

#[tauri::command]
pub fn export_comparison_result(
    result: CompareResult,
    format: String,
) -> Result<ExportData, String> {
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let safe_table = result.table.replace('.', "_").replace(' ', "_");
    let filename = format!("comparison_{}_{}.{}", safe_table, timestamp, format);

    let content = match format.as_str() {
        "json" => export_to_json(&result).map_err(|e| e.message)?,
        "csv" => export_to_csv(&result).map_err(|e| e.message)?,
        _ => return Err("Invalid format. Use 'json' or 'csv'.".into()),
    };

    Ok(ExportData {
        filename,
        content,
        format,
    })
}

// ============================================================================
// Connection Pool Management Commands
// ============================================================================

/// Get status of all active connections in the pool
#[tauri::command]
pub fn get_active_connections() -> Vec<ConnectionStatus> {
    #[cfg(feature = "oracle")]
    {
        get_connection_pool_status()
    }
    #[cfg(not(feature = "oracle"))]
    {
        Vec::new()
    }
}

/// Close all connections in the pool
#[tauri::command]
pub fn close_all_connections() -> bool {
    #[cfg(feature = "oracle")]
    {
        close_all_pool_connections();
        true
    }
    #[cfg(not(feature = "oracle"))]
    {
        false
    }
}

/// Close a specific connection in the pool
#[tauri::command]
#[allow(unused_variables)]
pub fn close_connection(connect_string: String, username: String) -> bool {
    #[cfg(feature = "oracle")]
    {
        close_pool_connection(&connect_string, &username)
    }
    #[cfg(not(feature = "oracle"))]
    {
        false
    }
}

/// Fetch Oracle data for unified comparison (data-only, no comparison)
/// This command fetches data from a single Oracle source and returns it
/// in a normalized format suitable for frontend comparison with other sources.
#[tauri::command]
#[allow(unused_variables)]
pub fn fetch_oracle_data(request: FetchDataRequest) -> Result<FetchDataResult, String> {
    #[cfg(feature = "oracle")]
    {
        // Get credentials
        let (username, password) = get_credentials(&request.connection_name)?;

        // Build SQL based on mode
        let (sql, source_name) = match request.mode.as_str() {
            "table" => {
                let owner = request.owner
                    .as_ref()
                    .ok_or("Owner is required for table mode")?;
                let table_name = request.table_name
                    .as_ref()
                    .ok_or("Table name is required for table mode")?;

                // Validate identifiers
                let owner = validate_identifier(owner).map_err(|e| e.message)?;
                let table = validate_identifier(table_name).map_err(|e| e.message)?;

                // Build SELECT query
                let fields = if let Some(ref f) = request.fields {
                    if f.is_empty() { "*".to_string() } else { f.join(", ") }
                } else {
                    "*".to_string()
                };

                let mut sql = format!("SELECT {} FROM \"{}\".\"{}\"", fields, owner, table);
                if let Some(ref where_clause) = request.where_clause {
                    if !where_clause.trim().is_empty() {
                        sql.push_str(&format!(" WHERE {}", where_clause));
                    }
                }

                (sql, format!("{}.{}", owner, table))
            }
            "raw-sql" => {
                let sql = request.sql
                    .as_ref()
                    .ok_or("SQL query is required for raw-sql mode")?
                    .clone();
                (sql, "Raw SQL Query".to_string())
            }
            _ => return Err(format!("Invalid mode: {}. Use 'table' or 'raw-sql'", request.mode)),
        };

        // Execute query using pooled connection
        let max_rows = request.max_rows;
        let rows = with_pooled_connection(
            &request.config.connect_string,
            &username,
            &password,
            |conn| execute_select(conn, &sql, max_rows),
        )
        .map_err(|e| format!("Query failed: {}", e.message))?;

        // Extract headers from first row
        let headers: Vec<String> = if let Some(first_row) = rows.first() {
            first_row.keys().cloned().collect()
        } else {
            Vec::new()
        };

        let row_count = rows.len();

        Ok(FetchDataResult {
            headers,
            rows,
            row_count,
            source_name,
        })
    }
    #[cfg(not(feature = "oracle"))]
    {
        Err("Oracle support not compiled".into())
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // Timeout Configuration Tests
    // -------------------------------------------------------------------------

    #[test]
    #[cfg(feature = "oracle")]
    fn test_query_timeout_constant_is_5_minutes() {
        assert_eq!(QUERY_TIMEOUT_SECS, 300, "Query timeout should be 5 minutes (300 seconds)");
    }

    #[test]
    #[cfg(feature = "oracle")]
    fn test_idle_timeout_constant_is_5_minutes() {
        assert_eq!(IDLE_TIMEOUT_SECS, 300, "Idle timeout should be 5 minutes (300 seconds)");
    }

    #[test]
    #[cfg(feature = "oracle")]
    fn test_max_connections_is_4() {
        assert_eq!(MAX_CONNECTIONS, 4, "Max connections should be 4");
    }

    #[test]
    #[cfg(feature = "oracle")]
    fn test_max_lob_size_is_1mb() {
        assert_eq!(MAX_LOB_SIZE_BYTES, 1_048_576, "Max LOB size should be 1MB (1,048,576 bytes)");
    }

    // -------------------------------------------------------------------------
    // Error Hint Tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_error_hint_for_timeout() {
        let err = OracleError::new(3136, "Connection timed out");
        assert!(err.hint.is_some(), "Timeout error should have a hint");
        assert!(err.hint.unwrap().contains("timeout"), "Hint should mention timeout");
    }

    #[test]
    fn test_error_hint_for_connection_lost() {
        let err = OracleError::new(3114, "Connection lost");
        assert!(err.hint.is_some(), "Connection lost error should have a hint");
        assert!(err.hint.unwrap().contains("network"), "Hint should mention network");
    }

    #[test]
    fn test_error_hint_for_invalid_credentials() {
        let err = OracleError::new(1017, "Invalid username/password");
        assert!(err.hint.is_some(), "Invalid credentials error should have a hint");
        assert!(err.hint.unwrap().contains("username"), "Hint should mention username");
    }

    #[test]
    fn test_error_hint_for_connection_timeout() {
        let err = OracleError::new(12170, "Connection timed out");
        assert!(err.hint.is_some(), "Connection timeout error should have a hint");
        assert!(err.hint.unwrap().contains("timed out"), "Hint should mention timed out");
    }

    #[test]
    fn test_error_hint_for_invalid_connect_string() {
        let err = OracleError::new(12154, "TNS could not resolve");
        assert!(err.hint.is_some(), "Invalid connect string error should have a hint");
        assert!(err.hint.unwrap().contains("host:port"), "Hint should show format");
    }

    #[test]
    fn test_error_hint_for_no_listener() {
        let err = OracleError::new(12541, "No listener");
        assert!(err.hint.is_some(), "No listener error should have a hint");
        assert!(err.hint.unwrap().contains("listener"), "Hint should mention listener");
    }

    #[test]
    fn test_error_hint_for_table_not_found() {
        let err = OracleError::new(942, "Table or view does not exist");
        assert!(err.hint.is_some(), "Table not found error should have a hint");
        assert!(err.hint.unwrap().contains("Table"), "Hint should mention table");
    }

    #[test]
    fn test_error_hint_for_insufficient_privileges() {
        let err = OracleError::new(1031, "Insufficient privileges");
        assert!(err.hint.is_some(), "Insufficient privileges error should have a hint");
        assert!(err.hint.unwrap().contains("privileges"), "Hint should mention privileges");
    }

    #[test]
    fn test_error_no_hint_for_unknown_code() {
        let err = OracleError::new(99999, "Unknown error");
        assert!(err.hint.is_none(), "Unknown error code should not have a hint");
    }

    #[test]
    fn test_internal_error_has_no_hint() {
        let err = OracleError::internal("Internal error message");
        assert_eq!(err.code, 0, "Internal error should have code 0");
        assert!(err.hint.is_none(), "Internal error should not have a hint");
    }

    #[test]
    fn test_error_display_format() {
        let err = OracleError::new(1017, "Invalid credentials");
        let display = format!("{}", err);
        assert!(display.contains("ORA-01017"), "Display should contain ORA-XXXXX format");
        assert!(display.contains("Invalid credentials"), "Display should contain message");
    }

    // -------------------------------------------------------------------------
    // Identifier Validation Tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_validate_identifier_valid() {
        assert!(validate_identifier("USERS").is_ok());
        assert!(validate_identifier("user_table").is_ok());
        assert!(validate_identifier("TABLE123").is_ok());
        assert!(validate_identifier("MY$TABLE").is_ok());
        assert!(validate_identifier("MY#TABLE").is_ok());
    }

    #[test]
    fn test_validate_identifier_returns_uppercase() {
        let result = validate_identifier("lowercase").unwrap();
        assert_eq!(result, "LOWERCASE", "Identifier should be uppercased");
    }

    #[test]
    fn test_validate_identifier_empty_rejected() {
        let result = validate_identifier("");
        assert!(result.is_err(), "Empty identifier should be rejected");
    }

    #[test]
    fn test_validate_identifier_too_long_rejected() {
        let long_name = "A".repeat(129);
        let result = validate_identifier(&long_name);
        assert!(result.is_err(), "Identifier over 128 chars should be rejected");
    }

    #[test]
    fn test_validate_identifier_128_chars_accepted() {
        let name = "A".repeat(128);
        let result = validate_identifier(&name);
        assert!(result.is_ok(), "Identifier of exactly 128 chars should be accepted");
    }

    #[test]
    fn test_validate_identifier_starts_with_number_rejected() {
        let result = validate_identifier("123TABLE");
        assert!(result.is_err(), "Identifier starting with number should be rejected");
    }

    #[test]
    fn test_validate_identifier_special_chars_rejected() {
        assert!(validate_identifier("TABLE;DROP").is_err(), "Semicolon should be rejected");
        assert!(validate_identifier("TABLE--").is_err(), "Dashes should be rejected");
        assert!(validate_identifier("TABLE'").is_err(), "Single quote should be rejected");
        assert!(validate_identifier("TABLE\"").is_err(), "Double quote should be rejected");
        assert!(validate_identifier("TABLE ").is_err(), "Space should be rejected");
    }

    #[test]
    fn test_validate_identifier_sql_injection_rejected() {
        assert!(validate_identifier("'; DROP TABLE users; --").is_err());
        assert!(validate_identifier("1=1 OR").is_err());
        assert!(validate_identifier("UNION SELECT").is_err());
    }

    // -------------------------------------------------------------------------
    // Export Tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_export_to_json() {
        let result = CompareResult {
            env1_name: "DEV".to_string(),
            env2_name: "UAT".to_string(),
            table: "USERS".to_string(),
            summary: CompareSummary {
                total: 2,
                matches: 1,
                differs: 1,
                only_in_env1: 0,
                only_in_env2: 0,
            },
            rows: vec![],
        };

        let json = export_to_json(&result).unwrap();
        assert!(json.contains("DEV"), "JSON should contain env1_name");
        assert!(json.contains("UAT"), "JSON should contain env2_name");
        assert!(json.contains("USERS"), "JSON should contain table name");
    }

    #[test]
    fn test_export_to_csv() {
        let result = CompareResult {
            env1_name: "DEV".to_string(),
            env2_name: "UAT".to_string(),
            table: "USERS".to_string(),
            summary: CompareSummary {
                total: 0,
                matches: 0,
                differs: 0,
                only_in_env1: 0,
                only_in_env2: 0,
            },
            rows: vec![],
        };

        let csv = export_to_csv(&result).unwrap();
        assert!(csv.contains("Status"), "CSV should contain header");
    }

    // -------------------------------------------------------------------------
    // CSV Escape Tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_csv_escape_plain_string() {
        let value = serde_json::Value::String("hello".to_string());
        let escaped = csv_escape(&value);
        assert_eq!(escaped, "hello");
    }

    #[test]
    fn test_csv_escape_string_with_comma() {
        let value = serde_json::Value::String("hello,world".to_string());
        let escaped = csv_escape(&value);
        assert_eq!(escaped, "\"hello,world\"");
    }

    #[test]
    fn test_csv_escape_string_with_quotes() {
        let value = serde_json::Value::String("say \"hello\"".to_string());
        let escaped = csv_escape(&value);
        assert_eq!(escaped, "\"say \"\"hello\"\"\"");
    }

    #[test]
    fn test_csv_escape_string_with_newline() {
        let value = serde_json::Value::String("line1\nline2".to_string());
        let escaped = csv_escape(&value);
        assert!(escaped.starts_with('"'), "String with newline should be quoted");
    }

    #[test]
    fn test_csv_escape_null() {
        let value = serde_json::Value::Null;
        let escaped = csv_escape(&value);
        assert_eq!(escaped, "");
    }

    #[test]
    fn test_csv_escape_number() {
        let value = serde_json::Value::Number(42.into());
        let escaped = csv_escape(&value);
        assert_eq!(escaped, "42");
    }
}
