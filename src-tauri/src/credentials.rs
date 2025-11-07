/// Credential management for AD Tools
///
/// This module provides secure credential storage using the macOS keychain.
/// It supports both Jenkins credentials (existing) and Oracle credentials (new).

use keyring::Entry;

/// Keychain service identifier for Oracle credentials
const KEYCHAIN_SERVICE_ORACLE: &str = "ad-tools:oracle";

/// Manager for Oracle database credentials
pub struct CredentialManager;

impl CredentialManager {
    /// Stores Oracle credentials in the macOS keychain
    ///
    /// # Arguments
    /// * `name` - Connection name/identifier
    /// * `username` - Database username
    /// * `password` - Database password
    ///
    /// # Returns
    /// `Ok(())` if successful, error message otherwise
    ///
    /// # Storage format
    /// - Username key: `ad-tools:oracle:{name}:username`
    /// - Password key: `ad-tools:oracle:{name}:password`
    pub fn set_oracle_credentials(
        name: &str,
        username: &str,
        password: &str,
    ) -> Result<(), String> {
        if name.is_empty() {
            return Err("Connection name cannot be empty".to_string());
        }
        if username.is_empty() {
            return Err("Username cannot be empty".to_string());
        }
        if password.is_empty() {
            return Err("Password cannot be empty".to_string());
        }

        // Store username
        let username_key = format!("{}:username", name);
        let username_entry = Entry::new(KEYCHAIN_SERVICE_ORACLE, &username_key)
            .map_err(|e| format!("Failed to create keychain entry for username: {}", e))?;
        username_entry
            .set_password(username)
            .map_err(|e| format!("Failed to store username: {}", e))?;

        // Store password
        let password_key = format!("{}:password", name);
        let password_entry = Entry::new(KEYCHAIN_SERVICE_ORACLE, &password_key)
            .map_err(|e| format!("Failed to create keychain entry for password: {}", e))?;
        password_entry
            .set_password(password)
            .map_err(|e| format!("Failed to store password: {}", e))?;

        log::info!("Stored Oracle credentials for connection: {}", name);
        Ok(())
    }

    /// Retrieves Oracle credentials from the macOS keychain
    ///
    /// # Arguments
    /// * `name` - Connection name/identifier
    ///
    /// # Returns
    /// `Ok((username, password))` if successful, error message otherwise
    pub fn get_oracle_credentials(name: &str) -> Result<(String, String), String> {
        if name.is_empty() {
            return Err("Connection name cannot be empty".to_string());
        }

        // Retrieve username
        let username_key = format!("{}:username", name);
        let username_entry = Entry::new(KEYCHAIN_SERVICE_ORACLE, &username_key)
            .map_err(|e| format!("Failed to create keychain entry for username: {}", e))?;
        let username = username_entry
            .get_password()
            .map_err(|e| format!("Failed to retrieve username for '{}': {}. Please check that credentials are saved in Settings.", name, e))?;

        // Retrieve password
        let password_key = format!("{}:password", name);
        let password_entry = Entry::new(KEYCHAIN_SERVICE_ORACLE, &password_key)
            .map_err(|e| format!("Failed to create keychain entry for password: {}", e))?;
        let password = password_entry
            .get_password()
            .map_err(|e| format!("Failed to retrieve password for '{}': {}. Please check that credentials are saved in Settings.", name, e))?;

        Ok((username, password))
    }

    /// Deletes Oracle credentials from the macOS keychain
    ///
    /// # Arguments
    /// * `name` - Connection name/identifier
    ///
    /// # Returns
    /// `Ok(())` if successful, error message otherwise
    pub fn delete_oracle_credentials(name: &str) -> Result<(), String> {
        if name.is_empty() {
            return Err("Connection name cannot be empty".to_string());
        }

        // Delete username
        let username_key = format!("{}:username", name);
        if let Ok(username_entry) = Entry::new(KEYCHAIN_SERVICE_ORACLE, &username_key) {
            // Ignore errors if credential doesn't exist
            let _ = username_entry.delete_password();
        }

        // Delete password
        let password_key = format!("{}:password", name);
        if let Ok(password_entry) = Entry::new(KEYCHAIN_SERVICE_ORACLE, &password_key) {
            // Ignore errors if credential doesn't exist
            let _ = password_entry.delete_password();
        }

        log::info!("Deleted Oracle credentials for connection: {}", name);
        Ok(())
    }

    /// Checks if Oracle credentials exist for a given connection
    ///
    /// # Arguments
    /// * `name` - Connection name/identifier
    ///
    /// # Returns
    /// `true` if credentials exist, `false` otherwise
    pub fn has_oracle_credentials(name: &str) -> bool {
        if name.is_empty() {
            return false;
        }

        let username_key = format!("{}:username", name);
        let password_key = format!("{}:password", name);

        // Check if both username and password exist
        let username_exists = Entry::new(KEYCHAIN_SERVICE_ORACLE, &username_key)
            .ok()
            .and_then(|entry| entry.get_password().ok())
            .is_some();

        let password_exists = Entry::new(KEYCHAIN_SERVICE_ORACLE, &password_key)
            .ok()
            .and_then(|entry| entry.get_password().ok())
            .is_some();

        username_exists && password_exists
    }
}

/// Tauri commands for credential management
#[tauri::command]
pub fn set_oracle_credentials(
    name: String,
    username: String,
    password: String,
) -> Result<(), String> {
    CredentialManager::set_oracle_credentials(&name, &username, &password)
}

#[tauri::command]
pub fn get_oracle_credentials(name: String) -> Result<(String, String), String> {
    CredentialManager::get_oracle_credentials(&name)
}

#[tauri::command]
pub fn delete_oracle_credentials(name: String) -> Result<(), String> {
    CredentialManager::delete_oracle_credentials(&name)
}

#[tauri::command]
pub fn has_oracle_credentials(name: String) -> bool {
    CredentialManager::has_oracle_credentials(&name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validation() {
        let result = CredentialManager::set_oracle_credentials("", "user", "pass");
        assert!(result.is_err());

        let result = CredentialManager::set_oracle_credentials("test", "", "pass");
        assert!(result.is_err());

        let result = CredentialManager::set_oracle_credentials("test", "user", "");
        assert!(result.is_err());
    }

    #[test]
    fn test_get_nonexistent() {
        let result = CredentialManager::get_oracle_credentials("nonexistent_test_connection_12345");
        assert!(result.is_err());
    }

    #[test]
    fn test_has_credentials() {
        assert!(!CredentialManager::has_oracle_credentials(""));
        assert!(!CredentialManager::has_oracle_credentials("nonexistent_test_connection_12345"));
    }
}
