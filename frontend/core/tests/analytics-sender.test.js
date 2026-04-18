// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsSender } from "../AnalyticsSender.js";

describe("AnalyticsSender", () => {
  beforeEach(() => {
    localStorage.clear();
    AnalyticsSender._debug = false;
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
  });

  it("sends batches with POST only", async () => {
    localStorage.setItem("config.analytics.endpoint", "https://worker.example");

    const ok = await AnalyticsSender.sendBatch({
      device_id: "device-1",
      device_usage: [{ device_id: "device-1", tool_id: "json-tools", action: "open", count: 1 }],
      events: [{ type: "json-tools", action: "tab_switch" }],
    });

    expect(ok).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.every(([, init]) => init.method === "POST")).toBe(true);
    expect(fetch.mock.calls.some(([url]) => String(url).includes("?"))).toBe(false);
  });

  it("sends live logs with POST only", async () => {
    localStorage.setItem("config.analytics.endpoint", "https://worker.example");

    const ok = await AnalyticsSender.sendLog({
      user_email: "user@example.com",
      device_id: "device-1",
      tool_id: "json-tools",
      action: "open",
    });

    expect(ok).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.every(([, init]) => init.method === "POST")).toBe(true);
    expect(fetch.mock.calls.some(([url]) => String(url).includes("?"))).toBe(false);
  });
});
