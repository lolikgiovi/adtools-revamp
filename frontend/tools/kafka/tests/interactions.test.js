import { beforeEach, describe, expect, it, vi } from "vitest";
import { KafkaTool } from "../main.js";
import { KAFKA_TOPIC_FAVORITES_KEY } from "../service.js";

vi.mock("../../../core/UsageTracker.js", () => ({ UsageTracker: { trackToolUse: vi.fn() } }));

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Kafka publish controls", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="tool"></div>';
    localStorage.clear();
  });

  it("renders boolean options as accessible toggle controls", () => {
    const tool = new KafkaTool(null, { publish: vi.fn() });
    tool.mount(document.querySelector("#tool"));

    for (const id of ["kafkaBulk", "kafkaFromBeginning"]) {
      const input = document.querySelector(`#${id}`);
      expect(input.type).toBe("checkbox");
      expect(input.closest(".switch")).not.toBeNull();
      expect(input.nextElementSibling.classList.contains("slider")).toBe(true);
    }
    expect(document.querySelector("#kafkaListen").textContent).toBe("Start listening");
    expect(document.querySelector("#kafkaListen").getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector("#kafkaStop")).toBeNull();
  });

  it("starts with a safe payload example and keeps the desktop split search-first", () => {
    const tool = new KafkaTool(null, { publish: vi.fn() });
    tool.mount(document.querySelector("#tool"));

    expect(document.querySelector("#kafkaValue").value).toBe(`{
  "example": "value"
}`);
    expect(document.querySelector("#kafkaPublish").disabled).toBe(true);
    expect(document.querySelector("#kafkaCount").textContent).toBe("Set up a broker to publish.");
    expect(document.querySelector("#kafkaPublishPanel").hidden).toBe(false);
    expect(document.querySelector("#kafkaListenPanel").hidden).toBe(false);
    expect(document.querySelector("#kafkaLiveHeading").closest(".kafka-live-results").querySelector("#kafkaListen")).not.toBeNull();

    const topic = document.querySelector("#kafkaTopic");
    topic.value = "orders.test";
    topic.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector("#kafkaListenTopic").textContent).toBe("Topic: orders.test");

    const brokers = document.querySelector("#kafkaBrokers");
    brokers.value = "broker:9092";
    brokers.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector("#kafkaPublish").disabled).toBe(false);
    expect(document.querySelector("#kafkaCount").textContent).toContain("1 message per click");
  });

  it("keeps payload primary and progressively discloses templates and options", () => {
    const tool = new KafkaTool(null, { publish: vi.fn() });
    tool.mount(document.querySelector("#tool"));

    const templates = document.querySelector("#kafkaTemplates");
    const options = document.querySelector("#kafkaPublishOptions");
    const payload = document.querySelector(".kafka-value-section");
    expect(templates.open).toBe(false);
    expect(options.open).toBe(false);
    expect(payload.nextElementSibling).toBe(options);

    templates.querySelector("summary").click();
    options.querySelector("summary").click();
    expect(templates.open).toBe(true);
    expect(options.open).toBe(true);
    expect(document.querySelector("#kafkaSavedList")).not.toBeNull();
    expect(document.querySelector("#kafkaKey")).not.toBeNull();
    expect(document.querySelector("#kafkaHeaders")).not.toBeNull();
  });

  it("filters saved templates and closes the picker after preparing one", () => {
    const service = { publish: vi.fn() };
    const tool = new KafkaTool(null, service);
    tool.mount(document.querySelector("#tool"));
    document.querySelector("#kafkaTopic").value = "orders.test";

    for (const [name, value] of [["Create order", '{"kind":"create"}'], ["Retry order", '{"kind":"retry"}']]) {
      document.querySelector("#kafkaRequestName").value = name;
      document.querySelector("#kafkaValue").value = value;
      document.querySelector("#kafkaSave").click();
    }

    const search = document.querySelector("#kafkaTemplateSearch");
    search.value = "retry";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelectorAll("#kafkaSavedList .kafka-saved-row")).toHaveLength(1);
    expect(document.querySelector("#kafkaSavedList").textContent).toContain("Retry order");

    document.querySelector('[data-action="load"]').click();
    expect(document.querySelector("#kafkaTemplates").open).toBe(false);
    expect(document.querySelector("#kafkaValue").value).toBe('{"kind":"retry"}');
    expect(service.publish).not.toHaveBeenCalled();
  });

  it("shows option counts and expands headers without changing the JSON contract", () => {
    const tool = new KafkaTool(null, { publish: vi.fn() });
    tool.mount(document.querySelector("#tool"));

    const headers = document.querySelector("#kafkaHeaders");
    headers.value = '{"source":"uat","traceId":"abc"}';
    headers.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector("#kafkaPublishOptionsSummary").textContent).toBe("2 headers");

    const expand = document.querySelector("#kafkaExpandHeaders");
    expand.click();
    expect(document.querySelector("#kafkaHeadersSection").classList.contains("is-expanded")).toBe(true);
    expect(document.body.classList.contains("kafka-editor-is-expanded")).toBe(true);
    expect(expand.getAttribute("aria-expanded")).toBe("true");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(document.querySelector("#kafkaHeadersSection").classList.contains("is-expanded")).toBe(false);
    expect(document.querySelector("#kafkaHeaders").value).toBe('{"source":"uat","traceId":"abc"}');
  });

  it("uses a custom responsive history picker instead of a native datetime control", () => {
    const tool = new KafkaTool(null, { publish: vi.fn() });
    tool.mount(document.querySelector("#tool"));

    const input = document.querySelector("#kafkaHistorySince");
    const trigger = document.querySelector("#kafkaHistoryTrigger");
    const calendar = document.querySelector("#kafkaHistoryCalendar");
    expect(input.type).toBe("hidden");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    trigger.click();
    expect(calendar.hidden).toBe(false);
    expect(document.querySelectorAll("#kafkaHistoryDays .kafka-date-day")).toHaveLength(42);

    const hours = document.querySelector("#kafkaHistoryHours");
    const minutes = document.querySelector("#kafkaHistoryMinutes");
    hours.value = "01";
    minutes.value = "05";
    hours.dispatchEvent(new Event("input", { bubbles: true }));
    minutes.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("#kafkaHistoryApply").click();

    expect(input.value).toMatch(/T01:05$/);
    expect(calendar.hidden).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps broker setup compact and shows the tested bootstrap server", async () => {
    const service = { test: vi.fn().mockResolvedValue("Connected to Kafka") };
    const tool = new KafkaTool(null, service);
    tool.mount(document.querySelector("#tool"));

    const settings = document.querySelector("#kafkaConnectionSettings");
    expect(settings.open).toBe(true);
    const brokers = document.querySelector("#kafkaBrokers");
    brokers.value = "broker:9092";
    brokers.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("#kafkaTest").click();
    await settle();

    expect(service.test).toHaveBeenCalledWith({ brokers: "broker:9092", securityProtocol: "PLAINTEXT" });
    expect(document.querySelector("#kafkaConnectionStatus").textContent).toBe("Connected to broker:9092");
    expect(document.querySelector("#kafkaConnection").dataset.state).toBe("connected");
    expect(settings.open).toBe(false);
  });

  it("favorites a topic and keeps multiple templates scoped to that topic", () => {
    const eventBus = { emit: vi.fn() };
    const tool = new KafkaTool(eventBus, { publish: vi.fn() });
    tool.mount(document.querySelector("#tool"));
    const topic = document.querySelector("#kafkaTopic");
    topic.value = "orders.test";
    topic.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("#kafkaTopicFavorite").click();
    expect(JSON.parse(localStorage.getItem(KAFKA_TOPIC_FAVORITES_KEY))).toEqual(["orders.test"]);
    expect(eventBus.emit).toHaveBeenCalledWith("notification:success", {
      message: "Added “orders.test” to favorites.", duration: 2500,
    });

    for (const name of ["Create order", "Retry order"]) {
      document.querySelector("#kafkaRequestName").value = name;
      document.querySelector("#kafkaValue").value = `{"name":"${name}"}`;
      document.querySelector("#kafkaSave").click();
    }
    expect(document.querySelectorAll("#kafkaSavedList .kafka-saved-row")).toHaveLength(2);
    expect(document.querySelector("#kafkaTopicFavorite").getAttribute("aria-pressed")).toBe("true");
  });

  it("formats message JSON and exposes a copy action without publishing", () => {
    const service = { publish: vi.fn() };
    const tool = new KafkaTool(null, service);
    tool.mount(document.querySelector("#tool"));
    tool.activate();
    tool.listening = true;
    tool.showMessage({
      topic: "orders.test", partition: 0, offset: 7, key: null, value: '{"id":1,"items":["a"]}',
      headers: [], keyIsUtf8: true, valueIsUtf8: true,
    });

    const article = document.querySelector("#kafkaMessages article");
    const format = article.querySelector('[data-message-action="format"]');
    expect(article.querySelector('[data-message-action="copy"]')).not.toBeNull();
    format.click();
    expect(article.querySelector("pre").textContent).toContain("\n  \"id\": 1");
    expect(service.publish).not.toHaveBeenCalled();
  });

  it("places the history picker above or below based on available space", () => {
    const tool = new KafkaTool(null, { publish: vi.fn() });
    tool.mount(document.querySelector("#tool"));

    const trigger = document.querySelector("#kafkaHistoryTrigger");
    const calendar = document.querySelector("#kafkaHistoryCalendar");
    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 700 });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({ top: 40, bottom: 84 });
    vi.spyOn(calendar, "getBoundingClientRect").mockReturnValue({ height: 360 });

    trigger.click();
    expect(calendar.classList.contains("is-above")).toBe(false);
    trigger.click();

    trigger.getBoundingClientRect.mockReturnValue({ top: 600, bottom: 644 });
    trigger.click();
    expect(calendar.classList.contains("is-above")).toBe(true);

    Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
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

  it("restarts a stale native listener when explicitly starting a preview", async () => {
    const service = {
      on: vi.fn().mockResolvedValue(() => {}),
      start: vi.fn().mockRejectedValueOnce("Listener already running.").mockResolvedValueOnce(),
      stop: vi.fn().mockResolvedValue(),
    };
    const tool = new KafkaTool(null, service);
    tool.mount(document.querySelector("#tool"));
    document.querySelector("#kafkaBrokers").value = "broker:9092";
    document.querySelector("#kafkaTopic").value = "orders.test";
    document.querySelector("#kafkaFromBeginning").checked = true;

    await tool.startListening();

    expect(service.stop).toHaveBeenCalledOnce();
    expect(service.start).toHaveBeenCalledTimes(2);
    expect(service.start).toHaveBeenLastCalledWith({ brokers: "broker:9092", securityProtocol: "PLAINTEXT" }, "orders.test", true);
    expect(document.querySelector("#kafkaListenHeading").textContent).toBe("Listen to orders.test");
    expect(document.querySelector("#kafkaListenStatus").textContent).toBe("");
    const listenButton = document.querySelector("#kafkaListen");
    expect(listenButton.textContent).toBe("Stop listening");
    expect(listenButton.getAttribute("aria-pressed")).toBe("true");

    listenButton.click();
    await settle();
    expect(service.stop).toHaveBeenCalledTimes(2);
    expect(listenButton.textContent).toBe("Start listening");
    expect(listenButton.getAttribute("aria-pressed")).toBe("false");
  });

  it("loads a received message into Publish without sending or saving it", () => {
    const service = { publish: vi.fn() };
    const tool = new KafkaTool(null, service);
    tool.mount(document.querySelector("#tool"));
    tool.activate();
    tool.listening = true;
    document.querySelector("#kafkaRequestName").value = "Existing template";
    tool.showMessage({
      topic: "orders.test", partition: 2, offset: 48, key: "account-1", value: '{"id":1}',
      headers: [{ key: "source", value: "uat" }], keyIsUtf8: true, valueIsUtf8: true,
    });

    const button = document.querySelector(".kafka-use-message");
    expect(button.disabled).toBe(false);
    button.click();

    expect(document.querySelector("#kafkaTopic").value).toBe("orders.test");
    expect(document.querySelector("#kafkaKey").value).toBe("account-1");
    expect(JSON.parse(document.querySelector("#kafkaHeaders").value)).toEqual({ source: "uat" });
    expect(document.querySelector("#kafkaValue").value).toBe('{"id":1}');
    expect(document.querySelector("#kafkaBulk").checked).toBe(false);
    expect(document.querySelector("#kafkaRequestName").value).toBe("");
    expect(service.publish).not.toHaveBeenCalled();
    expect(localStorage.getItem("tool:kafka:requests")).toBeNull();

    tool.showMessage({ topic: "orders.test", partition: 2, offset: 49, key: null, value: '{}' });
    expect(document.querySelector(".kafka-use-message").disabled).toBe(true);
    expect(document.querySelector(".kafka-message-note").textContent).toContain("Restart the desktop app");
  });

  it("searches retained history and loads a matching payload without publishing", async () => {
    const service = { searchHistory: vi.fn().mockResolvedValue({
      scanned: 42, limited: false,
      matches: [{ topic: "orders.test", partition: 1, offset: 12, key: null,
        value: '{"traceId":"ccfaba827199ab25"}', headers: [], keyIsUtf8: true, valueIsUtf8: true }],
    }), publish: vi.fn() };
    const tool = new KafkaTool(null, service);
    tool.mount(document.querySelector("#tool"));
    tool.activate();
    document.querySelector("#kafkaBrokers").value = "broker:9092";
    document.querySelector("#kafkaTopic").value = "orders.test";
    document.querySelector("#kafkaHistoryQuery").value = "ccfaba827199ab25";
    document.querySelector("#kafkaHistoryForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(service.searchHistory).toHaveBeenCalledWith(
      { brokers: "broker:9092", securityProtocol: "PLAINTEXT" }, "orders.test", "ccfaba827199ab25", expect.any(Number),
    );
    expect(document.querySelector("#kafkaHistoryStatus").textContent).toContain("1 match in 42 records");
    document.querySelector("#kafkaHistoryResults .kafka-use-message").click();
    expect(document.querySelector("#kafkaValue").value).toBe('{"traceId":"ccfaba827199ab25"}');
    expect(service.publish).not.toHaveBeenCalled();
  });
});
