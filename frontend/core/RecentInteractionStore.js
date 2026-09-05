const STORAGE_KEY = "adtools.global-search.recent-interactions.v1";
const MAX_ENTRIES = 100;

/** Return the stable recency key used for a Quick Query table. */
export function getQuickQueryTableInteractionKey(tableName) {
  const normalized = String(tableName || "").trim().toUpperCase();
  return normalized ? `quick-query-table:${normalized}` : "";
}

/** Return the stable recency key used for a global-search result. */
export function getSearchInteractionKey(item = {}) {
  const explicitKey = item.interactionKey || item.key;
  if (explicitKey) return String(explicitKey).trim();

  if (item.route === "quick-query" && item.data?.tableName) {
    return getQuickQueryTableInteractionKey(item.data.tableName);
  }

  const type = String(item.type || "item").trim().toLowerCase();
  const target = String(item.route || item.id || item.name || "").trim().toLowerCase();
  return target ? `${type}:${target}` : "";
}

/**
 * Small local-only store for the destinations a user interacted with most recently.
 * Entries are kept newest-first so equal timestamps still have deterministic order.
 */
export class RecentInteractionStore {
  static STORAGE_KEY = STORAGE_KEY;
  static MAX_ENTRIES = MAX_ENTRIES;

  constructor({ storage, now } = {}) {
    this.storage = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    this.now = typeof now === "function" ? now : () => Date.now();
  }

  getEntries() {
    if (!this.storage) return [];

    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return [];
      return this._normalizeEntries(JSON.parse(raw));
    } catch (_) {
      return [];
    }
  }

  getRecencyMap() {
    return new Map(
      this.getEntries().map((entry, order) => [
        entry.key,
        { lastInteractedAt: entry.lastInteractedAt, order },
      ]),
    );
  }

  getLastInteractedAt(key) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) return null;
    return this.getRecencyMap().get(normalizedKey)?.lastInteractedAt ?? null;
  }

  has(key) {
    const normalizedKey = String(key || "").trim();
    return Boolean(normalizedKey && this.getRecencyMap().has(normalizedKey));
  }

  touch(key, timestamp = this.now()) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey || !this.storage) return false;

    const numericTimestamp = Number(timestamp);
    const lastInteractedAt = Number.isFinite(numericTimestamp) ? numericTimestamp : Date.now();
    const entries = this.getEntries().filter((entry) => entry.key !== normalizedKey);
    entries.unshift({ key: normalizedKey, lastInteractedAt });

    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
      return true;
    } catch (_) {
      return false;
    }
  }

  touchItem(item, timestamp) {
    return this.touch(getSearchInteractionKey(item), timestamp);
  }

  clear() {
    if (!this.storage) return false;

    try {
      this.storage.removeItem(STORAGE_KEY);
      return true;
    } catch (_) {
      return false;
    }
  }

  _normalizeEntries(value) {
    if (Array.isArray(value)) {
      const seen = new Set();
      return value
        .map((entry) => ({
          key: String(entry?.key || "").trim(),
          lastInteractedAt: Number(entry?.lastInteractedAt ?? entry?.timestamp),
        }))
        .filter((entry) => {
          if (!entry.key || seen.has(entry.key)) return false;
          seen.add(entry.key);
          if (!Number.isFinite(entry.lastInteractedAt)) entry.lastInteractedAt = 0;
          return true;
        })
        .slice(0, MAX_ENTRIES);
    }

    // Accept an object map as a forgiving migration path for early local builds.
    if (value && typeof value === "object") {
      return Object.entries(value)
        .map(([key, timestamp]) => ({ key: String(key).trim(), lastInteractedAt: Number(timestamp) }))
        .filter((entry) => entry.key)
        .map((entry) => ({ ...entry, lastInteractedAt: Number.isFinite(entry.lastInteractedAt) ? entry.lastInteractedAt : 0 }))
        .sort((a, b) => b.lastInteractedAt - a.lastInteractedAt)
        .slice(0, MAX_ENTRIES);
    }

    return [];
  }
}
