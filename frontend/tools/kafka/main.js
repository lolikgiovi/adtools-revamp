import { BaseTool } from "../../core/BaseTool.js";
import { UsageTracker } from "../../core/UsageTracker.js";
import { getIconSvg } from "./icon.js";
import { KafkaService, KAFKA_CONFIG_KEY, KAFKA_REQUESTS_KEY, parseMessages, rankKafkaTopics, readKafkaConfig, readKafkaRequests, receivedMessageToDraft } from "./service.js";
import { KafkaTemplate } from "./template.js";
import { configureMonacoWorkers } from "../../core/MonacoWorkers.js";
import "./styles.css";

export class KafkaTool extends BaseTool {
  constructor(eventBus, service = new KafkaService()) {
    super({ id: "kafka", eventBus });
    this.service = service;
    this.publishing = false;
    this.listening = false;
    this.unlisten = [];
    this.stopRequested = false;
    this.topics = [];
    this.topicBrokerKey = "";
    this.topicsLoaded = false;
    this.topicRequestId = 0;
    this.topicLoading = false;
    this.topicError = "";
    this.visibleTopics = [];
    this.activeTopicIndex = -1;
    this.jsonEditors = {};
    this.receivedMessages = new WeakMap();
  }

  getIconSvg() { return getIconSvg(); }
  render() { return KafkaTemplate; }

  onMount() {
    const config = readKafkaConfig();
    this.field("kafkaBrokers").value = config.brokers;
    this.requests = readKafkaRequests();
    this.renderRequests();
    this.field("kafkaBrokers").addEventListener("change", () => this.saveConnection());
    this.field("kafkaBrokers").addEventListener("input", () => this.invalidateTopics());
    this.field("kafkaTopic").addEventListener("focus", () => { if (!this.suppressTopicFocus && this.config().brokers) this.openTopicMenu(); });
    this.field("kafkaTopicPicker").addEventListener("focusout", (event) => {
      if (!this.field("kafkaTopicPicker").contains(event.relatedTarget)) this.closeTopicMenu();
    });
    this.field("kafkaTopic").addEventListener("input", () => this.renderTopicOptions());
    this.field("kafkaTopic").addEventListener("keydown", (event) => this.handleTopicKeydown(event));
    this.field("kafkaTopicToggle").addEventListener("click", () => this.toggleTopicMenu());
    this.field("kafkaTopicRefresh").addEventListener("click", () => this.loadTopics(true));
    this.field("kafkaTopicOptions").addEventListener("pointerdown", (event) => {
      const option = event.target.closest(".kafka-topic-option");
      if (!option) return;
      event.preventDefault();
      this.selectTopic(this.visibleTopics[Number(option.dataset.index)]);
    });
    this.field("kafkaTopicOptions").addEventListener("click", (event) => this.handleTopicClick(event));
    this.outsideTopicClick = (event) => {
      if (!this.field("kafkaTopicMenu")?.hidden && !this.field("kafkaTopicPicker")?.contains(event.target)) this.closeTopicMenu();
    };
    document.addEventListener("click", this.outsideTopicClick);
    this.field("kafkaTest").addEventListener("click", () => this.testConnection());
    this.field("kafkaForm").addEventListener("submit", (event) => { event.preventDefault(); this.publish(); });
    this.field("kafkaSave").addEventListener("click", () => this.saveRequest());
    this.field("kafkaSavedList").addEventListener("click", (event) => this.handleSavedClick(event));
    this.field("kafkaBulk").addEventListener("change", () => this.updateCount());
    this.field("kafkaValue").addEventListener("input", () => this.updateCount());
    this.field("kafkaHeaders").addEventListener("input", () => this.updateCount());
    this.field("kafkaFormatHeaders").addEventListener("click", () => this.formatJson("Headers"));
    this.field("kafkaFormatValue").addEventListener("click", () => this.formatJson("Value"));
    this.field("kafkaListen").addEventListener("click", () => this.startListening());
    this.field("kafkaStop").addEventListener("click", () => this.stopListening());
    this.field("kafkaMessages").addEventListener("click", (event) => this.handleReceivedClick(event));
    this.updateCount();
    this.field("kafkaTopic").focus();
    if (import.meta.env.MODE !== "test") this.initializeJsonEditors();
  }

  onSoftDeactivate() { this.closeTopicMenu(); this.stopListening(); }
  onUnmount() {
    document.removeEventListener("click", this.outsideTopicClick);
    this.topicRequestId++;
    Object.values(this.jsonEditors).forEach((editor) => editor.dispose());
    this.jsonEditors = {};
    this.stopListening();
  }
  field(id) { return this.container?.querySelector(`#${id}`); }
  config() { return { brokers: this.field("kafkaBrokers").value.trim(), securityProtocol: "PLAINTEXT" }; }

  async initializeJsonEditors() {
    try {
      const [monaco, { default: editorWorker }, { default: jsonWorker }] = await Promise.all([
        import("monaco-editor/esm/vs/editor/editor.main.js"),
        import("monaco-editor/esm/vs/editor/editor.worker?worker"),
        import("monaco-editor/esm/vs/language/json/json.worker?worker"),
        import("monaco-editor/esm/vs/language/json/monaco.contribution.js"),
      ]);
      if (!this.container) return;
      configureMonacoWorkers(self, { editor: editorWorker, json: jsonWorker });
      for (const name of ["Headers", "Value"]) {
        const input = this.field(`kafka${name}`);
        const editor = monaco.editor.create(this.field(`kafka${name}Editor`), {
          value: input.value,
          language: "json",
          ariaLabel: name === "Headers" ? "Header JSON" : "Value JSON",
          theme: "vs-dark",
          automaticLayout: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          scrollbar: { alwaysConsumeMouseWheel: false },
          wordWrap: "on",
          formatOnPaste: true,
          tabSize: 2,
          insertSpaces: true,
          padding: { top: 12, bottom: 12 },
        });
        this.jsonEditors[name] = editor;
        editor.onDidChangeModelContent(() => {
          input.value = editor.getValue();
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
      }
      this.field("kafkaForm").classList.add("kafka-monaco-ready");
      this.updateCount();
    } catch (error) {
      console.error("Kafka JSON editors could not load", error);
    }
  }

  setJsonValue(name, value) {
    this.field(`kafka${name}`).value = value;
    this.jsonEditors[name]?.setValue(value);
  }

  formatJson(name) {
    const input = this.field(`kafka${name}`);
    try {
      const formatted = JSON.stringify(JSON.parse(input.value), null, 2);
      this.setJsonValue(name, formatted);
      this.updateCount();
    } catch (_) {
      this.message(`kafka${name}Status`, "Invalid JSON. Fix the syntax before formatting.", true);
      this.jsonEditors[name]?.focus();
    }
  }

  validateJson(name) {
    const input = this.field(`kafka${name}`);
    const status = `kafka${name}Status`;
    if (!input.value.trim() && name === "Value") {
      this.message(status, "");
      return;
    }
    try {
      const parsed = JSON.parse(input.value || (name === "Headers" ? "{}" : ""));
      if (name === "Headers" && (!parsed || Array.isArray(parsed) || typeof parsed !== "object" ||
        Object.entries(parsed).some(([key, value]) => !key || typeof value !== "string"))) {
        this.message(status, "Headers need a JSON object with string values.", true);
      } else if (name === "Value" && this.field("kafkaBulk").checked && (!Array.isArray(parsed) || !parsed.length || parsed.length > 100)) {
        this.message(status, "Bulk value needs an array of 1 to 100 messages.", true);
      } else this.message(status, "Valid JSON");
    } catch (_) { this.message(status, "Invalid JSON. Check the highlighted syntax.", true); }
  }

  saveConnection() {
    localStorage.setItem(KAFKA_CONFIG_KEY, JSON.stringify(this.config()));
  }

  invalidateTopics() {
    this.topicRequestId++;
    this.topicBrokerKey = "";
    this.topicsLoaded = false;
    this.topicLoading = false;
    this.topics = [];
    this.closeTopicMenu();
  }

  toggleTopicMenu() {
    if (this.field("kafkaTopicMenu").hidden) {
      this.field("kafkaTopic").focus();
      this.openTopicMenu();
    } else this.closeTopicMenu();
  }

  openTopicMenu() {
    this.field("kafkaTopicMenu").hidden = false;
    this.field("kafkaTopic").setAttribute("aria-expanded", "true");
    this.field("kafkaTopicToggle").setAttribute("aria-expanded", "true");
    this.renderTopicOptions();
    if (!this.topicsLoaded && !this.topicLoading) this.loadTopics();
  }

  closeTopicMenu() {
    if (!this.container) return;
    this.field("kafkaTopicMenu").hidden = true;
    this.field("kafkaTopic").setAttribute("aria-expanded", "false");
    this.field("kafkaTopic").removeAttribute("aria-activedescendant");
    this.field("kafkaTopicToggle").setAttribute("aria-expanded", "false");
    this.activeTopicIndex = -1;
  }

  async loadTopics(force = false) {
    const config = this.config();
    if (!config.brokers) {
      this.topicError = "Enter bootstrap servers before browsing topics.";
      this.renderTopicOptions();
      return;
    }
    if (this.topicLoading && !force) return;
    if (this.topicsLoaded && this.topicBrokerKey === config.brokers && !force) return;
    const requestId = ++this.topicRequestId;
    this.topicLoading = true;
    this.topicError = "";
    this.renderTopicOptions();
    try {
      const topics = await this.service.listTopics(config);
      if (requestId !== this.topicRequestId || !this.container) return;
      this.topics = topics;
      this.topicBrokerKey = config.brokers;
      this.topicsLoaded = true;
    } catch (error) {
      if (requestId !== this.topicRequestId || !this.container) return;
      this.topicError = `Could not browse topics: ${String(error)}`;
    } finally {
      if (requestId === this.topicRequestId && this.container) {
        this.topicLoading = false;
        this.renderTopicOptions();
      }
    }
  }

  renderTopicOptions() {
    const list = this.field("kafkaTopicOptions");
    if (!list) return;
    this.visibleTopics = rankKafkaTopics(this.topics, this.field("kafkaTopic").value);
    this.activeTopicIndex = this.visibleTopics.length ? 0 : -1;
    list.replaceChildren();
    this.visibleTopics.forEach((topic, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.id = `kafkaTopicOption${index}`;
      option.className = "kafka-topic-option";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(index === this.activeTopicIndex));
      option.dataset.index = String(index);
      option.dataset.active = String(index === this.activeTopicIndex);
      option.textContent = topic;
      list.append(option);
    });
    this.updateActiveTopic();
    const status = this.field("kafkaTopicStatus");
    status.textContent = this.topicLoading ? "Loading topics…" : this.topicError ||
      (this.visibleTopics.length ? `${this.visibleTopics.length} of ${this.topics.length} topics shown` :
        (this.topicsLoaded ? (this.topics.length ? "No matching topics. You can still enter a topic manually." :
          "No topics returned. Check broker access or enter a topic manually.") : "Browse topics from the broker."));
  }

  updateActiveTopic() {
    const input = this.field("kafkaTopic");
    input.removeAttribute("aria-activedescendant");
    this.field("kafkaTopicOptions").querySelectorAll(".kafka-topic-option").forEach((option, index) => {
      const active = index === this.activeTopicIndex;
      option.dataset.active = String(active);
      option.setAttribute("aria-selected", String(active));
      if (active) {
        input.setAttribute("aria-activedescendant", option.id);
        option.scrollIntoView?.({ block: "nearest" });
      }
    });
  }

  handleTopicKeydown(event) {
    if (event.key === "Escape") { if (!this.field("kafkaTopicMenu").hidden) { event.preventDefault(); this.closeTopicMenu(); } return; }
    if (event.key === "Enter") {
      event.preventDefault();
      if (!this.field("kafkaTopicMenu").hidden && this.activeTopicIndex >= 0) this.selectTopic(this.visibleTopics[this.activeTopicIndex]);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (this.field("kafkaTopicMenu").hidden) { this.openTopicMenu(); return; }
    if (!this.visibleTopics.length) return;
    const direction = event.key === "ArrowDown" ? 1 : -1;
    this.activeTopicIndex = (this.activeTopicIndex + direction + this.visibleTopics.length) % this.visibleTopics.length;
    this.updateActiveTopic();
  }

  handleTopicClick(event) {
    const option = event.target.closest(".kafka-topic-option");
    if (!option) return;
    this.selectTopic(this.visibleTopics[Number(option.dataset.index)]);
  }

  selectTopic(topic) {
    if (!topic) return;
    this.field("kafkaTopic").value = topic;
    this.closeTopicMenu();
    this.suppressTopicFocus = true;
    this.field("kafkaTopic").focus();
    this.suppressTopicFocus = false;
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
    this.validateJson("Headers");
    this.validateJson("Value");
    const bulk = this.field("kafkaBulk").checked;
    const button = this.field("kafkaPublish");
    try {
      const count = this.records().length;
      this.message("kafkaCount", `${count} ${count === 1 ? "message" : "messages"} per click${bulk ? " · 100 maximum" : ""}`);
      button.textContent = "Publish";
      button.disabled = this.publishing;
    } catch (_error) {
      this.message("kafkaCount", this.field("kafkaValue").value ? "" :
        (bulk ? "Enter a JSON array of 1 to 100 messages." : "Enter one JSON value."));
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
    this.closeTopicMenu();
    this.field("kafkaKey").value = request.key || "";
    this.setJsonValue("Headers", request.headers || "{}");
    this.setJsonValue("Value", request.value);
    this.field("kafkaBulk").checked = Boolean(request.bulk);
    this.updateCount(); this.message("kafkaPublishStatus", `Loaded “${request.name}”. Review it before publishing.`);
    if (this.jsonEditors.Value) this.jsonEditors.Value.focus();
    else this.field("kafkaValue").focus();
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
      try {
        await this.service.start(config, topic, fromBeginning);
      } catch (error) {
        if (!String(error).includes("Listener already running.")) throw error;
        this.message("kafkaListenStatus", "Restarting the previous listener…");
        await this.service.stop();
        if (this.stopRequested || !this.container) return;
        await this.service.start(config, topic, fromBeginning);
      }
      if (this.stopRequested || !this.container) {
        await this.service.stop();
        this.unlisten.forEach((unlisten) => unlisten()); this.unlisten = [];
        return;
      }
      this.listening = true;
      this.field("kafkaStop").disabled = false;
      this.field("kafkaListenHeading").textContent = `Listen to ${topic}`;
      this.message("kafkaListenStatus", "");
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
    const top = document.createElement("div"); top.className = "kafka-message-top";
    const meta = document.createElement("div"); meta.className = "kafka-message-meta";
    meta.textContent = `${message.topic} · partition ${message.partition} · offset ${message.offset}${message.key == null ? "" : ` · key ${message.key}`}` +
      `${message.headers?.length ? ` · ${message.headers.length} ${message.headers.length === 1 ? "header" : "headers"}` : ""}`;
    const use = document.createElement("button");
    use.type = "button";
    use.className = "btn btn-secondary btn-sm kafka-use-message";
    use.textContent = "Use in Publish";
    use.setAttribute("aria-label", `Use message at offset ${message.offset} in Publish`);
    let issue;
    try { receivedMessageToDraft(message); }
    catch (error) { use.disabled = true; use.title = error.message; issue = error.message; }
    this.receivedMessages.set(use, message);
    const value = document.createElement("pre"); value.textContent = message.value;
    top.append(meta, use);
    article.append(top, value); root.prepend(article);
    if (issue) {
      const note = document.createElement("p");
      note.className = "kafka-message-note";
      note.textContent = issue;
      article.append(note);
    }
    while (root.children.length > 100) root.lastElementChild.remove();
  }

  handleReceivedClick(event) {
    const button = event.target.closest(".kafka-use-message");
    if (!button || button.disabled || this.publishing) return;
    const message = this.receivedMessages.get(button);
    if (!message) return;
    try {
      const draft = receivedMessageToDraft(message);
      this.field("kafkaTopic").value = draft.topic;
      this.closeTopicMenu();
      this.field("kafkaKey").value = draft.key;
      this.setJsonValue("Headers", draft.headers);
      this.setJsonValue("Value", draft.value);
      this.field("kafkaBulk").checked = false;
      this.field("kafkaRequestName").value = "";
      this.updateCount();
      this.message("kafkaPublishStatus", `Loaded message at offset ${message.offset}. Review it before publishing.`);
      this.field("kafkaComposeHeading").scrollIntoView?.({ behavior: "smooth", block: "start" });
      if (this.jsonEditors.Value) this.jsonEditors.Value.focus();
      else this.field("kafkaValue").focus();
    } catch (error) { this.message("kafkaListenStatus", error.message, true); }
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
    if (this.field("kafkaListenHeading")) this.field("kafkaListenHeading").textContent = "Listen";
    this.message("kafkaListenStatus", "");
  }
}
