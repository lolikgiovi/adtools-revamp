// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { BehaviorTracker } from "../BehaviorTracker.js";
import { EventBus } from "../EventBus.js";
import { UsageTracker } from "../UsageTracker.js";

// Failure modes: content leaks through values/labels/dynamic IDs, passive edits flood events,
// behavior increments success totals, hidden time counts as engagement, duplicate listeners,
// telemetry exceptions interrupt actions, and detached/warm tool controls use the wrong feature.
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("shared behavior tracking", () => {
  it("records control interactions across tools without content or successful-use counts", () => {
    document.body.innerHTML = `<main class="main-content"><div data-tool-root="velocity-template">
      <button id="btnLocalRenderVelocity">SECRET</button><input value="SECRET"><select><option>SECRET</option></select>
      <div class="monaco-editor"><textarea>SECRET</textarea></div></div></main>`;
    const eventBus = new EventBus();
    const spy = vi.spyOn(UsageTracker, "trackEvent").mockImplementation(() => {});
    const success = vi.spyOn(UsageTracker, "trackToolUse").mockImplementation(() => {});
    const tracker = new BehaviorTracker(eventBus);
    document.querySelector("button").click();
    document.querySelector("input").dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector("select").dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector("textarea").dispatchEvent(new Event("change", { bubbles: true }));
    expect(spy.mock.calls.map((call) => call[1])).toEqual(["control_click", "control_change", "control_change"]);
    expect(spy.mock.calls[0]).toEqual([
      "velocity-template",
      "control_click",
      {
        control: "btnLocalRenderVelocity",
        control_type: "button",
        input_method: "keyboard",
      },
    ]);
    expect(JSON.stringify(spy.mock.calls)).not.toContain("SECRET");
    expect(success).not.toHaveBeenCalled();
    tracker.destroy();
    document.querySelector("button").click();
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("counts visible time and closes each visit once", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T00:00:00Z"));
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const spy = vi.spyOn(UsageTracker, "trackEvent").mockImplementation(() => {});
    const eventBus = new EventBus();
    const tracker = new BehaviorTracker(eventBus);
    eventBus.emit("page:changed", { page: "tool", toolId: "velocity-template" });
    vi.advanceTimersByTime(1500);
    eventBus.emit("page:changed", { page: "settings" });
    expect(spy).toHaveBeenCalledWith("velocity-template", "page_leave", { duration_ms: 1500, reason: "navigation" });
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(60000);
    window.dispatchEvent(new Event("pagehide"));
    expect(spy.mock.calls.filter((call) => call[1] === "page_leave")).toHaveLength(2);
    tracker.destroy();
  });

  it("keeps controls usable when analytics throws", () => {
    document.body.innerHTML = '<main class="main-content"><div data-tool-root="json-tools"><button id="btnFormat"></button></div></main>';
    vi.spyOn(UsageTracker, "trackEvent").mockImplementation(() => {
      throw new Error("analytics unavailable");
    });
    const tracker = new BehaviorTracker(new EventBus());
    const action = vi.fn();
    document.querySelector("button").addEventListener("click", action);
    document.querySelector("button").click();
    expect(action).toHaveBeenCalledOnce();
    tracker.destroy();
  });
});
