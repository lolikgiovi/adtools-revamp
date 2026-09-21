use redis::{Client, Commands, Connection, RedisError, Value};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value as JsonValue};
use std::time::{Duration, Instant};

const CONNECTION_TIMEOUT: Duration = Duration::from_secs(5);
const IO_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_SCAN_COUNT: usize = 200;
const MAX_DELETE_KEYS: usize = 200;
const MAX_VALUE_BYTES: usize = 512 * 1024;
const MAX_VALUE_COLLECTION_ITEMS: usize = 200;

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
    stage: String,
    endpoint: String,
    detail: Option<String>,
    hint: Option<String>,
    latency_ms: Option<u64>,
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

#[derive(Debug, Serialize)]
pub struct RedisValueResult {
    key: String,
    kind: String,
    ttl_seconds: i64,
    memory_bytes: Option<u64>,
    value: Option<JsonValue>,
    supported: bool,
    truncated: bool,
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

fn endpoint_label(config: &RedisConfig) -> String {
    let host = config.host.trim();
    let formatted_host = if host.contains(':') && !host.starts_with('[') {
        format!("[{}]", host)
    } else {
        host.to_string()
    };
    format!("{}:{}", formatted_host, config.port)
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

fn diagnose_redis_error(detail: &str) -> (&'static str, &'static str, &'static str) {
    let lower = detail.to_ascii_lowercase();
    if lower.contains("authentication") || lower.contains("noauth") || lower.contains("wrongpass") {
        (
            "authentication",
            "Redis authentication failed",
            "Check the username and password in Settings. Leave the username blank when the server uses password-only authentication.",
        )
    } else if lower.contains("certificate") || lower.contains("tls") || lower.contains("ssl") {
        (
            "tls",
            "Redis TLS negotiation failed",
            "Confirm the server expects TLS, its certificate is trusted by this Mac, and the TLS setting matches the endpoint.",
        )
    } else if lower.contains("connection refused") || lower.contains("os error 61") {
        (
            "network",
            "The Redis endpoint refused the TCP connection",
            concat!(
                "The host is reachable, but nothing is accepting Redis connections on this port. ",
                "Verify Redis is running and listening on the configured host and port, then check firewall or VPN rules."
            ),
        )
    } else if lower.contains("timed out") || lower.contains("timeout") {
        (
            "network",
            "The Redis connection timed out",
            "No response arrived before the timeout. Check the host, port, firewall, VPN route, and TLS setting.",
        )
    } else if lower.contains("could not resolve")
        || lower.contains("failed to lookup")
        || lower.contains("name or service not known")
        || lower.contains("no address associated")
    {
        (
            "network",
            "The Redis host could not be resolved",
            "Check the hostname spelling and confirm DNS or VPN access from this Mac.",
        )
    } else if lower.contains("keychain") || lower.contains("credential") {
        (
            "credentials",
            "Redis credentials could not be loaded",
            "Check Keychain access for AD Tools, then save the Redis password again in Settings.",
        )
    } else if lower.contains("db index is out of range")
        || lower.contains("invalid database")
        || lower.contains("invalid db index")
    {
        (
            "database",
            "Redis rejected the configured database",
            concat!(
                "The server does not expose the selected database index. Set Redis Database to a valid index, commonly 0, ",
                "or ask the Redis administrator to increase the configured database count."
            ),
        )
    } else {
        (
            "redis",
            "The Redis connection check failed",
            "Confirm the endpoint is a Redis server and review the server-side logs for the rejected connection.",
        )
    }
}

fn redis_error(error: RedisError) -> String {
    let detail = error.to_string();
    let (_, message, hint) = diagnose_redis_error(&detail);
    format!("{}. {} Details: {}", message, hint, detail)
}

fn raw_diagnostic_detail(detail: &str) -> String {
    detail
        .rsplit_once(" Details: ")
        .map(|(_, raw)| raw.to_string())
        .unwrap_or_else(|| detail.to_string())
}

fn failed_connection_status(config: &RedisConfig, detail: String) -> RedisConnectionStatus {
    let (stage, message, hint) = diagnose_redis_error(&detail);
    RedisConnectionStatus {
        ok: false,
        message: message.to_string(),
        stage: stage.to_string(),
        endpoint: endpoint_label(config),
        detail: Some(raw_diagnostic_detail(&detail)),
        hint: Some(hint.to_string()),
        latency_ms: None,
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
    if let Err(detail) = validate_config(&config) {
        return Ok(RedisConnectionStatus {
            ok: false,
            message: "Invalid Redis connection settings".to_string(),
            stage: "configuration".to_string(),
            endpoint: endpoint_label(&config),
            detail: Some(detail),
            hint: Some("Check the host, port, and database values in Settings.".to_string()),
            latency_ms: None,
        });
    }

    let started = Instant::now();
    let mut connection = match connect(&config) {
        Ok(connection) => connection,
        Err(detail) => return Ok(failed_connection_status(&config, detail)),
    };
    let response: String = match redis::cmd("PING").query(&mut connection) {
        Ok(response) => response,
        Err(error) => return Ok(failed_connection_status(&config, error.to_string())),
    };
    let latency_ms = Some(started.elapsed().as_millis().min(u64::MAX as u128) as u64);
    Ok(RedisConnectionStatus {
        ok: response == "PONG",
        message: if response == "PONG" {
            "Redis replied to PING".to_string()
        } else {
            "Redis returned an unexpected PING response".to_string()
        },
        stage: "redis".to_string(),
        endpoint: endpoint_label(&config),
        detail: if response == "PONG" {
            None
        } else {
            Some(format!("PING returned {}", response))
        },
        hint: if response == "PONG" {
            None
        } else {
            Some("Confirm that the configured endpoint is a Redis server.".to_string())
        },
        latency_ms,
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

fn validate_redis_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.len() > 4096 {
        return Err("Redis key is invalid or too long".to_string());
    }
    Ok(())
}

fn redis_value_to_json(value: Value) -> JsonValue {
    match value {
        Value::Nil => JsonValue::Null,
        Value::Int(number) => JsonValue::from(number),
        Value::BulkString(bytes) => JsonValue::String(String::from_utf8_lossy(&bytes).into_owned()),
        Value::Array(values) | Value::Set(values) => {
            JsonValue::Array(values.into_iter().map(redis_value_to_json).collect())
        }
        Value::Map(entries) => {
            let mut map = Map::new();
            for (key, value) in entries {
                let key = redis_value_to_text(&key);
                map.insert(key, redis_value_to_json(value));
            }
            JsonValue::Object(map)
        }
        Value::Attribute { data, .. } => redis_value_to_json(*data),
        Value::SimpleString(value) | Value::VerbatimString { text: value, .. } => {
            JsonValue::String(value)
        }
        Value::Okay => JsonValue::String("OK".to_string()),
        Value::Double(number) => serde_json::Number::from_f64(number)
            .map(JsonValue::Number)
            .unwrap_or(JsonValue::Null),
        Value::Boolean(value) => JsonValue::Bool(value),
        Value::BigNumber(number) => JsonValue::String(number.to_string()),
        Value::Push { data, .. } => {
            JsonValue::Array(data.into_iter().map(redis_value_to_json).collect())
        }
        Value::ServerError(error) => JsonValue::String(format!("{:?}", error)),
    }
}

fn redis_value_to_text(value: &Value) -> String {
    match value {
        Value::BulkString(bytes) => String::from_utf8_lossy(bytes).into_owned(),
        Value::SimpleString(value) | Value::VerbatimString { text: value, .. } => value.clone(),
        Value::Int(number) => number.to_string(),
        Value::Double(number) => number.to_string(),
        Value::Boolean(value) => value.to_string(),
        Value::Nil => String::new(),
        other => redis_value_to_json(other.clone()).to_string(),
    }
}

fn redis_scan_items(value: Value) -> Result<(u64, Vec<Value>), String> {
    let Value::Array(mut values) = value else {
        return Err("Redis returned an unexpected scan response".to_string());
    };
    if values.len() != 2 {
        return Err("Redis returned an incomplete scan response".to_string());
    }
    let cursor = redis_value_to_text(&values.remove(0))
        .parse::<u64>()
        .map_err(|_| "Redis returned an invalid scan cursor".to_string())?;
    let items = match values.remove(0) {
        Value::Array(items) | Value::Set(items) => items,
        value => vec![value],
    };
    Ok((cursor, items))
}

fn read_string_value(
    connection: &mut Connection,
    key: &str,
    max_bytes: usize,
) -> Result<(JsonValue, bool), String> {
    let byte_length: usize = redis::cmd("STRLEN")
        .arg(key)
        .query(connection)
        .map_err(redis_error)?;
    if byte_length == 0 {
        return Ok((JsonValue::String(String::new()), false));
    }
    let end = byte_length.min(max_bytes).saturating_sub(1) as isize;
    let bytes: Vec<u8> = redis::cmd("GETRANGE")
        .arg(key)
        .arg(0)
        .arg(end)
        .query(connection)
        .map_err(redis_error)?;
    Ok((
        JsonValue::String(String::from_utf8_lossy(&bytes).into_owned()),
        byte_length > max_bytes,
    ))
}

fn read_collection_value(
    connection: &mut Connection,
    key: &str,
    kind: &str,
    max_items: usize,
) -> Result<(Option<JsonValue>, bool), String> {
    let max_items = max_items.max(1);
    match kind {
        "hash" => {
            let response: Value = redis::cmd("HSCAN")
                .arg(key)
                .arg(0)
                .arg("COUNT")
                .arg(max_items)
                .query(connection)
                .map_err(redis_error)?;
            let (cursor, items) = redis_scan_items(response)?;
            let mut map = Map::new();
            for pair in items.chunks(2) {
                if let [field, value] = pair {
                    map.insert(
                        redis_value_to_text(field),
                        redis_value_to_json(value.clone()),
                    );
                }
            }
            Ok((Some(JsonValue::Object(map)), cursor != 0))
        }
        "list" => {
            let length: usize = redis::cmd("LLEN")
                .arg(key)
                .query(connection)
                .map_err(redis_error)?;
            if length == 0 {
                return Ok((Some(JsonValue::Array(Vec::new())), false));
            }
            let response: Value = redis::cmd("LRANGE")
                .arg(key)
                .arg(0)
                .arg((max_items - 1) as isize)
                .query(connection)
                .map_err(redis_error)?;
            Ok((Some(redis_value_to_json(response)), length > max_items))
        }
        "set" => {
            let response: Value = redis::cmd("SSCAN")
                .arg(key)
                .arg(0)
                .arg("COUNT")
                .arg(max_items)
                .query(connection)
                .map_err(redis_error)?;
            let (cursor, items) = redis_scan_items(response)?;
            Ok((
                Some(JsonValue::Array(
                    items.into_iter().map(redis_value_to_json).collect(),
                )),
                cursor != 0,
            ))
        }
        "zset" => {
            let response: Value = redis::cmd("ZRANGE")
                .arg(key)
                .arg(0)
                .arg((max_items - 1) as isize)
                .arg("WITHSCORES")
                .query(connection)
                .map_err(redis_error)?;
            let items = match response {
                Value::Array(items) | Value::Set(items) => items,
                value => vec![value],
            };
            let mut entries = Vec::new();
            for pair in items.chunks(2) {
                if let [member, score] = pair {
                    let mut entry = Map::new();
                    entry.insert("member".to_string(), redis_value_to_json(member.clone()));
                    entry.insert("score".to_string(), redis_value_to_json(score.clone()));
                    entries.push(JsonValue::Object(entry));
                }
            }
            let length: usize = redis::cmd("ZCARD")
                .arg(key)
                .query(connection)
                .map_err(redis_error)?;
            Ok((Some(JsonValue::Array(entries)), length > max_items))
        }
        "stream" => {
            let response: Value = redis::cmd("XRANGE")
                .arg(key)
                .arg("-")
                .arg("+")
                .arg("COUNT")
                .arg(max_items)
                .query(connection)
                .map_err(redis_error)?;
            let length: usize = redis::cmd("XLEN")
                .arg(key)
                .query(connection)
                .map_err(redis_error)?;
            Ok((Some(redis_value_to_json(response)), length > max_items))
        }
        _ => Ok((None, false)),
    }
}

fn read_value_payload(
    connection: &mut Connection,
    key: &str,
    kind: &str,
    max_bytes: usize,
) -> Result<(Option<JsonValue>, bool, bool), String> {
    if kind == "string" {
        let (value, truncated) = read_string_value(connection, key, max_bytes)?;
        return Ok((Some(value), truncated, true));
    }
    let (value, truncated) =
        read_collection_value(connection, key, kind, MAX_VALUE_COLLECTION_ITEMS)?;
    let supported = value.is_some();
    Ok((value, truncated, supported))
}

fn redis_memory_usage(connection: &mut Connection, key: &str) -> Option<u64> {
    redis::cmd("MEMORY")
        .arg("USAGE")
        .arg(key)
        .query::<Option<u64>>(connection)
        .ok()
        .flatten()
}

fn redis_value_kind(connection: &mut Connection, key: &str) -> Result<String, String> {
    redis::cmd("TYPE")
        .arg(key)
        .query(connection)
        .map_err(redis_error)
}

fn get_value(config: RedisConfig, key: String) -> Result<RedisValueResult, String> {
    validate_redis_key(&key)?;
    let mut connection = connect(&config)?;
    let kind = redis_value_kind(&mut connection, &key)?;
    if kind == "none" {
        return Err("Redis key no longer exists".to_string());
    }
    let ttl_seconds: i64 = redis::cmd("TTL")
        .arg(&key)
        .query(&mut connection)
        .map_err(redis_error)?;
    let memory_bytes = redis_memory_usage(&mut connection, &key);
    let (value, truncated, supported) =
        read_value_payload(&mut connection, &key, &kind, MAX_VALUE_BYTES)?;
    Ok(RedisValueResult {
        key,
        kind,
        ttl_seconds,
        memory_bytes,
        value,
        supported,
        truncated,
    })
}

#[tauri::command]
pub async fn redis_get_value(config: RedisConfig, key: String) -> Result<RedisValueResult, String> {
    tauri::async_runtime::spawn_blocking(move || get_value(config, key))
        .await
        .map_err(|error| format!("Redis value task failed: {}", error))?
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

    #[test]
    fn diagnoses_connection_refused_with_network_guidance() {
        let (stage, message, hint) = diagnose_redis_error("Connection refused (os error 61)");
        assert_eq!(stage, "network");
        assert!(message.contains("refused"));
        assert!(hint.contains("listening"));
    }

    #[test]
    fn diagnoses_authentication_and_tls_failures_separately() {
        assert_eq!(
            diagnose_redis_error("WRONGPASS invalid password").0,
            "authentication"
        );
        assert_eq!(
            diagnose_redis_error("TLS certificate verify failed").0,
            "tls"
        );
    }

    #[test]
    fn diagnoses_database_index_errors_separately() {
        let (stage, message, hint) =
            diagnose_redis_error("ResponseError: DB index is out of range");
        assert_eq!(stage, "database");
        assert!(message.contains("database"));
        assert!(hint.contains("Database"));
    }
}
