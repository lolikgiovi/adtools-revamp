import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsageTracker } from "../../../core/UsageTracker.js";
import { KafkaTool } from "../main.js";
import { KAFKA_ACTIVE_BROKER_KEY, KAFKA_BROKERS_KEY, KAFKA_TOPIC_FAVORITES_KEY } from "../service.js";

vi.mock("../../../core/UsageTracker.js", () => ({ UsageTracker: { trackToolUse: vi.fn(), trackEvent: vi.fn() } }));

function mountWithBroker(tool) {
  const profile = { id: "test-broker", name: "broker:9092", brokers: "broker:9092" };
  localStorage.setItem(KAFKA_BROKERS_KEY, JSON.stringify([profile]));
  localStorage.setItem(KAFKA_ACTIVE_BROKER_KEY, profile.id);
  tool.mount(document.querySelector("#tool"));
}

describe("Kafka analytics", () => {
  // Favorites can fail through empty input, failed persistence, or telemetry throwing.
  // Both pickers must record the topic and add/remove state without counting a tool use.
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="tool"></div>';
    localStorage.clear();
  });

  it("logs favorite additions and removals from both pickers", () => {
    const tool = new KafkaTool(null, {});
    mountWithBroker(tool);
    document.querySelector("#kafkaTopic").value = "orders.test";
    document.querySelector("#kafkaListenTopic").value = "orders.test";
    tool.toggleTopicFavorite("publish");
    tool.toggleTopicFavorite("listen");
    expect(UsageTracker.trackEvent.mock.calls).toEqual([
      ["kafka", "topic_favorite_changed", {
        topic: "orders.test", broker_profile: "broker:9092", source: "publish", favorite: true,
      }],
      ["kafka", "topic_favorite_changed", {
        topic: "orders.test", broker_profile: "broker:9092", source: "listen", favorite: false,
      }],
    ]);
    expect(UsageTracker.trackToolUse).not.toHaveBeenCalled();
    tool.unmount();
  });

  it("does not log empty topics or an unsaved favorite", () => {
    const tool = new KafkaTool(null, {});
    mountWithBroker(tool);
    tool.toggleTopicFavorite();
    expect(UsageTracker.trackEvent).not.toHaveBeenCalled();
    document.querySelector("#kafkaTopic").value = "orders.test";
    // jsdom requires spying on Storage.prototype; the Node storage polyfill owns its methods.
    const storageMethods = Object.hasOwn(localStorage, "setItem") ? localStorage : Object.getPrototypeOf(localStorage);
    const setItem = vi.spyOn(storageMethods, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
    tool.toggleTopicFavorite();
    expect(setItem).toHaveBeenCalledWith(KAFKA_TOPIC_FAVORITES_KEY, JSON.stringify(["orders.test"]));
    expect(UsageTracker.trackEvent).not.toHaveBeenCalled();
    tool.unmount();
  });

  it("keeps favorites working when telemetry throws", () => {
    const tool = new KafkaTool(null, {});
    mountWithBroker(tool);
    document.querySelector("#kafkaTopic").value = "orders.test";
    UsageTracker.trackEvent.mockImplementationOnce(() => { throw new Error("Telemetry unavailable"); });
    expect(() => tool.toggleTopicFavorite()).not.toThrow();
    expect(tool.favoriteTopics).toContain("orders.test");
    expect(document.querySelector("#kafkaTopicFavorite").getAttribute("aria-pressed")).toBe("true");
    tool.unmount();
  });

  it("records confirmed deliveries even when the tool unmounts before the response", async () => {
    let finish;
    const service = { publish: vi.fn(() => new Promise((resolve) => { finish = resolve; })) };
    const tool = new KafkaTool(null, service);
    mountWithBroker(tool);
    document.querySelector("#kafkaTopic").value = "orders.test";

    const pendingPublish = tool.publish();
    tool.unmount();
    finish({ delivered: [{ index: 0, partition: 0, offset: 1 }], failedAt: null });
    await pendingPublish;

    expect(UsageTracker.trackToolUse).toHaveBeenCalledWith("kafka", "publish", { message_count: 1 });
  });

  it("counts partially delivered messages and ignores a publish with no deliveries", async () => {
    const service = { publish: vi.fn()
      .mockResolvedValueOnce({ delivered: [{ index: 0, partition: 0, offset: 1 }], failedAt: 1, error: "delivery failed" })
      .mockResolvedValueOnce({ delivered: [], failedAt: 0, error: "delivery failed" }) };
    const tool = new KafkaTool(null, service);
    mountWithBroker(tool);
    document.querySelector("#kafkaTopic").value = "orders.test";

    await tool.publish();
    await tool.publish();

    expect(UsageTracker.trackToolUse).toHaveBeenCalledTimes(1);
    expect(UsageTracker.trackToolUse).toHaveBeenCalledWith("kafka", "publish", { message_count: 1 });
  });
});
