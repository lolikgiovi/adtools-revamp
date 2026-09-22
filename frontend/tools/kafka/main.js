import { BaseTool } from "../../core/BaseTool.js";
import { UsageTracker } from "../../core/UsageTracker.js";
import { getIconSvg } from "./icon.js";
import { KafkaService, KAFKA_CONFIG_KEY, KAFKA_REQUESTS_KEY, KAFKA_TOPIC_FAVORITES_KEY, parseMessages, rankKafkaTopics, readKafkaConfig, readKafkaRequests, readKafkaTopicFavorites, receivedMessageToDraft } from "./service.js";
import { KafkaTemplate } from "./template.js";
import { KafkaDateTimePicker } from "./date-picker.js";
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
    this.historyRequestId = 0;
    this.historyPicker = null;
    this.favoriteTopics = [];
    this._resizerCleanup = null;
  }

  getIconSvg() { return getIconSvg(); }
  render() { return KafkaTemplate; }

  onMount() {
    const config = readKafkaConfig();
    this.field("kafkaBrokers").value = config.brokers;
    this.requests = readKafkaRequests();
    this.favoriteTopics = readKafkaTopicFavorites();
    this.renderRequests();
    this.field("kafkaConnectionSettings").open = !config.brokers;
    this.setConnectionState(config.brokers ? "ready" : "empty");
    this.field("kafkaBrokers").addEventListener("change", () => this.saveConnection());
    this.field("kafkaBrokers").addEventListener("input", () => {
      this.invalidateTopics();
      this.setConnectionState(this.config().brokers ? "ready" : "empty");
      this.updateCount();
    });
    this.field("kafkaTopic").addEventListener("focus", () => { if (!this.suppressTopicFocus && this.config().brokers) this.openTopicMenu(); });
    this.field("kafkaTopicPicker").addEventListener("focusout", (event) => {
      if (!this.field("kafkaTopicPicker").contains(event.relatedTarget)) this.closeTopicMenu();
    });
    this.field("kafkaTopic").addEventListener("input", () => {
      this.renderTopicOptions();
      this.updateTopicFavorite();
      this.updateListenTopic();
      this.field("kafkaTemplateSearch").value = "";
      this.renderRequests();
      this.updateCount();
    });
    this.field("kafkaTopic").addEventListener("keydown", (event) => this.handleTopicKeydown(event));
    this.field("kafkaTopicToggle").addEventListener("click", () => this.toggleTopicMenu());
    this.field("kafkaTopicFavorite").addEventListener("click", () => this.toggleTopicFavorite());
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
    this.headersEscapeHandler = (event) => {
      if (event.key === "Escape" && this.field("kafkaHeadersSection")?.classList.contains("is-expanded")) {
        event.preventDefault();
        this.setHeadersExpanded(false);
      } else if (event.key === "Escape" && !this.field("kafkaTemplateSave")?.hidden) {
        event.preventDefault();
        this.setTemplateSaveOpen(false, true);
      }
    };
    document.addEventListener("keydown", this.headersEscapeHandler);
    this.field("kafkaTest").addEventListener("click", () => this.testConnection());
    this.field("kafkaPublishFlow").addEventListener("click", () => this.setFlow("publish"));
    this.field("kafkaListenFlow").addEventListener("click", () => this.setFlow("listen"));
    this.field("kafkaLiveMode").addEventListener("click", () => this.setListenMode("live"));
    this.field("kafkaHistoryMode").addEventListener("click", () => this.setListenMode("history"));
    this.field("kafkaLiveMode").parentElement.addEventListener("keydown", (event) => this.handleListenModeKeydown(event));
    this.field("kafkaForm").addEventListener("submit", (event) => { event.preventDefault(); this.publish(); });
    this.field("kafkaTemplateSaveToggle").addEventListener("click", () => this.setTemplateSaveOpen(this.field("kafkaTemplateSave").hidden));
    this.field("kafkaTemplateSaveCancel").addEventListener("click", () => this.setTemplateSaveOpen(false, true));
    this.field("kafkaSave").addEventListener("click", () => this.saveRequest());
    this.field("kafkaSavedList").addEventListener("click", (event) => this.handleSavedClick(event));
    this.field("kafkaTemplateSearch").addEventListener("input", () => this.renderRequests());
    this.field("kafkaBulk").addEventListener("change", () => this.updateCount());
    this.field("kafkaKey").addEventListener("input", () => this.updateCount());
    this.field("kafkaValue").addEventListener("input", () => this.updateCount());
    this.field("kafkaHeaders").addEventListener("input", () => this.updateCount());
    this.field("kafkaFormatHeaders").addEventListener("click", () => this.formatJson("Headers"));
    this.field("kafkaFormatValue").addEventListener("click", () => this.formatJson("Value"));
    this.field("kafkaExpandHeaders").addEventListener("click", () => this.setHeadersExpanded());
    this.field("kafkaListen").addEventListener("click", () => this.toggleListening());
    this.field("kafkaMessages").addEventListener("click", (event) => this.handleReceivedClick(event));
    this.field("kafkaHistoryResults").addEventListener("click", (event) => this.handleReceivedClick(event));
    this.field("kafkaHistoryForm").addEventListener("submit", (event) => { event.preventDefault(); this.searchHistory(); });
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    this.field("kafkaHistorySince").value = new Date(yesterday.getTime() - yesterday.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    this.historyPicker = new KafkaDateTimePicker({ root: this.field("kafkaHistoryPicker"), input: this.field("kafkaHistorySince") });
    this.historyPicker.mount();
    this.updateTopicFavorite();
    this.updateListenTopic();
    this.initializeResizer();
    this.updateCount();
    this.suppressTopicFocus = true;
    this.field("kafkaTopic").focus();
    this.suppressTopicFocus = false;
    if (import.meta.env.MODE !== "test") this.initializeJsonEditors();
  }

  onSoftDeactivate() {
    this.historyRequestId++;
    this.closeTopicMenu();
    this.historyPicker?.close();
    this.setHeadersExpanded(false);
    this.setTemplateSaveOpen(false);
    this.stopListening();
  }
  onUnmount() {
    document.removeEventListener("click", this.outsideTopicClick);
    document.removeEventListener("keydown", this.headersEscapeHandler);
    this.topicRequestId++;
    this.historyRequestId++;
    this.historyPicker?.destroy();
    this.historyPicker = null;
    this.cleanupResizer();
    this.setHeadersExpanded(false);
    this.setTemplateSaveOpen(false);
    Object.values(this.jsonEditors).forEach((editor) => editor.dispose());
    this.jsonEditors = {};
    this.stopListening();
  }
  field(id) { return this.container?.querySelector(`#${id}`); }
  config() { return { brokers: this.field("kafkaBrokers").value.trim(), securityProtocol: "PLAINTEXT" }; }
  setConnectionState(state, text = "") {
    const section = this.field("kafkaConnection");
    const status = this.field("kafkaConnectionStatus");
    if (!section || !status) return;
    const brokers = this.config().brokers;
    const labels = {
      empty: "Add a bootstrap server to get started.",
      ready: brokers ? `Not tested · ${brokers}` : "Add a bootstrap server to get started.",
      checking: "Checking connection…",
      connected: brokers ? `Connected · ${brokers}` : "Connected to Kafka",
      error: text || "Connection failed. Check broker settings.",
    };
    section.dataset.state = state;
    status.textContent = text || labels[state] || labels.ready;
    status.dataset.state = state === "error" ? "error" : "ok";
    status.title = state === "connected" && text ? text : "";
  }
  setFlow(flow) {
    const publish = flow === "publish";
    const publishButton = this.field("kafkaPublishFlow");
    const listenButton = this.field("kafkaListenFlow");
    publishButton?.classList.toggle("is-active", publish);
    listenButton?.classList.toggle("is-active", !publish);
    publishButton?.setAttribute("aria-pressed", String(publish));
    listenButton?.setAttribute("aria-pressed", String(!publish));
    this.field("kafkaPublishPanel")?.classList.toggle("is-active", publish);
    this.field("kafkaListenPanel")?.classList.toggle("is-active", !publish);
  }
  setListenMode(mode, focus = false) {
    const live = mode === "live";
    const liveButton = this.field("kafkaLiveMode");
    const historyButton = this.field("kafkaHistoryMode");
    liveButton?.classList.toggle("is-active", live);
    historyButton?.classList.toggle("is-active", !live);
    liveButton?.setAttribute("aria-selected", String(live));
    historyButton?.setAttribute("aria-selected", String(!live));
    if (liveButton) liveButton.tabIndex = live ? 0 : -1;
    if (historyButton) historyButton.tabIndex = live ? -1 : 0;
    if (this.field("kafkaLiveView")) this.field("kafkaLiveView").hidden = !live;
    if (this.field("kafkaHistoryView")) this.field("kafkaHistoryView").hidden = live;
    if (live) this.historyPicker?.close();
    if (focus) (live ? liveButton : historyButton)?.focus();
  }
  handleListenModeKeydown(event) {
    const keyModes = { ArrowLeft: "live", ArrowRight: "history", Home: "live", End: "history" };
    const mode = keyModes[event.key];
    if (!mode) return;
    event.preventDefault();
    this.setListenMode(mode, true);
  }
  setListeningButton(label = "Start listening", disabled = false, pressed = false) {
    const button = this.field("kafkaListen");
    if (!button) return;
    button.textContent = label;
    button.disabled = disabled;
    button.setAttribute("aria-pressed", String(pressed));
    button.setAttribute("aria-label", label);
  }
  toggleListening() { return this.listening ? this.stopListening() : this.startListening(); }

  initializeResizer() {
    const layout = this.field("kafkaWorkspace");
    const resizer = this.field("kafkaResizer");
    if (!layout || !resizer || this._resizerCleanup) return;

    const RESIZER_WIDTH = 4;
    const MIN_LEFT = 420;
    const MIN_RIGHT = 360;
    let dragging = false;
    let activePointerId = null;

    const getMetrics = () => {
      const rect = layout.getBoundingClientRect();
      const styles = getComputedStyle(layout);
      const gap = Number.parseFloat(styles.columnGap || styles.gap || "0") || 0;
      return { rect, gap, total: rect.width - RESIZER_WIDTH - gap * 2 };
    };
    const updateAria = (left, total) => {
      resizer.setAttribute("aria-valuemin", String(MIN_LEFT));
      resizer.setAttribute("aria-valuemax", String(Math.max(MIN_LEFT, Math.round(total - MIN_RIGHT))));
      resizer.setAttribute("aria-valuenow", String(Math.round(left)));
    };
    const currentLeft = () => {
      const firstColumn = getComputedStyle(layout).gridTemplateColumns.split(" ")[0];
      const current = Number.parseFloat(firstColumn);
      return Number.isFinite(current) ? current : MIN_LEFT;
    };
    const applyLeft = (requestedLeft, persist = true) => {
      const { total } = getMetrics();
      const maxLeft = total - MIN_RIGHT;
      if (maxLeft < MIN_LEFT) return;
      const left = Math.round(Math.max(MIN_LEFT, Math.min(requestedLeft, maxLeft)));
      const right = Math.max(MIN_RIGHT, Math.round(total - left));
      layout.style.gridTemplateColumns = `${left}px ${RESIZER_WIDTH}px ${right}px`;
      updateAria(left, total);
      if (persist && total > 0) {
        try { localStorage.setItem("tool:kafka:split-ratio", String(left / total)); } catch (_) {}
      }
    };
    const onMove = (event) => {
      if (!dragging || (activePointerId !== null && event.pointerId !== activePointerId)) return;
      const { rect, gap } = getMetrics();
      applyLeft(event.clientX - rect.left - gap - RESIZER_WIDTH / 2);
      event.preventDefault();
    };
    const onUp = (event) => {
      if (!dragging || (activePointerId !== null && event?.pointerId !== activePointerId)) return;
      if (activePointerId !== null && resizer.hasPointerCapture?.(activePointerId)) resizer.releasePointerCapture?.(activePointerId);
      dragging = false;
      activePointerId = null;
      resizer.classList.remove("is-dragging");
      document.body.classList.remove("is-resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    const onDown = (event) => {
      if (window.innerWidth <= 1060) return;
      dragging = true;
      activePointerId = event.pointerId;
      resizer.setPointerCapture?.(activePointerId);
      resizer.classList.add("is-dragging");
      document.body.classList.add("is-resizing");
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      event.preventDefault();
    };
    const onKeyDown = (event) => {
      if (window.innerWidth <= 1060) return;
      const step = event.shiftKey ? 48 : 16;
      const current = currentLeft();
      if (event.key === "ArrowLeft") applyLeft(current - step);
      else if (event.key === "ArrowRight") applyLeft(current + step);
      else if (event.key === "Home") applyLeft(MIN_LEFT);
      else if (event.key === "End") applyLeft(getMetrics().total - MIN_RIGHT);
      else return;
      event.preventDefault();
    };

    const metrics = getMetrics();
    let savedRatio = null;
    try {
      const parsed = Number.parseFloat(localStorage.getItem("tool:kafka:split-ratio") || "");
      if (Number.isFinite(parsed) && parsed > 0 && parsed < 1) savedRatio = parsed;
    } catch (_) {}
    if (savedRatio !== null) applyLeft(metrics.total * savedRatio, false);
    updateAria(currentLeft(), getMetrics().total);
    resizer.addEventListener("pointerdown", onDown);
    resizer.addEventListener("keydown", onKeyDown);
    this._resizerCleanup = () => {
      onUp({ pointerId: activePointerId });
      resizer.removeEventListener("pointerdown", onDown);
      resizer.removeEventListener("keydown", onKeyDown);
    };
  }

  cleanupResizer() {
    if (!this._resizerCleanup) return;
    try { this._resizerCleanup(); } catch (_) {}
    this._resizerCleanup = null;
  }

  setHeadersExpanded(expanded = !this.field("kafkaHeadersSection")?.classList.contains("is-expanded")) {
    const section = this.field("kafkaHeadersSection");
    const button = this.field("kafkaExpandHeaders");
    if (!section || !button) return;
    section.classList.toggle("is-expanded", expanded);
    button.textContent = expanded ? "Compact" : "Expand";
    button.setAttribute("aria-expanded", String(expanded));
    button.setAttribute("aria-label", expanded ? "Use compact headers editor" : "Expand headers editor inline");
    if (expanded) {
      this.jsonEditors.Headers?.focus();
      if (!this.jsonEditors.Headers) this.field("kafkaHeaders")?.focus();
    }
    this.jsonEditors.Headers?.layout?.();
  }

  setTemplateSaveOpen(open, returnFocus = false) {
    const panel = this.field("kafkaTemplateSave");
    const toggle = this.field("kafkaTemplateSaveToggle");
    if (!panel || !toggle) return;
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) this.field("kafkaRequestName")?.focus();
    else if (returnFocus) toggle.focus();
  }

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

  updateTopicFavorite() {
    const button = this.field("kafkaTopicFavorite");
    if (!button) return;
    const topic = this.field("kafkaTopic").value.trim();
    const favorite = Boolean(topic && this.favoriteTopics.includes(topic));
    button.classList.toggle("is-favorite", favorite);
    button.setAttribute("aria-pressed", String(favorite));
    button.setAttribute("aria-label", favorite ? "Remove topic from favorites" : "Favorite topic");
    button.title = favorite ? "Remove topic from favorites" : "Favorite topic";
  }

  updateListenTopic() {
    const node = this.field("kafkaListenTopic");
    if (!node) return;
    const topic = this.field("kafkaTopic")?.value.trim();
    node.textContent = topic ? `Topic: ${topic}` : "Choose a topic in Publish to search or listen.";
    node.title = topic || "";
  }

  toggleTopicFavorite() {
    const topic = this.field("kafkaTopic").value.trim();
    if (!topic) {
      this.message("kafkaPublishStatus", "Enter a topic before saving it as a favorite.", true);
      this.field("kafkaTopic").focus();
      return;
    }
    const favorite = this.favoriteTopics.includes(topic);
    this.favoriteTopics = favorite ? this.favoriteTopics.filter((item) => item !== topic) : [topic, ...this.favoriteTopics].slice(0, 100);
    try { localStorage.setItem(KAFKA_TOPIC_FAVORITES_KEY, JSON.stringify(this.favoriteTopics)); } catch (_) {}
    this.updateTopicFavorite();
    this.renderTopicOptions();
    this.showSuccess(favorite ? `Removed “${topic}” from favorites.` : `Added “${topic}” to favorites.`);
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
    const query = this.field("kafkaTopic").value;
    const favorites = rankKafkaTopics(this.favoriteTopics, query);
    const allTopics = rankKafkaTopics(this.topics, query).filter((topic) => !this.favoriteTopics.includes(topic));
    this.visibleTopics = [...favorites, ...allTopics];
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
      const label = document.createElement("span");
      label.textContent = topic;
      option.append(label);
      if (this.favoriteTopics.includes(topic)) {
        const favorite = document.createElement("span");
        favorite.className = "kafka-topic-option-favorite";
        favorite.setAttribute("aria-label", "Favorite");
        favorite.innerHTML = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z\" /></svg>";
        option.append(favorite);
      }
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
    this.updateTopicFavorite();
    this.updateListenTopic();
    this.field("kafkaTemplateSearch").value = "";
    this.renderRequests();
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
    this.setConnectionState("checking");
    try {
      const result = await this.service.test(this.config());
      this.setConnectionState("connected", `Connected to ${this.config().brokers}`);
      this.field("kafkaConnectionStatus").title = String(result || "Connected to Kafka");
      this.field("kafkaConnectionSettings").open = false;
    } catch (error) {
      this.setConnectionState("error", String(error));
    } finally { button.disabled = false; }
  }

  records() {
    return parseMessages(this.field("kafkaValue").value, this.field("kafkaBulk").checked,
      this.field("kafkaKey").value, this.field("kafkaHeaders").value);
  }

  updateCount() {
    this.updateOptionsSummary();
    this.validateJson("Headers");
    this.validateJson("Value");
    const bulk = this.field("kafkaBulk").checked;
    const button = this.field("kafkaPublish");
    try {
      const count = this.records().length;
      const ready = this.config().brokers && this.field("kafkaTopic").value.trim();
      this.message("kafkaCount", ready ? `${count} ${count === 1 ? "message" : "messages"} per click${bulk ? " · 100 maximum" : ""}` :
        (!this.config().brokers ? "Set up a broker to publish." : "Choose a topic to publish."));
      button.textContent = "Publish";
      button.disabled = this.publishing || !ready;
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
      favorite: Boolean(this.requests.find((item) => item.name === name)?.favorite),
    };
    if (!request.topic) { this.message("kafkaPublishStatus", "Enter a topic before saving.", true); return; }
    const next = [request, ...this.requests.filter((item) => item.name !== name)].slice(0, 30);
    try { localStorage.setItem(KAFKA_REQUESTS_KEY, JSON.stringify(next)); }
    catch (_) { this.message("kafkaPublishStatus", "This request is too large to save on this device.", true); return; }
    this.requests = next;
    this.renderRequests();
    this.setTemplateSaveOpen(false);
    this.field("kafkaTemplates").open = true;
    this.message("kafkaPublishStatus", `Saved “${name}” on this device.`);
  }

  updateOptionsSummary() {
    const summary = this.field("kafkaPublishOptionsSummary");
    if (!summary) return;
    const key = this.field("kafkaKey")?.value.trim();
    const headers = this.field("kafkaHeaders")?.value.trim();
    const parts = [];
    if (key) parts.push("Key");
    if (headers && headers !== "{}") {
      try {
        const parsed = JSON.parse(headers);
        const valid = parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
          Object.entries(parsed).every(([name, value]) => name && typeof value === "string");
        if (valid && Object.keys(parsed).length) {
          const count = Object.keys(parsed).length;
          parts.push(String(count) + (count === 1 ? " header" : " headers"));
        } else parts.push("Headers need attention");
      } catch (_) { parts.push("Headers need attention"); }
    }
    summary.textContent = parts.length ? parts.join(" · ") : "Optional";
  }

  renderRequests() {
    const root = this.field("kafkaSavedList");
    if (!root) return;
    root.replaceChildren();
    const topic = this.field("kafkaTopic")?.value.trim();
    const topicRequests = topic ? this.requests.filter((request) => request.topic === topic) : this.requests;
    const query = this.field("kafkaTemplateSearch")?.value.trim().toLowerCase() || "";
    const requests = query ? topicRequests.filter((request) => request.name.toLowerCase().includes(query)) : topicRequests;
    const count = this.field("kafkaTemplateCount");
    if (count) count.textContent = topicRequests.length ? `${topicRequests.length} ${topicRequests.length === 1 ? "template" : "templates"}` : "";
    if (!requests.length) {
      const empty = document.createElement("p"); empty.className = "kafka-empty";
      empty.textContent = query ? "No templates match “" + query + "”." : topic ? "No templates for this topic yet." : "Save a template to reuse it here."; root.append(empty); return;
    }
    const ordered = [...requests].sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)));
    ordered.forEach((request) => {
      const row = document.createElement("div"); row.className = "kafka-saved-row";
      const detail = document.createElement("div");
      const name = document.createElement("strong"); name.textContent = request.name;
      const topicLabel = document.createElement("small"); topicLabel.textContent = request.topic;
      detail.append(name, topicLabel);
      const index = this.requests.indexOf(request);
      const favorite = document.createElement("button"); favorite.type = "button"; favorite.className = "kafka-icon-button kafka-template-favorite"; favorite.dataset.action = "favorite"; favorite.dataset.index = index;
      favorite.setAttribute("aria-pressed", String(Boolean(request.favorite)));
      favorite.setAttribute("aria-label", request.favorite ? `Remove ${request.name} from favorites` : `Favorite ${request.name}`);
      favorite.title = favorite.getAttribute("aria-label");
      favorite.innerHTML = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z\" /></svg>";
      const load = document.createElement("button"); load.type = "button"; load.className = "btn btn-secondary btn-sm"; load.textContent = "Use"; load.dataset.action = "load"; load.dataset.index = index;
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "btn btn-ghost btn-sm"; remove.textContent = "Remove"; remove.dataset.action = "delete"; remove.dataset.index = index;
      row.append(detail, favorite, load, remove); root.append(row);
    });
  }

  handleSavedClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button || this.publishing) return;
    const index = Number(button.dataset.index);
    const request = this.requests[index];
    if (!request) return;
    if (button.dataset.action === "favorite") {
      request.favorite = !request.favorite;
      localStorage.setItem(KAFKA_REQUESTS_KEY, JSON.stringify(this.requests));
      this.renderRequests();
      return;
    }
    if (button.dataset.action === "delete") {
      this.requests.splice(index, 1); localStorage.setItem(KAFKA_REQUESTS_KEY, JSON.stringify(this.requests));
      this.renderRequests(); this.message("kafkaPublishStatus", `Deleted “${request.name}”.`); return;
    }
    this.field("kafkaRequestName").value = request.name;
    this.field("kafkaTopic").value = request.topic;
    this.closeTopicMenu();
    this.updateTopicFavorite();
    this.updateListenTopic();
    this.renderRequests();
    this.field("kafkaKey").value = request.key || "";
    this.setJsonValue("Headers", request.headers || "{}");
    this.setJsonValue("Value", request.value);
    this.field("kafkaBulk").checked = Boolean(request.bulk);
    this.field("kafkaPublishOptions").open = Boolean(request.key || (request.headers && request.headers.trim() !== "{}"));
    this.field("kafkaTemplateSearch").value = "";
    this.field("kafkaTemplates").open = false;
    this.updateCount(); this.message("kafkaPublishStatus", `Loaded “${request.name}”. Review it before publishing.`);
    if (this.jsonEditors.Value) this.jsonEditors.Value.focus();
    else this.field("kafkaValue").focus();
  }

  async startListening() {
    if (this.listening) return;
    this.setFlow("listen");
    this.setListenMode("live");
    this.stopRequested = false;
    const topic = this.field("kafkaTopic").value.trim();
    if (!this.config().brokers || !topic) { this.message("kafkaListenStatus", "Enter bootstrap servers and a topic.", true); return; }
    this.saveConnection();
    const config = this.config();
    const fromBeginning = this.field("kafkaFromBeginning").checked;
    this.setListeningButton("Connecting…", true);
    this.message("kafkaListenStatus", "Connecting…");
    try {
      this.unlisten = [
        await this.service.on("kafka-message", (event) => this.showMessage(event.payload)),
        await this.service.on("kafka-listener-error", (event) => { this.stopListening().finally(() => this.message("kafkaListenStatus", String(event.payload), true)); }),
      ];
      if (this.stopRequested || !this.container) {
        this.unlisten.forEach((unlisten) => unlisten()); this.unlisten = [];
        if (this.container) this.setListeningButton();
        return;
      }
      try {
        await this.service.start(config, topic, fromBeginning);
      } catch (error) {
        if (!String(error).includes("Listener already running.")) throw error;
        this.message("kafkaListenStatus", "Restarting the previous listener…");
        await this.service.stop();
        if (this.stopRequested || !this.container) {
          if (this.container) this.setListeningButton();
          return;
        }
        await this.service.start(config, topic, fromBeginning);
      }
      if (this.stopRequested || !this.container) {
        await this.service.stop();
        this.unlisten.forEach((unlisten) => unlisten()); this.unlisten = [];
        if (this.container) this.setListeningButton();
        return;
      }
      this.listening = true;
      this.setListeningButton("Stop listening", false, true);
      this.field("kafkaListenHeading").textContent = `Listen to ${topic}`;
      this.message("kafkaListenStatus", "");
    } catch (error) {
      this.unlisten.forEach((unlisten) => unlisten()); this.unlisten = [];
      this.setListeningButton();
      this.message("kafkaListenStatus", String(error), true);
    }
  }

  async searchHistory() {
    this.setFlow("listen");
    this.setListenMode("history");
    const topic = this.field("kafkaTopic").value.trim();
    const query = this.field("kafkaHistoryQuery").value.trim();
    const sinceMs = new Date(this.field("kafkaHistorySince").value).getTime();
    if (!this.config().brokers || !topic) { this.message("kafkaHistoryStatus", "Enter bootstrap servers and a topic in Publish first.", true); return; }
    if (query.length < 3 || !Number.isFinite(sinceMs) || sinceMs > Date.now()) {
      this.message("kafkaHistoryStatus", "Enter at least 3 characters and choose a start time in the past.", true); return;
    }
    const requestId = ++this.historyRequestId;
    const button = this.field("kafkaHistorySearch");
    button.disabled = true;
    this.field("kafkaHistoryResults").replaceChildren();
    this.message("kafkaHistoryStatus", "Searching retained records…");
    try {
      const result = await this.service.searchHistory(this.config(), topic, query, sinceMs);
      if (requestId !== this.historyRequestId || !this.container) return;
      for (const match of result.matches) this.showMessage(match, true);
      const count = result.matches.length;
      this.message("kafkaHistoryStatus", `${count} ${count === 1 ? "match" : "matches"} in ${result.scanned.toLocaleString()} records.${result.limited ? " Search limit reached; narrow the start time to look further." : ""}`);
    } catch (error) {
      if (requestId === this.historyRequestId && this.container) this.message("kafkaHistoryStatus", String(error), true);
    } finally {
      if (requestId === this.historyRequestId && this.container) button.disabled = false;
    }
  }

  showMessage(message, fromHistory = false) {
    if (!this.isActive || (!fromHistory && !this.listening)) return;
    const root = this.field(fromHistory ? "kafkaHistoryResults" : "kafkaMessages");
    if (!fromHistory) root.querySelector(".kafka-empty")?.remove();
    const article = document.createElement("article");
    const top = document.createElement("div"); top.className = "kafka-message-top";
    const meta = document.createElement("div"); meta.className = "kafka-message-meta";
    meta.textContent = `${message.topic} · partition ${message.partition} · offset ${message.offset}` +
      `${message.timestamp ? ` · ${new Date(message.timestamp).toLocaleString()}` : ""}${message.key == null ? "" : ` · key ${message.key}`}` +
      `${message.headers?.length ? ` · ${message.headers.length} ${message.headers.length === 1 ? "header" : "headers"}` : ""}`;
    const actions = document.createElement("div"); actions.className = "kafka-message-actions";
    const use = document.createElement("button");
    use.type = "button";
    use.className = "btn btn-secondary btn-sm kafka-use-message";
    use.dataset.messageAction = "use";
    use.textContent = "Use in Publish";
    use.setAttribute("aria-label", `Use message at offset ${message.offset} in Publish`);
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "btn btn-ghost btn-sm";
    copy.dataset.messageAction = "copy";
    copy.textContent = "Copy";
    copy.setAttribute("aria-label", `Copy message at offset ${message.offset}`);
    const format = document.createElement("button");
    format.type = "button";
    format.className = "btn btn-ghost btn-sm";
    format.dataset.messageAction = "format";
    format.textContent = "Format";
    format.setAttribute("aria-label", `Format message at offset ${message.offset} as JSON`);
    let issue;
    try { receivedMessageToDraft(message); }
    catch (error) { use.disabled = true; use.title = error.message; issue = error.message; }
    try { JSON.stringify(JSON.parse(message.value), null, 2); }
    catch (_) { format.disabled = true; format.title = "Message value is not valid JSON."; }
    this.receivedMessages.set(use, message);
    this.receivedMessages.set(copy, message);
    this.receivedMessages.set(format, message);
    const value = document.createElement("pre");
    value.className = "kafka-message-value";
    value.dataset.rawValue = message.value;
    value.textContent = message.value;
    actions.append(use, copy, format);
    top.append(meta, actions);
    article.append(top, value);
    if (fromHistory) root.append(article);
    else root.prepend(article);
    if (issue) {
      const note = document.createElement("p");
      note.className = "kafka-message-note";
      note.textContent = issue;
      article.append(note);
    }
    if (!fromHistory) while (root.children.length > 100) root.lastElementChild.remove();
  }

  handleReceivedClick(event) {
    const button = event.target.closest("[data-message-action]");
    if (!button || button.disabled || this.publishing) return;
    const message = this.receivedMessages.get(button);
    if (!message) return;
    if (button.dataset.messageAction === "copy") {
      const value = button.closest("article")?.querySelector(".kafka-message-value")?.textContent || message.value;
      this.copyToClipboard(value, button);
      return;
    }
    if (button.dataset.messageAction === "format") {
      this.toggleMessageFormat(button);
      return;
    }
    try {
      const draft = receivedMessageToDraft(message);
      this.field("kafkaTopic").value = draft.topic;
      this.closeTopicMenu();
      this.updateTopicFavorite();
      this.updateListenTopic();
      this.renderRequests();
      this.field("kafkaKey").value = draft.key;
      this.setJsonValue("Headers", draft.headers);
      this.setJsonValue("Value", draft.value);
      this.field("kafkaBulk").checked = false;
      this.field("kafkaRequestName").value = "";
      this.field("kafkaPublishOptions").open = Boolean(draft.key || draft.headers !== "{}");
      this.updateCount();
      this.setFlow("publish");
      this.message("kafkaPublishStatus", `Loaded message at offset ${message.offset}. Review it before publishing.`);
      this.field("kafkaComposeHeading").scrollIntoView?.({ behavior: "smooth", block: "start" });
      if (this.jsonEditors.Value) this.jsonEditors.Value.focus();
      else this.field("kafkaValue").focus();
    } catch (error) { this.message(button.closest("#kafkaHistoryResults") ? "kafkaHistoryStatus" : "kafkaListenStatus", error.message, true); }
  }

  toggleMessageFormat(button) {
    const article = button.closest("article");
    const value = article?.querySelector(".kafka-message-value");
    if (!value) return;
    const formatted = button.getAttribute("aria-pressed") !== "true";
    if (formatted) {
      try { value.textContent = JSON.stringify(JSON.parse(value.dataset.rawValue), null, 2); }
      catch (_) { return; }
    } else value.textContent = value.dataset.rawValue;
    button.setAttribute("aria-pressed", String(formatted));
    button.textContent = formatted ? "Raw" : "Format";
  }

  async stopListening() {
    this.stopRequested = true;
    if (!this.listening && !this.unlisten.length) {
      this.setListeningButton();
      return;
    }
    this.listening = false;
    this.unlisten.forEach((unlisten) => unlisten()); this.unlisten = [];
    this.setListeningButton("Stopping…", true);
    try { await this.service.stop(); }
    catch (error) { this.message("kafkaListenStatus", String(error), true); }
    this.setListeningButton();
    if (this.field("kafkaListenHeading")) this.field("kafkaListenHeading").textContent = "Listen";
    this.message("kafkaListenStatus", "");
  }
}
