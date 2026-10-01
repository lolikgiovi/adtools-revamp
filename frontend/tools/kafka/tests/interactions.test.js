import { beforeEach, describe, expect, it, vi } from "vitest";
import { KafkaTool } from "../main.js";
import {
  KAFKA_ACTIVE_BROKER_KEY,
  KAFKA_BROKERS_KEY,
  KAFKA_TOPIC_FAVORITES_KEY,
  saveKafkaBrokerProfiles,
} from "../service.js";

vi.mock("../../../core/UsageTracker.js", () => ({ UsageTracker: { trackToolUse: vi.fn() } }));

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function seedBrokers(addresses = ["broker:9092"]) {
  const profiles = addresses.map((brokers, index) => ({
    id: `test-broker-${index + 1}`,
    name: brokers,
    brokers,
  }));
  localStorage.setItem(KAFKA_BROKERS_KEY, JSON.stringify(profiles));
  localStorage.setItem(KAFKA_ACTIVE_BROKER_KEY, profiles[0]?.id || "");
  return profiles;
}

function mountWithBrokers(tool, addresses) {
  const profiles = seedBrokers(addresses);
  tool.mount(document.querySelector("#tool"));
  return profiles;
}

describe("Kafka publish controls", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="tool"></div>';
    localStorage.clear();
  });

  it("places the UUID action before Format and removes the bulk toggle", () => {
    const tool = new KafkaTool(null, { publish: vi.fn() });
    tool.mount(document.querySelector("#tool"));

    expect(document.querySelector("#kafkaBulk")).toBeNull();
    const generate = document.querySelector("#kafkaGenerateUuid");
    expect(generate).not.toBeNull();
    expect(generate.nextElementSibling).toBe(document.querySelector("#kafkaFormatValue"));
  });

  it("copies a generated UUID without changing the payload", async () => {
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });
    try {
      const tool = new KafkaTool(null, { publish: vi.fn() });
      tool.mount(document.querySelector("#tool"));
      const payload = document.querySelector("#kafkaValue");
      const originalPayload = payload.value;

      document.querySelector("#kafkaGenerateUuid").click();
      await settle();

      expect(clipboard.writeText).toHaveBeenCalledTimes(1);
      expect(clipboard.writeText.mock.calls[0][0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(payload.value).toBe(originalPayload);
    } finally {
      if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
      else delete navigator.clipboard;
    }
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
    expect(document.querySelector("#kafkaListen").parentElement).toBe(document.querySelector(".kafka-listen-topic-row"));
    expect(document.querySelector("#kafkaLiveView").hidden).toBe(true);
    expect(document.querySelector("#kafkaHistoryView").hidden).toBe(false);
    expect(document.querySelector("#kafkaSetupBrokers").hidden).toBe(false);
    expect(document.querySelector("#kafkaBrokerSelect").hidden).toBe(true);
    expect(document.querySelector("#kafkaTest").disabled).toBe(true);
    expect(document.querySelector("#kafkaListen").disabled).toBe(true);
    expect(document.querySelector("#kafkaHistorySearch").disabled).toBe(true);

    const topic = document.querySelector("#kafkaTopic");
    topic.value = "orders.test";
    topic.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector("#kafkaListenTopic").value).toBe("");
    expect(document.querySelector("#kafkaPublish").disabled).toBe(true);

    const listenTopic = document.querySelector("#kafkaListenTopic");
    listenTopic.value = "orders.test";
    listenTopic.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector("#kafkaListen").disabled).toBe(true);
    expect(document.querySelector("#kafkaHistorySearch").disabled).toBe(true);
  });

  it("updates action readiness when Settings saves the first broker", () => {
    const tool = new KafkaTool(null, { publish: vi.fn() });
    tool.mount(document.querySelector("#tool"));

    const connection = document.querySelector("#kafkaConnection");
    expect(connection.dataset.state).toBe("empty");
    expect(document.querySelector("#kafkaSetupBrokers").hidden).toBe(false);
    expect(document.querySelector("#kafkaBrokerSelect").hidden).toBe(true);
    expect(document.querySelector("#kafkaMessages .kafka-empty").textContent).toBe(
      "Set up a broker, then enter a topic to listen."
    );

    const topic = document.querySelector("#kafkaTopic");
    topic.value = "orders.test";
    topic.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector("#kafkaListen").disabled).toBe(true);

    saveKafkaBrokerProfiles([{ id: "settings-broker", name: "broker:9092", brokers: "broker:9092" }]);
    expect(connection.dataset.state).toBe("ready");
    expect(document.querySelector("#kafkaSetupBrokers").hidden).toBe(true);
    expect(document.querySelector("#kafkaBrokerSelect").hidden).toBe(false);
    expect(document.querySelector("#kafkaTest").disabled).toBe(false);
    expect(document.querySelector("#kafkaListen").disabled).toBe(true);
    expect(document.querySelector("#kafkaHistorySearch").disabled).toBe(true);
    expect(document.querySelector("#kafkaPublish").disabled).toBe(false);
    expect(document.querySelector("#kafkaCount").textContent).toContain("1 message per click");
    const listenTopic = document.querySelector("#kafkaListenTopic");
    listenTopic.value = "orders.test";
    listenTopic.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector("#kafkaListen").disabled).toBe(false);
    expect(document.querySelector("#kafkaHistorySearch").disabled).toBe(false);
    expect(document.querySelector("#kafkaMessages .kafka-empty").textContent).toBe("");
  });

  it("gives live listening and retained history separate full-pane modes", () => {
    const tool = new KafkaTool(null, { publish: vi.fn() });
    tool.mount(document.querySelector("#tool"));

    const liveMode = document.querySelector("#kafkaLiveMode");
    const historyMode = document.querySelector("#kafkaHistoryMode");
    historyMode.click();
    expect(historyMode.getAttribute("aria-selected")).toBe("true");
    expect(liveMode.getAttribute("aria-selected")).toBe("false");
    expect(document.querySelector("#kafkaHistoryView").hidden).toBe(false);
    expect(document.querySelector("#kafkaLiveView").hidden).toBe(true);

    liveMode.click();
    expect(liveMode.getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector("#kafkaLiveView").hidden).toBe(false);

    liveMode.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
    expect(historyMode.getAttribute("aria-selected")).toBe("true");
    expect(historyMode.tabIndex).toBe(0);
    expect(document.activeElement).toBe(historyMode);
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

  it("shows option counts and switches header editors without changing the JSON contract", () => {
    const tool = new KafkaTool(null, { publish: vi.fn() });
    tool.mount(document.querySelector("#tool"));

    const headers = document.querySelector("#kafkaHeaders");
    headers.value = '{"source":"uat","traceId":"abc"}';
    headers.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector("#kafkaPublishOptionsSummary").textContent).toBe("2 headers");

    document.querySelector("#kafkaHeadersKeyValueMode").click();
    expect(document.querySelector("#kafkaHeadersJsonView").hidden).toBe(true);
    expect(document.querySelector("#kafkaHeadersKeyValueView").hidden).toBe(false);
    expect(document.querySelectorAll("#kafkaHeaderRows [data-header-field='key']")).toHaveLength(2);

    document.querySelector("#kafkaHeadersJsonMode").click();
    expect(document.querySelector("#kafkaHeadersJsonView").hidden).toBe(false);
    expect(JSON.parse(document.querySelector("#kafkaHeaders").value)).toEqual({ source: "uat", traceId: "abc" });
  });

  it("generates a lowercase adt trace ID for the header and key without publishing", () => {
    const service = { publish: vi.fn() };
    const tool = new KafkaTool(null, service);
    tool.mount(document.querySelector("#tool"));
    const headers = document.querySelector("#kafkaHeaders");
    const key = document.querySelector("#kafkaKey");
    const generate = document.querySelector("#kafkaGenerateTraceId");
    headers.value = '{"source":"uat"}';

    generate.click();
    const first = JSON.parse(headers.value).traceId;
    expect(first).toMatch(/^adt-[0-9a-f]{12}$/);
    expect(JSON.parse(headers.value).source).toBe("uat");
    expect(key.value).toBe(first);
    expect(tool.records()[0].headers).toContainEqual({ key: "traceId", value: first });
    expect(tool.records()[0].key).toBe(first);

    generate.click();
    const second = JSON.parse(headers.value).traceId;
    expect(second).not.toBe(first);
    expect(key.value).toBe(second);
    expect(tool.records()[0].key).toBe(second);
    expect(service.publish).not.toHaveBeenCalled();
  });

  it("keeps the draft unchanged when selected trace ID destinations are invalid", () => {
    const tool = new KafkaTool(null, { publish: vi.fn() });
    tool.mount(document.querySelector("#tool"));
    const headers = document.querySelector("#kafkaHeaders");
    const key = document.querySelector("#kafkaKey");
    const generate = document.querySelector("#kafkaGenerateTraceId");
    headers.value = "{bad";
    key.value = "existing";

    generate.click();
    expect(headers.value).toBe("{bad");
    expect(key.value).toBe("existing");
    expect(document.querySelector("#kafkaPublishStatus").textContent).toContain("Fix header JSON");
  });

  it("keeps topic browsing and template saving in the publish pane flow", () => {
    const tool = new KafkaTool(null, { publish: vi.fn() });
    tool.mount(document.querySelector("#tool"));

    const topicMenu = document.querySelector("#kafkaTopicMenu");
    const topicPicker = document.querySelector("#kafkaTopicPicker");
    const topicToggle = document.querySelector("#kafkaTopicToggle");
    expect(topicMenu.parentElement).toBe(topicPicker);
    expect(document.querySelector("#kafkaTopicFavorite").parentElement).toBe(topicPicker);
    expect(document.querySelector('label[for="kafkaTopic"]')).toBeNull();

    topicToggle.click();
    expect(topicMenu.hidden).toBe(false);
    expect(topicToggle.getAttribute("aria-expanded")).toBe("true");
    topicToggle.click();
    expect(topicMenu.hidden).toBe(true);
    expect(topicToggle.getAttribute("aria-expanded")).toBe("false");

    const toggle = document.querySelector("#kafkaTemplateSaveToggle");
    const panel = document.querySelector("#kafkaTemplateSave");
    expect(panel.hidden).toBe(true);
    toggle.click();
    expect(panel.hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(document.querySelector("#kafkaRequestName"));

    document.querySelector("#kafkaTemplateSaveCancel").click();
    expect(panel.hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
  });

  it("offers only the requested rolling history ranges, defaulting to 24 hours", () => {
    const tool = new KafkaTool(null, { publish: vi.fn() });
    tool.mount(document.querySelector("#tool"));

    const range = document.querySelector("#kafkaHistoryRange");
    expect(range?.value).toBe("24");
    expect([...range.options].map(({ textContent }) => textContent.trim())).toEqual([
      "Last 1 hour", "Last 24 hours", "Last 3 days", "Last 7 days", "Last 14 days", "Last 30 days", "Last 60 days",
    ]);
    expect(document.querySelector("#kafkaHistoryCalendar")).toBeNull();
  });

  it("calculates the selected range from the time Search is submitted", async () => {
    const service = { searchHistory: vi.fn().mockResolvedValue({ matches: [], scanned: 0, limited: false }) };
    const tool = new KafkaTool(null, service);
    mountWithBrokers(tool);
    document.querySelector("#kafkaListenTopic").value = "orders.test";
    document.querySelector("#kafkaHistoryQuery").value = "trace-id";
    const range = document.querySelector("#kafkaHistoryRange");
    const now = vi.spyOn(Date, "now").mockReturnValue(1_780_000_000_000);
    try {
      range.value = "1";
      await tool.searchHistory();
      expect(service.searchHistory.mock.calls[0][3]).toBe(now() - 60 * 60 * 1000);
      range.value = "1440";
      await tool.searchHistory();
      expect(service.searchHistory.mock.calls[1][3]).toBe(now() - 60 * 24 * 60 * 60 * 1000);
    } finally {
      now.mockRestore();
    }
  });

  it("tests the selected saved broker and shows its status", async () => {
    const service = { test: vi.fn().mockResolvedValue("Connected to Kafka") };
    const tool = new KafkaTool(null, service);
    const [profile] = mountWithBrokers(tool);

    expect(document.querySelector("#kafkaSetupBrokers").hidden).toBe(true);
    expect(document.querySelector("#kafkaBrokerSelect").value).toBe(profile.id);
    document.querySelector("#kafkaTest").click();
    await settle();

    expect(service.test).toHaveBeenCalledWith({ brokers: "broker:9092", securityProtocol: "PLAINTEXT" });
    expect(document.querySelector("#kafkaConnectionStatus").textContent).toBe("Test passed · broker:9092");
    expect(document.querySelector("#kafkaConnection").dataset.state).toBe("connected");
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

  it("publishes an array payload as one message and locks the button until delivery", async () => {
    let finish;
    const service = { publish: vi.fn(() => new Promise((resolve) => { finish = resolve; })) };
    const tool = new KafkaTool(null, service);
    mountWithBrokers(tool);
    document.querySelector("#kafkaTopic").value = "orders.test";
    const value = document.querySelector("#kafkaValue");
    value.value = '[{"id":1},{"id":2}]';
    value.dispatchEvent(new Event("input"));

    expect(document.querySelector("#kafkaPublish").textContent).toBe("Publish");
    expect(document.querySelector("#kafkaCount").textContent).toContain("1 message per click");
    document.querySelector("#kafkaPublish").click();
    document.querySelector("#kafkaPublish").click();
    expect(service.publish).toHaveBeenCalledTimes(1);
    expect(service.publish.mock.calls[0][2]).toEqual([
      { key: null, value: '[{"id":1},{"id":2}]', headers: [] },
    ]);
    expect(document.querySelector("#kafkaPublish").disabled).toBe(true);

    finish({ delivered: [{ index: 0, partition: 0, offset: 35 }], failedAt: null });
    await settle();
    expect(document.querySelector("#kafkaPublishStatus").textContent).toContain("1 message delivered");
    expect(document.querySelectorAll("#kafkaDeliveries p")).toHaveLength(1);
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
    mountWithBrokers(tool);
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
    mountWithBrokers(tool);
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
    const profiles = mountWithBrokers(tool, ["first:9092", "second:9092"]);
    document.querySelector("#kafkaTopic").focus();
    const brokerSelect = document.querySelector("#kafkaBrokerSelect");
    brokerSelect.value = profiles[1].id;
    brokerSelect.dispatchEvent(new Event("change", { bubbles: true }));
    finish(["old.topic"]);
    await settle();
    expect(document.querySelectorAll(".kafka-topic-option")).toHaveLength(0);
  });

  it("supports arrow navigation and Escape without submitting the publish form", async () => {
    const service = { listTopics: vi.fn().mockResolvedValue(["orders.created", "orders.failed"]), publish: vi.fn() };
    const tool = new KafkaTool(null, service);
    mountWithBrokers(tool);
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
    mountWithBrokers(tool);
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
    mountWithBrokers(tool);
    document.querySelector("#kafkaListenTopic").value = "orders.test";
    await tool.startListening();

    expect(service.stop).toHaveBeenCalledOnce();
    expect(service.start).toHaveBeenCalledTimes(2);
    expect(service.start).toHaveBeenLastCalledWith({ brokers: "broker:9092", securityProtocol: "PLAINTEXT" }, "orders.test", false);
    expect(document.querySelector("#kafkaListenHeading").textContent).toBe("Listen");
    expect(document.querySelector("#kafkaListenTopic").value).toBe("orders.test");
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

  it("updates the listener control when Kafka is disconnected from the header", async () => {
    const service = {
      on: vi.fn().mockResolvedValue(() => {}),
      start: vi.fn().mockResolvedValue(),
      stop: vi.fn().mockResolvedValue(),
    };
    const tool = new KafkaTool(null, service);
    mountWithBrokers(tool);
    document.querySelector("#kafkaListenTopic").value = "orders.test";
    await tool.startListening();
    window.dispatchEvent(new Event("adtools:kafka-disconnected"));
    await settle();
    expect(tool.listening).toBe(false);
    expect(document.querySelector("#kafkaListen").textContent).toBe("Start listening");
    expect(service.stop).toHaveBeenCalledOnce();
    tool.unmount();
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
    mountWithBrokers(tool);
    tool.activate();
    document.querySelector("#kafkaListenTopic").value = "orders.test";
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
