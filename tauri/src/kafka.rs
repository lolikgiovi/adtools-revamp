use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};

use rdkafka::config::ClientConfig;
use rdkafka::consumer::{BaseConsumer, Consumer};
use rdkafka::message::{Header, Headers, Message, OwnedHeaders};
use rdkafka::producer::{FutureProducer, FutureRecord};
use rdkafka::topic_partition_list::{Offset, TopicPartitionList};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

const MAX_BATCH: usize = 100;
const MAX_MESSAGE_BYTES: usize = 1_048_576;
const MAX_SEARCH_RECORDS: usize = 50_000;
const MAX_SEARCH_MATCHES: usize = 20;
const MANUAL_CONNECTION_IDLE: Duration = Duration::from_secs(120);

pub struct KafkaConnectionState {
    session: Arc<Mutex<Option<KafkaManualConnection>>>,
    next_id: AtomicU64,
}

struct KafkaManualConnection {
    _consumer: BaseConsumer,
    brokers: String,
    last_used: Instant,
    id: u64,
}

impl Default for KafkaConnectionState {
    fn default() -> Self {
        Self { session: Arc::new(Mutex::new(None)), next_id: AtomicU64::new(1) }
    }
}

#[tauri::command]
pub async fn kafka_connect(config: KafkaConfig, state: State<'_, KafkaConnectionState>) -> Result<String, String> {
    let brokers = config.brokers.trim().to_string();
    let consumer = tauri::async_runtime::spawn_blocking(move || {
        let consumer: BaseConsumer = config.client()?.create().map_err(|e| e.to_string())?;
        consumer.fetch_metadata(None, Duration::from_secs(5)).map_err(|e| e.to_string())?;
        Ok::<_, String>(consumer)
    }).await.map_err(|e| e.to_string())??;
    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    let session = state.session.clone();
    {
        let mut guard = session.lock().map_err(|_| "Kafka connection unavailable".to_string())?;
        *guard = Some(KafkaManualConnection { _consumer: consumer, brokers: brokers.clone(), last_used: Instant::now(), id });
    }
    tauri::async_runtime::spawn(async move {
        loop {
            let remaining = {
                let Ok(mut guard) = session.lock() else { return; };
                let Some(active) = guard.as_ref() else { return; };
                if active.id != id { return; }
                let remaining = MANUAL_CONNECTION_IDLE.saturating_sub(active.last_used.elapsed());
                if remaining.is_zero() { guard.take(); return; }
                remaining
            };
            tokio::time::sleep(remaining).await;
        }
    });
    Ok(brokers)
}

#[tauri::command]
pub fn kafka_disconnect(state: State<'_, KafkaConnectionState>, listener: State<'_, ListenerState>) -> Result<(), String> {
    if let Some(running) = listener.0.lock().map_err(|_| "Listener unavailable".to_string())?.take() {
        running.store(false, Ordering::SeqCst);
    }
    state.session.lock().map_err(|_| "Kafka connection unavailable".to_string())?.take();
    Ok(())
}

#[tauri::command]
pub fn kafka_connection_status(state: State<'_, KafkaConnectionState>) -> Result<Option<String>, String> {
    let mut guard = state.session.lock().map_err(|_| "Kafka connection unavailable".to_string())?;
    if guard.as_ref().is_some_and(|active| active.last_used.elapsed() >= MANUAL_CONNECTION_IDLE) {
        guard.take();
    }
    Ok(guard.as_ref().map(|active| active.brokers.clone()))
}

#[tauri::command]
pub fn kafka_connection_touch(state: State<'_, KafkaConnectionState>) -> Result<(), String> {
    if let Some(active) = state.session.lock().map_err(|_| "Kafka connection unavailable".to_string())?.as_mut() {
        active.last_used = Instant::now();
    }
    Ok(())
}

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
pub async fn kafka_list_topics(config: KafkaConfig) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client: BaseConsumer = config.client()?.create().map_err(|e| e.to_string())?;
        let metadata = client
            .fetch_metadata(None, Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        let mut topics: Vec<String> = metadata
            .topics()
            .iter()
            .filter(|topic| topic.error().is_none())
            .map(|topic| topic.name().to_string())
            .collect();
        topics.sort_unstable();
        topics.dedup();
        Ok(topics)
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
        if record
            .headers
            .iter()
            .any(|h| h.key.is_empty() || h.key.len() > 128 || h.value.len() > 4096)
        {
            return Err("Use headers with names up to 128 bytes and values up to 4 KB.".into());
        }
        let header_bytes: usize = record.headers.iter().map(|h| h.key.len() + h.value.len()).sum();
        if record.value.len() + record.key.as_ref().map_or(0, String::len) + header_bytes > MAX_MESSAGE_BYTES {
            return Err("Each message, including its key and headers, must be 1 MB or less.".into());
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
    key_is_utf8: bool,
    value: String,
    value_is_utf8: bool,
    headers: Vec<ReceivedHeader>,
    timestamp: Option<i64>,
}

#[derive(Serialize, Clone)]
struct ReceivedHeader {
    key: String,
    value: Option<String>,
}

impl ReceivedMessage {
    fn from_message(message: &impl Message) -> Self {
        Self {
            topic: message.topic().to_string(),
            partition: message.partition(),
            offset: message.offset(),
            key: message
                .key()
                .map(|bytes| String::from_utf8_lossy(bytes).to_string()),
            key_is_utf8: message
                .key()
                .map_or(true, |bytes| std::str::from_utf8(bytes).is_ok()),
            value: message
                .payload()
                .map(|bytes| String::from_utf8_lossy(bytes).to_string())
                .unwrap_or_default(),
            value_is_utf8: message
                .payload()
                .map_or(true, |bytes| std::str::from_utf8(bytes).is_ok()),
            headers: message
                .headers()
                .map(|headers| {
                    headers
                        .iter()
                        .map(|header| ReceivedHeader {
                            key: header.key.to_string(),
                            value: header
                                .value
                                .and_then(|bytes| std::str::from_utf8(bytes).ok())
                                .map(str::to_string),
                        })
                        .collect()
                })
                .unwrap_or_default(),
            timestamp: message.timestamp().to_millis(),
        }
    }

    fn matches(&self, query: &str) -> bool {
        self.value.to_lowercase().contains(query)
            || self
                .key
                .as_ref()
                .is_some_and(|key| key.to_lowercase().contains(query))
            || self.headers.iter().any(|header| {
                header.key.to_lowercase().contains(query)
                    || header
                        .value
                        .as_ref()
                        .is_some_and(|value| value.to_lowercase().contains(query))
            })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    matches: Vec<ReceivedMessage>,
    scanned: usize,
    limited: bool,
}

#[tauri::command]
pub async fn kafka_search_history(
    config: KafkaConfig,
    topic: String,
    query: String,
    since_ms: i64,
) -> Result<SearchResult, String> {
    validate_topic(&topic)?;
    let query = query.trim().to_lowercase();
    if query.len() < 3 || query.len() > 200 {
        return Err("Enter an identifier of 3 to 200 characters.".into());
    }
    let now = chrono::Utc::now().timestamp_millis();
    if since_ms < 0 || since_ms > now {
        return Err("Choose a start time in the past.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut client = config.client()?;
        client
            .set(
                "group.id",
                format!("adtools-search-{}-{}", std::process::id(), now),
            )
            .set("enable.auto.commit", "false")
            .set("enable.partition.eof", "true");
        let consumer: BaseConsumer = client.create().map_err(|e| e.to_string())?;
        let metadata = consumer
            .fetch_metadata(Some(&topic), Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        let partitions = metadata
            .topics()
            .iter()
            .find(|item| item.name() == topic && item.error().is_none())
            .ok_or_else(|| "Topic unavailable or access denied.".to_string())?
            .partitions();
        if partitions.is_empty() {
            return Ok(SearchResult {
                matches: vec![],
                scanned: 0,
                limited: false,
            });
        }
        let mut timestamps = TopicPartitionList::new();
        let mut ends = std::collections::HashMap::new();
        for partition in partitions {
            let id = partition.id();
            let (_, high) = consumer
                .fetch_watermarks(&topic, id, Duration::from_secs(5))
                .map_err(|e| e.to_string())?;
            ends.insert(id, high);
            timestamps
                .add_partition_offset(&topic, id, Offset::Offset(since_ms))
                .map_err(|e| e.to_string())?;
        }
        let starts = consumer
            .offsets_for_times(timestamps, Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        let mut assignment = TopicPartitionList::new();
        let mut remaining = std::collections::HashSet::new();
        for entry in starts.elements() {
            let end = ends[&entry.partition()];
            let start = match entry.offset() {
                Offset::Offset(offset) => offset,
                Offset::Invalid => end,
                _ => return Err("Could not resolve a start offset for a partition.".into()),
            };
            if start < end {
                assignment
                    .add_partition_offset(&topic, entry.partition(), Offset::Offset(start))
                    .map_err(|e| e.to_string())?;
                remaining.insert(entry.partition());
            }
        }
        if remaining.is_empty() {
            return Ok(SearchResult {
                matches: vec![],
                scanned: 0,
                limited: false,
            });
        }
        consumer.assign(&assignment).map_err(|e| e.to_string())?;
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut result = SearchResult {
            matches: vec![],
            scanned: 0,
            limited: false,
        };
        while !remaining.is_empty()
            && result.scanned < MAX_SEARCH_RECORDS
            && result.matches.len() < MAX_SEARCH_MATCHES
            && Instant::now() < deadline
        {
            match consumer.poll(Duration::from_millis(200)) {
                Some(Ok(message)) => {
                    if !remaining.contains(&message.partition()) {
                        continue;
                    }
                    if message.offset() >= ends[&message.partition()] - 1 {
                        remaining.remove(&message.partition());
                    }
                    if message.offset() >= ends[&message.partition()] {
                        continue;
                    }
                    result.scanned += 1;
                    let received = ReceivedMessage::from_message(&message);
                    if received.matches(&query) {
                        result.matches.push(received);
                    }
                }
                Some(Err(rdkafka::error::KafkaError::PartitionEOF(partition))) => {
                    remaining.remove(&partition);
                }
                Some(Err(error)) => return Err(error.to_string()),
                None => {}
            }
        }
        result.limited = !remaining.is_empty();
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
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
                    let payload = ReceivedMessage::from_message(&message);
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
