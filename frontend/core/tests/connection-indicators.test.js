// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const oracle = vi.hoisted(() => ({ ready: false, pools: [] }));

vi.mock("../Runtime.js", () => ({ isTauri: () => true }));
vi.mock("../OracleConnectionService.js", () => ({
  SidecarStatus: { READY: "ready", STOPPED: "stopped" },
  OracleConnectionService: {
    onStatusChange: (listener) => { listener(oracle.ready ? "ready" : "stopped"); return () => {}; },
    isSidecarReady: () => oracle.ready,
    invokeTauri: vi.fn(async () => oracle.pools),
    connectPool: vi.fn(async (name) => { oracle.pools.push(name); }),
    disconnectPool: vi.fn(async (name) => { oracle.pools = oracle.pools.filter((item) => item !== name); }),
  },
}));

import { ConnectionIndicators } from "../ConnectionIndicators.js";
import { OracleConnectionService } from "../OracleConnectionService.js";

describe("connection indicators", () => {
  let indicators;
  let native;
  const detail = (service) => document.querySelector(`[data-connection="${service}"] .connection-detail`).textContent;

  beforeEach(() => {
    native = vi.spyOn(ConnectionIndicators.prototype, "native").mockImplementation(async (command) => {
      if (command.endsWith("_connection_status")) return null;
      if (command === "kafka_connect") return "broker:9092";
      if (command === "redis_connect") return "cache.local:6379/0";
      return null;
    });
    localStorage.clear();
    oracle.ready = false;
    oracle.pools = [];
    document.body.innerHTML = `<div class="connection-indicators">${["oracle", "kafka", "redis"].map((service) =>
      `<button data-connection="${service}" class="connection-indicator"><span class="connection-detail"></span></button>
      <div id="${service}-connection-menu" hidden></div>`).join("")}</div>`;
    indicators = new ConnectionIndicators(document.querySelector(".connection-indicators"));
  });

  afterEach(() => { indicators.destroy(); native.mockRestore(); vi.clearAllMocks(); });

  it("shows configured services as on demand until an operation or listener is active", () => {
    localStorage.setItem("tool:kafka:connection", JSON.stringify({ brokers: "broker:9092" }));
    localStorage.setItem("config.redis.host", "cache.local");
    indicators.render();
    expect(detail("kafka")).toBe("On demand");
    expect(detail("redis")).toBe("On demand");
    window.dispatchEvent(new CustomEvent("adtools:connection-activity", {
      detail: { service: "kafka", command: "kafka_start_listener", phase: "finish", success: true },
    }));
    expect(detail("kafka")).toBe("Listening");
    window.dispatchEvent(new CustomEvent("adtools:connection-activity", {
      detail: { service: "kafka", command: "kafka_stop_listener", phase: "finish", success: true },
    }));
    expect(detail("kafka")).toBe("On demand");
  });

  it("uses the names of active Oracle pools", async () => {
    oracle.ready = true;
    oracle.pools = ["U81", "U82"];
    await indicators.refreshOracle();
    expect(detail("oracle")).toBe("U81, U82");
    expect(document.querySelector('[data-connection="oracle"]').dataset.state).toBe("active");
    oracle.pools = [];
    await indicators.refreshOracle();
    expect(detail("oracle")).toBe("Idle");
  });

  it("connects two saved Oracle names and blocks a third until one disconnects", async () => {
    localStorage.setItem("config.oracle.connections", JSON.stringify([
      { name: "U81", connect_string: "db-one" },
      { name: "U82", connect_string: "db-two" },
      { name: "U83", connect_string: "db-three" },
    ]));
    oracle.ready = true;
    document.querySelector('[data-connection="oracle"]').click();
    document.querySelector('[data-connection-action="oracle-connect"][data-connection-name="U81"]').click();
    await vi.waitFor(() => expect(detail("oracle")).toBe("U81"));
    await indicators.runAction("oracle-connect", "U82");
    expect(detail("oracle")).toBe("U81, U82");
    expect(document.querySelector('[data-connection-action="oracle-connect"][data-connection-name="U83"]').disabled).toBe(true);
    expect(OracleConnectionService.connectPool).toHaveBeenCalledTimes(2);
    await indicators.runAction("oracle-disconnect", "U81");
    expect(document.querySelector('[data-connection-action="oracle-connect"][data-connection-name="U83"]').disabled).toBe(false);
    await indicators.runAction("oracle-connect", "U83");
    expect(detail("oracle")).toBe("U82, U83");
  });

  it("connects and disconnects Kafka and Redis from their menus", async () => {
    localStorage.setItem("tool:kafka:connection", JSON.stringify({ brokers: "broker:9092" }));
    localStorage.setItem("config.redis.host", "cache.local");
    document.querySelector('[data-connection="kafka"]').click();
    document.querySelector('[data-connection-action="kafka-connect"]').click();
    await vi.waitFor(() => expect(detail("kafka")).toBe("broker:9092"));
    expect(document.querySelector('[data-connection-action="kafka-disconnect"]')).toBeTruthy();
    await indicators.runAction("kafka-disconnect");
    expect(detail("kafka")).toBe("On demand");
    document.querySelector('[data-connection="redis"]').click();
    await indicators.runAction("redis-connect");
    expect(detail("redis")).toBe("cache.local:6379/0");
    await indicators.runAction("redis-disconnect");
    expect(detail("redis")).toBe("On demand");
    expect(native).toHaveBeenCalledWith("kafka_disconnect");
    expect(native).toHaveBeenCalledWith("redis_disconnect");
  });
});
