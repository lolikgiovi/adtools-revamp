use redis::{Client, Commands, Connection, RedisError};
use serde::{Deserialize, Serialize};
use std::time::Duration;

const CONNECTION_TIMEOUT: Duration = Duration::from_secs(5);
const IO_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_SCAN_COUNT: usize = 200;
const MAX_DELETE_KEYS: usize = 200;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub(crate) struct RedisCredentials {
    pub(crate) username: String,
    pub(crate) password: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RedisConfig {
    host: String,
    port: u16,
    database: i64,
    tls: bool,
    username: String,
}

#[derive(Debug, Serialize)]
pub struct RedisConnectionStatus {
    ok: bool,
    message: String,
}

#[derive(Debug, Serialize)]
pub struct RedisScanResult {
    cursor: u64,
    keys: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct RedisDeleteResult {
    deleted: usize,
    command: String,
}

fn validate_config(config: &RedisConfig) -> Result<(), String> {
    let host = config.host.trim();
    if host.is_empty() {
        return Err("Redis host is required".to_string());
    }
    if host.contains('/') || host.contains('@') || host.chars().any(char::is_whitespace) {
        return Err("Redis host contains invalid characters".to_string());
    }
    if config.port == 0 {
        return Err("Redis port must be between 1 and 65535".to_string());
    }
    if config.database < 0 || config.database > 1024 {
        return Err("Redis database must be between 0 and 1024".to_string());
    }
    Ok(())
}

fn load_credentials() -> Result<RedisCredentials, String> {
    Ok(crate::load_unified_secrets()?
        .redis_credentials
        .unwrap_or_default())
}

fn connection_url(config: &RedisConfig, credentials: &RedisCredentials) -> Result<String, String> {
    validate_config(config)?;
    let scheme = if config.tls { "rediss" } else { "redis" };
    let host = config.host.trim();
    let formatted_host = if host.contains(':') && !host.starts_with('[') {
        format!("[{}]", host)
    } else {
        host.to_string()
    };
    let username = config.username.trim();
    let auth = if username.is_empty() && credentials.password.is_empty() {
        String::new()
    } else {
        format!(
            "{}:{}@",
            urlencoding::encode(username),
            urlencoding::encode(&credentials.password)
        )
    };
    Ok(format!(
        "{}://{}{}:{}/{}",
        scheme, auth, formatted_host, config.port, config.database
    ))
}

fn connect(config: &RedisConfig) -> Result<Connection, String> {
    let credentials = load_credentials()?;
    let url = connection_url(config, &credentials)?;
    let client = Client::open(url).map_err(redis_error)?;
    let connection = client
        .get_connection_with_timeout(CONNECTION_TIMEOUT)
        .map_err(redis_error)?;
    connection
        .set_read_timeout(Some(IO_TIMEOUT))
        .map_err(redis_error)?;
    connection
        .set_write_timeout(Some(IO_TIMEOUT))
        .map_err(redis_error)?;
    Ok(connection)
}

fn redis_error(error: RedisError) -> String {
    let message = error.to_string();
    if message.to_lowercase().contains("authentication")
        || message.contains("NOAUTH")
        || message.contains("WRONGPASS")
    {
        "Redis authentication failed. Update the username or password in Settings.".to_string()
    } else if message.to_lowercase().contains("timed out") {
        "Redis connection timed out. Check the host, port, VPN, and TLS setting.".to_string()
    } else {
        format!("Redis error: {}", message)
    }
}

fn should_fallback_to_del(error: &RedisError) -> bool {
    let message = error.to_string().to_lowercase();
    message.contains("unknown command") || message.contains("noperm")
}

#[tauri::command]
pub fn set_redis_credentials(username: String, password: String) -> Result<(), String> {
    let mut secrets = crate::load_unified_secrets()?;
    secrets.redis_credentials = Some(RedisCredentials {
        username: username.trim().to_string(),
        password,
    });
    crate::save_unified_secrets(&secrets)
}

#[tauri::command]
pub fn clear_redis_credentials() -> Result<(), String> {
    let mut secrets = crate::load_unified_secrets()?;
    secrets.redis_credentials = None;
    crate::save_unified_secrets(&secrets)
}

#[tauri::command]
pub fn has_redis_credentials() -> Result<bool, String> {
    Ok(crate::load_unified_secrets()?.redis_credentials.is_some())
}

fn test_connection(config: RedisConfig) -> Result<RedisConnectionStatus, String> {
    let mut connection = connect(&config)?;
    let response: String = redis::cmd("PING")
        .query(&mut connection)
        .map_err(redis_error)?;
    Ok(RedisConnectionStatus {
        ok: response == "PONG",
        message: if response == "PONG" {
            "Connection successful".to_string()
        } else {
            format!("Unexpected PING response: {}", response)
        },
    })
}

#[tauri::command]
pub async fn redis_test_connection(config: RedisConfig) -> Result<RedisConnectionStatus, String> {
    tauri::async_runtime::spawn_blocking(move || test_connection(config))
        .await
        .map_err(|error| format!("Redis connection task failed: {}", error))?
}

fn scan_keys(
    config: RedisConfig,
    pattern: String,
    cursor: u64,
    count: usize,
) -> Result<RedisScanResult, String> {
    let pattern = pattern.trim();
    if pattern.is_empty() {
        return Err("Enter a Redis key pattern".to_string());
    }
    if pattern.len() > 512 {
        return Err("Redis key pattern is too long".to_string());
    }
    let count = count.clamp(1, MAX_SCAN_COUNT);
    let mut connection = connect(&config)?;
    let (next_cursor, keys): (u64, Vec<String>) = redis::cmd("SCAN")
        .arg(cursor)
        .arg("MATCH")
        .arg(pattern)
        .arg("COUNT")
        .arg(count)
        .query(&mut connection)
        .map_err(redis_error)?;
    Ok(RedisScanResult {
        cursor: next_cursor,
        keys,
    })
}

#[tauri::command]
pub async fn redis_scan_keys(
    config: RedisConfig,
    pattern: String,
    cursor: u64,
    count: usize,
) -> Result<RedisScanResult, String> {
    tauri::async_runtime::spawn_blocking(move || scan_keys(config, pattern, cursor, count))
        .await
        .map_err(|error| format!("Redis scan task failed: {}", error))?
}

fn delete_keys(config: RedisConfig, keys: Vec<String>) -> Result<RedisDeleteResult, String> {
    if keys.is_empty() {
        return Err("Select at least one Redis key".to_string());
    }
    if keys.len() > MAX_DELETE_KEYS {
        return Err(format!("Delete at most {} keys at a time", MAX_DELETE_KEYS));
    }
    if keys.iter().any(|key| key.is_empty() || key.len() > 4096) {
        return Err("One or more Redis keys are invalid".to_string());
    }

    let mut connection = connect(&config)?;
    match redis::cmd("UNLINK")
        .arg(&keys)
        .query::<usize>(&mut connection)
    {
        Ok(deleted) => Ok(RedisDeleteResult {
            deleted,
            command: "UNLINK".to_string(),
        }),
        Err(error) if should_fallback_to_del(&error) => {
            let deleted = connection.del::<_, usize>(&keys).map_err(redis_error)?;
            Ok(RedisDeleteResult {
                deleted,
                command: "DEL".to_string(),
            })
        }
        Err(error) => Err(redis_error(error)),
    }
}

#[tauri::command]
pub async fn redis_delete_keys(
    config: RedisConfig,
    keys: Vec<String>,
) -> Result<RedisDeleteResult, String> {
    tauri::async_runtime::spawn_blocking(move || delete_keys(config, keys))
        .await
        .map_err(|error| format!("Redis delete task failed: {}", error))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_plain_and_authenticated_urls() {
        let config = RedisConfig {
            host: "localhost".to_string(),
            port: 6379,
            database: 2,
            tls: false,
            username: "".to_string(),
        };
        assert_eq!(
            connection_url(&config, &RedisCredentials::default()).unwrap(),
            "redis://localhost:6379/2"
        );
        assert_eq!(
            connection_url(
                &RedisConfig {
                    username: "cache-user".to_string(),
                    ..config.clone()
                },
                &RedisCredentials {
                    username: "outdated-user".to_string(),
                    password: "p@ss word".to_string(),
                }
            )
            .unwrap(),
            "redis://cache-user:p%40ss%20word@localhost:6379/2"
        );
    }

    #[test]
    fn rejects_invalid_connection_config() {
        let config = RedisConfig {
            host: "bad/host".to_string(),
            port: 6379,
            database: 0,
            tls: false,
            username: "".to_string(),
        };
        assert!(validate_config(&config).is_err());
    }
}
