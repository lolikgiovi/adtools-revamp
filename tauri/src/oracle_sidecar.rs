//! Oracle Sidecar Manager
//!
//! Manages the Python Oracle sidecar process lifecycle.
//! The sidecar provides Oracle database connectivity without requiring
//! Oracle Instant Client to be bundled with the app.

use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

const SIDECAR_PORT: u16 = 21521;
const SIDECAR_NAME: &str = "oracle-sidecar";
const STARTUP_TIMEOUT_MS: u64 = 10000;
const HEALTH_CHECK_INTERVAL_MS: u64 = 100;

/// Holds the sidecar child process
pub struct SidecarState {
    child: Mutex<Option<CommandChild>>,
}

impl Default for SidecarState {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }
}

/// Start the Oracle sidecar process
#[tauri::command]
pub async fn start_oracle_sidecar(app: tauri::AppHandle) -> Result<String, String> {
    let state = app.state::<SidecarState>();

    // Check if already running
    let already_has_child = {
        let child = state.child.lock().map_err(|e| e.to_string())?;
        child.is_some()
    };

    if already_has_child {
        // Verify it's actually responding
        if check_sidecar_health().await {
            return Ok(format!("Sidecar already running on port {}", SIDECAR_PORT));
        }
        // Process exists but not responding, will restart below
    }

    // Spawn the sidecar
    let sidecar_command = app
        .shell()
        .sidecar(SIDECAR_NAME)
        .map_err(|e| format!("Failed to create sidecar command: {}", e))?;

    let (mut rx, child) = sidecar_command
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

    // Store the child process
    {
        let mut child_guard = state.child.lock().map_err(|e| e.to_string())?;
        *child_guard = Some(child);
    }

    // Spawn a task to log sidecar output
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let line = String::from_utf8_lossy(&line);
                    log::info!("[oracle-sidecar] {}", line.trim());
                }
                CommandEvent::Stderr(line) => {
                    let line = String::from_utf8_lossy(&line);
                    log::warn!("[oracle-sidecar] {}", line.trim());
                }
                CommandEvent::Terminated(payload) => {
                    log::info!(
                        "[oracle-sidecar] Process terminated with code: {:?}",
                        payload.code
                    );
                    break;
                }
                _ => {}
            }
        }
    });

    // Wait for sidecar to be ready
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_millis(STARTUP_TIMEOUT_MS) {
        if check_sidecar_health().await {
            log::info!("Oracle sidecar started successfully on port {}", SIDECAR_PORT);
            return Ok(format!("Sidecar started on port {}", SIDECAR_PORT));
        }
        tokio::time::sleep(Duration::from_millis(HEALTH_CHECK_INTERVAL_MS)).await;
    }

    Err(format!(
        "Sidecar failed to start within {}ms",
        STARTUP_TIMEOUT_MS
    ))
}

/// Stop the Oracle sidecar process
#[tauri::command]
pub async fn stop_oracle_sidecar(app: tauri::AppHandle) -> Result<String, String> {
    let state = app.state::<SidecarState>();

    let mut child_guard = state.child.lock().map_err(|e| e.to_string())?;

    if let Some(child) = child_guard.take() {
        child.kill().map_err(|e| format!("Failed to kill sidecar: {}", e))?;
        log::info!("Oracle sidecar stopped");
        Ok("Sidecar stopped".to_string())
    } else {
        Ok("Sidecar was not running".to_string())
    }
}

/// Check if the sidecar is running and healthy
#[tauri::command]
pub async fn check_oracle_sidecar_status() -> Result<bool, String> {
    Ok(check_sidecar_health().await)
}

/// Get the sidecar base URL
#[tauri::command]
pub fn get_oracle_sidecar_url() -> String {
    format!("http://127.0.0.1:{}", SIDECAR_PORT)
}

/// Internal health check
async fn check_sidecar_health() -> bool {
    let url = format!("http://127.0.0.1:{}/health", SIDECAR_PORT);

    match reqwest::Client::new()
        .get(&url)
        .timeout(Duration::from_secs(2))
        .send()
        .await
    {
        Ok(response) => response.status().is_success(),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sidecar_url() {
        let url = get_oracle_sidecar_url();
        assert_eq!(url, "http://127.0.0.1:21521");
    }

    #[test]
    fn test_sidecar_state_default() {
        let state = SidecarState::default();
        let child = state.child.lock().unwrap();
        assert!(child.is_none());
    }
}
