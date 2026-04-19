// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App.js";

function createLifecycleHarness() {
  return Object.assign(Object.create(App.prototype), {
    currentTool: null,
    toolDomRoots: new Map(),
    warmHeavyTools: new Map(),
  });
}

function createTool(id, options = {}) {
  return {
    id,
    isHeavyTool: options.isHeavyTool ?? true,
    deactivate: vi.fn(),
    unmount: vi.fn(),
    disposeHeavyResources: vi.fn(),
    hasActiveBackgroundWork: vi.fn(() => Boolean(options.activeBackgroundWork)),
  };
}

describe("App warm heavy-tool lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-19T00:00:00Z"));
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("keeps a heavy tool warm on route switch instead of hard-disposing immediately", () => {
    const app = createLifecycleHarness();
    const tool = createTool("quick-query");
    const root = document.createElement("div");
    document.body.appendChild(root);
    app.currentTool = tool;
    app.toolDomRoots.set(tool.id, root);

    app.clearCurrentTool();

    expect(tool.deactivate).toHaveBeenCalledTimes(1);
    expect(tool.unmount).not.toHaveBeenCalled();
    expect(tool.disposeHeavyResources).not.toHaveBeenCalled();
    expect(root.isConnected).toBe(false);
    expect(app.warmHeavyTools.has(tool.id)).toBe(true);
    expect(app.currentTool).toBeNull();
  });

  it("hard-disposes an idle warm tool after the grace period", () => {
    const app = createLifecycleHarness();
    const tool = createTool("quick-query");
    const root = document.createElement("div");

    app.scheduleWarmToolDisposal(tool, root);
    vi.advanceTimersByTime(90 * 1000);

    expect(tool.unmount).toHaveBeenCalledTimes(1);
    expect(tool.disposeHeavyResources).toHaveBeenCalledWith("idle-timeout");
    expect(app.warmHeavyTools.has(tool.id)).toBe(false);
  });

  it("evicts the least recently used idle heavy tool when the warm cache limit is exceeded", () => {
    const app = createLifecycleHarness();
    const first = createTool("quick-query");
    const second = createTool("run-query");
    const third = createTool("compare-config");

    vi.setSystemTime(new Date("2026-04-19T00:00:00Z"));
    app.scheduleWarmToolDisposal(first, document.createElement("div"));
    vi.setSystemTime(new Date("2026-04-19T00:00:01Z"));
    app.scheduleWarmToolDisposal(second, document.createElement("div"));
    vi.setSystemTime(new Date("2026-04-19T00:00:02Z"));
    app.scheduleWarmToolDisposal(third, document.createElement("div"));

    expect(first.unmount).toHaveBeenCalledTimes(1);
    expect(first.disposeHeavyResources).toHaveBeenCalledWith("warm-cache-limit");
    expect(app.warmHeavyTools.has("quick-query")).toBe(false);
    expect(app.warmHeavyTools.has("run-query")).toBe(true);
    expect(app.warmHeavyTools.has("compare-config")).toBe(true);
  });

  it("does not hard-dispose a warm tool with active background work", () => {
    const app = createLifecycleHarness();
    const tool = createTool("run-query", { activeBackgroundWork: true });
    const root = document.createElement("div");

    app.scheduleWarmToolDisposal(tool, root);
    vi.advanceTimersByTime(90 * 1000);

    expect(tool.unmount).not.toHaveBeenCalled();
    expect(tool.disposeHeavyResources).not.toHaveBeenCalled();
    expect(app.warmHeavyTools.has(tool.id)).toBe(true);
  });
});
