import { isTauri } from "./Runtime.js";
import { OracleConnectionService, SidecarStatus } from "./OracleConnectionService.js";
import { readKafkaConfig } from "../tools/kafka/service.js";
import { readRedisConfig } from "../tools/redis-cache/service.js";

const ORACLE_REFRESH_MS = 60_000;

export class ConnectionIndicators {
  constructor(container) {
    this.container = container;
    this.oraclePools = [];
    this.busy = { kafka: 0, redis: 0 };
    this.kafkaListening = false;
    this.kafkaListenerLabel = "";
    this.activeLabel = { kafka: "", redis: "" };
    this.oracleTimer = null;
    this.refreshPending = false;
    this.refreshQueued = false;
    this.onActivity = (event) => this.handleActivity(event.detail);
    this.onOracleActivity = () => void this.refreshOracle();
    this.onSettingsChanged = () => this.render();
    globalThis.addEventListener("adtools:connection-activity", this.onActivity);
    globalThis.addEventListener("adtools:oracle-pools-changed", this.onOracleActivity);
    globalThis.addEventListener("adtools:connection-settings-changed", this.onSettingsChanged);
    this.unsubscribeSidecar = OracleConnectionService.onStatusChange((status) => {
      if (status === SidecarStatus.READY) void this.refreshOracle();
      else {
        this.oraclePools = [];
        this.clearOracleTimer();
        this.render();
      }
    });
    this.render();
  }

  clearOracleTimer() {
    clearTimeout(this.oracleTimer);
    this.oracleTimer = null;
  }

  destroy() {
    this.clearOracleTimer();
    this.unsubscribeSidecar?.();
    globalThis.removeEventListener("adtools:connection-activity", this.onActivity);
    globalThis.removeEventListener("adtools:oracle-pools-changed", this.onOracleActivity);
    globalThis.removeEventListener("adtools:connection-settings-changed", this.onSettingsChanged);
  }

  async refreshOracle() {
    if (!isTauri() || !OracleConnectionService.isSidecarReady()) return;
    if (this.refreshPending) {
      this.refreshQueued = true;
      return;
    }
    this.refreshPending = true;
    this.clearOracleTimer();
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
      } else if (this.oraclePools.length) {
        this.oracleTimer = setTimeout(() => void this.refreshOracle(), ORACLE_REFRESH_MS);
      }
    }
  }

  handleActivity({ service, command, phase, success, label } = {}) {
    if (service !== "kafka" && service !== "redis") return;
    this.busy[service] = Math.max(0, this.busy[service] + (phase === "start" ? 1 : -1));
    if (phase === "start") this.activeLabel[service] = label || "";
    if (service === "kafka" && phase === "finish" && success) {
      if (command === "kafka_start_listener") {
        this.kafkaListening = true;
        this.kafkaListenerLabel = label || "";
      }
    }
    if (service === "kafka" && phase === "finish" && command === "kafka_stop_listener") {
      this.kafkaListening = false;
      this.kafkaListenerLabel = "";
    }
    this.render();
  }

  render() {
    if (!this.container) return;
    const names = [...new Set(this.oraclePools)];
    const kafka = readKafkaConfig();
    const redis = readRedisConfig();
    const states = [
      { service: "oracle", name: "Oracle", state: names.length ? "active" : "idle", detail: names.join(", ") || "Idle" },
      { service: "kafka", name: "Kafka", state: this.kafkaListening ? "active" : this.busy.kafka ? "busy" : "idle",
        detail: this.kafkaListening ? `Listening${this.kafkaListenerLabel ? ` · ${this.kafkaListenerLabel}` : ""}`
          : this.busy.kafka ? "Working" : kafka.brokers ? "On demand" : "Not set" },
      { service: "redis", name: "Redis", state: this.busy.redis ? "busy" : "idle",
        detail: this.busy.redis ? "Working" : redis.host ? "On demand" : "Not set" },
    ];
    for (const item of states) {
      const element = this.container.querySelector(`[data-connection="${item.service}"]`);
      if (!element) continue;
      element.dataset.state = item.state;
      element.querySelector(".connection-detail").textContent = item.detail;
      const endpoint = item.service === "redis"
        ? (this.busy.redis ? this.activeLabel.redis : "") || (redis.host ? `${redis.host}:${redis.port}/${redis.database}` : "")
        : item.service === "kafka" && !this.kafkaListening ? kafka.brokers : "";
      element.title = `${item.name}: ${item.detail}${endpoint ? ` · ${endpoint}` : ""}`;
      element.setAttribute("aria-label", element.title);
    }
  }
}
