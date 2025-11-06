use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct OracleClientStatus {
  pub installed: bool,
  pub version: Option<String>,
  pub lib_paths: Option<Vec<String>>, // potential library search paths
  pub message: Option<String>,        // human-friendly status or guidance
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OracleCredentialStatus {
  pub connection_id: String,
  pub username: Option<String>,
  pub has_password: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OracleConnectionConfig {
  pub id: String,
  pub host: String,
  pub port: u16,
  pub service_name: String,
  pub schema: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OracleColumnMeta {
  pub name: String,
  pub data_type: String,
  pub data_length: Option<i64>,
  pub nullable: bool,
  pub data_default: Option<String>,
  pub is_primary_key: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OracleTableMeta {
  pub schema: Option<String>,
  pub table: String,
  pub columns: Vec<OracleColumnMeta>,
}