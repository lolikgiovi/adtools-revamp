export const KAFKA_CONFIG_KEY = "tool:kafka:connection";
export const KAFKA_REQUESTS_KEY = "tool:kafka:requests";
export const MAX_KAFKA_BATCH = 100;

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

export function parseMessages(value, bulk, key = "", headersText = "{}") {
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
  if (bulk && (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > MAX_KAFKA_BATCH)) {
    throw new Error(`Bulk value must be a JSON array with 1 to ${MAX_KAFKA_BATCH} elements.`);
  }
  const values = bulk ? parsed : [parsed];
  const recordHeaders = Object.entries(headers).map(([name, text]) => ({ key: name, value: text }));
  return values.map((item) => ({ key: key === "" ? null : key, value: JSON.stringify(item), headers: recordHeaders }));
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
    const config = JSON.parse(storage.getItem(KAFKA_CONFIG_KEY) || "{}");
    return { brokers: String(config.brokers || ""), securityProtocol: "PLAINTEXT" };
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

export class KafkaService {
  constructor({ invoke, listen } = {}) {
    this.invoke = invoke;
    this.listen = listen;
  }

  async call(command, args) {
    if (!this.invoke) this.invoke = (await import("@tauri-apps/api/core")).invoke;
    return this.invoke(command, args);
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
