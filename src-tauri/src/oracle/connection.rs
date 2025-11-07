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
    /// NOTE: Placeholder for Phase 3
    pub fn fetch_schemas(&self) -> Result<Vec<String>, String> {
        Err("Not implemented yet - Phase 3".to_string())
    }

    /// Fetches all tables for a given schema/owner
    ///
    /// NOTE: Placeholder for Phase 3
    pub fn fetch_tables(&self, _owner: &str) -> Result<Vec<String>, String> {
        Err("Not implemented yet - Phase 3".to_string())
    }

    /// Fetches metadata for a specific table
    ///
    /// NOTE: Placeholder for Phase 3
    pub fn fetch_table_metadata(
        &self,
        _owner: &str,
        _table_name: &str,
    ) -> Result<super::models::TableMetadata, String> {
        Err("Not implemented yet - Phase 3".to_string())
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
