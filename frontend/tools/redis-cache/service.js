const CONFIG_KEYS = {
  host: "config.redis.host",
  port: "config.redis.port",
  database: "config.redis.database",
  tls: "config.redis.tls",
  username: "config.redis.username",
};

export const REDIS_FAVORITES_STORAGE_KEY = "tool:redis-cache:favorites";
export const REDIS_DELETE_BATCH_SIZE = 100;

export function normalizeRedisPattern(value) {
  const pattern = String(value || "").trim();
  if (!pattern) return "";
  const hasGlob = pattern.includes("*") || pattern.includes("?") || pattern.includes("[");
  const normalized = pattern.replace(/\s+/g, "*");
  return hasGlob ? normalized : `*${normalized}*`;
}

export function readRedisConfig(storage = localStorage) {
  const host = String(storage.getItem(CONFIG_KEYS.host) || "").trim();
  const port = Number(storage.getItem(CONFIG_KEYS.port) || 6379);
  const database = Number(storage.getItem(CONFIG_KEYS.database) || 0);
  return {
    host,
    port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 6379,
    database: Number.isInteger(database) && database >= 0 && database <= 1024 ? database : 0,
    tls: storage.getItem(CONFIG_KEYS.tls) === "true",
    username: String(storage.getItem(CONFIG_KEYS.username) || "").trim(),
  };
}

export function readFavorites(storage = localStorage) {
  try {
    const parsed = JSON.parse(storage.getItem(REDIS_FAVORITES_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? [...new Set(parsed.map((key) => String(key || "").trim()).filter(Boolean))].slice(0, 100) : [];
  } catch (_) {
    return [];
  }
}

export function writeFavorites(favorites, storage = localStorage) {
  const normalized = [...new Set((favorites || []).map((key) => String(key || "").trim()).filter(Boolean))].slice(0, 100);
  storage.setItem(REDIS_FAVORITES_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function chunkRedisKeys(keys, batchSize = REDIS_DELETE_BATCH_SIZE) {
  const size = Math.max(1, Math.floor(Number(batchSize) || REDIS_DELETE_BATCH_SIZE));
  const normalized = [...new Set((keys || []).map((key) => String(key || "")).filter(Boolean))];
  const batches = [];
  for (let index = 0; index < normalized.length; index += size) batches.push(normalized.slice(index, index + size));
  return batches;
}

export class RedisCacheService {
  constructor({ invoke } = {}) {
    this.invoke = invoke || null;
  }

  async call(command, args) {
    if (!this.invoke) {
      const tauri = await import("@tauri-apps/api/core");
      this.invoke = tauri.invoke;
    }
    return this.invoke(command, args);
  }

  testConnection(config) {
    return this.call("redis_test_connection", { config });
  }

  scan(config, pattern, cursor = 0, count = 100) {
    return this.call("redis_scan_keys", { config, pattern, cursor, count });
  }

  deleteKeys(config, keys) {
    return this.call("redis_delete_keys", { config, keys });
  }
}
