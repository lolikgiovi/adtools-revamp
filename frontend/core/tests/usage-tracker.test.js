// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsSender } from "../AnalyticsSender.js";
import { UsageTracker } from "../UsageTracker.js";

describe("UsageTracker analytics reliability", () => {
  beforeEach(() => {
    localStorage.clear();
    UsageTracker._enabled = true;
    UsageTracker._backupEnabled = false;
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
      daily: {},
      integrity: null,
    };
  });

  it("does not clear events when batch send fails", async () => {
    AnalyticsSender.sendBatch = vi.fn().mockResolvedValue(false);

    await UsageTracker._flushBatch();

    expect(UsageTracker._state.events).toHaveLength(1);
  });

  it("clears events when batch send succeeds", async () => {
    AnalyticsSender.sendBatch = vi.fn().mockResolvedValue(true);

    await UsageTracker._flushBatch();

    expect(UsageTracker._state.events).toHaveLength(0);
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
});
