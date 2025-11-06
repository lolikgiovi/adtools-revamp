use keyring::Entry;
use crate::oracle::types::OracleCredentialStatus;

const ORACLE_KEYCHAIN_PREFIX: &str = "ad-tools:oracle:";
const USERNAME_KEY: &str = "__username__";

pub struct CredentialManager;

impl CredentialManager {
  pub fn new() -> Self { Self }

  fn service_name(connection_id: &str) -> String {
    format!("{}{}", ORACLE_KEYCHAIN_PREFIX, connection_id)
  }

  pub fn set(&self, connection_id: &str, username: &str, password: &str) -> Result<(), String> {
    let service = Self::service_name(connection_id);
    let user_entry = Entry::new(&service, USERNAME_KEY).map_err(|e| e.to_string())?;
    user_entry.set_password(username).map_err(|e| e.to_string())?;

    let pass_entry = Entry::new(&service, username).map_err(|e| e.to_string())?;
    pass_entry.set_password(password).map_err(|e| e.to_string())
  }

  pub fn get(&self, connection_id: &str) -> Result<OracleCredentialStatus, String> {
    let service = Self::service_name(connection_id);
    let user_entry = Entry::new(&service, USERNAME_KEY).map_err(|e| e.to_string())?;
    let username = match user_entry.get_password() {
      Ok(u) => Some(u),
      Err(_) => None,
    };
    let has_password = match &username {
      Some(u) => Entry::new(&service, u).map_err(|e| e.to_string())?.get_password().is_ok(),
      None => false,
    };

    Ok(OracleCredentialStatus { connection_id: connection_id.to_string(), username, has_password })
  }

  pub fn get_secret(&self, connection_id: &str) -> Result<(String, String), String> {
    let service = Self::service_name(connection_id);
    let user_entry = Entry::new(&service, USERNAME_KEY).map_err(|e| e.to_string())?;
    let username = user_entry.get_password().map_err(|e| e.to_string())?;
    let pass_entry = Entry::new(&service, &username).map_err(|e| e.to_string())?;
    let password = pass_entry.get_password().map_err(|e| e.to_string())?;
    Ok((username, password))
  }
}