// @vitest-environment jsdom
// Failure cases: dev actions enter the durable queue; existing queued data uploads; disabling dev persists into release sessions.
import { afterEach, expect, it, vi } from "vitest";
import { UsageTracker } from "../UsageTracker.js";

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  localStorage.clear();
});

it("ignores development usage even when local analytics preferences are enabled", async () => {
  vi.useFakeTimers();
  vi.stubEnv("DEV", true);
  localStorage.setItem(UsageTracker.ENABLED_KEY, "true");
  UsageTracker.init();
  const before = JSON.stringify(UsageTracker._state);
  UsageTracker.trackFeature("json-tools", "open");
  expect(UsageTracker.trackToolUse("json-tools", "prettify")).toBeNull();
  UsageTracker.trackEvent("json-tools", "tab_switch");
  await UsageTracker.flushBatchNow();
  expect(JSON.stringify(UsageTracker._state)).toBe(before);
  expect(localStorage.getItem(UsageTracker.ENABLED_KEY)).toBe("true");
});
