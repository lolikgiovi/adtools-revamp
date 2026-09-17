export const KAFKA_CONFIG_KEY = "tool:kafka:connection";
export const KAFKA_REQUESTS_KEY = "tool:kafka:requests";
export const MAX_KAFKA_BATCH = 100;

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
  return values.map((item) => ({ key: key.trim() || null, value: JSON.stringify(item), headers: recordHeaders }));
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
  publish(config, topic, records) { return this.call("kafka_publish", { config, topic, records }); }
  start(config, topic, fromBeginning) { return this.call("kafka_start_listener", { config, topic, fromBeginning }); }
  stop() { return this.call("kafka_stop_listener", {}); }
}
