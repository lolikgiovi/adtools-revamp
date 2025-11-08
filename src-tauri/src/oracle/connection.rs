/// Oracle database connection management
///
/// This module handles database connections, testing, and metadata operations.
/// Note: Full implementation requires Oracle Instant Client to be installed.

use super::models::{ConnectionConfig, Credentials};
use super::client::{resolve_client_path, is_client_primed};
use oracle::Connection;
use std::sync::{Mutex, OnceLock};

/// Static to store the result of Oracle environment setup
static ORACLE_ENV_SETUP: OnceLock<Mutex<Result<(), String>>> = OnceLock::new();

/// Sets up the Oracle client library environment
///
/// This ensures the Oracle client library path is set in the environment
/// so the oracle crate can find it when creating connections.
fn setup_oracle_env() -> Result<(), String> {
    let setup_result = ORACLE_ENV_SETUP.get_or_init(|| {
        log::info!("Initializing Oracle environment setup...");

        // Check if the client has been primed
        if !is_client_primed() {
            log::error!("Oracle client is not primed");
            return Mutex::new(Err("Oracle Instant Client is not loaded. Please ensure the client is installed and loaded.".to_string()));
        }

        let client_path = resolve_client_path(None);

        if !client_path.exists() {
            log::error!("Oracle client path does not exist: {:?}", client_path);
            return Mutex::new(Err(format!(
                "Oracle Instant Client directory not found at: {}. Please install Oracle Instant Client.",
                client_path.display()
            )));
        }

        // Set the library path in the environment
        // This is needed for the oracle crate to find the library at runtime
        #[cfg(target_os = "macos")]
        {
            std::env::set_var("DYLD_LIBRARY_PATH", client_path.to_string_lossy().to_string());
            log::info!("Set DYLD_LIBRARY_PATH to: {:?}", client_path);
        }

        #[cfg(target_os = "linux")]
        {
            std::env::set_var("LD_LIBRARY_PATH", client_path.to_string_lossy().to_string());
            log::info!("Set LD_LIBRARY_PATH to: {:?}", client_path);
        }

        #[cfg(target_os = "windows")]
        {
            std::env::set_var("PATH", client_path.to_string_lossy().to_string());
            log::info!("Set PATH to: {:?}", client_path);
        }

        Mutex::new(Ok(()))
    });

    // Clone the result from the mutex
    setup_result.lock()
        .map_err(|e| format!("Failed to acquire lock: {}", e))?
        .clone()
}

/// Represents an Oracle database connection
///
/// Phase 2: Full implementation with actual Oracle connectivity
#[derive(Debug)]
pub struct DatabaseConnection {
    conn: Connection,
}

impl DatabaseConnection {
    /// Creates a new database connection
    ///
    /// # Arguments
    /// * `config` - Connection configuration
    /// * `credentials` - User credentials
    ///
    /// # Returns
    /// A new DatabaseConnection instance or error if connection fails
    pub fn new(config: ConnectionConfig, credentials: Credentials) -> Result<Self, String> {
        config.validate()?;
        credentials.validate()?;

        // Ensure Oracle environment is set up
        setup_oracle_env()?;

        let connect_string = config.connection_string();

        // Log current DYLD_LIBRARY_PATH for debugging
        if let Ok(dyld_path) = std::env::var("DYLD_LIBRARY_PATH") {
            log::info!("Current DYLD_LIBRARY_PATH: {}", dyld_path);
        } else {
            log::warn!("DYLD_LIBRARY_PATH is not set in environment");
        }

        log::info!("Attempting to connect to Oracle database: {}", connect_string);

        let conn = Connection::connect(
            &credentials.username,
            &credentials.password,
            &connect_string,
        )
        .map_err(|e| {
            let error_str = e.to_string();

            // Check if this is an Oracle client library not found error
            if error_str.contains("DPI-1047") || error_str.contains("Cannot locate") {
                return "Oracle Instant Client library could not be loaded. Please ensure Oracle Instant Client is installed correctly. Visit the Compare Config page for installation instructions.".to_string();
            }

            // Check if this is a network/connection error
            if error_str.contains("ORA-12170") || error_str.contains("ORA-12541") || error_str.contains("timeout") {
                return format!("Could not connect to database at {}: Network error or database not reachable", connect_string);
            }

            // Check if this is an authentication error
            if error_str.contains("ORA-01017") {
                return format!("Authentication failed for {}: Invalid username or password", connect_string);
            }

            // Check if this is a service name error
            if error_str.contains("ORA-12514") {
                return format!("Service name '{}' not found on the database server", config.service_name);
            }

            // For other errors, provide a more concise message
            format!("Failed to connect to {}: {}", connect_string, error_str)
        })?;

        log::info!("Successfully connected to {}", connect_string);

        Ok(Self { conn })
    }

    /// Tests the database connection
    ///
    /// Attempts to execute a simple query to verify connectivity.
    ///
    /// # Returns
    /// `Ok(())` if connection is successful, error message otherwise
    pub fn test_connection(&self) -> Result<(), String> {
        log::info!("Testing database connection with SELECT 1 FROM dual");

        // Execute query and get first row
        let result = self.conn.query_row("SELECT 1 FROM dual", &[]);

        match result {
            Ok(row) => {
                // Try to extract the value from the first column
                let val: i32 = row
                    .get(0)
                    .map_err(|e| format!("Failed to get value from result: {}", e))?;
                log::info!("Connection test successful, received: {}", val);
                Ok(())
            }
            Err(e) => {
                let error_msg = format!("Connection test failed: {}", e);
                log::error!("{}", error_msg);
                Err(error_msg)
            }
        }
    }

    /// Fetches all schemas from the database
    ///
    /// Returns a list of schema names (owners) that the user has access to,
    /// with system schemas filtered out.
    ///
    /// # Returns
    /// A vector of schema names or an error message
    pub fn fetch_schemas(&self) -> Result<Vec<String>, String> {
        log::info!("Fetching schemas from database");

        let sql = r#"
            SELECT DISTINCT OWNER
            FROM   ALL_TABLES
            WHERE  OWNER NOT IN ('SYS', 'SYSTEM', 'OUTLN', 'DBSNMP', 'APPQOSSYS',
                                 'WMSYS', 'EXFSYS', 'CTXSYS', 'XDB', 'ANONYMOUS',
                                 'ORDSYS', 'ORDDATA', 'MDSYS', 'LBACSYS', 'DVSYS',
                                 'DVF', 'AUDSYS', 'OJVMSYS', 'GSMADMIN_INTERNAL')
            ORDER BY OWNER
        "#;

        let rows = self.conn
            .query(sql, &[])
            .map_err(|e| format!("Failed to fetch schemas: {}", e))?;

        let mut schemas = Vec::new();
        for row_result in rows {
            let row = row_result.map_err(|e| format!("Row error: {}", e))?;
            let schema: String = row.get(0).map_err(|e| format!("Schema error: {}", e))?;
            schemas.push(schema);
        }

        log::info!("Found {} schemas", schemas.len());
        Ok(schemas)
    }

    /// Fetches all tables for a given schema/owner
    ///
    /// # Arguments
    /// * `owner` - Schema/owner name
    ///
    /// # Returns
    /// A vector of table names or an error message
    pub fn fetch_tables(&self, owner: &str) -> Result<Vec<String>, String> {
        log::info!("Fetching tables for schema: {}", owner);

        let sql = r#"
            SELECT TABLE_NAME
            FROM   ALL_TABLES
            WHERE  OWNER = :owner
            ORDER BY TABLE_NAME
        "#;

        let rows = self.conn
            .query(sql, &[&owner])
            .map_err(|e| format!("Failed to fetch tables: {}", e))?;

        let mut tables = Vec::new();
        for row_result in rows {
            let row = row_result.map_err(|e| format!("Row error: {}", e))?;
            let table: String = row.get(0).map_err(|e| format!("Table error: {}", e))?;
            tables.push(table);
        }

        log::info!("Found {} tables in schema {}", tables.len(), owner);
        Ok(tables)
    }

    /// Fetches metadata for a specific table
    ///
    /// Retrieves column information and primary key details from Oracle system views.
    ///
    /// # Arguments
    /// * `owner` - Schema/owner name
    /// * `table_name` - Table name
    ///
    /// # Returns
    /// TableMetadata structure or an error message
    pub fn fetch_table_metadata(
        &self,
        owner: &str,
        table_name: &str,
    ) -> Result<super::models::TableMetadata, String> {
        log::info!("Fetching metadata for table: {}.{}", owner, table_name);

        // Query columns
        let sql_columns = r#"
            SELECT c.COLUMN_NAME,
                   c.DATA_TYPE,
                   c.NULLABLE
            FROM   ALL_TAB_COLUMNS c
            WHERE  c.OWNER = :owner
            AND    c.TABLE_NAME = :table_name
            ORDER BY c.COLUMN_ID
        "#;

        let rows = self.conn
            .query(sql_columns, &[&owner, &table_name])
            .map_err(|e| format!("Failed to fetch columns: {}", e))?;

        let mut columns = Vec::new();
        for row_result in rows {
            let row = row_result.map_err(|e| format!("Row error: {}", e))?;
            columns.push(super::models::ColumnInfo {
                name: row.get(0).map_err(|e| format!("Column name error: {}", e))?,
                data_type: row.get(1).map_err(|e| format!("Data type error: {}", e))?,
                nullable: row.get::<usize, String>(2)
                    .map_err(|e| format!("Nullable error: {}", e))? == "Y",
                is_pk: false,  // Will be updated below
            });
        }

        log::info!("Found {} columns", columns.len());

        // Query primary key
        let sql_pk = r#"
            SELECT cc.COLUMN_NAME
            FROM   ALL_CONSTRAINTS cons
            JOIN   ALL_CONS_COLUMNS cc
              ON   cons.OWNER = cc.OWNER
             AND   cons.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
            WHERE  cons.OWNER = :owner
            AND    cons.TABLE_NAME = :table_name
            AND    cons.CONSTRAINT_TYPE = 'P'
            ORDER BY cc.POSITION
        "#;

        let pk_rows = self.conn
            .query(sql_pk, &[&owner, &table_name])
            .map_err(|e| format!("Failed to fetch primary key: {}", e))?;

        let mut primary_key = Vec::new();
        for row_result in pk_rows {
            let row = row_result.map_err(|e| format!("PK row error: {}", e))?;
            let pk_col: String = row.get(0).map_err(|e| format!("PK column error: {}", e))?;
            primary_key.push(pk_col.clone());

            // Mark column as PK
            if let Some(col) = columns.iter_mut().find(|c| c.name == pk_col) {
                col.is_pk = true;
            }
        }

        log::info!("Primary key columns: {:?}", primary_key);

        Ok(super::models::TableMetadata {
            owner: owner.to_string(),
            table_name: table_name.to_string(),
            columns,
            primary_key,
        })
    }

    /// Fetches records from a table
    ///
    /// Supports optional WHERE clause filtering and field selection.
    /// Returns records as JSON values with proper Oracle type handling.
    pub fn fetch_records(
        &self,
        owner: &str,
        table_name: &str,
        where_clause: Option<&str>,
        fields: &[String],
    ) -> Result<Vec<serde_json::Value>, String> {
        log::info!("Fetching records from {}.{}", owner, table_name);

        // Build field list
        let field_list = if fields.is_empty() {
            "*".to_string()
        } else {
            fields.join(", ")
        };

        // Build SQL query
        let mut sql = format!(
            "SELECT {} FROM {}.{}",
            field_list, owner, table_name
        );

        if let Some(where_sql) = where_clause {
            sql.push_str(" WHERE ");
            sql.push_str(where_sql);
        }

        log::debug!("Executing query: {}", sql);

        // Execute query
        let rows = self
            .conn
            .query(&sql, &[])
            .map_err(|e| format!("Query failed: {}", e))?;

        // Convert rows to JSON
        let mut records = Vec::new();
        for row_result in rows {
            let row = row_result.map_err(|e| format!("Row error: {}", e))?;
            let record = row_to_json(&row)?;
            records.push(record);
        }

        log::info!("Fetched {} records", records.len());
        Ok(records)
    }
}

/// Converts an Oracle row to JSON with proper sanitization
fn row_to_json(row: &oracle::Row) -> Result<serde_json::Value, String> {
    let mut map = serde_json::Map::new();
    let col_info_list = row.column_info();

    for (i, col_info) in col_info_list.iter().enumerate() {
        let col_name = col_info.name().to_string();

        // Sanitize and convert value based on Oracle type
        let value = sanitize_oracle_value(row, i, col_info)?;
        map.insert(col_name, value);
    }

    Ok(serde_json::Value::Object(map))
}

/// Sanitizes Oracle value with proper type handling and security
fn sanitize_oracle_value(
    row: &oracle::Row,
    idx: usize,
    col_info: &oracle::ColumnInfo,
) -> Result<serde_json::Value, String> {
    use oracle::sql_type::OracleType;

    let oracle_type = col_info.oracle_type();

    // Handle NULL values first - check using a safe approach
    let is_null = match row.get::<usize, Option<String>>(idx) {
        Ok(opt) => opt.is_none(),
        Err(_) => {
            // If we can't get as String, try as number to check nullability
            match row.get::<usize, Option<i64>>(idx) {
                Ok(opt) => opt.is_none(),
                Err(_) => false, // If both fail, assume not null and let type handler deal with it
            }
        }
    };

    if is_null {
        return Ok(serde_json::Value::Null);
    }

    match oracle_type {
        // String types: VARCHAR2, CHAR, NVARCHAR2, NCHAR
        OracleType::Varchar2(_) | OracleType::Char(_) | OracleType::NVarchar2(_) | OracleType::NChar(_) => {
            match row.get::<usize, String>(idx) {
                Ok(mut s) => {
                    // Sanitize: remove control characters except newline/tab
                    s = s
                        .chars()
                        .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
                        .collect();

                    // Truncate if too long (safety limit: 10MB)
                    const MAX_STRING_LEN: usize = 10_000_000;
                    if s.len() > MAX_STRING_LEN {
                        s.truncate(MAX_STRING_LEN);
                        s.push_str("... [TRUNCATED]");
                    }

                    Ok(serde_json::Value::String(s))
                }
                Err(_) => Ok(serde_json::Value::Null),
            }
        }

        // Number types: NUMBER, FLOAT, BINARY_FLOAT, BINARY_DOUBLE
        OracleType::Number(_, _) | OracleType::Float(_) | OracleType::BinaryFloat | OracleType::BinaryDouble => {
            // Convert to string to preserve precision (Oracle NUMBER can be very large)
            match row.get::<usize, String>(idx) {
                Ok(s) => Ok(serde_json::Value::String(s)),
                Err(_) => Ok(serde_json::Value::Null),
            }
        }

        // Date/Timestamp types
        OracleType::Date | OracleType::Timestamp(_) | OracleType::TimestampTZ(_) | OracleType::TimestampLTZ(_) => {
            match row.get::<usize, String>(idx) {
                Ok(s) => Ok(serde_json::Value::String(s)),
                Err(_) => Ok(serde_json::Value::Null),
            }
        }

        // CLOB: Character Large Object
        OracleType::CLOB => {
            match row.get::<usize, String>(idx) {
                Ok(mut s) => {
                    // Remove control characters
                    s = s
                        .chars()
                        .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
                        .collect();

                    // Truncate large CLOBs (limit: 1MB for UI performance)
                    const MAX_CLOB_LEN: usize = 1_000_000;
                    if s.len() > MAX_CLOB_LEN {
                        s.truncate(MAX_CLOB_LEN);
                        s.push_str("\n... [CLOB TRUNCATED - too large for comparison]");
                    }

                    Ok(serde_json::Value::String(s))
                }
                Err(_) => Ok(serde_json::Value::Null),
            }
        }

        // BLOB: Binary Large Object (not suitable for text comparison)
        OracleType::BLOB => Ok(serde_json::Value::String(
            "[BLOB - binary data not displayed]".to_string(),
        )),

        // RAW, LONG RAW: Binary data
        OracleType::Raw(_) | OracleType::LongRaw => {
            Ok(serde_json::Value::String("[BINARY DATA]".to_string()))
        }

        // Other types: fallback to string conversion
        _ => match row.get::<usize, String>(idx) {
            Ok(s) => Ok(serde_json::Value::String(s)),
            Err(_) => Ok(serde_json::Value::Null),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_connection_validation() {
        // Test invalid config (empty name)
        let config = ConnectionConfig::new(
            "".to_string(),
            "localhost".to_string(),
            1521,
            "ORCL".to_string(),
        );
        let creds = Credentials::new("user".to_string(), "pass".to_string());

        // Should fail during validation, not during connection
        let result = DatabaseConnection::new(config, creds);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("name cannot be empty"));
    }

    #[test]
    fn test_credentials_validation() {
        let config = ConnectionConfig::new(
            "test".to_string(),
            "localhost".to_string(),
            1521,
            "ORCL".to_string(),
        );

        // Test empty username
        let creds = Credentials::new("".to_string(), "pass".to_string());
        let result = DatabaseConnection::new(config.clone(), creds);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Username cannot be empty"));

        // Test empty password
        let creds = Credentials::new("user".to_string(), "".to_string());
        let result = DatabaseConnection::new(config, creds);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Password cannot be empty"));
    }

    // Note: Actual connection tests require Oracle Instant Client
    // and a running Oracle database. These are integration tests
    // and should be run separately with proper setup.
}
