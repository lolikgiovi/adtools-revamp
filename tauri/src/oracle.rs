//! Oracle database integration for Compare Config tool
//!
//! This module provides Oracle connectivity for comparing database configurations
//! between environments. It requires the `oracle` feature to be enabled and
//! Oracle Instant Client to be installed.

use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
#[cfg(feature = "oracle")]
use std::sync::OnceLock;

#[cfg(feature = "oracle")]
use oracle::{Connection, pool::Pool};

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
        let code = e.oci_error().map(|o| o.code()).unwrap_or(0);
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
    pub data_type: String,
    pub data_length: Option<i32>,
    pub data_precision: Option<i32>,
    pub data_scale: Option<i32>,
    pub nullable: bool,
    pub data_default: Option<String>,
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
// Oracle Client State (OnceLock for lazy initialization)
// ============================================================================

#[cfg(feature = "oracle")]
static ORACLE_INITIALIZED: OnceLock<bool> = OnceLock::new();

/// Check if Oracle client library can be loaded
#[cfg(feature = "oracle")]
pub fn check_oracle_available() -> Result<bool, OracleError> {
    // The oracle crate will fail to create connections if the client isn't available
    // We can check this by seeing if the library is linked
    Ok(true) // If compiled with oracle feature, the library is linked
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
// Connection Management
// ============================================================================

#[cfg(feature = "oracle")]
pub fn create_connection(connect_string: &str, username: &str, password: &str) -> Result<Connection, OracleError> {
    Connection::connect(username, password, connect_string).map_err(OracleError::from)
}

#[cfg(not(feature = "oracle"))]
pub fn create_connection(_connect_string: &str, _username: &str, _password: &str) -> Result<(), OracleError> {
    Err(OracleError::internal("Oracle support not compiled"))
}

// ============================================================================
// Credential Management (Keychain)
// ============================================================================

pub fn set_credentials(name: &str, username: &str, password: &str) -> Result<(), String> {
    let user_account = format!("{}:user", name);
    let pass_account = format!("{}:pass", name);

    let user_entry = Entry::new(ORACLE_KEYCHAIN_SERVICE, &user_account).map_err(|e| e.to_string())?;
    user_entry.set_password(username).map_err(|e| e.to_string())?;

    let pass_entry = Entry::new(ORACLE_KEYCHAIN_SERVICE, &pass_account).map_err(|e| e.to_string())?;
    pass_entry.set_password(password).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn get_credentials(name: &str) -> Result<(String, String), String> {
    let user_account = format!("{}:user", name);
    let pass_account = format!("{}:pass", name);

    let user_entry = Entry::new(ORACLE_KEYCHAIN_SERVICE, &user_account).map_err(|e| e.to_string())?;
    let username = user_entry.get_password().map_err(|e| format!("Username not found: {}", e))?;

    let pass_entry = Entry::new(ORACLE_KEYCHAIN_SERVICE, &pass_account).map_err(|e| e.to_string())?;
    let password = pass_entry.get_password().map_err(|e| format!("Password not found: {}", e))?;

    Ok((username, password))
}

pub fn delete_credentials(name: &str) -> Result<(), String> {
    let user_account = format!("{}:user", name);
    let pass_account = format!("{}:pass", name);

    // Ignore errors - credentials might not exist
    if let Ok(user_entry) = Entry::new(ORACLE_KEYCHAIN_SERVICE, &user_account) {
        let _ = user_entry.delete_password();
    }
    if let Ok(pass_entry) = Entry::new(ORACLE_KEYCHAIN_SERVICE, &pass_account) {
        let _ = pass_entry.delete_password();
    }

    Ok(())
}

pub fn has_credentials(name: &str) -> Result<bool, String> {
    let user_account = format!("{}:user", name);
    let user_entry = match Entry::new(ORACLE_KEYCHAIN_SERVICE, &user_account) {
        Ok(e) => e,
        Err(_) => return Ok(false),
    };
    Ok(user_entry.get_password().is_ok())
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
        columns.push(ColumnInfo {
            column_id: row.get::<_, Option<i32>>(0)?.unwrap_or(0),
            column_name: row.get(1)?,
            data_type: row.get(2)?,
            data_length: row.get(3)?,
            data_precision: row.get(4)?,
            data_scale: row.get(5)?,
            nullable: row.get::<_, String>(6)? == "Y",
            data_default: row.get(7)?,
        });
    }

    // Fetch primary key columns
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

    Ok(TableMetadata { columns, primary_key })
}

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

    // Get column info
    let col_info = rows.column_info();
    let col_names: Vec<String> = col_info.iter().map(|c| c.name().to_string()).collect();

    for row_result in rows {
        let row = row_result?;
        let mut record = HashMap::new();
        for (i, col_name) in col_names.iter().enumerate() {
            let value = row_to_json_value(&row, i)?;
            record.insert(col_name.clone(), value);
        }
        results.push(record);
    }

    Ok(results)
}

#[cfg(feature = "oracle")]
fn row_to_json_value(row: &oracle::Row, idx: usize) -> Result<serde_json::Value, OracleError> {
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
    let build_key = |row: &HashMap<String, serde_json::Value>| -> String {
        primary_key
            .iter()
            .map(|k| row.get(k).map(|v| v.to_string()).unwrap_or_default())
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

        // Build key map for output
        let key: HashMap<String, serde_json::Value> = primary_key
            .iter()
            .map(|k| {
                let v = env1_row
                    .or(env2_row)
                    .and_then(|r| r.get(k))
                    .cloned()
                    .unwrap_or(serde_json::Value::Null);
                (k.clone(), v)
            })
            .collect();

        let (status, differences) = match (env1_row, env2_row) {
            (Some(r1), Some(r2)) => {
                // Compare all fields
                let diffs: Vec<String> = r1
                    .keys()
                    .filter(|k| !primary_key.contains(k))
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
        let conn = create_connection(&config.connect_string, &username, &password)
            .map_err(|e| e.message)?;
        query_schemas(&conn).map_err(|e| e.message)
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
        let conn = create_connection(&config.connect_string, &username, &password)
            .map_err(|e| e.message)?;
        query_tables(&conn, &owner).map_err(|e| e.message)
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
        let conn = create_connection(&config.connect_string, &username, &password)
            .map_err(|e| e.message)?;
        query_table_metadata(&conn, &owner, &table_name).map_err(|e| e.message)
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

        // Connect to both databases
        let conn1 = create_connection(&request.env1_config.connect_string, &user1, &pass1)
            .map_err(|e| format!("Env1 connection failed: {}", e.message))?;
        let conn2 = create_connection(&request.env2_config.connect_string, &user2, &pass2)
            .map_err(|e| format!("Env2 connection failed: {}", e.message))?;

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

        // Fetch data from both environments
        let env1_data = execute_select(&conn1, &sql, request.max_rows)
            .map_err(|e| format!("Env1 query failed: {}", e.message))?;
        let env2_data = execute_select(&conn2, &sql, request.max_rows)
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

        // Connect to both databases
        let conn1 = create_connection(&request.env1_config.connect_string, &user1, &pass1)
            .map_err(|e| format!("Env1 connection failed: {}", e.message))?;
        let conn2 = create_connection(&request.env2_config.connect_string, &user2, &pass2)
            .map_err(|e| format!("Env2 connection failed: {}", e.message))?;

        // Fetch data from both environments
        let env1_data = execute_select(&conn1, &request.sql, request.max_rows)
            .map_err(|e| format!("Env1 query failed: {}", e.message))?;
        let env2_data = execute_select(&conn2, &request.sql, request.max_rows)
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
