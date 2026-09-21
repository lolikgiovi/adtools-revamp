import { beforeEach, describe, expect, it } from "vitest";
import {
  chunkRedisKeys,
  normalizeRedisPattern,
  readFavorites,
  readRedisConfig,
  REDIS_FAVORITES_STORAGE_KEY,
  RedisCacheService,
  writeFavorites,
} from "../service.js";

describe("Redis cache service helpers", () => {
  beforeEach(() => localStorage.clear());

  it("turns plain text into a contains pattern and preserves Redis glob patterns", () => {
    expect(normalizeRedisPattern("customer:42")).toBe("*customer:42*");
    expect(normalizeRedisPattern("a b")).toBe("*a*b*");
    expect(normalizeRedisPattern("  a   b  ")).toBe("*a*b*");
    expect(normalizeRedisPattern(" session:* ")).toBe("session:*");
    expect(normalizeRedisPattern("user:?")).toBe("user:?");
    expect(normalizeRedisPattern(" ")).toBe("");
  });

  it("loads one connection from settings with bounded numeric fallbacks", () => {
    localStorage.setItem("config.redis.host", " cache.internal ");
    localStorage.setItem("config.redis.port", "6380");
    localStorage.setItem("config.redis.database", "4");
    localStorage.setItem("config.redis.tls", "true");
    localStorage.setItem("config.redis.username", " cache-user ");
    expect(readRedisConfig()).toEqual({ host: "cache.internal", port: 6380, database: 4, tls: true, username: "cache-user" });

    localStorage.setItem("config.redis.port", "0");
    localStorage.setItem("config.redis.database", "-1");
    expect(readRedisConfig()).toMatchObject({ port: 6379, database: 0 });
  });

  it("deduplicates, bounds, and safely restores favorite keys", () => {
    expect(writeFavorites(["session:1", "session:1", " queue:2 "])).toEqual(["session:1", "queue:2"]);
    expect(readFavorites()).toEqual(["session:1", "queue:2"]);
    localStorage.setItem(REDIS_FAVORITES_STORAGE_KEY, "not-json");
    expect(readFavorites()).toEqual([]);
  });

  it("chunks bulk deletes into bounded commands without repeating keys", () => {
    expect(chunkRedisKeys(["one", "two", "one", "three"], 2)).toEqual([["one", "two"], ["three"]]);
  });

  it("delegates scan and delete operations with structured arguments", async () => {
    const calls = [];
    const service = new RedisCacheService({
      invoke: async (command, args) => {
        calls.push({ command, args });
        return { ok: true };
      },
    });
    const config = { host: "cache.internal", port: 6379, database: 0, tls: false, username: "" };

    await service.testConnection(config);
    await service.scan(config, "session:*", 12, 100);
    await service.getValue(config, "session:1");
    await service.deleteKeys(config, ["session:1"]);

    expect(calls).toEqual([
      { command: "redis_test_connection", args: { config } },
      { command: "redis_scan_keys", args: { config, pattern: "session:*", cursor: 12, count: 100 } },
      { command: "redis_get_value", args: { config, key: "session:1" } },
      { command: "redis_delete_keys", args: { config, keys: ["session:1"] } },
    ]);
  });
});
