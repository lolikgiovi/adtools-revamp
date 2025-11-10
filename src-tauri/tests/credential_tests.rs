/// Integration tests for credential management
///
/// Run these tests with: cargo test --test credential_tests

use ad_tools_lib::credentials::CredentialManager;

const TEST_CONNECTION_NAME: &str = "test_oracle_connection_12345";
const TEST_USERNAME: &str = "test_user";
const TEST_PASSWORD: &str = "test_password_123";

#[test]
fn test_1_4_store_and_retrieve_credentials() {
    // Clean up any existing test credentials first
    let _ = CredentialManager::delete_oracle_credentials(TEST_CONNECTION_NAME);

    // Test 1.4.1: Store credentials
    let store_result = CredentialManager::set_oracle_credentials(
        TEST_CONNECTION_NAME,
        TEST_USERNAME,
        TEST_PASSWORD,
    );

    assert!(store_result.is_ok(), "Should successfully store credentials");
    println!("✓ Test 1.4.1 PASSED: Credentials stored to keychain");

    // Test 1.4.2: Retrieve credentials
    let retrieve_result = CredentialManager::get_oracle_credentials(TEST_CONNECTION_NAME);

    assert!(retrieve_result.is_ok(), "Should successfully retrieve credentials");

    if let Ok((username, password)) = retrieve_result {
        assert_eq!(username, TEST_USERNAME, "Username should match");
        assert_eq!(password, TEST_PASSWORD, "Password should match");
        println!("✓ Test 1.4.2 PASSED: Credentials retrieved from keychain");
        println!("  Retrieved username: {}", username);
    }

    // Test 1.4.3: Check credentials exist
    let has_creds = CredentialManager::has_oracle_credentials(TEST_CONNECTION_NAME);
    assert!(has_creds, "Should report credentials exist");
    println!("✓ Test 1.4.3 PASSED: has_oracle_credentials returns true");

    // Test 1.4.4: Delete credentials
    let delete_result = CredentialManager::delete_oracle_credentials(TEST_CONNECTION_NAME);
    assert!(delete_result.is_ok(), "Should successfully delete credentials");
    println!("✓ Test 1.4.4 PASSED: Credentials deleted from keychain");

    // Test 1.4.5: Verify deletion
    let has_creds_after = CredentialManager::has_oracle_credentials(TEST_CONNECTION_NAME);
    assert!(!has_creds_after, "Should report credentials don't exist after deletion");
    println!("✓ Test 1.4.5 PASSED: Credentials no longer exist after deletion");
}

#[test]
fn test_1_4_invalid_connection_name() {
    // Test with empty connection name
    let result = CredentialManager::set_oracle_credentials("", "user", "pass");

    assert!(result.is_err(), "Should return error for empty connection name");
    if let Err(e) = result {
        assert!(e.contains("cannot be empty"), "Error should mention empty name");
        println!("✓ Test 1.4.6 PASSED: Rejects empty connection name");
        println!("  Error message: {}", e);
    }
}

#[test]
fn test_1_4_invalid_username() {
    let result = CredentialManager::set_oracle_credentials("test", "", "pass");

    assert!(result.is_err(), "Should return error for empty username");
    if let Err(e) = result {
        assert!(e.contains("cannot be empty"), "Error should mention empty username");
        println!("✓ Test 1.4.7 PASSED: Rejects empty username");
    }
}

#[test]
fn test_1_4_invalid_password() {
    let result = CredentialManager::set_oracle_credentials("test", "user", "");

    assert!(result.is_err(), "Should return error for empty password");
    if let Err(e) = result {
        assert!(e.contains("cannot be empty"), "Error should mention empty password");
        println!("✓ Test 1.4.8 PASSED: Rejects empty password");
    }
}

#[test]
fn test_1_4_retrieve_nonexistent_credentials() {
    let result = CredentialManager::get_oracle_credentials("nonexistent_connection_xyz_999");

    assert!(result.is_err(), "Should return error for nonexistent credentials");
    if let Err(e) = result {
        println!("✓ Test 1.4.9 PASSED: Returns error for nonexistent credentials");
        println!("  Error message: {}", e);
    }
}

#[test]
fn test_1_4_has_credentials_for_nonexistent() {
    let result = CredentialManager::has_oracle_credentials("nonexistent_connection_xyz_999");

    assert!(!result, "Should return false for nonexistent credentials");
    println!("✓ Test 1.4.10 PASSED: has_credentials returns false for nonexistent");
}
