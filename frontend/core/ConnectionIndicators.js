import { isTauri } from "./Runtime.js";
import { OracleConnectionService, SidecarStatus } from "./OracleConnectionService.js";
import { readKafkaConfig } from "../tools/kafka/service.js";
import { readRedisConfig } from "../tools/redis-cache/service.js";

const STATUS_REFRESH_MS = 30_000;
const ORACLE_LIMIT = 2;

function readOracleConnections() {
  try {
    const value = JSON.parse(localStorage.getItem("config.oracle.connections") || "[]");
    return Array.isArray(value) ? value.filter((item) => item && typeof item.name === "string" && item.connect_string) : [];
  } catch (_) {
    return [];
  }
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function errorText(error) {
  const raw = String(error?.message || error || "Connection failed");
  try {
    const parsed = JSON.parse(raw);
    const detail = parsed?.detail || parsed;
    return String(detail?.message || detail);
  } catch (_) {
    return raw;
  }
}

export class ConnectionIndicators {
  constructor(container, { onOpenSettings } = {}) {
    this.container = container;
    this.onOpenSettings = onOpenSettings;
    this.oraclePools = [];
    this.manual = { kafka: null, redis: null };
    this.busy = { kafka: 0, redis: 0 };
    this.kafkaListening = false;
    this.kafkaListenerLabel = "";
    this.menuService = null;
    this.menuError = "";
    this.pendingAction = false;
    this.manualRevision = 0;
    this.statusTimer = null;
    this.refreshPending = false;
    this.refreshQueued = false;
    this.onActivity = (event) => this.handleActivity(event.detail);
    this.onOracleActivity = () => void this.refreshOracle();
    this.onSettingsChanged = () => this.render();
    this.onDocumentPointerDown = (event) => {
      if (this.menuService && !this.container?.contains(event.target)) this.closeMenu();
    };
    this.onDocumentKeyDown = (event) => {
      if (event.key === "Escape" && this.menuService) {
        event.preventDefault();
        this.closeMenu({ restoreFocus: true });
      }
    };
    this.onContainerClick = (event) => {
      const action = event.target.closest("[data-connection-action]");
      if (action) {
        void this.runAction(action.dataset.connectionAction, action.dataset.connectionName);
        return;
      }
      const trigger = event.target.closest("button.connection-indicator");
      if (trigger) this.toggleMenu(trigger.dataset.connection);
    };
    container?.addEventListener("click", this.onContainerClick);
    document.addEventListener("pointerdown", this.onDocumentPointerDown);
    document.addEventListener("keydown", this.onDocumentKeyDown);
    globalThis.addEventListener("adtools:connection-activity", this.onActivity);
    globalThis.addEventListener("adtools:oracle-pools-changed", this.onOracleActivity);
    globalThis.addEventListener("adtools:connection-settings-changed", this.onSettingsChanged);
    this.unsubscribeSidecar = OracleConnectionService.onStatusChange((status) => {
      if (status === SidecarStatus.READY) void this.refreshOracle();
      else {
        this.oraclePools = [];
        this.render();
      }
    });
    if (isTauri()) void this.refreshManual();
    this.render();
  }

  async native(command, args = {}) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke(command, args);
  }

  destroy() {
    clearTimeout(this.statusTimer);
    this.unsubscribeSidecar?.();
    this.container?.removeEventListener("click", this.onContainerClick);
    document.removeEventListener("pointerdown", this.onDocumentPointerDown);
    document.removeEventListener("keydown", this.onDocumentKeyDown);
    globalThis.removeEventListener("adtools:connection-activity", this.onActivity);
    globalThis.removeEventListener("adtools:oracle-pools-changed", this.onOracleActivity);
    globalThis.removeEventListener("adtools:connection-settings-changed", this.onSettingsChanged);
  }

  scheduleRefresh() {
    clearTimeout(this.statusTimer);
    if (!isTauri() || !(this.oraclePools.length || this.manual.kafka || this.manual.redis || this.kafkaListening)) return;
    this.statusTimer = setTimeout(() => {
      void this.refreshOracle();
      void this.refreshManual();
    }, STATUS_REFRESH_MS);
  }

  async refreshOracle() {
    if (!isTauri() || !OracleConnectionService.isSidecarReady()) return;
    if (this.refreshPending) {
      this.refreshQueued = true;
      return;
    }
    this.refreshPending = true;
    try {
      this.oraclePools = await OracleConnectionService.invokeTauri("oracle_sidecar_pool_connections", {});
    } catch (_) {
      this.oraclePools = [];
    } finally {
      this.refreshPending = false;
      this.render();
      if (this.refreshQueued) {
        this.refreshQueued = false;
        void this.refreshOracle();
      }
    }
  }

  async refreshManual() {
    if (!isTauri() || this.pendingAction) return;
    const revision = this.manualRevision;
    const results = await Promise.allSettled([
      this.native("kafka_connection_status"),
      this.native("redis_connection_status"),
    ]);
    if (revision !== this.manualRevision) return;
    this.manual.kafka = results[0].status === "fulfilled" ? results[0].value : null;
    this.manual.redis = results[1].status === "fulfilled" ? results[1].value : null;
    this.render();
  }

  handleActivity({ service, command, phase, success, label } = {}) {
    if (service !== "kafka" && service !== "redis") return;
    this.busy[service] = Math.max(0, this.busy[service] + (phase === "start" ? 1 : -1));
    if (service === "kafka" && phase === "finish" && success && command === "kafka_start_listener") {
      this.kafkaListening = true;
      this.kafkaListenerLabel = label || "";
    }
    if (service === "kafka" && phase === "finish" && command === "kafka_stop_listener") {
      this.kafkaListening = false;
      this.kafkaListenerLabel = "";
    }
    if (phase === "finish" && success && this.manual[service]) {
      void this.native(`${service}_connection_touch`).catch(() => {});
    }
    this.render();
  }

  toggleMenu(service) {
    if (!isTauri()) return;
    if (this.menuService === service) {
      this.closeMenu();
      return;
    }
    this.menuService = service;
    this.menuError = "";
    this.renderMenu();
    if (service === "oracle") void this.refreshOracle();
    else void this.refreshManual();
  }

  closeMenu({ restoreFocus = false } = {}) {
    const service = this.menuService;
    this.menuService = null;
    this.menuError = "";
    this.renderMenu();
    if (restoreFocus && service) this.container?.querySelector(`[data-connection="${service}"]`)?.focus();
  }

  appendAction(row, label, action, name, disabled = false) {
    const button = element("button", "connection-menu-action", label);
    button.type = "button";
    button.dataset.connectionAction = action;
    if (name) button.dataset.connectionName = name;
    button.disabled = this.pendingAction || disabled;
    row.append(button);
  }

  renderMenu() {
    if (!this.container) return;
    for (const service of ["oracle", "kafka", "redis"]) {
      const menu = this.container.querySelector(`#${service}-connection-menu`);
      const trigger = this.container.querySelector(`button[data-connection="${service}"]`);
      const open = this.menuService === service;
      if (trigger) trigger.setAttribute("aria-expanded", String(open));
      if (!menu) continue;
      menu.hidden = !open;
      if (!open) continue;
      menu.replaceChildren();
      const heading = element("div", "connection-menu-heading", `${service[0].toUpperCase()}${service.slice(1)} connections`);
      if (service === "oracle") heading.append(element("span", "connection-menu-count", `${this.oraclePools.length}/${ORACLE_LIMIT} active`));
      menu.append(heading);
      const list = element("div", "connection-menu-list");
      if (service === "oracle") {
        const connections = readOracleConnections();
        for (const config of connections) {
          const row = element("div", "connection-menu-row");
          const identity = element("div", "connection-menu-identity");
          identity.append(element("div", "connection-menu-name", config.name));
          identity.append(element("div", "connection-menu-endpoint", config.connect_string));
          row.append(identity);
          const active = this.oraclePools.includes(config.name);
          this.appendAction(row, active ? "Disconnect" : "Connect", active ? "oracle-disconnect" : "oracle-connect", config.name,
            !active && this.oraclePools.length >= ORACLE_LIMIT);
          list.append(row);
        }
        if (!connections.length) list.append(element("p", "connection-menu-note", "Add an Oracle connection in Settings."));
      } else {
        const kafka = readKafkaConfig();
        const redis = readRedisConfig();
        const endpoint = service === "kafka" ? kafka.brokers : redis.host ? `${redis.host}:${redis.port}/${redis.database}` : "";
        const connected = service === "kafka" ? Boolean(this.manual.kafka || this.kafkaListening) : Boolean(this.manual.redis);
        const row = element("div", "connection-menu-row");
        const label = connected ? this.manual[service] || endpoint : endpoint || "Not configured";
        row.append(element("span", "connection-menu-name", service === "kafka" ? label.replace(/,\s*/g, ", ") : label));
        this.appendAction(row, connected ? "Disconnect" : "Connect", `${service}-${connected ? "disconnect" : "connect"}`, "", !connected && !endpoint);
        list.append(row);
      }
      menu.append(list);
      if (this.menuError) {
        const note = element("p", "connection-menu-note", this.menuError);
        note.dataset.error = "true";
        menu.append(note);
      } else {
        const note = service === "kafka" && this.kafkaListening
          ? "Live listening continues until disconnected or you leave Kafka."
          : "Idle connections close automatically after about 2 minutes.";
        menu.append(element("p", "connection-menu-note", note));
      }
      if (service === "oracle" && !readOracleConnections().length && this.onOpenSettings) {
        const settings = element("button", "connection-menu-action", "Open Settings");
        settings.type = "button";
        settings.dataset.connectionAction = "settings";
        menu.append(settings);
      }
    }
  }

  async runAction(action, name) {
    if (this.pendingAction) return;
    if (action === "settings") {
      this.closeMenu();
      this.onOpenSettings?.();
      return;
    }
    this.pendingAction = true;
    this.manualRevision++;
    this.menuError = "";
    this.renderMenu();
    try {
      if (action === "oracle-connect") {
        const config = readOracleConnections().find((item) => item.name === name);
        if (!config) throw new Error("Connection settings are no longer available.");
        if (this.oraclePools.length >= ORACLE_LIMIT) throw new Error("Disconnect an Oracle connection first.");
        await OracleConnectionService.connectPool(name, config);
        await this.refreshOracle();
      } else if (action === "oracle-disconnect") {
        await OracleConnectionService.disconnectPool(name);
        await this.refreshOracle();
      } else if (action === "kafka-connect") {
        const config = readKafkaConfig();
        if (!config.brokers) throw new Error("Add Kafka brokers in the Kafka tool first.");
        this.manual.kafka = await this.native("kafka_connect", { config });
      } else if (action === "kafka-disconnect") {
        await this.native("kafka_disconnect");
        this.manual.kafka = null;
        this.kafkaListening = false;
        this.kafkaListenerLabel = "";
        globalThis.dispatchEvent(new Event("adtools:kafka-disconnected"));
      } else if (action === "redis-connect") {
        const config = readRedisConfig();
        if (!config.host) throw new Error("Add a Redis host in Settings first.");
        this.manual.redis = await this.native("redis_connect", { config });
      } else if (action === "redis-disconnect") {
        await this.native("redis_disconnect");
        this.manual.redis = null;
      }
    } catch (error) {
      this.menuError = errorText(error);
    } finally {
      this.pendingAction = false;
      this.render();
    }
  }

  render() {
    if (!this.container) return;
    const names = [...new Set(this.oraclePools)];
    const kafka = readKafkaConfig();
    const redis = readRedisConfig();
    const states = [
      { service: "oracle", name: "Oracle", state: names.length ? "active" : "idle", detail: names.join(", ") || "Idle" },
      { service: "kafka", name: "Kafka", state: this.manual.kafka || this.kafkaListening ? "active" : this.busy.kafka ? "busy" : "idle",
        detail: this.kafkaListening ? `Listening${this.kafkaListenerLabel ? ` · ${this.kafkaListenerLabel}` : ""}`
          : this.manual.kafka || (this.busy.kafka ? "Working" : kafka.brokers ? "On demand" : "Not set") },
      { service: "redis", name: "Redis", state: this.manual.redis ? "active" : this.busy.redis ? "busy" : "idle",
        detail: this.manual.redis || (this.busy.redis ? "Working" : redis.host ? "On demand" : "Not set") },
    ];
    for (const item of states) {
      const trigger = this.container.querySelector(`[data-connection="${item.service}"]`);
      if (!trigger) continue;
      trigger.dataset.state = item.state;
      trigger.querySelector(".connection-detail").textContent = item.detail;
      trigger.title = `${item.name}: ${item.detail}`;
      trigger.setAttribute("aria-label", `Manage ${item.name} connections. ${item.detail}`);
    }
    this.renderMenu();
    this.scheduleRefresh();
  }
}
