// Kafka reports failed operations and history searches that find nothing, labelled by broker profile.
// Ways it could go wrong: a failed publish, partial publish, connection test, topic browse, listen or history search goes
// unreported; an invalid message reports as a server failure; the broker host, topic, search text or error text leaks;
// a profile named after its host is reported as an environment label; a history search with matches reports as empty.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsageTracker } from "../../../core/UsageTracker.js";
import { KafkaTool } from "../main.js";
import { KAFKA_ACTIVE_BROKER_KEY, KAFKA_BROKERS_KEY } from "../service.js";

vi.mock("../../../core/UsageTracker.js", () => ({
  UsageTracker: { trackToolUse: vi.fn(), trackEvent: vi.fn(), trackFailure: vi.fn() },
}));

function mount(service, name = "SIT") {
  const profile = { id: "p1", name, brokers: "kafka.secret-host.internal:9092" };
  localStorage.setItem(KAFKA_BROKERS_KEY, JSON.stringify([profile]));
  localStorage.setItem(KAFKA_ACTIVE_BROKER_KEY, profile.id);
  const tool = new KafkaTool(null, service);
  tool.mount(document.querySelector("#tool"));
  tool.isActive = true;
  return tool;
}

const failures = () => UsageTracker.trackFailure.mock.calls.map(([tool, action, error, meta]) => ({ tool, action, error, meta }));
const leaked = () => JSON.stringify([UsageTracker.trackEvent.mock.calls, UsageTracker.trackFailure.mock.calls.map((call) => call[3])]);

describe("Kafka insight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="tool"></div>';
    localStorage.clear();
  });

  it("reports a failed publish with the broker profile label and never the host or topic", async () => {
    const tool = mount({ publish: vi.fn().mockRejectedValue("Broker transport failure: kafka.secret-host.internal") });
    document.querySelector("#kafkaTopic").value = "orders.secret-topic";
    document.querySelector("#kafkaValue").value = '{"a":1}';
    await tool.publish();
    expect(failures()).toEqual([
      { tool: "kafka", action: "publish", error: expect.any(Error), meta: { broker_profile: "SIT", message_count: 1 } },
    ]);
    expect(leaked()).not.toMatch(/secret/);
  });

  it("reports a publish that stopped part way, and an invalid message as invalid input", async () => {
    const tool = mount({
      publish: vi.fn().mockResolvedValue({ delivered: [{ index: 0, partition: 0, offset: 1 }], failedAt: 1, error: "x" }),
    });
    document.querySelector("#kafkaTopic").value = "orders";
    document.querySelector("#kafkaValue").value = '{"a":1}';
    await tool.publish();
    document.querySelector("#kafkaValue").value = "{not json";
    await tool.publish();
    expect(failures().map(({ action, error, meta }) => [action, error instanceof Error ? "error" : error, meta])).toEqual([
      ["publish", "error", { broker_profile: "SIT", message_count: 1, delivered_count: 1 }],
      ["publish", "invalid_input", { broker_profile: "SIT" }],
    ]);
  });

  it("leaves out a profile label that looks like a host", async () => {
    const tool = mount({ test: vi.fn().mockRejectedValue("refused") }, "kafka.secret-host.internal:9092");
    await tool.testConnection();
    expect(failures()).toEqual([{ tool: "kafka", action: "test_connection", error: expect.any(Error), meta: {} }]);
  });

  it("reports failed topic browsing, listening and history search", async () => {
    const tool = mount({
      listTopics: vi.fn().mockRejectedValue("refused"),
      on: vi.fn().mockResolvedValue(() => {}),
      start: vi.fn().mockRejectedValue("refused"),
      searchHistory: vi.fn().mockRejectedValue("timed out"),
    });
    await tool.loadTopics(true);
    document.querySelector("#kafkaListenTopic").value = "orders";
    await tool.startListening();
    document.querySelector("#kafkaHistoryQuery").value = "abc-secret";
    await tool.searchHistory();
    expect(failures().map(({ action }) => action)).toEqual(["browse_topics", "listen", "history_search"]);
    expect(leaked()).not.toMatch(/secret/);
  });

  it("reports an empty history search by its shape only", async () => {
    const tool = mount({ searchHistory: vi.fn().mockResolvedValue({ matches: [], scanned: 500, limited: false }) });
    document.querySelector("#kafkaListenTopic").value = "orders";
    document.querySelector("#kafkaHistoryQuery").value = "abc-secret";
    await tool.searchHistory();
    expect(UsageTracker.trackEvent).toHaveBeenCalledWith(
      "kafka",
      "history_empty",
      expect.objectContaining({ broker_profile: "SIT", scanned_count: 500 }),
    );
    expect(leaked()).not.toMatch(/secret/);
  });
});
