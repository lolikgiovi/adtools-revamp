export const KAFKA_CONFIG_KEY = "tool:kafka:connection";
export const KAFKA_BROKERS_KEY = "tool:kafka:brokers";
export const KAFKA_ACTIVE_BROKER_KEY = "tool:kafka:active-broker";
export const KAFKA_TABS_KEY = "tool:kafka:tabs";
export const KAFKA_REQUESTS_KEY = "tool:kafka:requests";
export const KAFKA_TOPIC_FAVORITES_KEY = "tool:kafka:topic-favorites";

function stableBrokerId(brokers) {
  let hash = 2166136261;
  for (const char of brokers) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `kafka-${(hash >>> 0).toString(36)}`;
}

function profileFrom(value, index = 0) {
  const brokers = String(value?.brokers || "").trim();
  if (!brokers) return null;
  const fallbackName = brokers.split(",")[0].trim() || `Broker ${index + 1}`;
  return {
    id: String(value?.id || "").trim() || stableBrokerId(brokers),
    name: String(value?.name || value?.label || fallbackName).trim() || fallbackName,
    brokers,
  };
}

function migrateKafkaBrokerProfiles(storage) {
  const legacyBrokers = new Set();
  try {
    const legacy = JSON.parse(storage.getItem(KAFKA_CONFIG_KEY) || "{}");
    const brokers = String(legacy?.brokers || "").trim();
    if (brokers) legacyBrokers.add(brokers);
  } catch (_) {}
  try {
    const session = JSON.parse(storage.getItem(KAFKA_TABS_KEY) || "null");
    for (const tab of Array.isArray(session?.tabs) ? session.tabs : []) {
      const brokers = String(tab?.brokers || "").trim();
      if (brokers) legacyBrokers.add(brokers);
    }
  } catch (_) {}

  return [...legacyBrokers].map((brokers, index) => profileFrom({
    id: stableBrokerId(brokers),
    name: brokers.split(",")[0].trim() || `Broker ${index + 1}`,
    brokers,
  }, index));
}

export function readKafkaBrokerProfiles(storage = localStorage) {
  try {
    let raw = storage.getItem(KAFKA_BROKERS_KEY);
    if (raw === null) {
      const migrated = migrateKafkaBrokerProfiles(storage).filter(Boolean);
      storage.setItem(KAFKA_BROKERS_KEY, JSON.stringify(migrated));
      if (migrated.length && !storage.getItem(KAFKA_ACTIVE_BROKER_KEY)) {
        storage.setItem(KAFKA_ACTIVE_BROKER_KEY, migrated[0].id);
      }
      return migrated;
    }
    const profiles = JSON.parse(raw);
    return Array.isArray(profiles) ? profiles.map(profileFrom).filter(Boolean) : [];
  } catch (_) {
    return [];
  }
}

export function readKafkaActiveBrokerId(storage = localStorage) {
  const profiles = readKafkaBrokerProfiles(storage);
  try {
    const selected = storage.getItem(KAFKA_ACTIVE_BROKER_KEY);
    return profiles.some((profile) => profile.id === selected) ? selected : profiles[0]?.id || "";
  } catch (_) {
    return profiles[0]?.id || "";
  }
}

export function saveKafkaBrokerProfiles(value, storage = localStorage) {
  const profiles = (Array.isArray(value) ? value : []).map(profileFrom).filter(Boolean);
  storage.setItem(KAFKA_BROKERS_KEY, JSON.stringify(profiles));
  const selected = storage.getItem(KAFKA_ACTIVE_BROKER_KEY);
  if (!profiles.some((profile) => profile.id === selected)) {
    if (profiles.length) storage.setItem(KAFKA_ACTIVE_BROKER_KEY, profiles[0].id);
    else storage.removeItem(KAFKA_ACTIVE_BROKER_KEY);
  }
  globalThis.dispatchEvent?.(new Event("adtools:kafka-brokers-changed"));
  globalThis.dispatchEvent?.(new Event("adtools:connection-settings-changed"));
  return profiles;
}

export function saveKafkaActiveBroker(id, storage = localStorage) {
  const profiles = readKafkaBrokerProfiles(storage);
  const selected = profiles.find((profile) => profile.id === id);
  if (selected) storage.setItem(KAFKA_ACTIVE_BROKER_KEY, selected.id);
  else storage.removeItem(KAFKA_ACTIVE_BROKER_KEY);
  globalThis.dispatchEvent?.(new Event("adtools:connection-settings-changed"));
  return selected || null;
}

export function rankKafkaTopics(topics, query, limit = 40) {
  const needle = String(query || "").trim().toLowerCase();
  const terms = needle.split(/\s+/);
  const matches = [];
  for (const topic of topics) {
    const name = topic.toLowerCase();
    let score = 0;
    let distance = 0;
    if (terms.length > 1) {
      let cursor = 0;
      let matched = true;
      for (const term of terms) {
        const index = name.indexOf(term, cursor);
        if (index === -1) { matched = false; break; }
        distance += index - cursor;
        cursor = index + term.length;
      }
      if (matched) score = name.startsWith(terms[0]) ? 3 : 2;
    } else if (needle) {
      if (name === needle) score = 5;
      else if (name.startsWith(needle)) score = 4;
      else if (name.split(/[._-]/).some((segment) => segment.startsWith(needle))) score = 3;
      else if (name.includes(needle)) score = 2;
      else {
        let index = 0;
        for (const char of name) if (char === needle[index]) index++;
        if (index === needle.length) score = 1;
      }
    } else score = 1;
    if (score) matches.push({ topic, score, distance });
  }
  matches.sort((a, b) => b.score - a.score || a.distance - b.distance || a.topic.localeCompare(b.topic));
  return matches.slice(0, limit).map(({ topic }) => topic);
}

export function parseMessages(value, key = "", headersText = "{}") {
  let parsed;
  let headers;
  try {
    parsed = JSON.parse(value);
    headers = JSON.parse(headersText || "{}");
  } catch (error) {
    throw new Error("Value and headers must contain valid JSON.", { cause: error });
  }
  if (!headers || Array.isArray(headers) || typeof headers !== "object" ||
      Object.entries(headers).some(([name, text]) => !name || typeof text !== "string")) {
    throw new Error("Headers must be a JSON object with string values.");
  }
  const recordHeaders = Object.entries(headers).map(([name, text]) => ({ key: name, value: text }));
  return [{ key: key === "" ? null : key, value: JSON.stringify(parsed), headers: recordHeaders }];
}

export function receivedMessageToDraft(message) {
  if (!Array.isArray(message.headers)) throw new Error("Restart the desktop app to load message headers into Publish.");
  if (message.keyIsUtf8 === false || message.valueIsUtf8 === false) {
    throw new Error("This message contains a non-text key or value that the JSON publisher cannot reproduce.");
  }
  try { JSON.parse(message.value); }
  catch (error) { throw new Error("This message value is not valid JSON and cannot be loaded into Publish.", { cause: error }); }
  const headers = Object.create(null);
  for (const header of message.headers) {
    if (!header.key || typeof header.value !== "string" || Object.hasOwn(headers, header.key)) {
      throw new Error("This message has duplicate, null, or non-text headers that the JSON publisher cannot reproduce.");
    }
    headers[header.key] = header.value;
  }
  return {
    topic: message.topic,
    key: message.key ?? "",
    headers: JSON.stringify(headers, null, 2),
    value: message.value,
  };
}

export function readKafkaConfig(storage = localStorage) {
  try {
    const profiles = readKafkaBrokerProfiles(storage);
    const selectedId = readKafkaActiveBrokerId(storage);
    const selected = profiles.find((profile) => profile.id === selectedId) || profiles[0];
    return { brokers: selected?.brokers || "", securityProtocol: "PLAINTEXT" };
  } catch (_) {
    return { brokers: "", securityProtocol: "PLAINTEXT" };
  }
}

export function readKafkaRequests(storage = localStorage) {
  try {
    const requests = JSON.parse(storage.getItem(KAFKA_REQUESTS_KEY) || "[]");
    return Array.isArray(requests) ? requests.filter((item) => item && typeof item.name === "string").slice(0, 30) : [];
  } catch (_) {
    return [];
  }
}

export function readKafkaTopicFavorites(storage = localStorage) {
  try {
    const topics = JSON.parse(storage.getItem(KAFKA_TOPIC_FAVORITES_KEY) || "[]");
    return Array.isArray(topics) ? topics.filter((topic) => typeof topic === "string" && topic.trim()).slice(0, 100) : [];
  } catch (_) {
    return [];
  }
}

export class KafkaService {
  constructor({ invoke, listen } = {}) {
    this.invoke = invoke;
    this.listen = listen;
  }

  async call(command, args) {
    if (!this.invoke) this.invoke = (await import("@tauri-apps/api/core")).invoke;
    const detail = { service: "kafka", command, phase: "start", label: args?.config?.brokers || "" };
    globalThis.dispatchEvent?.(new CustomEvent("adtools:connection-activity", { detail }));
    try {
      const result = await this.invoke(command, args);
      globalThis.dispatchEvent?.(new CustomEvent("adtools:connection-activity", {
        detail: { ...detail, phase: "finish", success: true },
      }));
      return result;
    } catch (error) {
      globalThis.dispatchEvent?.(new CustomEvent("adtools:connection-activity", {
        detail: { ...detail, phase: "finish", success: false },
      }));
      throw error;
    }
  }

  async on(event, handler) {
    if (!this.listen) this.listen = (await import("@tauri-apps/api/event")).listen;
    return this.listen(event, handler);
  }

  test(config) { return this.call("kafka_test_connection", { config }); }
  listTopics(config) { return this.call("kafka_list_topics", { config }); }
  searchHistory(config, topic, query, sinceMs) { return this.call("kafka_search_history", { config, topic, query, sinceMs }); }
  publish(config, topic, records) { return this.call("kafka_publish", { config, topic, records }); }
  start(config, topic, fromBeginning) { return this.call("kafka_start_listener", { config, topic, fromBeginning }); }
  stop() { return this.call("kafka_stop_listener", {}); }
}
