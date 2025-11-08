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
    /// NOTE: Placeholder for Phase 4
    pub fn fetch_records(
        &self,
        _owner: &str,
        _table_name: &str,
        _where_clause: Option<&str>,
        _fields: &[String],
    ) -> Result<Vec<serde_json::Value>, String> {
        Err("Not implemented yet - Phase 4".to_string())
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
