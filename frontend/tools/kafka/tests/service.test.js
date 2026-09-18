import { describe, expect, it } from "vitest";
import { MAX_KAFKA_BATCH, parseMessages, rankKafkaTopics, receivedMessageToDraft } from "../service.js";

describe("Kafka message preparation", () => {
  it("creates one record for one JSON request", () => {
    expect(parseMessages('{"cif":"30000758049"}', false, "account-1", '{"source":"ad-tools"}')).toEqual([
      { key: "account-1", value: '{"cif":"30000758049"}', headers: [{ key: "source", value: "ad-tools" }] },
    ]);
  });

  it("maps each array element to exactly one message", () => {
    const records = parseMessages('[{"id":1},{"id":2}]', true);
    expect(records.map((record) => record.value)).toEqual(['{"id":1}', '{"id":2}']);
    expect(records).toHaveLength(2);
  });

  it("rejects invalid or oversized bulk input before publishing", () => {
    expect(() => parseMessages('{"id":1}', true)).toThrow("JSON array");
    expect(() => parseMessages("[]", true)).toThrow("1 to 100");
    expect(() => parseMessages(JSON.stringify(Array.from({ length: MAX_KAFKA_BATCH + 1 }, (_, id) => ({ id }))), true)).toThrow("1 to 100");
    expect(() => parseMessages("{bad", false)).toThrow("valid JSON");
  });

  it("requires string header values", () => {
    expect(() => parseMessages("{}", false, "", '{"retry":3}')).toThrow("Headers");
  });

  it("copies a received JSON message and its headers into a publish draft", () => {
    const draft = receivedMessageToDraft({
      topic: "orders.test", key: " key ", value: '{"id":1}',
      headers: [{ key: "source", value: "uat" }, { key: "traceId", value: "abc" }],
      keyIsUtf8: true, valueIsUtf8: true,
    });
    expect(draft).toEqual({ topic: "orders.test", key: " key ", headers: '{\n  "source": "uat",\n  "traceId": "abc"\n}', value: '{"id":1}' });
    expect(parseMessages(draft.value, false, draft.key, draft.headers)[0].key).toBe(" key ");
  });

  it("rejects received messages whose content cannot be reproduced by the JSON publisher", () => {
    const message = { topic: "orders.test", key: null, value: '{}', headers: [{ key: "x", value: "a" }] };
    expect(() => receivedMessageToDraft({ ...message, headers: undefined })).toThrow("Restart the desktop app");
    expect(() => receivedMessageToDraft({ ...message, value: "plain text" })).toThrow("not valid JSON");
    expect(() => receivedMessageToDraft({ ...message, headers: [...message.headers, { key: "x", value: "b" }] })).toThrow("duplicate");
    expect(() => receivedMessageToDraft({ ...message, headers: [{ key: "x", value: null }] })).toThrow("null");
  });
});

describe("Kafka topic matching", () => {
  const topics = ["streaming.gold.bullion.saving.prebook.execution.consumer-uat1", "orders.created", "orders.failed", "audit.events"];

  it("ranks exact, prefix, segment, and fuzzy matches without fetching for each query", () => {
    expect(rankKafkaTopics(topics, "orders.created")[0]).toBe("orders.created");
    expect(rankKafkaTopics(topics, "prebook")).toEqual([topics[0]]);
    expect(rankKafkaTopics(topics, "sgpcu")).toEqual([topics[0]]);
    expect(rankKafkaTopics(topics, "orders", 1)).toHaveLength(1);
  });

  it("matches space-separated terms across dots, dashes, and intervening words", () => {
    const names = [
      "streaming.notification.event",
      "streaming-notification-event",
      "streaming-event-uat1",
      "event.streaming",
      "streaming.notification.audit",
    ];
    expect(rankKafkaTopics(names, "streaming event")).toEqual([
      "streaming-event-uat1",
      "streaming-notification-event",
      "streaming.notification.event",
    ]);
    expect(rankKafkaTopics(names, "  STREAMING   event  ")).toEqual(rankKafkaTopics(names, "streaming event"));
    expect(rankKafkaTopics(names, "event streaming")).toEqual(["event.streaming"]);
  });
});
