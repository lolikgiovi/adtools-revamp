/**
 * UsageTracker - Centralized usage analytics with localStorage persistence
 * - Records feature/action events with timestamps
 * - Maintains aggregated counts per feature/action
 * - Stores anonymized install ID, no PII
 * - Debounced writes for performance and integrity safeguards
 */
class UsageTracker {
  static STORAGE_KEY = "usage.analytics.v1";
  static BACKUP_KEY = "usage.analytics.backup.v1";
  static INSTALL_ID_KEY = "usage.analytics.installId";
  static MAX_EVENTS = 1500; // rolling buffer to avoid quota issues
  static FLUSH_DELAY_MS = 300; // debounce writes

  static _state = null;
  static _flushTimer = null;
  static _eventBus = null;

  /** Initialize tracker (optional), sets event bus and attaches lifecycle hooks */
  static init(eventBus = null) {
    this._eventBus = eventBus || null;
    this._state = this._loadFromStorage();

    // Ensure flush on unload to prevent data loss
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", () => {
        try { this.flushSync(); } catch (_) {}
      });
    }
  }

  /** Track a usage event with consistent schema */
  static track(featureId, action, meta = {}) {
    if (!featureId || !action) return; // must specify both

    // Lazy-load state
    if (!this._state) {
      this._state = this._loadFromStorage();
    }

    const now = new Date();
    if (!this._isValidTimestamp(now)) return; // guard against invalid clocks

    const event = {
      featureId: String(featureId),
      action: String(action),
      ts: now.toISOString(),
      meta: this._sanitizeMeta(meta),
    };

    // Append to rolling events buffer
    this._state.events.push(event);
    if (this._state.events.length > this.MAX_EVENTS) {
      this._state.events.splice(0, this._state.events.length - this.MAX_EVENTS);
    }

    // Increment aggregated counts
    const counts = this._state.counts;
    counts[featureId] = counts[featureId] || {};
    counts[featureId][action] = (counts[featureId][action] || 0) + 1;

    this._state.lastUpdated = event.ts;
    this._state.revision = (this._state.revision || 0) + 1;

    // Debounced flush for performance
    this._scheduleFlush();

    // Emit update event for any future dashboards
    try { this._eventBus?.emit?.("usage:updated", { featureId, action, ts: event.ts }); } catch (_) {}
  }

  /** Return deep-copied aggregated counts */
  static getCounts() {
    const counts = this._state?.counts || {};
    return JSON.parse(JSON.stringify(counts));
  }

  /** Return recent events (default last 100) */
  static getEvents(limit = 100) {
    const events = this._state?.events || [];
    const start = Math.max(0, events.length - limit);
    return events.slice(start);
  }

  /** Return counts per feature and per day breakdown */
  static getAggregatedStats() {
    const counts = this.getCounts();
    let totalEvents = 0;
    const totalsByFeature = {};

    Object.entries(counts).forEach(([feature, actions]) => {
      const featureTotal = Object.values(actions || {}).reduce((sum, v) => sum + (v || 0), 0);
      totalsByFeature[feature] = featureTotal;
      totalEvents += featureTotal;
    });

    const daily = {};
    for (const ev of this._state?.events || []) {
      const day = ev.ts.slice(0, 10); // YYYY-MM-DD
      const key = `${ev.featureId}.${ev.action}`;
      daily[day] = daily[day] || {};
      daily[day][key] = (daily[day][key] || 0) + 1;
    }

    return { totalEvents, totalsByFeature, counts, daily };
  }

  // ---------------------- Internal helpers ----------------------

  static _sanitizeMeta(meta) {
    try {
      const sanitized = {};
      Object.entries(meta || {}).forEach(([k, v]) => {
        // Only allow safe primitives, with length limits for strings
        if (typeof v === "string") {
          sanitized[k] = v.slice(0, 40); // truncate to avoid PII risk
        } else if (typeof v === "number" && Number.isFinite(v)) {
          sanitized[k] = v;
        } else if (typeof v === "boolean") {
          sanitized[k] = v;
        }
      });
      return sanitized;
    } catch (_) {
      return {};
    }
  }

  static _scheduleFlush() {
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(() => {
      this.flush().catch(() => {}).finally(() => {
        this._flushTimer = null;
      });
    }, this.FLUSH_DELAY_MS);
  }

  static async flush() {
    if (!this._state) return;
    const payload = this._state;

    // Attach integrity checksum (best-effort)
    try {
      const integrity = await this._computeSha256(JSON.stringify(payload));
      payload.integrity = integrity;
    } catch (_) {
      payload.integrity = this._simpleHash(JSON.stringify(payload));
    }

    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(payload));
      // Maintain backup key for resilience
      localStorage.setItem(this.BACKUP_KEY, JSON.stringify(payload));
    } catch (err) {
      // Quota or other write issues: trim events and retry best-effort
      try {
        const targetLen = Math.max(0, Math.floor(payload.events.length * 0.5));
        payload.events.splice(0, payload.events.length - targetLen);
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(payload));
      } catch (_) {
        // Fall back to saving counts only
        const minimal = { ...payload, events: [] };
        try { localStorage.setItem(this.STORAGE_KEY, JSON.stringify(minimal)); } catch (_) {}
      }
    }
  }

  /** Synchronous flush used on beforeunload; no integrity to avoid async */
  static flushSync() {
    if (!this._state) return;
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this._state));
      localStorage.setItem(this.BACKUP_KEY, JSON.stringify(this._state));
    } catch (_) {
      // Ignore sync failures
    }
  }

  static _loadFromStorage() {
    let raw = null;
    try {
      raw = localStorage.getItem(this.STORAGE_KEY) || localStorage.getItem(this.BACKUP_KEY);
    } catch (_) {}

    let state = null;
    if (raw) {
      try {
        state = JSON.parse(raw);
        if (!this._validateState(state)) {
          state = this._createEmptyState();
        } else {
          // Validate timestamps on existing events
          state.events = Array.isArray(state.events) ? state.events.filter((ev) => this._validateEvent(ev)) : [];
          state.counts = state.counts && typeof state.counts === "object" ? state.counts : {};
          state.version = typeof state.version === "number" ? state.version : 1;
          state.revision = typeof state.revision === "number" ? state.revision : 0;
          state.lastUpdated = typeof state.lastUpdated === "string" && this._validateTimestampString(state.lastUpdated)
            ? state.lastUpdated
            : null;
          state.installId = state.installId || this._getOrCreateInstallId();
        }
      } catch (_) {
        state = this._createEmptyState();
      }
    } else {
      state = this._createEmptyState();
    }
    return state;
  }

  static _createEmptyState() {
    return {
      version: 1,
      installId: this._getOrCreateInstallId(),
      lastUpdated: null,
      revision: 0,
      counts: {},
      events: [],
      integrity: null,
    };
  }

  static _getOrCreateInstallId() {
    try {
      let id = localStorage.getItem(this.INSTALL_ID_KEY);
      if (!id) {
        id = `anon-${crypto.randomUUID()}`;
        localStorage.setItem(this.INSTALL_ID_KEY, id);
      }
      return id;
    } catch (_) {
      // Environments without localStorage
      return `anon-${Math.random().toString(36).slice(2)}`;
    }
  }

  static _validateState(s) {
    return !!(s && typeof s === "object" && typeof s.version === "number" && s.counts && s.events);
  }

  static _validateEvent(ev) {
    if (!ev || typeof ev !== "object") return false;
    if (typeof ev.featureId !== "string" || typeof ev.action !== "string" || typeof ev.ts !== "string") return false;
    return this._validateTimestampString(ev.ts);
  }

  static _isValidTimestamp(dt) {
    return dt instanceof Date && !Number.isNaN(dt.getTime());
  }

  static _validateTimestampString(ts) {
    const dt = new Date(ts);
    if (Number.isNaN(dt.getTime())) return false;
    const now = Date.now();
    const t = dt.getTime();
    // Between 2000-01-01 and now + 7 days
    return t > 946684800000 && t < now + 7 * 24 * 60 * 60 * 1000;
  }

  static async _computeSha256(str) {
    const bytes = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  static _simpleHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (h << 5) - h + str.charCodeAt(i);
      h |= 0;
    }
    return (h >>> 0).toString(16);
  }
}

export { UsageTracker };