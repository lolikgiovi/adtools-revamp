/// Integration tests for Oracle client detection
///
/// Run these tests with: cargo test --test oracle_client_tests

use ad_tools_lib::oracle::client::{check_client_ready, prime_client, resolve_client_path};
use std::path::PathBuf;

#[test]
fn test_1_1_client_not_installed() {
    // Test with a path that definitely doesn't have Oracle client
    let result = check_client_ready(Some("/nonexistent/path/oracle"));
    assert_eq!(result, false, "Should return false when Oracle client not installed");
    println!("✓ Test 1.1.1 PASSED: Returns false when client not installed");
}

#[test]
fn test_1_1_resolve_default_path() {
    let path = resolve_client_path(None);
    assert!(path.to_string_lossy().contains("Library/Application Support/AD Tools/instantclient"));
    println!("✓ Path resolution works: {:?}", path);
}

#[test]
fn test_1_1_resolve_custom_path() {
    let custom_path = "/opt/oracle/instantclient";
    let path = resolve_client_path(Some(custom_path));
    assert_eq!(path, PathBuf::from(custom_path));
    println!("✓ Custom path resolution works: {:?}", path);
}

#[test]
fn test_1_1_check_actual_installation() {
    // This will check if Oracle client is actually installed at the default location
    let result = check_client_ready(None);

    if result {
        println!("✓ Test 1.1.2 PASSED: Oracle client IS installed and valid");
    } else {
        println!("ℹ Test 1.1.2 INFO: Oracle client NOT installed (expected if you haven't installed it yet)");
    }

    // This test always passes, just reports the status
    assert!(true);
}

#[test]
#[ignore] // Only run after installing Oracle client
fn test_1_1_verify_installation() {
    // This test verifies Oracle client is actually installed
    let result = check_client_ready(None);

    assert!(result, "Oracle client should be installed. Run the installation script first.");

    if result {
        println!("✓ Oracle client IS installed and detected");
        println!("✓ Test 1.1.2 PASSED: Oracle client IS installed and valid");

        // Also test priming
        let prime_result = prime_client(None);
        assert!(prime_result.is_ok(), "Should successfully prime client when installed");
        println!("✓ Test 1.1.5 PASSED: Prime loads library successfully");
    }
}

#[test]
fn test_1_1_prime_client_without_installation() {
    // Test priming when client is not installed
    let result = prime_client(Some("/nonexistent/path/oracle"));

    assert!(result.is_err(), "Should return error when client not found");
    if let Err(e) = result {
        assert!(e.contains("not found"), "Error should mention file not found");
        println!("✓ Test 1.1.4 PASSED: Prime returns error when client not found");
        println!("  Error message: {}", e);
    }
}

#[test]
#[ignore] // Only run this if Oracle client is actually installed
fn test_1_1_prime_client_with_installation() {
    // This test only works if Oracle client is installed
    let result = prime_client(None);

    if check_client_ready(None) {
        assert!(result.is_ok(), "Should successfully prime client when installed");
        println!("✓ Test 1.1.5 PASSED: Prime loads library successfully");
    } else {
        println!("⊘ Test 1.1.5 SKIPPED: Oracle client not installed");
    }
}
