import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsageTracker } from "../../../core/UsageTracker.js";
import { KafkaService, KAFKA_BROKERS_KEY } from "../service.js";

vi.mock("../../../core/UsageTracker.js", () => ({ UsageTracker: { trackEvent: vi.fn() } }));

// Failure modes: partial delivery treated as success, rejected calls omitted, sensitive
// inputs leaked, telemetry breaking operations, and asynchronous listener errors omitted.
describe("Kafka operation logging", () => {
  const config = { brokers: "private-host:9092", securityProtocol: "PLAINTEXT" };
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    localStorage.setItem(KAFKA_BROKERS_KEY, JSON.stringify([{ id: "uat", name: "UAT", brokers: config.brokers }]));
  });

  it("records partial delivery with profile and topic but no message content", async () => {
    const result = { delivered: [{ index: 0, partition: 2, offset: 123 }], failedAt: 1, error: "Timed out private-host" };
    const service = new KafkaService({ invoke: async () => result });
    expect(await service.publish(config, "orders", [{ key: "secret-key", value: "secret-value", headers: [] }, {}])).toBe(result);
    expect(UsageTracker.trackEvent).toHaveBeenCalledWith("kafka", "publish_result", expect.objectContaining({
      broker_profile: "UAT", topic: "orders", outcome: "partial", requested_count: 2, delivered_count: 1,
      failed_message_index: 1, error_category: "timeout", duration_ms: expect.any(Number),
    }));
    const logged = JSON.stringify(UsageTracker.trackEvent.mock.calls);
    for (const secret of ["private-host", "secret-key", "secret-value", "123"]) expect(logged).not.toContain(secret);
  });

  it("logs rejected operations without changing the original error", async () => {
    const error = new Error("Broker transport failure private-host");
    const service = new KafkaService({ invoke: async () => { throw error; } });
    await expect(service.test(config)).rejects.toBe(error);
    expect(UsageTracker.trackEvent).toHaveBeenCalledWith("kafka", "test_connection_result", expect.objectContaining({
      outcome: "failure", error_category: "connection", broker_profile: "UAT",
    }));
  });

  it("logs history summaries without the search query or matched content", async () => {
    const service = new KafkaService({ invoke: async () => ({ matches: [{ value: "secret-payload" }], scanned: 42, limited: true }) });
    await service.searchHistory(config, "orders", "secret-query", Date.now() - 3600000);
    expect(UsageTracker.trackEvent).toHaveBeenCalledWith("kafka", "search_history_result", expect.objectContaining({
      outcome: "success", match_count: 1, scanned_count: 42, limited: true,
    }));
    expect(JSON.stringify(UsageTracker.trackEvent.mock.calls)).not.toContain("secret");
  });

  it("keeps telemetry failures from failing successful Kafka calls", async () => {
    UsageTracker.trackEvent.mockImplementation(() => { throw new Error("storage unavailable"); });
    const service = new KafkaService({ invoke: async () => ["orders"] });
    await expect(service.listTopics(config)).resolves.toEqual(["orders"]);
  });

  it("records asynchronous listener errors and still delivers the original event", async () => {
    let callback;
    const service = new KafkaService({ invoke: async () => {}, listen: async (_event, handler) => { callback = handler; return () => {}; } });
    await service.start(config, "orders", false);
    const handler = vi.fn();
    await service.on("kafka-listener-error", handler);
    const event = { payload: "Timed out private-host" };
    callback(event);
    expect(handler).toHaveBeenCalledWith(event);
    expect(UsageTracker.trackEvent).toHaveBeenCalledWith("kafka", "listener_error", expect.objectContaining({
      broker_profile: "UAT", topic: "orders", outcome: "failure", error_category: "timeout",
    }));
  });
});
