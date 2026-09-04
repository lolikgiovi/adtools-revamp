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

  it("partitions batches by combined item count and preserves array order", () => {
    const payload = {
      device_id: "device-1",
      user_email: "user@example.com",
      runtime: "web",
      app_version: "1.0.0",
      events: Array.from({ length: 260 }, (_, index) => ({ id: `event-${index}` })),
      usage_log: Array.from({ length: 180 }, (_, index) => ({ id: `log-${index}` })),
      error_events: Array.from({ length: 70 }, (_, index) => ({ id: `error-${index}` })),
      device_usage: Array.from({ length: 40 }, (_, index) => ({ id: `usage-${index}` })),
    };

    const chunks = UsageTracker._chunkBatchPayload(payload);
    const keys = ["events", "usage_log", "error_events", "device_usage"];

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk) => {
      const itemCount = keys.reduce((total, key) => total + chunk[key].length, 0);
      expect(itemCount).toBeLessThanOrEqual(UsageTracker.MAX_BATCH_ITEMS);
      expect(UsageTracker._getSerializedByteLength(chunk)).toBeLessThanOrEqual(UsageTracker.MAX_BATCH_BYTES);
    });
    keys.forEach((key) => {
      expect(chunks.flatMap((chunk) => chunk[key])).toEqual(payload[key]);
    });
  });

  it("keeps newly queued rows when all snapshot chunks succeed", async () => {
    const initialEvents = Array.from({ length: 501 }, (_, index) => ({
      featureId: "tool",
      action: `event-${index}`,
      ts: new Date().toISOString(),
      meta: {},
    }));
    UsageTracker._state.events = initialEvents;
    UsageTracker._state.usageLogs = [];
    UsageTracker._state.errorEvents = [];

    let releaseFirstChunk;
    let firstChunkStarted;
    const firstChunkReady = new Promise((resolve) => {
      firstChunkStarted = resolve;
    });
    const firstChunkRelease = new Promise((resolve) => {
      releaseFirstChunk = resolve;
    });
    AnalyticsSender.sendBatch = vi.fn(async () => {
      if (AnalyticsSender.sendBatch.mock.calls.length === 1) {
        firstChunkStarted();
        await firstChunkRelease;
      }
      return true;
    });

    const flushPromise = UsageTracker._flushBatch();
    await firstChunkReady;
    const newEvent = { featureId: "tool", action: "new-event", ts: new Date().toISOString(), meta: {} };
    UsageTracker._state.events.push(newEvent);
    releaseFirstChunk();
    await flushPromise;

    expect(AnalyticsSender.sendBatch).toHaveBeenCalledTimes(2);
    expect(UsageTracker._state.events).toEqual([newEvent]);
  });

  it("removes only acknowledged chunks after a later chunk fails", async () => {
    UsageTracker._state.events = Array.from({ length: 501 }, (_, index) => ({
      featureId: "tool",
      action: `event-${index}`,
      ts: new Date().toISOString(),
      meta: {},
    }));
    UsageTracker._state.usageLogs = [];
    UsageTracker._state.errorEvents = [];
    AnalyticsSender.sendBatch = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await UsageTracker._flushBatch();

    expect(AnalyticsSender.sendBatch).toHaveBeenCalledTimes(2);
    expect(UsageTracker._state.events).toHaveLength(1);
    expect(UsageTracker._state.events[0].action).toBe("event-500");
  });
});
