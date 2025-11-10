/// Integration tests for Oracle database connection
///
/// These tests require Oracle Instant Client to be installed and a running Oracle database.
/// Connection parameters should be provided via environment variables for testing.

use ad_tools_lib::oracle::connection::DatabaseConnection;
use ad_tools_lib::oracle::models::{ConnectionConfig, Credentials};
use std::env;

/// Helper to load test credentials from environment variables
fn load_test_config() -> Option<(ConnectionConfig, Credentials)> {
    let host = env::var("HOST").ok()?;
    let port = env::var("PORT").ok()?.parse().ok()?;
    let service_name = env::var("SERVICE_NAME").ok()?;
    let username = env::var("USERNAME").ok()?;
    let password = env::var("PASSWORD").ok()?;

    let config = ConnectionConfig::new(
        "test-connection".to_string(),
        host,
        port,
        service_name,
    );

    let credentials = Credentials::new(username, password);

    Some((config, credentials))
}

#[test]
#[ignore] // Ignored by default, run with: cargo test oracle_connection -- --ignored --nocapture
fn test_oracle_connection_with_real_database() {
    // First, check if Oracle Instant Client is available
    // If not, skip the test gracefully
    let client_path = dirs::home_dir()
        .map(|h| {
            h.join("Documents")
                .join("adtools_library")
                .join("oracle_instantclient")
                .join("libclntsh.dylib")
        });

    if let Some(path) = client_path {
        if !path.exists() {
            println!("⚠️  Oracle Instant Client not found at: {:?}", path);
            println!("Skipping test - Install Oracle Instant Client to run this test");
            println!("See docs/compare_config/COMPARE-CONFIG-FEATURE.md for installation instructions");
            return;
        }
    }

    // Load credentials from .env.development
    let env_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join(".env.development");

    if env_path.exists() {
        dotenv::from_path(&env_path).ok();
    }

    let (config, credentials) = match load_test_config() {
        Some(cfg) => cfg,
        None => {
            println!("⚠️  Skipping test: No database credentials found in environment variables");
            println!("Expected variables: HOST, PORT, SERVICE_NAME, USERNAME, PASSWORD");
            println!("Check .env.development file");
            return;
        }
    };

    println!("✓ Testing Oracle connection to: {}", config.connection_string());

    // Test connection creation
    let conn = match DatabaseConnection::new(config.clone(), credentials) {
        Ok(c) => c,
        Err(e) => {
            panic!("❌ Failed to create connection: {}", e);
        }
    };

    println!("✓ Connection established successfully!");

    // Test connection with SELECT 1 FROM dual
    match conn.test_connection() {
        Ok(()) => {
            println!("✅ Connection test PASSED! SELECT 1 FROM dual executed successfully.");
        }
        Err(e) => {
            panic!("❌ Connection test FAILED: {}", e);
        }
    }
}

#[test]
fn test_connection_config_validation() {
    // Test invalid config
    let invalid_config = ConnectionConfig::new(
        "".to_string(), // Invalid: empty name
        "localhost".to_string(),
        1521,
        "ORCL".to_string(),
    );

    let credentials = Credentials::new("user".to_string(), "pass".to_string());

    let result = DatabaseConnection::new(invalid_config, credentials);
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
    let invalid_creds = Credentials::new("".to_string(), "pass".to_string());
    let result = DatabaseConnection::new(config.clone(), invalid_creds);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Username cannot be empty"));

    // Test empty password
    let invalid_creds = Credentials::new("user".to_string(), "".to_string());
    let result = DatabaseConnection::new(config, invalid_creds);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Password cannot be empty"));
}

#[test]
fn test_connection_string_format() {
    let config = ConnectionConfig::new(
        "test".to_string(),
        "db-host.example.com".to_string(),
        1522,
        "MYSERVICE".to_string(),
    );

    assert_eq!(
        config.connection_string(),
        "db-host.example.com:1522/MYSERVICE"
    );
}
