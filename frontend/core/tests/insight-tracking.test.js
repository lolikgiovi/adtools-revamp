// @vitest-environment jsdom
// Insight signals: where a tool open came from, how long the first use took, and why work failed.
// Ways it could go wrong:
// - every open is reported with one source, or a back/forward or typed URL claims a click it never had;
// - a source leaks into the next navigation, or into route data a tool receives;
// - time to first use is stamped on later uses, on a different tool, or survives a reopen;
// - an embedded tool (TLV inside QR Tools) never gets a time;
// - failures carry error messages or content, use unbounded categories, or count as Tool Uses.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BehaviorTracker } from "../BehaviorTracker.js";
import { EventBus } from "../EventBus.js";
import { Router } from "../Router.js";
import { UsageTracker, failureCategory } from "../UsageTracker.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("open source", () => {
  function router() {
    const eventBus = { emit: vi.fn() };
    const instance = new Router(eventBus);
    const seen = [];
    instance.register("json-tools", () => seen.push(instance.currentSource));
    instance.register("home", () => seen.push(instance.currentSource));
    return { instance, seen, eventBus };
  }

  it("records the source the caller names, and keeps it out of route data", () => {
    window.location.hash = "home";
    const { instance, seen, eventBus } = router();
    instance.navigate("json-tools", {}, { source: "sidebar" });
    instance.handleRouteChange();
    expect(seen).toEqual(["sidebar"]);
    expect(eventBus.emit).toHaveBeenCalledWith("route:change", { path: "json-tools", data: {} });
  });

  it("treats navigation that carries data without a source as a hand-off", () => {
    window.location.hash = "home";
    const { instance, seen } = router();
    instance.navigate("json-tools", { sql: "select 1" });
    instance.handleRouteChange();
    expect(seen).toEqual(["handoff"]);
  });

  it("reports history for a route change nobody navigated to, and never reuses a source", () => {
    window.location.hash = "json-tools";
    const { instance, seen } = router();
    instance.navigate("json-tools", {}, { source: "search" });
    instance.handleRouteChange();
    expect(seen).toEqual(["search", "history"]);
  });

  it("puts the source on the page view", () => {
    const eventBus = new EventBus();
    const events = vi.spyOn(UsageTracker, "trackEvent").mockImplementation(() => {});
    const tracker = new BehaviorTracker(eventBus);
    eventBus.emit("page:changed", { page: "tool", toolId: "json-tools", source: "home" });
    tracker.destroy();
    expect(events).toHaveBeenCalledWith("json-tools", "page_view", { previous: "none", source: "home" });
  });
});

describe("time to first use", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-04T10:00:00+07:00"));
    UsageTracker._enabled = true;
    UsageTracker._state = { toolUses: [], revision: 1 };
    UsageTracker._openedTool = null;
    vi.spyOn(UsageTracker, "flush").mockResolvedValue();
    vi.spyOn(UsageTracker, "_scheduleRemoteFlush").mockImplementation(() => {});
  });

  const metas = () => UsageTracker._state.toolUses.map((item) => item.meta.ms_to_first_use);

  it("stamps only the first use after an open of that tool", () => {
    UsageTracker.noteToolOpen("json-tools");
    vi.advanceTimersByTime(4200);
    UsageTracker.trackToolUse("json-tools", "prettify");
    vi.advanceTimersByTime(1000);
    UsageTracker.trackToolUse("json-tools", "minify");
    UsageTracker.trackToolUse("base64-tools", "encode");
    expect(metas()).toEqual([4200, undefined, undefined]);
  });

  it("starts over when the tool is opened again", () => {
    UsageTracker.noteToolOpen("json-tools");
    UsageTracker.trackToolUse("json-tools", "prettify");
    UsageTracker.noteToolOpen("home");
    UsageTracker.noteToolOpen("json-tools");
    vi.advanceTimersByTime(900);
    UsageTracker.trackToolUse("json-tools", "prettify");
    expect(metas()).toEqual([0, 900]);
  });

  it("times a tool that is embedded in the page that was opened", () => {
    UsageTracker.noteToolOpen("qr-tools");
    vi.advanceTimersByTime(300);
    UsageTracker.trackToolUse("tlv-viewer", "parse");
    expect(metas()).toEqual([300]);
  });
});

describe("failures", () => {
  it("records a bounded category and the failed action, never the message or a Tool Use", () => {
    const events = vi.spyOn(UsageTracker, "trackEvent").mockImplementation(() => {});
    const uses = vi.spyOn(UsageTracker, "trackToolUse").mockImplementation(() => {});
    UsageTracker.trackFailure("redis-cache", "search", new Error("ECONNREFUSED 10.1.2.3:6379 secret-key"), { env: "SIT" });
    expect(events).toHaveBeenCalledWith("redis-cache", "failed", { action: "search", category: "network", env: "SIT" });
    expect(JSON.stringify(events.mock.calls)).not.toContain("secret");
    expect(uses).not.toHaveBeenCalled();
  });

  it.each([
    [Object.assign(new Error("x"), { name: "AbortError" }), "cancelled"],
    [new Error("Request timed out after 30s"), "timeout"],
    [Object.assign(new Error("x"), { status: 401 }), "auth"],
    [Object.assign(new Error("x"), { status: 404 }), "not_found"],
    [Object.assign(new Error("x"), { status: 503 }), "server"],
    [Object.assign(new Error("x"), { status: 422 }), "rejected"],
    [new TypeError("Failed to fetch"), "network"],
    [new SyntaxError("Unexpected token } in JSON"), "invalid_input"],
    [new Error("ORA-01017: invalid username/password; logon denied"), "auth"],
    ["invalid_input", "invalid_input"],
    ["anything else", "internal"],
    [new Error("boom"), "internal"],
    [undefined, "internal"],
  ])("classifies %s as %s", (error, category) => {
    expect(failureCategory(error)).toBe(category);
  });
});
