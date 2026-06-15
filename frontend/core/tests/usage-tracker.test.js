// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsSender } from "../AnalyticsSender.js";
import { UsageTracker } from "../UsageTracker.js";

describe("UsageTracker analytics reliability", () => {
  beforeEach(() => {
    localStorage.clear();
    UsageTracker._enabled = true;
    UsageTracker._backupEnabled = false;
    UsageTracker._flushTimer = null;
    UsageTracker._state = {
      version: 1,
      deviceId: "device-1",
      lastUpdated: new Date().toISOString(),
      revision: 1,
      counts: {
        master_lockey: { mount: 2 },
        json_tools: { export_excel: 1 },
      },
      events: [{ featureId: "json_tools", action: "export_excel", ts: new Date().toISOString(), meta: { stack: "a".repeat(200) } }],
      usageLogs: [
        {
          user_email: "user@example.com",
          device_id: "device-1",
          tool_id: "json_tools",
          action: "export_excel",
          ts: new Date().toISOString(),
        },
      ],
      errorEvents: [
        {
          user_email: "user@example.com",
          device_id: "device-1",
          runtime: "web",
          route: "#json-tools",
          tool_id: "json_tools",
          process_area: "tool",
          error_kind: "captured_error",
          error_name: "Error",
          message: "boom",
          created_time: new Date().toISOString(),
        },
      ],
      daily: {},
      integrity: null,
    };
  });

  it("does not clear events when batch send fails", async () => {
    AnalyticsSender.sendBatch = vi.fn().mockResolvedValue(false);

    await UsageTracker._flushBatch();

    expect(UsageTracker._state.events).toHaveLength(1);
    expect(UsageTracker._state.usageLogs).toHaveLength(1);
    expect(UsageTracker._state.errorEvents).toHaveLength(1);
  });

  it("clears detail rows when batch send succeeds", async () => {
    AnalyticsSender.sendBatch = vi.fn().mockResolvedValue(true);

    await UsageTracker._flushBatch();

    expect(UsageTracker._state.events).toHaveLength(0);
    expect(UsageTracker._state.usageLogs).toHaveLength(0);
    expect(UsageTracker._state.errorEvents).toHaveLength(0);
  });

  it("exposes a public immediate batch flush wrapper", async () => {
    AnalyticsSender.sendBatch = vi.fn().mockResolvedValue(true);

    await UsageTracker.flushBatchNow();

    expect(AnalyticsSender.sendBatch).toHaveBeenCalledTimes(1);
    expect(UsageTracker._state.events).toHaveLength(0);
    expect(UsageTracker._state.usageLogs).toHaveLength(0);
    expect(UsageTracker._state.errorEvents).toHaveLength(0);
  });

  it("queues feature usage logs for the next batch instead of sending live logs", () => {
    AnalyticsSender.sendLog = vi.fn();
    localStorage.setItem("user.email", "USER@example.com");
    localStorage.setItem("adtools.deviceId", "device-1");
    UsageTracker._state.usageLogs = [];

    UsageTracker.trackFeature("json_tools", "prettify");

    expect(AnalyticsSender.sendLog).not.toHaveBeenCalled();
    expect(UsageTracker._state.usageLogs).toEqual([
      expect.objectContaining({
        user_email: "user@example.com",
        device_id: "device-1",
        tool_id: "json-tools",
        action: "prettify",
      }),
    ]);
  });

  it("queues error events for the next batch", () => {
    UsageTracker._state.errorEvents = [];

    UsageTracker.queueErrorEvent({
      user_email: "user@example.com",
      device_id: "device-1",
      error_kind: "captured_error",
      error_name: "Error",
      message: "boom",
      created_time: new Date().toISOString(),
    });

    expect(UsageTracker._state.errorEvents).toEqual([
      expect.objectContaining({
        user_email: "user@example.com",
        device_id: "device-1",
        error_kind: "captured_error",
        message: "boom",
      }),
    ]);
  });

  it("normalizes legacy feature IDs", () => {
    UsageTracker.sanitizeCounts();

    expect(UsageTracker._state.counts["master-lockey"].mount).toBe(2);
    expect(UsageTracker._state.counts["json-tools"].export_excel).toBe(1);
    expect(UsageTracker._state.counts.master_lockey).toBeUndefined();
    expect(UsageTracker._state.counts.json_tools).toBeUndefined();
  });

  it("allows longer sanitized error stacks without retaining sensitive fields", () => {
    const meta = UsageTracker.sanitizeErrorMeta({
      stack: `Error: boom\n${"frame\n".repeat(100)}`,
      message: "The 123456 code failed",
      sql: "select * from secret_table",
      token: "abc",
    });

    expect(meta.stack.length).toBeGreaterThan(40);
    expect(meta.message).toContain("[redacted-code]");
    expect(meta.sql).toBeUndefined();
    expect(meta.token).toBeUndefined();
  });

  it("debounces bursty event persistence while keeping explicit sync flush available", async () => {
    vi.useFakeTimers();
    const setItemSpy = vi.spyOn(localStorage, "setItem");

    UsageTracker.trackEvent("json-tools", "tab_switch", { tab: "formatter" });
    UsageTracker.trackEvent("json-tools", "tab_switch", { tab: "validator" });

    expect(setItemSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(UsageTracker.FLUSH_DELAY_MS);

    expect(setItemSpy).toHaveBeenCalled();

    setItemSpy.mockClear();
    UsageTracker.flushSync();
    expect(setItemSpy).toHaveBeenCalled();

    setItemSpy.mockRestore();
    vi.useRealTimers();
  });
});
