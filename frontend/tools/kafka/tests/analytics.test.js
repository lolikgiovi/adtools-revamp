import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsageTracker } from "../../../core/UsageTracker.js";
import { KafkaTool } from "../main.js";

vi.mock("../../../core/UsageTracker.js", () => ({ UsageTracker: { trackToolUse: vi.fn() } }));

describe("Kafka analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="tool"></div>';
    localStorage.clear();
  });

  it("records confirmed deliveries even when the tool unmounts before the response", async () => {
    let finish;
    const service = { publish: vi.fn(() => new Promise((resolve) => { finish = resolve; })) };
    const tool = new KafkaTool(null, service);
    tool.mount(document.querySelector("#tool"));
    document.querySelector("#kafkaBrokers").value = "broker:9092";
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
    tool.mount(document.querySelector("#tool"));
    document.querySelector("#kafkaBrokers").value = "broker:9092";
    document.querySelector("#kafkaTopic").value = "orders.test";

    await tool.publish();
    await tool.publish();

    expect(UsageTracker.trackToolUse).toHaveBeenCalledTimes(1);
    expect(UsageTracker.trackToolUse).toHaveBeenCalledWith("kafka", "publish", { message_count: 1 });
  });
});
