import { beforeEach, describe, expect, it, vi } from "vitest";
import { KafkaTool } from "../main.js";

vi.mock("../../../core/UsageTracker.js", () => ({ UsageTracker: { trackToolUse: vi.fn() } }));

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Kafka publish controls", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="tool"></div>';
    localStorage.clear();
  });

  it("sends one explicit bulk click once and locks the button until delivery", async () => {
    let finish;
    const service = { publish: vi.fn(() => new Promise((resolve) => { finish = resolve; })) };
    const tool = new KafkaTool(null, service);
    tool.mount(document.querySelector("#tool"));
    document.querySelector("#kafkaBrokers").value = "broker:9092";
    document.querySelector("#kafkaTopic").value = "orders.test";
    document.querySelector("#kafkaBulk").click();
    const value = document.querySelector("#kafkaValue");
    value.value = '[{"id":1},{"id":2}]';
    value.dispatchEvent(new Event("input"));

    expect(document.querySelector("#kafkaPublish").textContent).toBe("Publish 2 messages");
    document.querySelector("#kafkaPublish").click();
    document.querySelector("#kafkaPublish").click();
    expect(service.publish).toHaveBeenCalledTimes(1);
    expect(service.publish.mock.calls[0][2].map((item) => item.value)).toEqual(['{"id":1}', '{"id":2}']);
    expect(document.querySelector("#kafkaPublish").disabled).toBe(true);

    finish({ delivered: [{ index: 0, partition: 0, offset: 35 }, { index: 1, partition: 0, offset: 36 }], failedAt: null });
    await settle();
    expect(document.querySelector("#kafkaPublishStatus").textContent).toContain("2 messages delivered");
    expect(document.querySelectorAll("#kafkaDeliveries p")).toHaveLength(2);
    expect(document.querySelector("#kafkaPublish").disabled).toBe(false);
  });

  it("loads a saved request without publishing it", () => {
    const service = { publish: vi.fn() };
    const tool = new KafkaTool(null, service);
    tool.mount(document.querySelector("#tool"));
    document.querySelector("#kafkaRequestName").value = "UAT prebook";
    document.querySelector("#kafkaTopic").value = "prebook.test";
    document.querySelector("#kafkaValue").value = '{"cif":"30000758049"}';
    document.querySelector("#kafkaSave").click();
    document.querySelector("#kafkaValue").value = "";
    document.querySelector('[data-action="load"]').click();
    expect(document.querySelector("#kafkaValue").value).toBe('{"cif":"30000758049"}');
    expect(service.publish).not.toHaveBeenCalled();
  });
});
