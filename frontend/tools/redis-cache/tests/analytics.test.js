import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsageTracker } from "../../../core/UsageTracker.js";
import { RedisCacheTool } from "../main.js";

vi.mock("../../../core/UsageTracker.js", () => ({ UsageTracker: { trackToolUse: vi.fn() } }));

describe("Redis Cache analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="tool"></div>';
    localStorage.clear();
    localStorage.setItem("config.redis.host", "cache.internal");
  });

  it("counts an explicit search once while additional result pages load", async () => {
    const keys = Array.from({ length: 10 }, (_, index) => `key:${index}`);
    const service = {
      scan: vi.fn().mockResolvedValueOnce({ cursor: 12, keys }).mockResolvedValueOnce({ cursor: 0, keys: ["key:10"] }),
    };
    const tool = new RedisCacheTool(null, service);
    tool.mount(document.querySelector("#tool"));
    document.querySelector("#redisPatternInput").value = "key";

    await tool.search();
    await tool.goToPage(2);

    expect(UsageTracker.trackToolUse).toHaveBeenCalledTimes(1);
    expect(UsageTracker.trackToolUse).toHaveBeenCalledWith("redis-cache", "search", expect.objectContaining({ result_count: 10 }));
  });

  it("does not count a clear when Redis deleted no keys", async () => {
    const tool = new RedisCacheTool(null, { deleteKeys: vi.fn().mockResolvedValue({ deleted: 0, command: "UNLINK" }) });
    tool.mount(document.querySelector("#tool"));
    tool.pendingDeleteKeys = ["expired:key"];

    await tool.confirmDelete();

    expect(UsageTracker.trackToolUse).not.toHaveBeenCalled();
  });

  it("counts confirmed deletions when a later batch fails", async () => {
    const deleteKeys = vi.fn().mockResolvedValueOnce({ deleted: 2, command: "UNLINK" }).mockRejectedValueOnce(new Error("connection lost"));
    const tool = new RedisCacheTool(null, { deleteKeys });
    tool.mount(document.querySelector("#tool"));
    tool.pendingDeleteKeys = Array.from({ length: 101 }, (_, index) => `key:${index}`);

    await tool.confirmDelete();

    expect(UsageTracker.trackToolUse).toHaveBeenCalledTimes(1);
    expect(UsageTracker.trackToolUse).toHaveBeenCalledWith("redis-cache", "clear", {
      requested_count: 101,
      deleted_count: 2,
      partial: true,
    });
  });
});
