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
  },
}));

import { ConnectionIndicators } from "../ConnectionIndicators.js";

describe("connection indicators", () => {
  let indicators;
  const detail = (service) => document.querySelector(`[data-connection="${service}"] .connection-detail`).textContent;

  beforeEach(() => {
    localStorage.clear();
    oracle.ready = false;
    oracle.pools = [];
    document.body.innerHTML = `<div class="connection-indicators">${["oracle", "kafka", "redis"].map((service) =>
      `<span data-connection="${service}"><span class="connection-detail"></span></span>`).join("")}</div>`;
    indicators = new ConnectionIndicators(document.querySelector(".connection-indicators"));
  });

  afterEach(() => indicators.destroy());

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
});
