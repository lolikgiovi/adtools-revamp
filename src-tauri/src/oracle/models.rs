/// Data models for Oracle database operations
///
/// This module defines the core data structures used for Oracle connection
/// configuration, credentials, and comparison results.

use serde::{Deserialize, Serialize};

/// Configuration for an Oracle database connection
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    /// User-friendly name for the connection
    pub name: String,

    /// Database host/hostname
    pub host: String,

    /// Database port (typically 1521)
    pub port: u16,

    /// Oracle service name
    pub service_name: String,

    /// Whether credentials exist for this connection (frontend-only field)
    #[serde(default)]
    pub has_credentials: bool,
}

impl ConnectionConfig {
    /// Creates a new ConnectionConfig
    pub fn new(name: String, host: String, port: u16, service_name: String) -> Self {
        Self {
            name,
            host,
            port,
            service_name,
            has_credentials: false,
        }
    }

    /// Validates the connection configuration
    pub fn validate(&self) -> Result<(), String> {
        if self.name.is_empty() {
            return Err("Connection name cannot be empty".to_string());
        }
        if self.host.is_empty() {
            return Err("Host cannot be empty".to_string());
        }
        if self.service_name.is_empty() {
            return Err("Service name cannot be empty".to_string());
        }
        if self.port == 0 {
            return Err("Port must be greater than 0".to_string());
        }
        Ok(())
    }

    /// Builds an Oracle connection string
    ///
    /// Format: `host:port/service_name`
    pub fn connection_string(&self) -> String {
        format!("{}:{}/{}", self.host, self.port, self.service_name)
    }
}

/// Credentials for Oracle database authentication
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Credentials {
    /// Database username
    pub username: String,

    /// Database password
    pub password: String,
}

impl Credentials {
    /// Creates new Credentials
    pub fn new(username: String, password: String) -> Self {
        Self { username, password }
    }

    /// Validates credentials
    pub fn validate(&self) -> Result<(), String> {
        if self.username.is_empty() {
            return Err("Username cannot be empty".to_string());
        }
        if self.password.is_empty() {
            return Err("Password cannot be empty".to_string());
        }
        Ok(())
    }
}

/// Metadata about a database table
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableMetadata {
    /// Schema/owner name
    pub owner: String,

    /// Table name
    pub table_name: String,

    /// List of columns
    pub columns: Vec<ColumnInfo>,

    /// Primary key column names
    pub primary_key: Vec<String>,
}

/// Information about a table column
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnInfo {
    /// Column name
    pub name: String,

    /// Oracle data type
    pub data_type: String,

    /// Whether the column can be NULL
    pub nullable: bool,

    /// Whether this column is part of the primary key
    pub is_pk: bool,
}

/// Request structure for configuration comparison
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComparisonRequest {
    /// Environment 1 (reference) name
    pub env1_name: String,

    /// Environment 1 connection config
    pub env1_connection: ConnectionConfig,

    /// Environment 1 schema
    pub env1_schema: String,

    /// Environment 2 (comparison) name
    pub env2_name: String,

    /// Environment 2 connection config
    pub env2_connection: ConnectionConfig,

    /// Environment 2 schema
    pub env2_schema: String,

    /// Table to compare
    pub table_name: String,

    /// Optional WHERE clause
    pub where_clause: Option<String>,

    /// Custom primary key fields for comparison (empty = use table's actual PK)
    pub custom_primary_key: Vec<String>,

    /// Fields to compare (empty = all fields)
    pub fields: Vec<String>,
}

/// Summary statistics for a comparison
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComparisonSummary {
    /// Total number of unique records across both environments
    pub total_records: usize,

    /// Number of matching records
    pub matching: usize,

    /// Number of differing records
    pub differing: usize,

    /// Number of records only in environment 1
    pub only_in_env1: usize,

    /// Number of records only in environment 2
    pub only_in_env2: usize,
}

/// Complete comparison result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComparisonResult {
    /// Environment 1 name
    pub env1_name: String,

    /// Environment 2 name
    pub env2_name: String,

    /// Timestamp of comparison
    pub timestamp: String,

    /// Summary statistics
    pub summary: ComparisonSummary,

    /// Detailed comparisons
    pub comparisons: Vec<ConfigComparison>,
}

/// Comparison status for a single record
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ComparisonStatus {
    /// Records match exactly
    Match,

    /// Records differ
    Differ,

    /// Record exists only in environment 1
    OnlyInEnv1,

    /// Record exists only in environment 2
    OnlyInEnv2,
}

/// Detailed comparison for a single configuration record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigComparison {
    /// Primary key value(s) as a string
    pub primary_key: String,

    /// Comparison status
    pub status: ComparisonStatus,

    /// Data from environment 1 (if present)
    pub env1_data: Option<serde_json::Value>,

    /// Data from environment 2 (if present)
    pub env2_data: Option<serde_json::Value>,

    /// Field-level differences (only for Differ status)
    pub differences: Vec<FieldDifference>,
}

/// Difference in a specific field
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldDifference {
    /// Field name
    pub field_name: String,

    /// Value in environment 1
    pub env1_value: Option<String>,

    /// Value in environment 2
    pub env2_value: Option<String>,

    /// Diff chunks for environment 1 (with highlighting)
    pub env1_diff_chunks: Vec<DiffChunk>,

    /// Diff chunks for environment 2 (with highlighting)
    pub env2_diff_chunks: Vec<DiffChunk>,
}

/// Type of diff chunk for highlighting
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DiffChunkType {
    /// Text is the same in both versions
    Same,

    /// Text was added in env2
    Added,

    /// Text was removed from env1
    Removed,

    /// Text was modified
    Modified,
}

/// A chunk of text with its diff status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffChunk {
    /// The text content
    pub text: String,

    /// The type of change
    pub chunk_type: DiffChunkType,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_connection_config_validate() {
        let config = ConnectionConfig::new(
            "test".to_string(),
            "localhost".to_string(),
            1521,
            "ORCL".to_string(),
        );
        assert!(config.validate().is_ok());

        let invalid = ConnectionConfig::new(
            "".to_string(),
            "localhost".to_string(),
            1521,
            "ORCL".to_string(),
        );
        assert!(invalid.validate().is_err());
    }

    #[test]
    fn test_connection_string() {
        let config = ConnectionConfig::new(
            "test".to_string(),
            "dbhost".to_string(),
            1521,
            "ORCL".to_string(),
        );
        assert_eq!(config.connection_string(), "dbhost:1521/ORCL");
    }

    #[test]
    fn test_credentials_validate() {
        let creds = Credentials::new("user".to_string(), "pass".to_string());
        assert!(creds.validate().is_ok());

        let invalid = Credentials::new("".to_string(), "pass".to_string());
        assert!(invalid.validate().is_err());
    }
}
