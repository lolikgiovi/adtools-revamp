// Redis Cache reports failed operations and searches that find nothing.
// Ways it could go wrong: a failed search, value view, clear or connection test goes unreported; a report carries the
// host, key names, the pattern text or the error message; an empty search is not reported, or a search with
// results is reported as empty; loading a further page reports a second empty search.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsageTracker } from "../../../core/UsageTracker.js";
import { RedisCacheTool } from "../main.js";

vi.mock("../../../core/UsageTracker.js", () => ({
  UsageTracker: { trackToolUse: vi.fn(), trackEvent: vi.fn(), trackFailure: vi.fn() },
}));

function mount(service) {
  const tool = new RedisCacheTool(null, service);
  tool.mount(document.querySelector("#tool"));
  return tool;
}

const reported = () => JSON.stringify([UsageTracker.trackEvent.mock.calls, UsageTracker.trackFailure.mock.calls.map((call) => call[3])]);

describe("Redis Cache insight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="tool"></div>';
    localStorage.clear();
    localStorage.setItem("config.redis.host", "cache.secret-host.internal");
    localStorage.setItem("config.redis.database", "3");
  });

  it("reports an empty search with its shape, never the pattern or host", async () => {
    const tool = mount({ scan: vi.fn().mockResolvedValue({ cursor: 0, keys: [] }) });
    document.querySelector("#redisPatternInput").value = "customer:12345:*";
    await tool.search();
    expect(UsageTracker.trackEvent).toHaveBeenCalledWith("redis-cache", "search_empty", {
      has_wildcard: true,
      pattern_length: 16,
      database: 3,
      tls: false,
    });
    expect(reported()).not.toContain("12345");
    expect(reported()).not.toContain("secret-host");
  });

  it("does not report a search with results as empty", async () => {
    const tool = mount({ scan: vi.fn().mockResolvedValue({ cursor: 0, keys: ["a"] }) });
    document.querySelector("#redisPatternInput").value = "a";
    await tool.search();
    expect(UsageTracker.trackEvent).not.toHaveBeenCalledWith("redis-cache", "search_empty", expect.anything());
  });

  it("reports failed search, view, clear and connection test with the error for categorizing", async () => {
    const error = new Error("ECONNREFUSED cache.secret-host.internal:6379");
    const tool = mount({
      scan: vi.fn().mockRejectedValue(error),
      getValue: vi.fn().mockRejectedValue(error),
      deleteKeys: vi.fn().mockRejectedValue(error),
      testConnection: vi.fn().mockRejectedValue(error),
    });
    document.querySelector("#redisPatternInput").value = "a*";
    await tool.search();
    await tool.viewValue("user:1");
    tool.pendingDeleteKeys = ["user:1"];
    await tool.confirmDelete();
    await tool.testConnection();
    expect(UsageTracker.trackFailure.mock.calls.map((call) => [call[0], call[1], call[2]])).toEqual([
      ["redis-cache", "search", error],
      ["redis-cache", "view", error],
      ["redis-cache", "clear", error],
      ["redis-cache", "test_connection", error],
    ]);
    expect(reported()).not.toContain("secret-host");
    expect(reported()).not.toContain("user:1");
  });

  it("reports a connection test that answers not-ok, categorized by its diagnosed stage", async () => {
    const tool = mount({ testConnection: vi.fn().mockResolvedValue({ ok: false, stage: "auth", message: "NOAUTH secret" }) });
    await tool.testConnection();
    expect(UsageTracker.trackFailure).toHaveBeenCalledWith("redis-cache", "test_connection", "auth", {
      database: 3,
      tls: false,
      stage: "auth",
    });
  });
});
