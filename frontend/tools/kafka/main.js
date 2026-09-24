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
    this.testingConnection = false;
    this.searchingHistory = false;
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
    this.topicPickerSource = "publish";
    this.jsonEditors = {};
    this.receivedMessages = new WeakMap();
    this.historyRequestId = 0;
    this.historyPicker = null;
    this.favoriteTopics = [];
    this.visibleRequests = [];
    this.activeTemplateIndex = -1;
    this.selectedRequestName = "";
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
    const connectionSettings = this.field("kafkaConnectionSettings");
    connectionSettings.addEventListener("toggle", () => this.updateConnectionSettingsLayout());
    this.setConnectionSettingsOpen(!config.brokers);
    const templatePicker = this.field("kafkaTemplates");
    templatePicker.addEventListener("toggle", () => this.updateTemplateMenuLayout());
    this.field("kafkaTemplateToggle").addEventListener("click", () => this.toggleTemplateMenu());
    this.field("kafkaTemplateToggle").addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        this.openTemplateMenu();
        this.field("kafkaTemplateSearch").focus();
      }
    });
    this.setConnectionState(config.brokers ? "ready" : "empty");
    this.field("kafkaBrokers").addEventListener("change", () => this.saveConnection());
    this.field("kafkaBrokers").addEventListener("input", () => {
      this.invalidateTopics();
      this.setConnectionState(this.config().brokers ? "ready" : "empty");
      this.updateCount();
      this.updateActionAvailability();
    });
    this.bindTopicPicker("publish");
    this.bindTopicPicker("listen");
    this.outsideTopicClick = (event) => {
      if (!this.field("kafkaTopicMenu")?.hidden && !this.field("kafkaTopicPicker")?.contains(event.target)) this.closeTopicMenu();
      if (!this.field("kafkaListenTopicMenu")?.hidden && !this.field("kafkaListenTopicPicker")?.contains(event.target)) {
        this.closeTopicMenu("listen");
      }
      if (this.field("kafkaTemplates")?.open && !this.field("kafkaTemplatePicker")?.contains(event.target)) this.closeTemplateMenu();
      if (this.field("kafkaConnectionSettings")?.open && !this.field("kafkaConnectionSettings")?.contains(event.target)) {
        this.setConnectionSettingsOpen(false);
      }
    };
    document.addEventListener("click", this.outsideTopicClick);
    this.field("kafkaTemplatePicker").addEventListener("focusout", (event) => {
      if (!this.field("kafkaTemplatePicker").contains(event.relatedTarget)) this.closeTemplateMenu();
    });
    this.field("kafkaTemplateSearch").addEventListener("focus", () => this.openTemplateMenu());
    this.field("kafkaTemplateSearch").addEventListener("pointerdown", () => this.field("kafkaTemplatePicker").classList.add("is-pointer-focused"));
    this.field("kafkaTemplateSearch").addEventListener("click", () => this.field("kafkaTemplatePicker").classList.add("is-pointer-focused"));
    this.field("kafkaTemplateSearch").addEventListener("blur", () => this.field("kafkaTemplatePicker").classList.remove("is-pointer-focused"));
    this.field("kafkaTemplateFavorite").addEventListener("click", () => this.toggleTemplateFavorite());
    this.headersEscapeHandler = (event) => {
      if (event.key === "Escape" && this.field("kafkaHeadersSection")?.classList.contains("is-expanded")) {
        event.preventDefault();
        this.setHeadersExpanded(false);
      } else if (event.key === "Escape" && !this.field("kafkaTemplateSave")?.hidden) {
        event.preventDefault();
        this.setTemplateSaveOpen(false, true);
      } else if (event.key === "Escape" && this.field("kafkaTemplates")?.open) {
        event.preventDefault();
        this.closeTemplateMenu();
        this.field("kafkaTemplateToggle").focus();
      } else if (event.key === "Escape" && this.field("kafkaConnectionSettings")?.open) {
        event.preventDefault();
        this.setConnectionSettingsOpen(false);
        this.field("kafkaConnectionSettings").querySelector("summary")?.focus();
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
    this.field("kafkaSavedList").addEventListener("pointerdown", (event) => {
      if (event.target.closest('button[data-action="load"]')) event.preventDefault();
    });
    this.field("kafkaTemplateSearch").addEventListener("input", () => {
      this.selectedRequestName = "";
      this.renderRequests();
    });
    this.field("kafkaTemplateSearch").addEventListener("keydown", (event) => this.handleTemplateKeydown(event));
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
    this.setListenMode("history");
    this.updateTopicFavorite();
    this.updateTopicFavorite("listen");
    this.updateActionAvailability();
    this.initializeResizer();
    this.updateCount();
    if (!config.brokers) this.field("kafkaBrokers").focus();
    if (import.meta.env.MODE !== "test") this.initializeJsonEditors();
  }

  onSoftDeactivate() {
    this.historyRequestId++;
    this.closeTopicMenu();
    this.closeTopicMenu("listen");
    this.closeTemplateMenu();
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
    this.closeTopicMenu();
    this.closeTopicMenu("listen");
    this.historyPicker?.destroy();
    this.historyPicker = null;
    this.cleanupResizer();
    this.setHeadersExpanded(false);
    this.closeTemplateMenu();
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
      connected: brokers ? `Test passed · ${brokers}` : "Connection test passed",
      error: text || "Connection failed. Check broker settings.",
    };
    section.dataset.state = state;
    status.textContent = text || labels[state] || labels.ready;
    status.dataset.state = state === "error" ? "error" : "ok";
    status.title = state === "connected" && text ? text : "";
  }
  setConnectionSettingsOpen(open) {
    const settings = this.field("kafkaConnectionSettings");
    if (!settings) return;
    settings.open = Boolean(open);
    this.updateConnectionSettingsLayout();
  }
  updateConnectionSettingsLayout() {
    const settings = this.field("kafkaConnectionSettings");
    this.field("kafkaConnection")?.classList.toggle("is-settings-open", Boolean(settings?.open));
  }
  updateActionAvailability() {
    const hasBrokers = Boolean(this.config().brokers);
    const hasTopic = Boolean(this.field("kafkaListenTopic")?.value.trim());
    const ready = hasBrokers && hasTopic;
    const testButton = this.field("kafkaTest");
    const listenButton = this.field("kafkaListen");
    const historyButton = this.field("kafkaHistorySearch");
    const emptyMessage = this.field("kafkaMessages")?.querySelector(".kafka-empty");

    if (testButton) testButton.disabled = !hasBrokers || this.testingConnection;
    if (listenButton && !this.listening && !["Connecting…", "Stopping…"].includes(listenButton.textContent)) {
      listenButton.disabled = !ready;
    }
    if (historyButton) historyButton.disabled = !ready || this.searchingHistory;
    if (emptyMessage) {
      emptyMessage.textContent = !hasBrokers ? "Add a bootstrap server, then enter a topic to listen." : "";
    }
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
    this.updateListeningButtonVisibility();
    if (live) this.historyPicker?.close();
    if (focus) (live ? liveButton : historyButton)?.focus();
  }
  updateListeningButtonVisibility() {
    const button = this.field("kafkaListen");
    const liveView = this.field("kafkaLiveView");
    if (!button || !liveView) return;
    const active = this.listening || button.getAttribute("aria-pressed") === "true" ||
      ["Connecting…", "Stopping…"].includes(button.textContent);
    button.hidden = liveView.hidden && !active;
  }
  handleListenModeKeydown(event) {
    const keyModes = { ArrowLeft: "history", ArrowRight: "live", Home: "history", End: "live" };
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
    this.updateListeningButtonVisibility();
    const topic = this.field("kafkaListenTopic");
    if (topic) topic.disabled = pressed || ["Connecting…", "Stopping…"].includes(label);
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
    globalThis.dispatchEvent?.(new Event("adtools:connection-settings-changed"));
  }

  invalidateTopics() {
    this.topicRequestId++;
    this.topicBrokerKey = "";
    this.topicsLoaded = false;
    this.topicLoading = false;
    this.topics = [];
    this.closeTopicMenu();
    this.closeTopicMenu("listen");
  }

  topicPickerIds(source = "publish") {
    const input = source === "listen" ? "kafkaListenTopic" : "kafkaTopic";
    return {
      input,
      picker: `${input}Picker`,
      favorite: `${input}Favorite`,
      toggle: `${input}Toggle`,
      menu: `${input}Menu`,
      refresh: `${input}Refresh`,
      status: `${input}Status`,
      options: `${input}Options`,
    };
  }

  bindTopicPicker(source) {
    const ids = this.topicPickerIds(source);
    const input = this.field(ids.input);
    const picker = this.field(ids.picker);
    input.addEventListener("pointerdown", () => picker.classList.add("is-pointer-focused"));
    input.addEventListener("click", () => picker.classList.add("is-pointer-focused"));
    input.addEventListener("blur", () => picker.classList.remove("is-pointer-focused"));
    input.addEventListener("focus", () => {
      if (!this.suppressTopicFocus && this.config().brokers) this.openTopicMenu(source);
    });
    picker.addEventListener("focusout", (event) => {
      if (!picker.contains(event.relatedTarget)) this.closeTopicMenu(source);
    });
    input.addEventListener("input", () => {
      this.renderTopicOptions(source);
      this.updateTopicFavorite(source);
      if (source === "listen") {
        this.updateActionAvailability();
      } else {
        this.closeTemplateMenu();
        this.field("kafkaTemplateSearch").value = "";
        this.selectedRequestName = "";
        this.renderRequests();
        this.updateCount();
      }
    });
    input.addEventListener("keydown", (event) => this.handleTopicKeydown(event, source));
    this.field(ids.toggle).addEventListener("click", () => this.toggleTopicMenu(source));
    this.field(ids.favorite).addEventListener("click", () => this.toggleTopicFavorite(source));
    this.field(ids.refresh).addEventListener("click", () => this.loadTopics(true));
    this.field(ids.options).addEventListener("pointerdown", (event) => {
      const option = event.target.closest(".kafka-topic-option");
      if (!option) return;
      event.preventDefault();
      this.selectTopic(this.visibleTopics[Number(option.dataset.index)], source);
    });
    this.field(ids.options).addEventListener("click", (event) => this.handleTopicClick(event, source));
  }

  updateTopicFavorite(source = "publish") {
    const ids = this.topicPickerIds(source);
    const button = this.field(ids.favorite);
    if (!button) return;
    const topic = this.field(ids.input).value.trim();
    const favorite = Boolean(topic && this.favoriteTopics.includes(topic));
    button.classList.toggle("is-favorite", favorite);
    button.setAttribute("aria-pressed", String(favorite));
    button.setAttribute("aria-label", favorite ? "Remove topic from favorites" : "Favorite topic");
    button.title = favorite ? "Remove topic from favorites" : "Favorite topic";
  }

  toggleTopicFavorite(source = "publish") {
    const ids = this.topicPickerIds(source);
    const topic = this.field(ids.input).value.trim();
    if (!topic) {
      this.message(source === "listen" ? "kafkaListenStatus" : "kafkaPublishStatus", "Enter a topic before saving it as a favorite.", true);
      this.field(ids.input).focus();
      return;
    }
    const favorite = this.favoriteTopics.includes(topic);
    this.favoriteTopics = favorite ? this.favoriteTopics.filter((item) => item !== topic) : [topic, ...this.favoriteTopics].slice(0, 100);
    try { localStorage.setItem(KAFKA_TOPIC_FAVORITES_KEY, JSON.stringify(this.favoriteTopics)); } catch (_) {}
    this.updateTopicFavorite("publish");
    this.updateTopicFavorite("listen");
    this.renderTopicOptions(source);
    this.showSuccess(favorite ? `Removed “${topic}” from favorites.` : `Added “${topic}” to favorites.`);
  }

  toggleTopicMenu(source = "publish") {
    const { menu } = this.topicPickerIds(source);
    if (this.field(menu).hidden) this.openTopicMenu(source);
    else this.closeTopicMenu(source);
  }

  openTopicMenu(source = "publish") {
    const ids = this.topicPickerIds(source);
    this.closeTopicMenu(source === "listen" ? "publish" : "listen");
    this.topicPickerSource = source;
    this.field(ids.menu).hidden = false;
    this.field(ids.input).setAttribute("aria-expanded", "true");
    this.field(ids.toggle).setAttribute("aria-expanded", "true");
    this.renderTopicOptions(source);
    if (!this.topicsLoaded && !this.topicLoading) this.loadTopics();
  }

  closeTopicMenu(source = "publish") {
    if (!this.container) return;
    const ids = this.topicPickerIds(source);
    const menu = this.field(ids.menu);
    if (!menu) return;
    const wasOpen = !menu.hidden;
    menu.hidden = true;
    this.field(ids.input).setAttribute("aria-expanded", "false");
    this.field(ids.input).removeAttribute("aria-activedescendant");
    this.field(ids.toggle).setAttribute("aria-expanded", "false");
    if (wasOpen && this.topicPickerSource === source) this.activeTopicIndex = -1;
  }

  updateTemplateMenuLayout() {
    const picker = this.field("kafkaTemplates");
    const search = this.field("kafkaTemplateSearch");
    if (!picker || !search) return;
    const expanded = Boolean(picker.open);
    picker.querySelector("summary")?.setAttribute("aria-expanded", String(expanded));
    this.field("kafkaTemplateToggle").setAttribute("aria-expanded", String(expanded));
    search.setAttribute("aria-expanded", String(expanded));
    if (!expanded) {
      this.activeTemplateIndex = -1;
      search.removeAttribute("aria-activedescendant");
    }
  }

  openTemplateMenu() {
    const picker = this.field("kafkaTemplates");
    if (!picker) return;
    picker.open = true;
    this.updateTemplateMenuLayout();
    this.renderRequests();
  }

  toggleTemplateMenu() {
    if (this.field("kafkaTemplates").open) this.closeTemplateMenu();
    else this.openTemplateMenu();
  }

  closeTemplateMenu() {
    const picker = this.field("kafkaTemplates");
    if (!picker) return;
    picker.open = false;
    this.updateTemplateMenuLayout();
  }

  updateActiveTemplate() {
    const search = this.field("kafkaTemplateSearch");
    const options = this.field("kafkaSavedList")?.querySelectorAll(".kafka-saved-option") || [];
    options.forEach((option, index) => {
      const active = index === this.activeTemplateIndex;
      option.dataset.active = String(active);
      if (active) {
        search.setAttribute("aria-activedescendant", option.id);
        option.scrollIntoView?.({ block: "nearest" });
      }
    });
    if (this.activeTemplateIndex < 0) search.removeAttribute("aria-activedescendant");
  }

  handleTemplateKeydown(event) {
    const picker = this.field("kafkaTemplates");
    if (event.key === "Escape") {
      if (picker.open) {
        event.preventDefault();
        this.closeTemplateMenu();
        this.field("kafkaTemplateToggle").focus();
      }
      return;
    }
    if (event.key === "Enter") {
      if (picker.open) {
        event.preventDefault();
        if (this.activeTemplateIndex >= 0) {
          this.field("kafkaSavedList").querySelectorAll('[data-action="load"]')[this.activeTemplateIndex]?.click();
        }
      }
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (!picker.open) this.openTemplateMenu();
    if (!this.visibleRequests.length) return;
    const direction = event.key === "ArrowDown" ? 1 : -1;
    this.activeTemplateIndex = this.activeTemplateIndex < 0 ?
      (direction > 0 ? 0 : this.visibleRequests.length - 1) :
      (this.activeTemplateIndex + direction + this.visibleRequests.length) % this.visibleRequests.length;
    this.updateActiveTemplate();
  }

  templateForFavorite() {
    const name = (this.selectedRequestName || this.field("kafkaTemplateSearch")?.value.trim() || "").toLowerCase();
    if (!name) return null;
    const topic = this.field("kafkaTopic")?.value.trim();
    return this.requests.find((request) => request.name.toLowerCase() === name && (!topic || request.topic === topic)) || null;
  }

  updateTemplateFavorite() {
    const button = this.field("kafkaTemplateFavorite");
    if (!button) return;
    const request = this.templateForFavorite();
    const favorite = Boolean(request?.favorite);
    button.disabled = !request;
    button.classList.toggle("is-favorite", favorite);
    button.setAttribute("aria-pressed", String(favorite));
    const label = !request ? "Favorite template" : favorite ? `Remove ${request.name} from favorites` : `Favorite ${request.name}`;
    button.setAttribute("aria-label", label);
    button.title = label;
  }

  toggleTemplateFavorite() {
    const request = this.templateForFavorite();
    if (!request) return;
    request.favorite = !request.favorite;
    try { localStorage.setItem(KAFKA_REQUESTS_KEY, JSON.stringify(this.requests)); } catch (_) {}
    this.renderRequests();
    this.showSuccess(request.favorite ? `Added “${request.name}” to favorites.` : `Removed “${request.name}” from favorites.`);
  }

  async loadTopics(force = false) {
    const config = this.config();
    if (!config.brokers) {
      this.topicError = "Enter bootstrap servers before browsing topics.";
      this.renderTopicOptions(this.topicPickerSource);
      return;
    }
    if (this.topicLoading && !force) return;
    if (this.topicsLoaded && this.topicBrokerKey === config.brokers && !force) return;
    const requestId = ++this.topicRequestId;
    this.topicLoading = true;
    this.topicError = "";
    this.renderTopicOptions(this.topicPickerSource);
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
        this.renderTopicOptions(this.topicPickerSource);
      }
    }
  }

  renderTopicOptions(source = "publish") {
    const ids = this.topicPickerIds(source);
    const list = this.field(ids.options);
    if (!list) return;
    const query = this.field(ids.input).value;
    const favorites = rankKafkaTopics(this.favoriteTopics, query);
    const allTopics = rankKafkaTopics(this.topics, query).filter((topic) => !this.favoriteTopics.includes(topic));
    this.visibleTopics = [...favorites, ...allTopics];
    this.activeTopicIndex = this.visibleTopics.length ? 0 : -1;
    list.replaceChildren();
    this.visibleTopics.forEach((topic, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.id = `${ids.input}Option${index}`;
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
    this.updateActiveTopic(source);
    const status = this.field(ids.status);
    status.textContent = this.topicLoading ? "Loading topics…" : this.topicError ||
      (this.visibleTopics.length ? `${this.visibleTopics.length} of ${this.topics.length} topics shown` :
        (this.topicsLoaded ? (this.topics.length ? "No matching topics. You can still enter a topic manually." :
          "No topics returned. Check broker access or enter a topic manually.") : "Browse topics from the broker."));
  }

  updateActiveTopic(source = "publish") {
    const ids = this.topicPickerIds(source);
    const input = this.field(ids.input);
    input.removeAttribute("aria-activedescendant");
    this.field(ids.options).querySelectorAll(".kafka-topic-option").forEach((option, index) => {
      const active = index === this.activeTopicIndex;
      option.dataset.active = String(active);
      option.setAttribute("aria-selected", String(active));
      if (active) {
        input.setAttribute("aria-activedescendant", option.id);
        option.scrollIntoView?.({ block: "nearest" });
      }
    });
  }

  handleTopicKeydown(event, source = "publish") {
    const ids = this.topicPickerIds(source);
    if (event.key === "Escape") { if (!this.field(ids.menu).hidden) { event.preventDefault(); this.closeTopicMenu(source); } return; }
    if (event.key === "Enter") {
      event.preventDefault();
      if (!this.field(ids.menu).hidden && this.activeTopicIndex >= 0) this.selectTopic(this.visibleTopics[this.activeTopicIndex], source);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (this.field(ids.menu).hidden) { this.openTopicMenu(source); return; }
    if (!this.visibleTopics.length) return;
    const direction = event.key === "ArrowDown" ? 1 : -1;
    this.activeTopicIndex = (this.activeTopicIndex + direction + this.visibleTopics.length) % this.visibleTopics.length;
    this.updateActiveTopic(source);
  }

  handleTopicClick(event, source = "publish") {
    const option = event.target.closest(".kafka-topic-option");
    if (!option) return;
    this.selectTopic(this.visibleTopics[Number(option.dataset.index)], source);
  }

  selectTopic(topic, source = "publish") {
    if (!topic) return;
    const ids = this.topicPickerIds(source);
    this.field(ids.input).value = topic;
    this.updateTopicFavorite(source);
    this.closeTopicMenu(source);
    if (source === "listen") {
      this.updateActionAvailability();
      return;
    }
    this.closeTemplateMenu();
    this.selectedRequestName = "";
    this.field("kafkaTemplateSearch").value = "";
    this.renderRequests();
  }

  message(id, text, error = false) {
    const node = this.field(id);
    if (node) { node.textContent = text; node.dataset.state = error ? "error" : "ok"; }
  }

  async testConnection() {
    if (!this.config().brokers) {
      this.field("kafkaBrokers").focus();
      return;
    }
    this.saveConnection();
    const button = this.field("kafkaTest");
    this.testingConnection = true;
    button.disabled = true;
    this.setConnectionState("checking");
    try {
      const result = await this.service.test(this.config());
      this.setConnectionState("connected", `Test passed · ${this.config().brokers}`);
      this.field("kafkaConnectionStatus").title = String(result || "Connected to Kafka");
      this.setConnectionSettingsOpen(false);
    } catch (error) {
      this.setConnectionState("error", String(error));
    } finally {
      this.testingConnection = false;
      this.updateActionAvailability();
    }
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
        (!this.config().brokers ? "Set up a broker to publish." : ""));
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
      const count = result.delivered.length;
      if (count) UsageTracker.trackToolUse("kafka", "publish", { message_count: count });
      if (!this.container) return;
      const status = result.failedAt == null ? `${count} ${count === 1 ? "message" : "messages"} delivered.` :
        `${count} delivered; stopped at message ${result.failedAt + 1}: ${result.error || "delivery failed"}`;
      this.message("kafkaPublishStatus", status, result.failedAt != null);
      for (const delivery of result.delivered) {
        const row = document.createElement("p");
        row.textContent = `#${delivery.index + 1} · partition ${delivery.partition} · offset ${delivery.offset}`;
        this.field("kafkaDeliveries").append(row);
      }
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
    this.selectedRequestName = name;
    this.field("kafkaTemplateSearch").value = name;
    this.renderRequests();
    this.setTemplateSaveOpen(false);
    this.openTemplateMenu();
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
    summary.textContent = parts.join(" · ");
  }

  renderRequests() {
    const root = this.field("kafkaSavedList");
    if (!root) return;
    root.replaceChildren();
    const topic = this.field("kafkaTopic")?.value.trim();
    const topicRequests = topic ? this.requests.filter((request) => request.topic === topic) : this.requests;
    const typedQuery = this.field("kafkaTemplateSearch")?.value.trim().toLowerCase() || "";
    const query = this.selectedRequestName && typedQuery === this.selectedRequestName.toLowerCase() ? "" : typedQuery;
    const requests = query ? topicRequests.filter((request) => request.name.toLowerCase().includes(query)) : topicRequests;
    const count = this.field("kafkaTemplateCount");
    if (count) count.textContent = topicRequests.length ? `${topicRequests.length} ${topicRequests.length === 1 ? "template" : "templates"}` : "";
    const status = this.field("kafkaTemplateStatus");
    this.visibleRequests = [...requests].sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)));
    this.activeTemplateIndex = -1;
    this.field("kafkaTemplateSearch")?.removeAttribute("aria-activedescendant");
    if (!requests.length) {
      if (status) status.textContent = query ? `No templates match “${query}”.` : topic ? "No templates for this topic yet." : "Save a template to reuse it here.";
      this.updateTemplateFavorite();
      return;
    }
    if (status) status.textContent = "";
    this.visibleRequests.forEach((request, position) => {
      const row = document.createElement("div"); row.className = "kafka-saved-row";
      const index = this.requests.indexOf(request);
      const load = document.createElement("button"); load.type = "button"; load.className = "kafka-saved-option"; load.dataset.action = "load"; load.dataset.index = index;
      load.id = `kafkaSavedOption${position}`;
      load.setAttribute("role", "option");
      load.setAttribute("aria-selected", String(request.name === this.selectedRequestName));
      const name = document.createElement("strong"); name.textContent = request.name;
      const topicLabel = document.createElement("small"); topicLabel.textContent = request.topic;
      load.append(name, topicLabel);
      const favorite = document.createElement("button"); favorite.type = "button"; favorite.className = "kafka-icon-button kafka-template-favorite"; favorite.dataset.action = "favorite"; favorite.dataset.index = index;
      favorite.setAttribute("aria-pressed", String(Boolean(request.favorite)));
      favorite.setAttribute("aria-label", request.favorite ? `Remove ${request.name} from favorites` : `Favorite ${request.name}`);
      favorite.title = favorite.getAttribute("aria-label");
      favorite.innerHTML = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z\" /></svg>";
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "btn btn-ghost btn-sm"; remove.textContent = "Remove"; remove.dataset.action = "delete"; remove.dataset.index = index;
      remove.setAttribute("aria-label", `Remove ${request.name}`);
      row.append(load, favorite, remove); root.append(row);
    });
    this.updateTemplateFavorite();
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
      if (this.selectedRequestName === request.name) {
        this.selectedRequestName = "";
        this.field("kafkaTemplateSearch").value = "";
      }
      this.renderRequests(); this.message("kafkaPublishStatus", `Deleted “${request.name}”.`); return;
    }
    this.field("kafkaRequestName").value = request.name;
    this.field("kafkaTopic").value = request.topic;
    this.closeTopicMenu();
    this.closeTemplateMenu();
    this.selectedRequestName = request.name;
    this.field("kafkaTemplateSearch").value = request.name;
    this.updateTopicFavorite();
    this.renderRequests();
    this.field("kafkaKey").value = request.key || "";
    this.setJsonValue("Headers", request.headers || "{}");
    this.setJsonValue("Value", request.value);
    this.field("kafkaBulk").checked = Boolean(request.bulk);
    this.field("kafkaPublishOptions").open = Boolean(request.key || (request.headers && request.headers.trim() !== "{}"));
    this.updateCount(); this.message("kafkaPublishStatus", `Loaded “${request.name}”. Review it before publishing.`);
    if (this.jsonEditors.Value) this.jsonEditors.Value.focus();
    else this.field("kafkaValue").focus();
  }

  async startListening() {
    if (this.listening) return;
    this.setFlow("listen");
    this.setListenMode("live");
    this.stopRequested = false;
    const topic = this.field("kafkaListenTopic").value.trim();
    if (!this.config().brokers) {
      this.message("kafkaListenStatus", "Enter bootstrap servers before listening.", true);
      return;
    }
    if (!topic) {
      this.message("kafkaListenStatus", "Enter a topic to listen on.", true);
      this.field("kafkaListenTopic").focus();
      return;
    }
    this.saveConnection();
    const config = this.config();
    const fromBeginning = false;
    this.setListeningButton("Connecting…", true);
    this.message("kafkaListenStatus", "Connecting…");
    try {
      this.unlisten = [
        await this.service.on("kafka-message", (event) => this.showMessage(event.payload)),
        await this.service.on("kafka-listener-error", (event) => { this.stopListening().finally(() => this.message("kafkaListenStatus", String(event.payload), true)); }),
      ];
      if (this.stopRequested || !this.container) {
        this.unlisten.forEach((unlisten) => unlisten()); this.unlisten = [];
        if (this.container) {
          this.setListeningButton();
          this.updateActionAvailability();
        }
        return;
      }
      try {
        await this.service.start(config, topic, fromBeginning);
      } catch (error) {
        if (!String(error).includes("Listener already running.")) throw error;
        this.message("kafkaListenStatus", "Restarting the previous listener…");
        await this.service.stop();
        if (this.stopRequested || !this.container) {
          if (this.container) {
            this.setListeningButton();
            this.updateActionAvailability();
          }
          return;
        }
        await this.service.start(config, topic, fromBeginning);
      }
      if (this.stopRequested || !this.container) {
        await this.service.stop();
        this.unlisten.forEach((unlisten) => unlisten()); this.unlisten = [];
        if (this.container) {
          this.setListeningButton();
          this.updateActionAvailability();
        }
        return;
      }
      this.listening = true;
      this.setListeningButton("Stop listening", false, true);
      this.message("kafkaListenStatus", "");
    } catch (error) {
      this.unlisten.forEach((unlisten) => unlisten()); this.unlisten = [];
      this.setListeningButton();
      if (this.container) this.updateActionAvailability();
      this.message("kafkaListenStatus", String(error), true);
    }
  }

  async searchHistory() {
    this.setFlow("listen");
    this.setListenMode("history");
    const topic = this.field("kafkaListenTopic").value.trim();
    const query = this.field("kafkaHistoryQuery").value.trim();
    const sinceMs = new Date(this.field("kafkaHistorySince").value).getTime();
    if (!this.config().brokers || !topic) { this.message("kafkaHistoryStatus", "Enter bootstrap servers and a topic to search.", true); return; }
    if (query.length < 3 || !Number.isFinite(sinceMs) || sinceMs > Date.now()) {
      this.message("kafkaHistoryStatus", "Enter at least 3 characters and choose a start time in the past.", true); return;
    }
    const requestId = ++this.historyRequestId;
    const button = this.field("kafkaHistorySearch");
    this.searchingHistory = true;
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
      this.searchingHistory = false;
      if (this.container) this.updateActionAvailability();
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
      this.closeTemplateMenu();
      this.selectedRequestName = "";
      this.field("kafkaTemplateSearch").value = "";
      this.updateTopicFavorite();
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
      if (this.container) this.updateActionAvailability();
      return;
    }
    this.listening = false;
    this.unlisten.forEach((unlisten) => unlisten()); this.unlisten = [];
    this.setListeningButton("Stopping…", true);
    try { await this.service.stop(); }
    catch (error) { this.message("kafkaListenStatus", String(error), true); }
    this.setListeningButton();
    if (this.container) this.updateActionAvailability();
    this.message("kafkaListenStatus", "");
  }
}
