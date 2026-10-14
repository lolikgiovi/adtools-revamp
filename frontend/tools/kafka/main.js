import { BaseTool } from "../../core/BaseTool.js";
import { UsageTracker } from "../../core/UsageTracker.js";
import { getIconSvg } from "./icon.js";
import {
  KafkaService,
  KAFKA_REQUESTS_KEY,
  KAFKA_TABS_KEY,
  KAFKA_TOPIC_FAVORITES_KEY,
  parseMessages,
  rankKafkaTopics,
  readKafkaActiveBrokerId,
  readKafkaBrokerProfiles,
  readKafkaConfig,
  readKafkaRequests,
  readKafkaTopicFavorites,
  receivedMessageToDraft,
  saveKafkaActiveBroker,
} from "./service.js";
import { KafkaTemplate } from "./template.js";
import { configureMonacoWorkers } from "../../core/MonacoWorkers.js";
import "./styles.css";

const HISTORY_RANGE_HOURS = new Set([1, 24, 72, 168, 336, 720, 1440]);
const MAX_KAFKA_TABS = 15;
const DEFAULT_KAFKA_VALUE = '{\n  "example": "value"\n}';

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
    this.headersMode = "json";
    this.headerRows = [];
    this.receivedMessages = new WeakMap();
    this.historyRequestId = 0;
    this.favoriteTopics = [];
    this.visibleRequests = [];
    this.activeTemplateIndex = -1;
    this.selectedRequestName = "";
    this.tabs = [];
    this.activeTabId = null;
    this.tabTitleTopicSource = "publish";
    this._restoringTab = false;
    this._tabSaveTimer = null;
    this._tabStorageErrorShown = false;
    this._tabOperation = false;
    this._tabContextMenu = null;
    this._tabContextTrigger = null;
    this._handleTabContextDismiss = null;
    this._handleTabContextKeydown = null;
    this._closedTabs = null;
    this._tabUndoTimer = null;
    this._resizerCleanup = null;
    this.brokerProfiles = [];
  }

  getIconSvg() { return getIconSvg(); }
  render() { return KafkaTemplate; }

  onMount() {
    this.headersMode = "json";
    this.headerRows = [];
    this.headerDisconnectHandler = () => { void this.stopListening(); };
    globalThis.addEventListener("adtools:kafka-disconnected", this.headerDisconnectHandler);
    this.brokerProfiles = readKafkaBrokerProfiles();
    this.renderBrokerOptions(readKafkaActiveBrokerId());
    const config = readKafkaConfig();
    this.requests = readKafkaRequests();
    this.favoriteTopics = readKafkaTopicFavorites();
    this.restoreTabSession();
    this.renderRequests();
    this.brokerProfilesChangedHandler = () => this.refreshBrokerProfiles();
    globalThis.addEventListener("adtools:kafka-brokers-changed", this.brokerProfilesChangedHandler);
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
    this.field("kafkaBrokerSelect").addEventListener("change", () => this.changeBroker());
    this.field("kafkaSetupBrokers").addEventListener("click", () => this.openBrokerSettings());
    this.bindTopicPicker("publish");
    this.bindTopicPicker("listen");
    this.outsideTopicClick = (event) => {
      if (!this.field("kafkaTopicMenu")?.hidden && !this.field("kafkaTopicPicker")?.contains(event.target)) this.closeTopicMenu();
      if (!this.field("kafkaListenTopicMenu")?.hidden && !this.field("kafkaListenTopicPicker")?.contains(event.target)) {
        this.closeTopicMenu("listen");
      }
      if (this.field("kafkaTemplates")?.open && !this.field("kafkaTemplatePicker")?.contains(event.target)) this.closeTemplateMenu();
    };
    document.addEventListener("click", this.outsideTopicClick);
    this.field("kafkaTabList").addEventListener("click", (event) => this.handleTabListClick(event));
    this.field("kafkaTabList").addEventListener("dblclick", (event) => this.handleTabListDoubleClick(event));
    this.field("kafkaTabList").addEventListener("contextmenu", (event) => this.handleTabListContextMenu(event));
    this.field("kafkaTabList").addEventListener("keydown", (event) => this.handleTabListKeydown(event));
    this.field("kafkaAddTab").addEventListener("click", () => this.createNewTab());
    this.field("kafkaUndoCloseTab").addEventListener("click", () => this.undoCloseTabs());
    this.field("kafkaTemplatePicker").addEventListener("focusout", (event) => {
      if (!this.field("kafkaTemplatePicker").contains(event.relatedTarget)) this.closeTemplateMenu();
    });
    this.field("kafkaTemplateSearch").addEventListener("focus", () => this.openTemplateMenu());
    this.field("kafkaTemplateSearch").addEventListener("pointerdown", () => this.field("kafkaTemplatePicker").classList.add("is-pointer-focused"));
    this.field("kafkaTemplateSearch").addEventListener("click", () => this.field("kafkaTemplatePicker").classList.add("is-pointer-focused"));
    this.field("kafkaTemplateSearch").addEventListener("blur", () => this.field("kafkaTemplatePicker").classList.remove("is-pointer-focused"));
    this.field("kafkaTemplateFavorite").addEventListener("click", () => this.toggleTemplateFavorite());
    this.headersEscapeHandler = (event) => {
      if (event.key === "Escape" && !this.field("kafkaTemplateSave")?.hidden) {
        event.preventDefault();
        this.setTemplateSaveOpen(false, true);
      } else if (event.key === "Escape" && this.field("kafkaTemplates")?.open) {
        event.preventDefault();
        this.closeTemplateMenu();
        this.field("kafkaTemplateToggle").focus();
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
    for (const id of [
      "kafkaTopic",
      "kafkaListenTopic",
      "kafkaTemplateSearch",
      "kafkaRequestName",
      "kafkaKey",
      "kafkaValue",
      "kafkaHeaders",
      "kafkaHeaderRows",
      "kafkaHistoryQuery",
    ]) {
      this.field(id).addEventListener("input", () => {
        if (id === "kafkaTopic") this.tabTitleTopicSource = "publish";
        if (id === "kafkaListenTopic") this.tabTitleTopicSource = "listen";
        this.scheduleTabSave();
      });
    }
    this.field("kafkaHistoryRange").addEventListener("change", () => this.scheduleTabSave());
    this.field("kafkaPublishOptions").addEventListener("toggle", () => this.scheduleTabSave());
    this.field("kafkaKey").addEventListener("input", () => this.updateCount());
    this.field("kafkaValue").addEventListener("input", () => this.updateCount());
    this.field("kafkaHeaders").addEventListener("input", () => this.updateCount());
    this.field("kafkaHeadersJsonMode").addEventListener("click", () => this.setHeadersMode("json"));
    this.field("kafkaHeadersKeyValueMode").addEventListener("click", () => this.setHeadersMode("key-value"));
    this.field("kafkaHeaderRows").addEventListener("input", (event) => this.handleHeaderRowsInput(event));
    this.field("kafkaHeaderRows").addEventListener("click", (event) => this.handleHeaderRowsClick(event));
    this.field("kafkaAddHeader").addEventListener("click", () => this.addHeaderRow());
    this.field("kafkaFormatHeaders").addEventListener("click", () => this.formatJson("Headers"));
    this.field("kafkaGenerateTraceId").addEventListener("click", () => this.generateTraceId());
    this.field("kafkaFormatValue").addEventListener("click", () => this.formatJson("Value"));
    this.field("kafkaGenerateUuid").addEventListener("click", () => this.generateUuid());
    this.field("kafkaListen").addEventListener("click", () => this.toggleListening());
    this.field("kafkaMessages").addEventListener("click", (event) => this.handleReceivedClick(event));
    this.field("kafkaHistoryResults").addEventListener("click", (event) => this.handleReceivedClick(event));
    this.field("kafkaHistoryForm").addEventListener("submit", (event) => { event.preventDefault(); this.searchHistory(); });
    this.applyTabDraft(this.getActiveTab());
    this.renderTabs();
    this.updateTopicFavorite();
    this.updateTopicFavorite("listen");
    this.updateActionAvailability();
    this.initializeResizer();
    this.updateCount();
    this.flushTabSave();
    this.tabPageHideHandler = () => this.flushTabSave();
    globalThis.addEventListener("pagehide", this.tabPageHideHandler);
    if (import.meta.env.MODE !== "test") this.initializeJsonEditors();
  }

  restoreTabSession() {
    let session = null;
    try {
      session = JSON.parse(localStorage.getItem(KAFKA_TABS_KEY) || "null");
    } catch (_) {}

    const seenIds = new Set();
    const savedTabs = Array.isArray(session?.tabs)
      ? session.tabs.map((tab) => this.normalizeTabDraft(tab)).filter((tab) => {
        if (!tab || seenIds.has(tab.id)) return false;
        seenIds.add(tab.id);
        return true;
      }).slice(0, MAX_KAFKA_TABS)
      : [];
    this.tabs = savedTabs.length ? savedTabs : [this.createTabDraft()];
    this.activeTabId = this.tabs.some((tab) => tab.id === session?.activeTabId)
      ? session.activeTabId
      : this.tabs[0].id;
  }

  normalizeTabDraft(tab) {
    if (!tab || typeof tab !== "object") return null;
    const text = (value, fallback = "") => typeof value === "string" ? value : fallback;
    const id = text(tab.id);
    if (!/^[\w-]+$/.test(id)) return null;
    const range = Number(tab.historyRange);
    return {
      id,
      title: text(tab.title),
      brokers: text(tab.brokers),
      brokerId: text(tab.brokerId),
      flow: tab.flow === "listen" ? "listen" : "publish",
      listenMode: tab.listenMode === "live" ? "live" : "history",
      publishTopic: text(tab.publishTopic),
      listenTopic: text(tab.listenTopic),
      titleTopicSource: tab.titleTopicSource === "listen" ? "listen" : "publish",
      selectedRequestName: text(tab.selectedRequestName),
      templateSearch: text(tab.templateSearch),
      requestName: text(tab.requestName),
      key: text(tab.key),
      headers: text(tab.headers, "{}"),
      value: text(tab.value, DEFAULT_KAFKA_VALUE),
      headersMode: tab.headersMode === "key-value" ? "key-value" : "json",
      headerRows: Array.isArray(tab.headerRows)
        ? tab.headerRows.filter((row) => row && typeof row === "object").map((row) => ({
          key: text(row.key),
          value: text(row.value),
        }))
        : [],
      publishOptionsOpen: Boolean(tab.publishOptionsOpen),
      templateSaveOpen: Boolean(tab.templateSaveOpen),
      historyQuery: text(tab.historyQuery),
      historyRange: HISTORY_RANGE_HOURS.has(range) ? String(range) : "24",
      createdAt: text(tab.createdAt, new Date().toISOString()),
      updatedAt: text(tab.updatedAt, new Date().toISOString()),
    };
  }

  createTabDraft(overrides = {}) {
    const now = new Date().toISOString();
    const tab = {
      id: "",
      title: "",
      brokers: this.config().brokers,
      brokerId: this.field("kafkaBrokerSelect")?.value || readKafkaActiveBrokerId(),
      flow: "publish",
      listenMode: "history",
      publishTopic: "",
      listenTopic: "",
      titleTopicSource: "publish",
      selectedRequestName: "",
      templateSearch: "",
      requestName: "",
      key: "",
      headers: "{}",
      value: DEFAULT_KAFKA_VALUE,
      headersMode: "json",
      headerRows: [],
      publishOptionsOpen: false,
      templateSaveOpen: false,
      historyQuery: "",
      historyRange: "24",
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
    tab.id = overrides.id || globalThis.crypto?.randomUUID?.() || `kafka-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    tab.title = typeof overrides.title === "string" ? overrides.title : "";
    tab.headerRows = Array.isArray(overrides.headerRows)
      ? overrides.headerRows.map((row) => ({ key: String(row.key || ""), value: String(row.value || "") }))
      : [];
    return tab;
  }

  getActiveTab() {
    return this.tabs.find((tab) => tab.id === this.activeTabId) || this.tabs[0] || null;
  }

  getTabTitle(tab) {
    const customTitle = tab?.title?.trim();
    if (customTitle) return customTitle;
    const templateName = tab?.selectedRequestName?.trim();
    const primaryTopic = tab?.titleTopicSource === "listen" ? tab.listenTopic : tab.publishTopic;
    const topic = (primaryTopic || tab?.publishTopic || tab?.listenTopic || "").trim();
    return (tab?.titleTopicSource !== "listen" && templateName) || topic || templateName || "Untitled";
  }

  captureCurrentTabDraft() {
    const active = this.getActiveTab();
    if (!active || !this.container) return active;
    return {
      ...active,
      updatedAt: new Date().toISOString(),
      brokers: this.config().brokers,
      brokerId: this.field("kafkaBrokerSelect").value,
      flow: this.field("kafkaListenFlow").getAttribute("aria-pressed") === "true" ? "listen" : "publish",
      listenMode: this.field("kafkaLiveMode").getAttribute("aria-selected") === "true" ? "live" : "history",
      publishTopic: this.field("kafkaTopic").value,
      listenTopic: this.field("kafkaListenTopic").value,
      titleTopicSource: this.tabTitleTopicSource,
      selectedRequestName: this.selectedRequestName,
      templateSearch: this.field("kafkaTemplateSearch").value,
      requestName: this.field("kafkaRequestName").value,
      key: this.field("kafkaKey").value,
      headers: this.field("kafkaHeaders").value,
      value: this.field("kafkaValue").value,
      headersMode: this.headersMode,
      headerRows: this.headerRows.map((row) => ({ key: row.key, value: row.value })),
      publishOptionsOpen: this.field("kafkaPublishOptions").open,
      templateSaveOpen: !this.field("kafkaTemplateSave").hidden,
      historyQuery: this.field("kafkaHistoryQuery").value,
      historyRange: this.field("kafkaHistoryRange").value,
    };
  }

  applyTabDraft(tab) {
    if (!tab || !this.container) return;
    this._restoringTab = true;
    try {
      const previousBrokers = this.config().brokers;
      const profile = this.brokerProfiles.find((item) => item.id === tab.brokerId)
        || this.brokerProfiles.find((item) => item.brokers === tab.brokers)
        || (!tab.brokers ? this.brokerProfiles.find((item) => item.id === readKafkaActiveBrokerId()) : null);
      this.field("kafkaBrokerSelect").value = profile?.id || "";
      tab.brokerId = profile?.id || "";
      tab.brokers = profile?.brokers || "";
      this.saveConnection();
      if (previousBrokers !== this.config().brokers) this.invalidateTopics();
      this.setConnectionState(this.config().brokers ? "ready" : "empty");
      this.field("kafkaTopic").value = tab.publishTopic;
      this.field("kafkaListenTopic").value = tab.listenTopic;
      this.field("kafkaTemplateSearch").value = tab.templateSearch;
      this.field("kafkaRequestName").value = tab.requestName;
      this.field("kafkaKey").value = tab.key;
      this.field("kafkaHistoryQuery").value = tab.historyQuery;
      this.field("kafkaHistoryRange").value = tab.historyRange;
      this.selectedRequestName = tab.selectedRequestName;
      this.tabTitleTopicSource = tab.titleTopicSource;

      this.headersMode = "json";
      this.applyHeadersMode("json");
      this.setJsonValue("Headers", tab.headers);
      this.setJsonValue("Value", tab.value);
      this.headersMode = tab.headersMode;
      this.headerRows = tab.headerRows.map((row) => ({ key: row.key, value: row.value }));
      if (tab.headersMode === "key-value" && !this.headerRows.length) {
        const parsed = this.parseHeadersValue(tab.headers);
        if (parsed.valid) this.headerRows = Object.entries(parsed.headers).map(([key, value]) => ({ key, value }));
      }
      this.renderHeaderRows();
      this.applyHeadersMode(this.headersMode);

      this.field("kafkaPublishOptions").open = tab.publishOptionsOpen;
      this.field("kafkaTemplateSave").hidden = !tab.templateSaveOpen;
      this.field("kafkaTemplateSaveToggle").setAttribute("aria-expanded", String(tab.templateSaveOpen));
      this.setFlow(tab.flow);
      this.setListenMode(tab.listenMode);
      this.field("kafkaMessages").replaceChildren();
      this.field("kafkaMessages").append(Object.assign(document.createElement("p"), {
        className: "kafka-empty",
        textContent: this.config().brokers ? "Choose a topic and start listening." : "Set up a broker, then enter a topic to listen.",
      }));
      this.field("kafkaHistoryResults").replaceChildren();
      this.message("kafkaPublishStatus", "");
      this.message("kafkaListenStatus", "");
      this.message("kafkaHistoryStatus", "");
      this.renderRequests();
      this.updateTopicFavorite();
      this.updateTopicFavorite("listen");
      this.updateCount();
      this.updateActionAvailability();
      this.setListeningButton();
    } finally {
      this._restoringTab = false;
    }
  }

  renderTabs() {
    const root = this.field("kafkaTabList");
    if (!root) return;
    root.replaceChildren();
    this.tabs.forEach((tab) => {
      const item = document.createElement("div");
      const active = tab.id === this.activeTabId;
      item.className = `kafka-tab${active ? " active" : ""}`;
      item.dataset.tabId = tab.id;

      const label = document.createElement("button");
      label.type = "button";
      label.id = `kafka-tab-${tab.id}`;
      label.className = "kafka-tab-label";
      label.dataset.tabId = tab.id;
      label.setAttribute("role", "tab");
      label.setAttribute("aria-selected", String(active));
      label.setAttribute("aria-controls", "kafkaWorkspace");
      label.tabIndex = active ? 0 : -1;
      label.textContent = this.getTabTitle(tab);
      label.title = `${this.getTabTitle(tab)} · Double-click to rename`;

      const close = document.createElement("button");
      close.type = "button";
      close.className = "kafka-tab-close";
      close.dataset.closeTabId = tab.id;
      close.title = `Close ${this.getTabTitle(tab)}`;
      close.disabled = this.tabs.length <= 1;
      close.setAttribute("aria-label", `Close ${this.getTabTitle(tab)}`);
      close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>';

      item.append(label, close);
      root.append(item);
    });
    const add = this.field("kafkaAddTab");
    if (add) {
      add.disabled = this.tabs.length >= MAX_KAFKA_TABS;
      add.title = add.disabled ? `Maximum ${MAX_KAFKA_TABS} tabs` : "New tab";
    }
    this.field("kafkaWorkspace")?.setAttribute("aria-labelledby", `kafka-tab-${this.activeTabId}`);
    this.scrollActiveTabIntoView();
  }

  scrollActiveTabIntoView() {
    const root = this.field("kafkaTabList");
    const active = Array.from(root?.children || []).find((tab) => tab.dataset.tabId === this.activeTabId);
    active?.scrollIntoView?.({ behavior: "auto", block: "nearest", inline: "nearest" });
  }

  focusTabLabel(tabId) {
    Array.from(this.field("kafkaTabList")?.querySelectorAll(".kafka-tab-label") || [])
      .find((label) => label.dataset.tabId === tabId)?.focus();
  }

  updateActiveTabTitle() {
    const active = this.getActiveTab();
    if (!active) return;
    const title = this.getTabTitle(this.captureCurrentTabDraft());
    const label = Array.from(this.field("kafkaTabList")?.querySelectorAll(".kafka-tab-label") || [])
      .find((button) => button.dataset.tabId === active.id);
    if (label) {
      label.textContent = title;
      label.title = `${title} · Double-click to rename`;
      const close = label.parentElement?.querySelector(".kafka-tab-close");
      close?.setAttribute("title", `Close ${title}`);
      close?.setAttribute("aria-label", `Close ${title}`);
    }
  }

  scheduleTabSave() {
    if (this._restoringTab || !this.getActiveTab() || !this.container) return;
    this.updateActiveTabTitle();
    clearTimeout(this._tabSaveTimer);
    this._tabSaveTimer = setTimeout(() => this.flushTabSave(), 180);
  }

  flushTabSave() {
    clearTimeout(this._tabSaveTimer);
    this._tabSaveTimer = null;
    if (!this.getActiveTab()) return false;
    const active = this.captureCurrentTabDraft();
    if (active) {
      const index = this.tabs.findIndex((tab) => tab.id === active.id);
      if (index !== -1) this.tabs[index] = active;
    }
    try {
      localStorage.setItem(KAFKA_TABS_KEY, JSON.stringify({
        version: 1,
        tabs: this.tabs,
        activeTabId: this.activeTabId,
      }));
      this._tabStorageErrorShown = false;
      return true;
    } catch (_) {
      if (!this._tabStorageErrorShown) {
        this._tabStorageErrorShown = true;
        this.eventBus?.emit("notification:error", {
          message: "Kafka tabs could not be saved. Check the available browser storage.",
        });
      }
      return false;
    }
  }

  handleTabListClick(event) {
    const close = event.target.closest("[data-close-tab-id]");
    if (close) {
      this.closeTab(close.dataset.closeTabId);
      return;
    }
    const label = event.target.closest("[role='tab'][data-tab-id]");
    if (label) this.switchTab(label.dataset.tabId, true);
  }

  handleTabListDoubleClick(event) {
    const label = event.target.closest(".kafka-tab-label");
    if (label) this.renameTab(label.dataset.tabId);
  }

  handleTabListContextMenu(event) {
    const tab = event.target.closest(".kafka-tab");
    if (!tab) return;
    event.preventDefault();
    event.stopPropagation();
    this.openTabContextMenu(event, tab.dataset.tabId, tab.querySelector(".kafka-tab-label"));
  }

  handleTabListKeydown(event) {
    const tab = event.target.closest(".kafka-tab");
    if (!tab) return;
    if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
      event.preventDefault();
      const rect = tab.getBoundingClientRect();
      this.openTabContextMenu(event, tab.dataset.tabId, tab.querySelector(".kafka-tab-label"), rect.left, rect.bottom + 4);
      return;
    }
    const index = this.tabs.findIndex((item) => item.id === tab.dataset.tabId);
    if (index < 0) return;
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % this.tabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + this.tabs.length) % this.tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = this.tabs.length - 1;
    else return;
    event.preventDefault();
    this.switchTab(this.tabs[nextIndex].id, true);
  }

  openTabContextMenu(event, tabId, trigger = null, x = event.clientX, y = event.clientY) {
    const tabIndex = this.tabs.findIndex((tab) => tab.id === tabId);
    if (tabIndex < 0 || this._tabOperation) return;
    this.closeTabContextMenu();

    const menu = document.createElement("div");
    menu.className = "kafka-tab-context-menu app-popover-surface";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", `Options for ${this.getTabTitle(this.tabs[tabIndex])}`);
    const hasOtherTabs = this.tabs.length > 1;
    const actions = [
      { label: "Rename", run: () => this.renameTab(tabId) },
      { label: "Duplicate", run: () => this.duplicateTab(tabId), disabled: this.tabs.length >= MAX_KAFKA_TABS },
      { separator: true },
      { label: "Close", run: () => this.closeTab(tabId), disabled: !hasOtherTabs },
      { label: "Close Other Tabs", run: () => this.closeOtherTabs(tabId), disabled: !hasOtherTabs },
      { label: "Close Tabs to the Left", run: () => this.closeTabsToLeft(tabId), disabled: tabIndex === 0 },
      { label: "Close Tabs to the Right", run: () => this.closeTabsToRight(tabId), disabled: tabIndex === this.tabs.length - 1 },
      { label: "Close All Tabs", run: () => this.closeAllTabs() },
    ];
    actions.forEach((action) => {
      if (action.separator) {
        const separator = document.createElement("div");
        separator.className = "kafka-tab-context-menu-separator";
        separator.setAttribute("role", "separator");
        menu.appendChild(separator);
        return;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.textContent = action.label;
      button.disabled = Boolean(action.disabled);
      button.addEventListener("click", () => {
        this.closeTabContextMenu();
        void action.run();
      });
      menu.appendChild(button);
    });
    menu.addEventListener("keydown", (keydownEvent) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(keydownEvent.key)) return;
      const enabled = [...menu.querySelectorAll("button:not(:disabled)")];
      const current = enabled.indexOf(document.activeElement);
      const next = keydownEvent.key === "Home"
        ? 0
        : keydownEvent.key === "End"
          ? enabled.length - 1
          : (current + (keydownEvent.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length;
      keydownEvent.preventDefault();
      enabled[next]?.focus();
    });

    document.body.appendChild(menu);
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const margin = 8;
    const maxLeft = Math.max(margin, viewportWidth - menu.offsetWidth - margin);
    const maxTop = Math.max(margin, viewportHeight - menu.offsetHeight - margin);
    menu.style.left = `${Math.min(Math.max(x, margin), maxLeft)}px`;
    menu.style.top = `${Math.min(Math.max(y, margin), maxTop)}px`;
    this._tabContextMenu = menu;
    this._tabContextTrigger = trigger;
    this._handleTabContextDismiss = (dismissEvent) => {
      if (!menu.contains(dismissEvent.target)) this.closeTabContextMenu();
    };
    this._handleTabContextKeydown = (keydownEvent) => {
      if (keydownEvent.key === "Escape") {
        keydownEvent.preventDefault();
        this.closeTabContextMenu(true);
      }
    };
    document.addEventListener("pointerdown", this._handleTabContextDismiss);
    document.addEventListener("keydown", this._handleTabContextKeydown);
    menu.querySelector("button:not(:disabled)")?.focus();
  }

  closeTabContextMenu(restoreFocus = false) {
    const trigger = this._tabContextTrigger;
    this._tabContextMenu?.remove();
    this._tabContextMenu = null;
    this._tabContextTrigger = null;
    if (this._handleTabContextDismiss) {
      document.removeEventListener("pointerdown", this._handleTabContextDismiss);
      this._handleTabContextDismiss = null;
    }
    if (this._handleTabContextKeydown) {
      document.removeEventListener("keydown", this._handleTabContextKeydown);
      this._handleTabContextKeydown = null;
    }
    if (restoreFocus && trigger?.isConnected) trigger.focus();
  }

  renameTab(tabId) {
    if (this._tabOperation) return;
    const tab = this.tabs.find((item) => item.id === tabId);
    const tabElement = Array.from(this.field("kafkaTabList")?.children || [])
      .find((item) => item.dataset.tabId === tabId);
    const label = tabElement?.querySelector(".kafka-tab-label");
    if (!tab || !label) return;
    const currentTitle = this.getTabTitle(tab);
    const input = document.createElement("input");
    input.className = "kafka-tab-rename";
    input.value = currentTitle;
    input.setAttribute("aria-label", "Rename tab");
    label.replaceWith(input);
    let finished = false;
    const finish = (save) => {
      if (finished) return;
      finished = true;
      const nextTitle = input.value.trim().slice(0, 120);
      const previousTitle = tab.title;
      if (save && nextTitle && nextTitle !== currentTitle) tab.title = nextTitle;
      this.renderTabs();
      if (tab.title !== previousTitle && !this.flushTabSave()) {
        tab.title = previousTitle;
        this.renderTabs();
      }
      this.focusTabLabel(tabId);
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
    input.focus();
    input.select();
  }

  switchTab(tabId, focus = false) {
    if (!tabId || tabId === this.activeTabId || this._tabOperation || !this.tabs.some((tab) => tab.id === tabId)) return false;
    if (!this.flushTabSave()) return false;
    this.closeTabContextMenu();
    this._tabOperation = true;
    const previousTabId = this.activeTabId;
    try {
      void this.stopListening();
      this.activeTabId = tabId;
      this.applyTabDraft(this.getActiveTab());
      this.renderTabs();
      if (!this.flushTabSave()) {
        this.activeTabId = previousTabId;
        this.applyTabDraft(this.getActiveTab());
        this.renderTabs();
        return false;
      }
      if (focus) this.focusTabLabel(tabId);
      return true;
    } finally {
      this._tabOperation = false;
    }
  }

  createNewTab() {
    if (this.tabs.length >= MAX_KAFKA_TABS || this._tabOperation || !this.flushTabSave()) return null;
    this._tabOperation = true;
    const previousTabs = this.tabs;
    const previousTabId = this.activeTabId;
    const tab = this.createTabDraft();
    try {
      void this.stopListening();
      this.tabs = [...this.tabs, tab];
      this.activeTabId = tab.id;
      this.applyTabDraft(tab);
      this.renderTabs();
      if (!this.flushTabSave()) {
        this.tabs = previousTabs;
        this.activeTabId = previousTabId;
        this.applyTabDraft(this.getActiveTab());
        this.renderTabs();
        return null;
      }
      this.focusTabLabel(tab.id);
      return tab;
    } finally {
      this._tabOperation = false;
    }
  }

  cloneTabDraft(tab) {
    return { ...tab, headerRows: tab.headerRows.map((row) => ({ ...row })) };
  }

  duplicateTab(tabId) {
    if (this.tabs.length >= MAX_KAFKA_TABS || this._tabOperation || !this.flushTabSave()) return null;
    const sourceIndex = this.tabs.findIndex((tab) => tab.id === tabId);
    if (sourceIndex < 0) return null;
    const source = this.tabs[sourceIndex];
    const duplicate = this.createTabDraft({
      ...source,
      id: undefined,
      title: `${this.getTabTitle(source)} copy`,
      updatedAt: new Date().toISOString(),
    });
    const previousTabs = this.tabs;
    const previousTabId = this.activeTabId;
    this._tabOperation = true;
    try {
      if (source.id === this.activeTabId) void this.stopListening();
      this.tabs = [...this.tabs.slice(0, sourceIndex + 1), duplicate, ...this.tabs.slice(sourceIndex + 1)];
      this.activeTabId = duplicate.id;
      this.applyTabDraft(duplicate);
      this.renderTabs();
      if (!this.flushTabSave()) {
        this.tabs = previousTabs;
        this.activeTabId = previousTabId;
        this.applyTabDraft(this.getActiveTab());
        this.renderTabs();
        return null;
      }
      this.focusTabLabel(duplicate.id);
      return duplicate;
    } finally {
      this._tabOperation = false;
    }
  }

  closeTab(tabId) {
    const index = this.tabs.findIndex((tab) => tab.id === tabId);
    if (this.tabs.length <= 1 || index < 0) return false;
    const remaining = this.tabs.filter((tab) => tab.id !== tabId);
    const nextActiveId = tabId === this.activeTabId
      ? remaining[Math.min(index, remaining.length - 1)]?.id
      : this.activeTabId;
    return this.closeTabs([tabId], { nextActiveId });
  }

  closeOtherTabs(tabId) {
    if (this.tabs.length <= 1 || !this.tabs.some((tab) => tab.id === tabId)) return false;
    return this.closeTabs(this.tabs.filter((tab) => tab.id !== tabId).map((tab) => tab.id), { nextActiveId: tabId });
  }

  closeTabsToLeft(tabId) {
    const index = this.tabs.findIndex((tab) => tab.id === tabId);
    if (index <= 0) return false;
    return this.closeTabs(this.tabs.slice(0, index).map((tab) => tab.id), { nextActiveId: tabId });
  }

  closeTabsToRight(tabId) {
    const index = this.tabs.findIndex((tab) => tab.id === tabId);
    if (index < 0 || index >= this.tabs.length - 1) return false;
    return this.closeTabs(this.tabs.slice(index + 1).map((tab) => tab.id), { nextActiveId: tabId });
  }

  closeAllTabs() {
    if (!this.tabs.length) return false;
    return this.closeTabs(this.tabs.map((tab) => tab.id), { createReplacement: true });
  }

  closeTabs(tabIds, { nextActiveId = null, createReplacement = false } = {}) {
    if (this._tabOperation || !this.flushTabSave()) return false;
    const idsToClose = new Set((Array.isArray(tabIds) ? tabIds : [tabIds])
      .filter((id) => this.tabs.some((tab) => tab.id === id)));
    if (!idsToClose.size || (!createReplacement && idsToClose.size >= this.tabs.length)) return false;

    this.closeTabContextMenu();
    this._tabOperation = true;
    const previousTabs = this.tabs;
    const previousActiveId = this.activeTabId;
    const activeIndex = this.tabs.findIndex((tab) => tab.id === previousActiveId);
    try {
      const closed = this.tabs.flatMap((tab, index) => idsToClose.has(tab.id)
        ? [{ tab: this.cloneTabDraft(tab), index }]
        : []);
      const remaining = this.tabs.filter((tab) => !idsToClose.has(tab.id));
      const replacement = remaining.length ? null : this.createTabDraft();
      if (replacement) remaining.push(replacement);
      const requestedNext = remaining.find((tab) => tab.id === nextActiveId);
      const currentActive = remaining.find((tab) => tab.id === previousActiveId);
      const next = requestedNext || currentActive || remaining[Math.min(Math.max(activeIndex, 0), remaining.length - 1)];

      this.tabs = remaining;
      this.activeTabId = next.id;
      if (next.id !== previousActiveId) {
        void this.stopListening();
        this.applyTabDraft(next);
      }
      this.renderTabs();
      if (!this.flushTabSave()) {
        this.tabs = previousTabs;
        this.activeTabId = previousActiveId;
        this.applyTabDraft(this.getActiveTab());
        this.renderTabs();
        return false;
      }
      this._closedTabs = {
        closed,
        previousActiveId,
        replacementId: replacement?.id || null,
        replacementBaseline: replacement ? this.cloneTabDraft(replacement) : null,
      };
      this.showTabUndo(closed.length);
      this.focusTabLabel(next.id);
      return true;
    } finally {
      this._tabOperation = false;
    }
  }

  isEmptyReplacementTab(tab, baseline) {
    if (!tab || !baseline) return false;
    const ignoredFields = new Set(["id", "createdAt", "updatedAt"]);
    return Object.keys(baseline).every((key) => {
      if (ignoredFields.has(key)) return true;
      if (key === "headerRows") return JSON.stringify(tab.headerRows) === JSON.stringify(baseline.headerRows);
      return tab[key] === baseline[key];
    });
  }

  showTabUndo(count) {
    clearTimeout(this._tabUndoTimer);
    this.field("kafkaTabUndoMessage").textContent = `${count} tab${count === 1 ? "" : "s"} closed`;
    this.field("kafkaTabUndo").hidden = false;
    this._tabUndoTimer = setTimeout(() => {
      this._closedTabs = null;
      if (this.field("kafkaTabUndo")) this.field("kafkaTabUndo").hidden = true;
    }, 8000);
  }

  undoCloseTabs() {
    if (this._tabOperation || !this._closedTabs || !this.flushTabSave()) return false;
    const { closed, previousActiveId, replacementId, replacementBaseline } = this._closedTabs;
    const previousTabs = this.tabs;
    const currentActiveId = this.activeTabId;
    const replacement = this.tabs.find((tab) => tab.id === replacementId);
    const dropReplacement = replacement && this.isEmptyReplacementTab(replacement, replacementBaseline);
    const restored = this.tabs.filter((tab) => !dropReplacement || tab.id !== replacementId);
    closed.forEach(({ tab, index }) => restored.splice(Math.min(index, restored.length), 0, this.cloneTabDraft(tab)));
    if (restored.length > MAX_KAFKA_TABS) {
      this.eventBus?.emit("notification:error", { message: "Close a tab before restoring the previous tabs." });
      return false;
    }

    this._tabOperation = true;
    try {
      const nextActiveId = restored.some((tab) => tab.id === previousActiveId) ? previousActiveId : currentActiveId;
      this.tabs = restored;
      this.activeTabId = nextActiveId;
      if (nextActiveId !== currentActiveId) {
        void this.stopListening();
        this.applyTabDraft(this.getActiveTab());
      }
      this.renderTabs();
      if (!this.flushTabSave()) {
        this.tabs = previousTabs;
        this.activeTabId = currentActiveId;
        this.applyTabDraft(this.getActiveTab());
        this.renderTabs();
        return false;
      }
      this._closedTabs = null;
      clearTimeout(this._tabUndoTimer);
      this.field("kafkaTabUndo").hidden = true;
      this.focusTabLabel(nextActiveId);
      return true;
    } finally {
      this._tabOperation = false;
    }
  }

  onSoftDeactivate() {
    this.flushTabSave();
    this.closeTabContextMenu();
    this.historyRequestId++;
    this.closeTopicMenu();
    this.closeTopicMenu("listen");
    this.closeTemplateMenu();
    this.setTemplateSaveOpen(false);
    this.flushTabSave();
    this.stopListening();
  }
  onUnmount() {
    this.closeTabContextMenu();
    clearTimeout(this._tabUndoTimer);
    this._tabUndoTimer = null;
    this._closedTabs = null;
    this.flushTabSave();
    globalThis.removeEventListener("pagehide", this.tabPageHideHandler);
    globalThis.removeEventListener("adtools:kafka-disconnected", this.headerDisconnectHandler);
    globalThis.removeEventListener("adtools:kafka-brokers-changed", this.brokerProfilesChangedHandler);
    document.removeEventListener("click", this.outsideTopicClick);
    document.removeEventListener("keydown", this.headersEscapeHandler);
    this.topicRequestId++;
    this.historyRequestId++;
    this.closeTopicMenu();
    this.closeTopicMenu("listen");
    this.cleanupResizer();
    this.closeTemplateMenu();
    this.setTemplateSaveOpen(false);
    this.flushTabSave();
    Object.values(this.jsonEditors).forEach((editor) => editor.dispose());
    this.jsonEditors = {};
    this.stopListening();
  }
  field(id) { return this.container?.querySelector(`#${id}`); }
  config() {
    const profile = this.brokerProfiles.find((item) => item.id === this.field("kafkaBrokerSelect")?.value);
    return { brokers: profile?.brokers || "", securityProtocol: "PLAINTEXT" };
  }

  renderBrokerOptions(selectedId = this.field("kafkaBrokerSelect")?.value || "") {
    const select = this.field("kafkaBrokerSelect");
    if (!select) return;
    select.replaceChildren();
    for (const profile of this.brokerProfiles) {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.name;
      select.appendChild(option);
    }
    const selected = this.brokerProfiles.some((profile) => profile.id === selectedId) ? selectedId : this.brokerProfiles[0]?.id || "";
    select.value = selected;
  }

  refreshBrokerProfiles() {
    const previousConfig = this.config();
    const tab = this.getActiveTab();
    this.brokerProfiles = readKafkaBrokerProfiles();
    const matchingProfile = this.brokerProfiles.find((profile) => profile.id === tab?.brokerId)
      || this.brokerProfiles.find((profile) => profile.brokers === tab?.brokers)
      || this.brokerProfiles[0];
    this.renderBrokerOptions(matchingProfile?.id || "");
    if (tab) {
      tab.brokerId = this.field("kafkaBrokerSelect").value;
      tab.brokers = this.config().brokers;
    }
    if (previousConfig.brokers !== this.config().brokers) {
      void this.stopListening();
      this.invalidateTopics();
    }
    this.saveConnection();
    this.setConnectionState(this.config().brokers ? "ready" : "empty");
    this.updateActionAvailability();
    this.updateCount();
    this.scheduleTabSave();
  }

  changeBroker() {
    const selected = this.brokerProfiles.find((profile) => profile.id === this.field("kafkaBrokerSelect").value);
    if (!selected) return;
    const tab = this.getActiveTab();
    const previousBrokers = tab?.brokers || "";
    if (previousBrokers !== selected.brokers) {
      void this.stopListening();
      this.invalidateTopics();
    }
    if (tab) {
      tab.brokerId = selected.id;
      tab.brokers = selected.brokers;
    }
    this.saveConnection();
    this.setConnectionState("ready");
    this.updateCount();
    this.updateActionAvailability();
    this.scheduleTabSave();
  }

  openBrokerSettings() {
    try { localStorage.setItem("settings.focus", "kafka.brokers"); } catch (_) {}
    if (window.app?.router?.navigate) window.app.router.navigate("settings");
    else this.eventBus?.emit?.("route:change", { path: "settings" });
  }

  setConnectionState(state, text = "") {
    const section = this.field("kafkaConnection");
    const status = this.field("kafkaConnectionStatus");
    if (!section || !status) return;
    const profile = this.brokerProfiles.find((item) => item.id === this.field("kafkaBrokerSelect")?.value);
    const labels = {
      empty: "No broker saved yet.",
      ready: profile ? `Not tested · ${profile.name}` : "No broker saved yet.",
      checking: "Checking connection…",
      connected: profile ? `Test passed · ${profile.name}` : "Connection test passed",
      error: text || "Connection failed. Check the saved broker in Settings.",
    };
    section.dataset.state = state;
    status.textContent = text || labels[state] || labels.ready;
    status.dataset.state = state === "error" ? "error" : "ok";
    status.title = state === "connected" && text ? text : "";
  }
  updateActionAvailability() {
    const hasBrokers = Boolean(this.config().brokers);
    const hasTopic = Boolean(this.field("kafkaListenTopic")?.value.trim());
    const ready = hasBrokers && hasTopic;
    const testButton = this.field("kafkaTest");
    const brokerSelect = this.field("kafkaBrokerSelect");
    const setupButton = this.field("kafkaSetupBrokers");
    const listenButton = this.field("kafkaListen");
    const historyButton = this.field("kafkaHistorySearch");
    const emptyMessage = this.field("kafkaMessages")?.querySelector(".kafka-empty");

    if (brokerSelect) {
      const isEmpty = !this.brokerProfiles.length;
      brokerSelect.hidden = isEmpty;
      brokerSelect.closest(".ad-searchable-dropdown")?.toggleAttribute("hidden", isEmpty);
    }
    if (testButton) {
      testButton.hidden = !this.brokerProfiles.length;
      testButton.disabled = !hasBrokers || this.testingConnection;
    }
    if (setupButton) setupButton.hidden = this.brokerProfiles.length > 0;
    if (listenButton && !this.listening && !["Connecting…", "Stopping…"].includes(listenButton.textContent)) {
      listenButton.disabled = !ready;
    }
    if (historyButton) historyButton.disabled = !ready || this.searchingHistory;
    if (emptyMessage) {
      emptyMessage.textContent = !hasBrokers ? "Set up a broker, then enter a topic to listen." : "";
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
    this.scheduleTabSave();
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
    if (focus) (live ? liveButton : historyButton)?.focus();
    this.scheduleTabSave();
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

  setTemplateSaveOpen(open, returnFocus = false) {
    const panel = this.field("kafkaTemplateSave");
    const toggle = this.field("kafkaTemplateSaveToggle");
    if (!panel || !toggle) return;
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) this.field("kafkaRequestName")?.focus();
    else if (returnFocus) toggle.focus();
    this.scheduleTabSave();
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
          quickSuggestions: { other: true, comments: false, strings: true },
          suggestOnTriggerCharacters: true,
          wordBasedSuggestions: "off",
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
    const input = this.field(`kafka${name}`);
    input.value = value;
    if (name === "Headers" && this.headersMode === "key-value") {
      const parsed = this.parseHeadersValue(value);
      if (parsed.valid) {
        this.headerRows = Object.entries(parsed.headers).map(([key, text]) => ({ key, value: text }));
        this.renderHeaderRows();
      } else this.applyHeadersMode("json");
    }
    const editor = this.jsonEditors[name];
    if (editor && editor.getValue() !== value) editor.setValue(value);
    this.scheduleTabSave();
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

  parseHeadersValue(value) {
    let headers;
    try { headers = JSON.parse(value || "{}"); }
    catch (_) { return { valid: false, error: "Invalid JSON. Check the highlighted syntax." }; }
    if (!headers || Array.isArray(headers) || typeof headers !== "object" ||
      Object.entries(headers).some(([key, text]) => !key || typeof text !== "string")) {
      return { valid: false, error: "Headers need a JSON object with string values." };
    }
    return { valid: true, headers };
  }

  getHeaderRowsState() {
    const headers = Object.create(null);
    const names = new Set();
    for (const row of this.headerRows) {
      if (!row.key || names.has(row.key)) {
        return { valid: false, error: "Header names must be non-empty and unique." };
      }
      names.add(row.key);
      headers[row.key] = row.value;
    }
    return { valid: true, headers };
  }

  renderHeaderRows() {
    const root = this.field("kafkaHeaderRows");
    const empty = this.field("kafkaHeadersEmpty");
    if (!root || !empty) return;
    root.replaceChildren();
    empty.hidden = this.headerRows.length > 0;
    this.headerRows.forEach((header, index) => {
      const row = document.createElement("div");
      row.className = "kafka-header-row";

      const key = document.createElement("textarea");
      key.rows = 1;
      key.value = header.key;
      key.placeholder = "Header name";
      key.setAttribute("aria-label", `Header name ${index + 1}`);
      key.dataset.headerIndex = String(index);
      key.dataset.headerField = "key";

      const value = document.createElement("textarea");
      value.rows = 1;
      value.value = header.value;
      value.placeholder = "Value";
      value.setAttribute("aria-label", `Value for ${header.key || `header ${index + 1}`}`);
      value.dataset.headerIndex = String(index);
      value.dataset.headerField = "value";

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn btn-ghost btn-sm";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove ${header.key || `header ${index + 1}`}`);
      remove.dataset.removeHeader = String(index);

      row.append(key, value, remove);
      root.append(row);
    });
  }

  applyHeadersMode(mode) {
    const json = mode === "json";
    this.headersMode = json ? "json" : "key-value";
    this.field("kafkaHeadersJsonView").hidden = !json;
    this.field("kafkaHeadersKeyValueView").hidden = json;
    this.field("kafkaFormatHeaders").hidden = !json;
    const jsonButton = this.field("kafkaHeadersJsonMode");
    const keyValueButton = this.field("kafkaHeadersKeyValueMode");
    jsonButton.classList.toggle("is-active", json);
    keyValueButton.classList.toggle("is-active", !json);
    jsonButton.setAttribute("aria-pressed", String(json));
    keyValueButton.setAttribute("aria-pressed", String(!json));
    if (json) this.jsonEditors.Headers?.layout?.();
  }

  setHeadersMode(mode) {
    if (mode === this.headersMode) return true;
    if (mode === "key-value") {
      const parsed = this.parseHeadersValue(this.field("kafkaHeaders").value);
      if (!parsed.valid) {
        this.message("kafkaHeadersStatus", parsed.error, true);
        this.jsonEditors.Headers?.focus();
        if (!this.jsonEditors.Headers) this.field("kafkaHeaders")?.focus();
        return false;
      }
      this.headerRows = Object.entries(parsed.headers).map(([key, value]) => ({ key, value }));
      this.renderHeaderRows();
      this.applyHeadersMode("key-value");
    } else {
      const state = this.getHeaderRowsState();
      if (!state.valid) {
        this.message("kafkaHeadersStatus", state.error, true);
        this.field("kafkaHeaderRows")?.querySelector("[data-header-field='key']")?.focus();
        return false;
      }
      this.writeHeadersJson(state.headers);
      this.applyHeadersMode("json");
    }
    this.updateCount();
    this.scheduleTabSave();
    return true;
  }

  writeHeadersJson(headers) {
    const value = JSON.stringify(headers, null, 2);
    const input = this.field("kafkaHeaders");
    input.value = value;
    const editor = this.jsonEditors.Headers;
    if (editor && editor.getValue() !== value) editor.setValue(value);
  }

  handleHeaderRowsInput(event) {
    const input = event.target.closest("[data-header-field]");
    if (!input) return;
    const index = Number(input.dataset.headerIndex);
    if (!this.headerRows[index]) return;
    this.headerRows[index][input.dataset.headerField] = input.value;
    const state = this.getHeaderRowsState();
    if (state.valid) this.writeHeadersJson(state.headers);
    this.updateCount();
    this.scheduleTabSave();
  }

  handleHeaderRowsClick(event) {
    const button = event.target.closest("button[data-remove-header]");
    if (!button) return;
    const index = Number(button.dataset.removeHeader);
    this.headerRows.splice(index, 1);
    this.renderHeaderRows();
    const state = this.getHeaderRowsState();
    if (state.valid) this.writeHeadersJson(state.headers);
    this.updateCount();
    this.scheduleTabSave();
    const nextIndex = Math.min(index, this.headerRows.length - 1);
    if (nextIndex >= 0) {
      const selector = `[data-header-index="${nextIndex}"][data-header-field="key"]`;
      this.field("kafkaHeaderRows")?.querySelector(selector)?.focus();
    } else this.field("kafkaAddHeader")?.focus();
  }

  addHeaderRow() {
    this.headerRows.push({ key: "", value: "" });
    this.renderHeaderRows();
    this.updateCount();
    this.scheduleTabSave();
    const index = this.headerRows.length - 1;
    const selector = `[data-header-index="${index}"][data-header-field="key"]`;
    this.field("kafkaHeaderRows")?.querySelector(selector)?.focus();
  }

  generateUuid() {
    const uuid = globalThis.crypto.randomUUID();
    this.copyToClipboard(uuid, this.field("kafkaGenerateUuid"));
  }

  generateTraceId() {
    const rows = this.headersMode === "key-value" ? this.getHeaderRowsState() : null;
    if (rows && !rows.valid) {
      this.message("kafkaPublishStatus", rows.error, true);
      return;
    }
    const parsed = this.parseHeadersValue(this.field("kafkaHeaders").value);
    if (!parsed.valid) {
      const error = parsed.error.startsWith("Invalid JSON")
        ? "Fix header JSON before generating a trace ID."
        : parsed.error;
      this.message("kafkaPublishStatus", error, true);
      return;
    }
    const random = globalThis.crypto.getRandomValues(new Uint8Array(6));
    const traceId = `adt-${Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    this.setJsonValue("Headers", JSON.stringify({ ...parsed.headers, traceId }, null, 2));
    this.field("kafkaKey").value = traceId;
    this.updateCount();
    this.message("kafkaPublishStatus", `Generated ${traceId} for the traceId header and message key.`);
  }

  validateJson(name) {
    const input = this.field(`kafka${name}`);
    const status = `kafka${name}Status`;
    if (name === "Headers" && this.headersMode === "key-value") {
      const rows = this.getHeaderRowsState();
      this.message(status, rows.valid ? "Valid JSON" : rows.error, !rows.valid);
      return;
    }
    if (!input.value.trim() && name === "Value") {
      this.message(status, "");
      return;
    }
    if (name === "Headers") {
      const headers = this.parseHeadersValue(input.value);
      this.message(status, headers.valid ? "Valid JSON" : headers.error, !headers.valid);
      return;
    }
    try {
      JSON.parse(input.value);
      this.message(status, "Valid JSON");
    } catch (_) { this.message(status, "Invalid JSON. Check the highlighted syntax.", true); }
  }

  saveConnection() {
    const profile = saveKafkaActiveBroker(this.field("kafkaBrokerSelect")?.value || "");
    const tab = this.getActiveTab();
    if (tab && profile) {
      tab.brokerId = profile.id;
      tab.brokers = profile.brokers;
    } else if (tab) {
      tab.brokerId = "";
      tab.brokers = "";
    }
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
    try {
      localStorage.setItem(KAFKA_TOPIC_FAVORITES_KEY, JSON.stringify(this.favoriteTopics));
      const profile = this.brokerProfiles.find((item) => item.id === readKafkaActiveBrokerId());
      UsageTracker.trackEvent("kafka", "topic_favorite_changed", {
        topic, source, favorite: !favorite, ...(profile ? { broker_profile: profile.name } : {}),
      });
    } catch (_) { /* Persistence and analytics remain best effort for the favorites UI. */ }
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
    this.tabTitleTopicSource = source;
    const ids = this.topicPickerIds(source);
    this.field(ids.input).value = topic;
    this.updateTopicFavorite(source);
    this.closeTopicMenu(source);
    if (source === "listen") {
      this.updateActionAvailability();
      this.scheduleTabSave();
      return;
    }
    this.closeTemplateMenu();
    this.selectedRequestName = "";
    this.field("kafkaTemplateSearch").value = "";
    this.renderRequests();
    this.scheduleTabSave();
  }

  message(id, text, error = false) {
    const node = this.field(id);
    if (node) { node.textContent = text; node.dataset.state = error ? "error" : "ok"; }
  }

  async testConnection() {
    if (!this.config().brokers) {
      this.openBrokerSettings();
      return;
    }
    this.saveConnection();
    const button = this.field("kafkaTest");
    this.testingConnection = true;
    button.disabled = true;
    this.setConnectionState("checking");
    try {
      const result = await this.service.test(this.config());
      this.setConnectionState("connected");
      this.field("kafkaConnectionStatus").title = String(result || "Connected to Kafka");
    } catch (error) {
      this.setConnectionState("error", String(error));
    } finally {
      this.testingConnection = false;
      this.updateActionAvailability();
    }
  }

  records() {
    if (this.headersMode === "key-value") {
      const headers = this.getHeaderRowsState();
      if (!headers.valid) throw new Error(headers.error);
    }
    return parseMessages(this.field("kafkaValue").value, this.field("kafkaKey").value, this.field("kafkaHeaders").value);
  }

  updateCount() {
    this.updateOptionsSummary();
    this.validateJson("Headers");
    this.validateJson("Value");
    const button = this.field("kafkaPublish");
    try {
      const count = this.records().length;
      const ready = this.config().brokers && this.field("kafkaTopic").value.trim();
      this.message("kafkaCount", ready ? `${count} ${count === 1 ? "message" : "messages"} per click` :
        (!this.config().brokers ? "Set up a broker to publish." : ""));
      button.textContent = "Publish";
      button.disabled = this.publishing || !ready;
    } catch (_error) {
      this.message("kafkaCount", this.field("kafkaValue").value ? "" : "Enter one JSON value.");
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
      headers: this.field("kafkaHeaders").value, value: this.field("kafkaValue").value,
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
    this.scheduleTabSave();
  }

  updateOptionsSummary() {
    const summary = this.field("kafkaPublishOptionsSummary");
    if (!summary) return;
    const key = this.field("kafkaKey")?.value.trim();
    const headers = this.field("kafkaHeaders")?.value.trim();
    const parts = [];
    if (key) parts.push("Key");
    const invalidRows = this.headersMode === "key-value" && !this.getHeaderRowsState().valid;
    if (invalidRows) parts.push("Headers need attention");
    else if (headers && headers !== "{}") {
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
      this.renderRequests(); this.message("kafkaPublishStatus", `Deleted “${request.name}”.`); this.scheduleTabSave(); return;
    }
    this.field("kafkaRequestName").value = request.name;
    this.field("kafkaTopic").value = request.topic;
    this.tabTitleTopicSource = "publish";
    this.closeTopicMenu();
    this.closeTemplateMenu();
    this.selectedRequestName = request.name;
    this.field("kafkaTemplateSearch").value = request.name;
    this.updateTopicFavorite();
    this.renderRequests();
    this.field("kafkaKey").value = request.key || "";
    this.setJsonValue("Headers", request.headers || "{}");
    this.setJsonValue("Value", request.value);
    this.field("kafkaPublishOptions").open = Boolean(request.key || (request.headers && request.headers.trim() !== "{}"));
    this.updateCount(); this.message("kafkaPublishStatus", `Loaded “${request.name}”. Review it before publishing.`);
    this.scheduleTabSave();
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
    const rangeHours = Number(this.field("kafkaHistoryRange").value);
    if (!this.config().brokers || !topic) { this.message("kafkaHistoryStatus", "Enter bootstrap servers and a topic to search.", true); return; }
    if (query.length < 3 || !HISTORY_RANGE_HOURS.has(rangeHours)) {
      this.message("kafkaHistoryStatus", "Enter at least 3 characters and choose a search range.", true); return;
    }
    const sinceMs = Date.now() - rangeHours * 60 * 60 * 1000;
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
      this.tabTitleTopicSource = "publish";
      this.closeTopicMenu();
      this.closeTemplateMenu();
      this.selectedRequestName = "";
      this.field("kafkaTemplateSearch").value = "";
      this.updateTopicFavorite();
      this.renderRequests();
      this.field("kafkaKey").value = draft.key;
      this.setJsonValue("Headers", draft.headers);
      this.setJsonValue("Value", draft.value);
      this.field("kafkaRequestName").value = "";
      this.field("kafkaPublishOptions").open = Boolean(draft.key || draft.headers !== "{}");
      this.updateCount();
      this.setFlow("publish");
      this.scheduleTabSave();
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
