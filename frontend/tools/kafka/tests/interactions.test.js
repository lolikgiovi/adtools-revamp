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

    expect(document.querySelector("#kafkaPublish").textContent).toBe("Publish");
    expect(document.querySelector("#kafkaCount").textContent).toContain("2 messages per click");
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

  it("formats both JSON fields and blocks publish when headers are invalid", () => {
    const service = { publish: vi.fn() };
    const tool = new KafkaTool(null, service);
    tool.mount(document.querySelector("#tool"));
    document.querySelector("#kafkaBrokers").value = "broker:9092";
    document.querySelector("#kafkaTopic").value = "orders.test";
    const headers = document.querySelector("#kafkaHeaders");
    const value = document.querySelector("#kafkaValue");
    headers.value = '{"source":"uat"}';
    value.value = '{"id":1}';
    document.querySelector("#kafkaFormatHeaders").click();
    document.querySelector("#kafkaFormatValue").click();
    expect(headers.value).toBe('{\n  "source": "uat"\n}');
    expect(value.value).toBe('{\n  "id": 1\n}');
    expect(document.querySelector("#kafkaValueStatus").textContent).toBe("Valid JSON");

    headers.value = '{"retry":3}';
    headers.dispatchEvent(new Event("input"));
    expect(document.querySelector("#kafkaHeadersStatus").textContent).toContain("string values");
    expect(document.querySelector("#kafkaPublish").disabled).toBe(true);
    expect(service.publish).not.toHaveBeenCalled();
  });

  it("browses metadata once and selects a fuzzy topic with the keyboard without publishing", async () => {
    const service = { listTopics: vi.fn().mockResolvedValue(["orders.failed", "orders.created", "streaming.gold.prebook.consumer-uat1"]), publish: vi.fn() };
    const tool = new KafkaTool(null, service);
    tool.mount(document.querySelector("#tool"));
    const brokers = document.querySelector("#kafkaBrokers");
    brokers.value = "broker:9092";
    brokers.focus();
    const input = document.querySelector("#kafkaTopic");
    input.focus();
    await settle();
    expect(service.listTopics).toHaveBeenCalledTimes(1);

    input.value = "prebook";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelectorAll(".kafka-topic-option")).toHaveLength(1);
    expect(document.querySelector(".kafka-topic-option").textContent).toBe("streaming.gold.prebook.consumer-uat1");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(input.value).toBe("streaming.gold.prebook.consumer-uat1");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(service.publish).not.toHaveBeenCalled();
    expect(service.listTopics).toHaveBeenCalledTimes(1);

    document.querySelector("#kafkaTopicRefresh").click();
    await settle();
    expect(service.listTopics).toHaveBeenCalledTimes(2);
  });

  it("ignores stale topic responses after bootstrap servers change", async () => {
    let finish;
    const service = { listTopics: vi.fn(() => new Promise((resolve) => { finish = resolve; })) };
    const tool = new KafkaTool(null, service);
    tool.mount(document.querySelector("#tool"));
    const brokers = document.querySelector("#kafkaBrokers");
    brokers.value = "first:9092";
    brokers.focus();
    document.querySelector("#kafkaTopic").focus();
    brokers.value = "second:9092";
    brokers.dispatchEvent(new Event("input", { bubbles: true }));
    finish(["old.topic"]);
    await settle();
    expect(document.querySelectorAll(".kafka-topic-option")).toHaveLength(0);
  });

  it("supports arrow navigation and Escape without submitting the publish form", async () => {
    const service = { listTopics: vi.fn().mockResolvedValue(["orders.created", "orders.failed"]), publish: vi.fn() };
    const tool = new KafkaTool(null, service);
    tool.mount(document.querySelector("#tool"));
    const brokers = document.querySelector("#kafkaBrokers");
    brokers.value = "broker:9092";
    brokers.focus();
    const input = document.querySelector("#kafkaTopic");
    input.focus();
    await settle();
    input.value = "orders";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(input.getAttribute("aria-activedescendant")).toBe("kafkaTopicOption1");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(input.value).toBe("orders.failed");
    expect(service.publish).not.toHaveBeenCalled();
    document.querySelector("#kafkaTopicToggle").click();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("selects a topic on pointer down before a blur can close the menu", async () => {
    const service = { listTopics: vi.fn().mockResolvedValue(["orders.created", "orders.failed"]), publish: vi.fn() };
    const tool = new KafkaTool(null, service);
    tool.mount(document.querySelector("#tool"));
    const brokers = document.querySelector("#kafkaBrokers");
    brokers.value = "broker:9092";
    brokers.focus();
    const input = document.querySelector("#kafkaTopic");
    input.focus();
    await settle();
    const option = document.querySelectorAll(".kafka-topic-option")[1];
    const pointerDown = new Event("pointerdown", { bubbles: true, cancelable: true });
    option.dispatchEvent(pointerDown);
    expect(pointerDown.defaultPrevented).toBe(true);
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
    expect(input.value).toBe("orders.failed");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(service.publish).not.toHaveBeenCalled();
  });
});
