use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};

use rdkafka::config::ClientConfig;
use rdkafka::consumer::{BaseConsumer, Consumer};
use rdkafka::message::{Header, Message, OwnedHeaders};
use rdkafka::producer::{FutureProducer, FutureRecord};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

const MAX_BATCH: usize = 100;
const MAX_MESSAGE_BYTES: usize = 1_048_576;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KafkaConfig {
    brokers: String,
    security_protocol: String,
}

impl KafkaConfig {
    fn client(&self) -> Result<ClientConfig, String> {
        let brokers: Vec<&str> = self
            .brokers
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .collect();
        if brokers.is_empty()
            || brokers.len() > 10
            || brokers.iter().any(|s| !s.contains(':') || s.len() > 255)
        {
            return Err("Enter 1 to 10 broker addresses as host:port.".into());
        }
        if self.security_protocol != "PLAINTEXT" {
            return Err("Only PLAINTEXT is configured for this connection. Secure broker authentication is not yet available.".into());
        }
        let mut config = ClientConfig::new();
        config
            .set("bootstrap.servers", brokers.join(","))
            .set("security.protocol", "PLAINTEXT")
            .set("socket.timeout.ms", "5000")
            .set("message.timeout.ms", "10000");
        Ok(config)
    }
}

#[derive(Deserialize)]
pub struct KafkaHeader {
    key: String,
    value: String,
}

#[derive(Deserialize)]
pub struct KafkaRecord {
    key: Option<String>,
    value: String,
    headers: Vec<KafkaHeader>,
}

#[derive(Serialize)]
pub struct Delivery {
    index: usize,
    partition: i32,
    offset: i64,
}

#[derive(Serialize)]
pub struct PublishResult {
    delivered: Vec<Delivery>,
    failed_at: Option<usize>,
    error: Option<String>,
}

#[derive(Default)]
pub struct PublishGuard(Mutex<PublishState>);

#[derive(Default)]
struct PublishState {
    busy: bool,
    last_started: Option<Instant>,
}

struct ActivePublish<'a>(&'a PublishGuard);

impl Drop for ActivePublish<'_> {
    fn drop(&mut self) {
        if let Ok(mut state) = self.0 .0.lock() {
            state.busy = false;
        }
    }
}

impl PublishGuard {
    fn start(&self) -> Result<ActivePublish<'_>, String> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| "Publisher unavailable".to_string())?;
        if state.busy {
            return Err("A publish is already in progress.".into());
        }
        if state
            .last_started
            .is_some_and(|last| last.elapsed() < Duration::from_secs(3))
        {
            return Err("Wait three seconds before another publish.".into());
        }
        state.busy = true;
        state.last_started = Some(Instant::now());
        Ok(ActivePublish(self))
    }
}

fn validate_topic(topic: &str) -> Result<(), String> {
    if topic.is_empty() || topic.len() > 249 || topic.chars().any(|c| c.is_whitespace()) {
        return Err("Enter a valid topic name.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn kafka_test_connection(config: KafkaConfig) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client: BaseConsumer = config.client()?.create().map_err(|e| e.to_string())?;
        client
            .fetch_metadata(None, Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        Ok("Connected to Kafka".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn kafka_publish(
    config: KafkaConfig,
    topic: String,
    records: Vec<KafkaRecord>,
    guard: State<'_, PublishGuard>,
) -> Result<PublishResult, String> {
    validate_topic(&topic)?;
    if records.is_empty() || records.len() > MAX_BATCH {
        return Err("Send between 1 and 100 messages per click.".into());
    }
    for record in &records {
        if record.value.len() > MAX_MESSAGE_BYTES {
            return Err("Each message must be 1 MB or less.".into());
        }
        if serde_json::from_str::<serde_json::Value>(&record.value).is_err() {
            return Err("Every message value must be valid JSON.".into());
        }
        if record.headers.len() > 20
            || record
                .headers
                .iter()
                .any(|h| h.key.is_empty() || h.key.len() > 128 || h.value.len() > 4096)
        {
            return Err("Use at most 20 headers with short names and values.".into());
        }
    }
    let _active = guard.start()?;
    let mut client = config.client()?;
    client.set("enable.idempotence", "true");
    let producer: FutureProducer = client.create().map_err(|e| e.to_string())?;
    let mut result = PublishResult {
        delivered: Vec::new(),
        failed_at: None,
        error: None,
    };
    for (index, item) in records.iter().enumerate() {
        let mut record = FutureRecord::<str, str>::to(&topic).payload(&item.value);
        if let Some(key) = item.key.as_deref() {
            record = record.key(key);
        }
        if !item.headers.is_empty() {
            let mut headers = OwnedHeaders::new();
            for header in &item.headers {
                headers = headers.insert(Header {
                    key: &header.key,
                    value: Some(&header.value),
                });
            }
            record = record.headers(headers);
        }
        match producer.send(record, Duration::from_secs(10)).await {
            Ok(delivery) => result.delivered.push(Delivery {
                index,
                partition: delivery.partition,
                offset: delivery.offset,
            }),
            Err((error, _)) => {
                result.failed_at = Some(index);
                result.error = Some(error.to_string());
                break;
            }
        }
        if index + 1 < records.len() {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
    Ok(result)
}

#[derive(Default)]
pub struct ListenerState(Mutex<Option<Arc<AtomicBool>>>);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ReceivedMessage {
    topic: String,
    partition: i32,
    offset: i64,
    key: Option<String>,
    value: String,
    timestamp: Option<i64>,
}

#[tauri::command]
pub fn kafka_start_listener(
    app: AppHandle,
    config: KafkaConfig,
    topic: String,
    from_beginning: bool,
    state: State<'_, ListenerState>,
) -> Result<(), String> {
    validate_topic(&topic)?;
    let mut client = config.client()?;
    client
        .set(
            "group.id",
            format!(
                "adtools-preview-{}-{}",
                std::process::id(),
                chrono::Utc::now().timestamp_millis()
            ),
        )
        .set("enable.auto.commit", "false")
        .set(
            "auto.offset.reset",
            if from_beginning { "earliest" } else { "latest" },
        );
    let consumer: BaseConsumer = client.create().map_err(|e| e.to_string())?;
    consumer.subscribe(&[&topic]).map_err(|e| e.to_string())?;
    let running = Arc::new(AtomicBool::new(true));
    {
        let mut slot = state
            .0
            .lock()
            .map_err(|_| "Listener unavailable".to_string())?;
        if slot
            .as_ref()
            .is_some_and(|flag| flag.load(Ordering::SeqCst))
        {
            return Err("Listener already running.".into());
        }
        *slot = Some(running.clone());
    }
    std::thread::spawn(move || {
        while running.load(Ordering::SeqCst) {
            match consumer.poll(Duration::from_millis(250)) {
                Some(Ok(message)) => {
                    let payload = ReceivedMessage {
                        topic: message.topic().to_string(),
                        partition: message.partition(),
                        offset: message.offset(),
                        key: message
                            .key()
                            .map(|bytes| String::from_utf8_lossy(bytes).to_string()),
                        value: message
                            .payload()
                            .map(|bytes| String::from_utf8_lossy(bytes).to_string())
                            .unwrap_or_default(),
                        timestamp: message.timestamp().to_millis(),
                    };
                    if app.emit("kafka-message", payload).is_err() {
                        break;
                    }
                }
                Some(Err(error)) => {
                    let _ = app.emit("kafka-listener-error", error.to_string());
                    break;
                }
                None => {}
            }
        }
        running.store(false, Ordering::SeqCst);
    });
    Ok(())
}

#[tauri::command]
pub fn kafka_stop_listener(state: State<'_, ListenerState>) -> Result<(), String> {
    if let Some(running) = state
        .0
        .lock()
        .map_err(|_| "Listener unavailable".to_string())?
        .take()
    {
        running.store(false, Ordering::SeqCst);
    }
    Ok(())
}
