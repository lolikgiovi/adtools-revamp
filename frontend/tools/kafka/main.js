import { BaseTool } from "../../core/BaseTool.js";
import { UsageTracker } from "../../core/UsageTracker.js";
import { getIconSvg } from "./icon.js";
import { KafkaService, KAFKA_CONFIG_KEY, KAFKA_REQUESTS_KEY, parseMessages, readKafkaConfig, readKafkaRequests } from "./service.js";
import { KafkaTemplate } from "./template.js";
import "./styles.css";

export class KafkaTool extends BaseTool {
  constructor(eventBus, service = new KafkaService()) {
    super({ id: "kafka", eventBus });
    this.service = service;
    this.publishing = false;
    this.listening = false;
    this.unlisten = [];
    this.stopRequested = false;
  }

  getIconSvg() { return getIconSvg(); }
  render() { return KafkaTemplate; }

  onMount() {
    const config = readKafkaConfig();
    this.field("kafkaBrokers").value = config.brokers;
    this.requests = readKafkaRequests();
    this.renderRequests();
    this.field("kafkaBrokers").addEventListener("change", () => this.saveConnection());
    this.field("kafkaTest").addEventListener("click", () => this.testConnection());
    this.field("kafkaForm").addEventListener("submit", (event) => { event.preventDefault(); this.publish(); });
    this.field("kafkaSave").addEventListener("click", () => this.saveRequest());
    this.field("kafkaSavedList").addEventListener("click", (event) => this.handleSavedClick(event));
    this.field("kafkaBulk").addEventListener("change", () => this.updateCount());
    this.field("kafkaValue").addEventListener("input", () => this.updateCount());
    this.field("kafkaListen").addEventListener("click", () => this.startListening());
    this.field("kafkaStop").addEventListener("click", () => this.stopListening());
    this.updateCount();
    this.field("kafkaTopic").focus();
  }

  onSoftDeactivate() { this.stopListening(); }
  onUnmount() { this.stopListening(); }
  field(id) { return this.container?.querySelector(`#${id}`); }
  config() { return { brokers: this.field("kafkaBrokers").value.trim(), securityProtocol: "PLAINTEXT" }; }

  saveConnection() {
    localStorage.setItem(KAFKA_CONFIG_KEY, JSON.stringify(this.config()));
  }

  message(id, text, error = false) {
    const node = this.field(id);
    if (node) { node.textContent = text; node.dataset.state = error ? "error" : "ok"; }
  }

  async testConnection() {
    this.saveConnection();
    const button = this.field("kafkaTest");
    button.disabled = true;
    this.message("kafkaConnectionStatus", "Connecting…");
    try { this.message("kafkaConnectionStatus", await this.service.test(this.config())); }
    catch (error) { this.message("kafkaConnectionStatus", String(error), true); }
    finally { button.disabled = false; }
  }

  records() {
    return parseMessages(this.field("kafkaValue").value, this.field("kafkaBulk").checked,
      this.field("kafkaKey").value, this.field("kafkaHeaders").value);
  }

  updateCount() {
    const bulk = this.field("kafkaBulk").checked;
    const button = this.field("kafkaPublish");
    try {
      const count = this.records().length;
      this.message("kafkaCount", `${count} ${count === 1 ? "message" : "messages"} per click${bulk ? " · 100 maximum" : ""}`);
      button.textContent = `Publish ${count} ${count === 1 ? "message" : "messages"}`;
      button.disabled = this.publishing;
    } catch (error) {
      this.message("kafkaCount", this.field("kafkaValue").value ? error.message :
        (bulk ? "Enter a JSON array of 1 to 100 messages." : "Enter one JSON value."), Boolean(this.field("kafkaValue").value));
      button.textContent = "Publish";
      button.disabled = true;
    }
  }

  async publish() {
    if (this.publishing) return;
    let records;
    try {
      records = this.records();
      if (!this.config().brokers || !this.field("kafkaTopic").value.trim()) throw new Error("Enter bootstrap servers and a topic.");
    } catch (error) { this.message("kafkaPublishStatus", error.message, true); return; }
    this.saveConnection();
    this.publishing = true;
    this.field("kafkaPublish").disabled = true;
    this.field("kafkaSave").disabled = true;
    this.message("kafkaPublishStatus", `Sending ${records.length} ${records.length === 1 ? "message" : "messages"}…`);
    this.field("kafkaDeliveries").replaceChildren();
    try {
      const result = await this.service.publish(this.config(), this.field("kafkaTopic").value.trim(), records);
      if (!this.container) return;
      const count = result.delivered.length;
      const status = result.failedAt == null ? `${count} ${count === 1 ? "message" : "messages"} delivered.` :
        `${count} delivered; stopped at message ${result.failedAt + 1}: ${result.error || "delivery failed"}`;
      this.message("kafkaPublishStatus", status, result.failedAt != null);
      for (const delivery of result.delivered) {
        const row = document.createElement("p");
        row.textContent = `#${delivery.index + 1} · partition ${delivery.partition} · offset ${delivery.offset}`;
        this.field("kafkaDeliveries").append(row);
      }
      if (count) UsageTracker.trackToolUse("kafka", "publish", { message_count: count });
    } catch (error) { this.message("kafkaPublishStatus", String(error), true); }
    finally {
      this.publishing = false;
      if (this.container) { this.field("kafkaSave").disabled = false; this.updateCount(); }
    }
  }

  saveRequest() {
    const name = this.field("kafkaRequestName").value.trim();
    if (!name) { this.message("kafkaPublishStatus", "Enter a request name before saving.", true); this.field("kafkaRequestName").focus(); return; }
    try { this.records(); }
    catch (error) { this.message("kafkaPublishStatus", error.message, true); return; }
    const request = {
      name, topic: this.field("kafkaTopic").value.trim(), key: this.field("kafkaKey").value,
      headers: this.field("kafkaHeaders").value, value: this.field("kafkaValue").value, bulk: this.field("kafkaBulk").checked,
    };
    if (!request.topic) { this.message("kafkaPublishStatus", "Enter a topic before saving.", true); return; }
    const next = [request, ...this.requests.filter((item) => item.name !== name)].slice(0, 30);
    try { localStorage.setItem(KAFKA_REQUESTS_KEY, JSON.stringify(next)); }
    catch (_) { this.message("kafkaPublishStatus", "This request is too large to save on this device.", true); return; }
    this.requests = next;
    this.renderRequests();
    this.message("kafkaPublishStatus", `Saved “${name}” on this device.`);
  }

  renderRequests() {
    const root = this.field("kafkaSavedList");
    root.replaceChildren();
    if (!this.requests.length) {
      const empty = document.createElement("p"); empty.className = "kafka-empty";
      empty.textContent = "No saved requests yet. Name the current JSON and save it for later."; root.append(empty); return;
    }
    this.requests.forEach((request, index) => {
      const row = document.createElement("div"); row.className = "kafka-saved-row";
      const detail = document.createElement("div");
      const name = document.createElement("strong"); name.textContent = request.name;
      const topic = document.createElement("small"); topic.textContent = request.topic;
      detail.append(name, topic);
      const load = document.createElement("button"); load.type = "button"; load.className = "btn btn-ghost btn-sm"; load.textContent = "Load"; load.dataset.action = "load"; load.dataset.index = index;
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "btn btn-ghost btn-sm"; remove.textContent = "Delete"; remove.dataset.action = "delete"; remove.dataset.index = index;
      row.append(detail, load, remove); root.append(row);
    });
  }

  handleSavedClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button || this.publishing) return;
    const index = Number(button.dataset.index);
    const request = this.requests[index];
    if (!request) return;
    if (button.dataset.action === "delete") {
      this.requests.splice(index, 1); localStorage.setItem(KAFKA_REQUESTS_KEY, JSON.stringify(this.requests));
      this.renderRequests(); this.message("kafkaPublishStatus", `Deleted “${request.name}”.`); return;
    }
    this.field("kafkaRequestName").value = request.name;
    this.field("kafkaTopic").value = request.topic;
    this.field("kafkaKey").value = request.key || "";
    this.field("kafkaHeaders").value = request.headers || "{}";
    this.field("kafkaValue").value = request.value;
    this.field("kafkaBulk").checked = Boolean(request.bulk);
    this.updateCount(); this.message("kafkaPublishStatus", `Loaded “${request.name}”. Review it before publishing.`);
    this.field("kafkaValue").focus();
  }

  async startListening() {
    if (this.listening) return;
    this.stopRequested = false;
    const topic = this.field("kafkaTopic").value.trim();
    if (!this.config().brokers || !topic) { this.message("kafkaListenStatus", "Enter bootstrap servers and a topic.", true); return; }
    this.saveConnection();
    const config = this.config();
    const fromBeginning = this.field("kafkaFromBeginning").checked;
    this.field("kafkaListen").disabled = true;
    this.message("kafkaListenStatus", "Connecting…");
    try {
      this.unlisten = [
        await this.service.on("kafka-message", (event) => this.showMessage(event.payload)),
        await this.service.on("kafka-listener-error", (event) => { this.stopListening().finally(() => this.message("kafkaListenStatus", String(event.payload), true)); }),
      ];
      if (this.stopRequested || !this.container) {
        this.unlisten.forEach((unlisten) => unlisten()); this.unlisten = [];
        return;
      }
      await this.service.start(config, topic, fromBeginning);
      if (this.stopRequested || !this.container) {
        await this.service.stop();
        this.unlisten.forEach((unlisten) => unlisten()); this.unlisten = [];
        return;
      }
      this.listening = true;
      this.field("kafkaStop").disabled = false;
      this.message("kafkaListenStatus", `Listening to ${topic}…`);
    } catch (error) {
      this.unlisten.forEach((unlisten) => unlisten()); this.unlisten = [];
      if (this.field("kafkaListen")) this.field("kafkaListen").disabled = false;
      this.message("kafkaListenStatus", String(error), true);
    }
  }

  showMessage(message) {
    if (!this.isActive || !this.listening) return;
    const root = this.field("kafkaMessages");
    root.querySelector(".kafka-empty")?.remove();
    const article = document.createElement("article");
    const meta = document.createElement("div"); meta.className = "kafka-message-meta";
    meta.textContent = `${message.topic} · partition ${message.partition} · offset ${message.offset}${message.key == null ? "" : ` · key ${message.key}`}`;
    const value = document.createElement("pre"); value.textContent = message.value;
    article.append(meta, value); root.prepend(article);
    while (root.children.length > 100) root.lastElementChild.remove();
  }

  async stopListening() {
    this.stopRequested = true;
    if (!this.listening && !this.unlisten.length) return;
    this.listening = false;
    this.unlisten.forEach((unlisten) => unlisten()); this.unlisten = [];
    try { await this.service.stop(); }
    catch (error) { this.message("kafkaListenStatus", String(error), true); }
    if (this.field("kafkaListen")) this.field("kafkaListen").disabled = false;
    if (this.field("kafkaStop")) this.field("kafkaStop").disabled = true;
    this.message("kafkaListenStatus", "Stopped");
  }
}
