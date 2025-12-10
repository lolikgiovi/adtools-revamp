import { AnalyticsSender } from './AnalyticsSender.js';
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
  static BATCH_FLUSH_INTERVAL_MS = 60 * 60 * 1000; // hourly remote flush (default)
  static BACKUP_ENABLED_KEY = "usage.analytics.backup.enabled";
  static _backupEnabled = true;
  static ENABLED_KEY = "usage.analytics.enabled";
  static _enabled = true;
  static _state = null;
  static _flushTimer = null;
  static _debounceTimers = new Map();
  static _eventBus = null;
  static _batchTimer = null;

  /** Initialize tracker (optional), sets event bus and attaches lifecycle hooks */
  static init(eventBus = null) {
    this._eventBus = eventBus || null;
    // Set sane defaults before reading storage (prevents backup fallback in dev)
    const isDev = !!(import.meta && import.meta.env && import.meta.env.DEV);
    this._backupEnabled = isDev ? false : true;
    this._enabled = true;
    // Respect persisted flags if present
    try {
      const be = localStorage.getItem(this.BACKUP_ENABLED_KEY);
      if (be === "false") this._backupEnabled = false;
      else if (be === "true") this._backupEnabled = true;
      const en = localStorage.getItem(this.ENABLED_KEY);
      if (en === "false") this._enabled = false;
    } catch (_) {}

    // Load after flags applied so fallback behaves correctly
    this._state = this._loadFromStorage();

    // Start periodic batch flush for remote analytics
    try {
      if (this._batchTimer) clearInterval(this._batchTimer);
      this._batchTimer = setInterval(() => {
        this._flushBatch().catch(() => {});
      }, this._getBatchIntervalMs());
    } catch (_) {}

    // Ensure flush on unload to prevent data loss
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", () => {
        try {
          this.flushSync();
        } catch (_) {}
      });

      // Opportunistic batch flush when tab is hidden or connection resumes
      try {
        document.addEventListener("visibilitychange", () => {
          if (document.hidden) {
            this._flushBatch().catch(() => {});
          }
        });
        window.addEventListener("online", () => {
          this._flushBatch().catch(() => {});
        });
      } catch (_) {}
    }
  }

  static _getBatchIntervalMs() {
    // Allow overrides via env or localStorage for quicker testing
    try {
      const envMs = Number(import.meta?.env?.VITE_USAGE_BATCH_INTERVAL_MS);
      if (Number.isFinite(envMs) && envMs > 0) return envMs;
    } catch (_) {}
    try {
      const ls = Number(localStorage.getItem('usage.analytics.batch.interval.ms'));
      if (Number.isFinite(ls) && ls > 0) return ls;
    } catch (_) {}
    return this.BATCH_FLUSH_INTERVAL_MS;
  }

  /** Track a usage event (simple: increment counts and daily, flush immediately) */
  static track(featureId, action, meta = {}) {
    if (!featureId || !action) return;
    if (!this._enabled) return;

    if (!this._state) this._state = this._loadFromStorage();

    const now = new Date();
    if (!this._isValidTimestamp(now)) return;

    const featureKey = String(featureId);
    const actionKey = String(action);

    const counts = this._state.counts;
    counts[featureKey] = counts[featureKey] || {};
    counts[featureKey][actionKey] = (counts[featureKey][actionKey] || 0) + 1;

    const day = now.toISOString().slice(0, 10);
    const k = `${featureKey}.${actionKey}`;
    this._state.daily = this._state.daily || {};
    this._state.daily[day] = this._state.daily[day] || {};
    this._state.daily[day][k] = (this._state.daily[day][k] || 0) + 1;

    this._state.lastUpdated = now.toISOString();
    this._state.revision = (this._state.revision || 0) + 1;

    this.flushSync();

    try {
      this._eventBus?.emit?.("usage:updated", { featureId: featureKey, action: actionKey, ts: this._state.lastUpdated });
    } catch (_) {}

  }

  /** Alias for feature-centric tracking */
  static trackFeature(featureId, action, meta = {}, debounceMs) {
    if (!featureId || !action) return;
    const ms = Number(debounceMs);
    if (Number.isFinite(ms) && ms > 0) {
      const key = `${String(featureId)}:${String(action)}`;
      const existing = this._debounceTimers.get(key);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        try {
          this.track(featureId, action, meta);
        } finally {
          this._debounceTimers.delete(key);
        }
      }, ms);
      this._debounceTimers.set(key, timer);
      return;
    }
    this.track(featureId, action, meta);

    // Send live usage log (if server has SEND_LIVE_USER_LOG enabled)
    try {
      let userEmail = null;
      try {
        const email = localStorage.getItem('user.email');
        const deviceId = localStorage.getItem('adtools.deviceId');
        userEmail = email ? String(email).trim().toLowerCase() : null;
      } catch (_) {}

      if (userEmail) {
        const now = new Date();
        AnalyticsSender.sendLog({
          user_email: userEmail,
          device_id: deviceId,
          tool_id: String(featureId),
          action: String(action),
          created_time: this._isoToGmt7Plain(now.toISOString()),
        }).catch(() => {}); // Fire and forget
      }
    } catch (_) {}
  }

  // Add explicit event-level tracking with event detail persistence
  static trackEvent(featureId, event, meta = {}, debounceMs) {
    const ms = Number(debounceMs);
    if (Number.isFinite(ms) && ms > 0) {
      const key = `${String(featureId)}:${String(event)}:ev`;
      const existing = this._debounceTimers.get(key);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        try {
          this._trackEventImmediate(featureId, event, meta);
        } finally {
          this._debounceTimers.delete(key);
        }
      }, ms);
      this._debounceTimers.set(key, timer);
      return;
    }
    return this._trackEventImmediate(featureId, event, meta);
  }

  static _trackEventImmediate(featureId, event, meta = {}) {
    if (!featureId || !event) return;
    if (!this._enabled) return;

    if (!this._state) this._state = this._loadFromStorage();

    const now = new Date();
    if (!this._isValidTimestamp(now)) return;

    const featureKey = String(featureId);
    const actionKey = String(event);

    const counts = this._state.counts;
    counts[featureKey] = counts[featureKey] || {};
    counts[featureKey][actionKey] = (counts[featureKey][actionKey] || 0) + 1;

    const day = now.toISOString().slice(0, 10);
    const k = `${featureKey}.${actionKey}`;
    this._state.daily = this._state.daily || {};
    this._state.daily[day] = this._state.daily[day] || {};
    this._state.daily[day][k] = (this._state.daily[day][k] || 0) + 1;

    const ev = {
      featureId: featureKey,
      action: actionKey,
      ts: now.toISOString(),
      meta: this._sanitizeMeta(meta),
    };
    this._state.events = Array.isArray(this._state.events) ? this._state.events : [];
    this._state.events.push(ev);
    if (this._state.events.length > this.MAX_EVENTS) {
      this._state.events = this._state.events.slice(this._state.events.length - this.MAX_EVENTS);
    }

    this._state.lastUpdated = ev.ts;
    this._state.revision = (this._state.revision || 0) + 1;

    this.flushSync();

    try {
      this._eventBus?.emit?.("usage:updated", ev);
    } catch (_) {}
  }

  /** Return deep-copied aggregated counts */
  static getCounts() {
    const counts = this._state?.counts || {};
    return JSON.parse(JSON.stringify(counts));
  }

  /** Return recent events (not used in simple tracker) */
  static getEvents(limit = 100) {
    const arr = Array.isArray(this._state?.events) ? this._state.events.slice(-limit) : [];
    return JSON.parse(JSON.stringify(arr));
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

    // Use simple daily counters maintained in state
    const daily = this._state?.daily || {};

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
      this.flush()
        .catch(() => {})
        .finally(() => {
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
      if (this._backupEnabled) {
        localStorage.setItem(this.BACKUP_KEY, JSON.stringify(payload));
      }
    } catch (err) {
      // Quota or other write issues: trim events and retry best-effort
      try {
        const targetLen = Math.max(0, Math.floor(payload.events.length * 0.5));
        payload.events.splice(0, payload.events.length - targetLen);
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(payload));
      } catch (_) {
        // Fall back to saving counts only
        const minimal = { ...payload, events: [] };
        try {
          localStorage.setItem(this.STORAGE_KEY, JSON.stringify(minimal));
        } catch (_) {}
      }
    }
  }

  /** Synchronous flush used on beforeunload; no integrity to avoid async */
  static flushSync() {
    if (!this._state) return;
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this._state));
      if (this._backupEnabled) {
        localStorage.setItem(this.BACKUP_KEY, JSON.stringify(this._state));
      }
    } catch (_) {
      // Ignore sync failures
    }
  }

  static _loadFromStorage() {
    let raw = null;
    try {
      raw = localStorage.getItem(this.STORAGE_KEY) || (this._backupEnabled ? localStorage.getItem(this.BACKUP_KEY) : null);
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
          if (state.events.length > this.MAX_EVENTS) {
            state.events = state.events.slice(state.events.length - this.MAX_EVENTS);
          }
          state.counts = state.counts && typeof state.counts === "object" ? state.counts : {};
          state.daily = state.daily && typeof state.daily === "object" ? state.daily : {};
          state.version = typeof state.version === "number" ? state.version : 1;
          state.revision = typeof state.revision === "number" ? state.revision : 0;
          state.lastUpdated =
            typeof state.lastUpdated === "string" && this._validateTimestampString(state.lastUpdated) ? state.lastUpdated : null;
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
      deviceId: this._getOrCreateDeviceId(),
      lastUpdated: null,
      revision: 0,
      counts: {},
      events: [],
      daily: {},
      integrity: null,
    };
  }

  // Convert ISO string to plain "YYYY-MM-DD HH:MM:SS" in GMT+7
  static _isoToGmt7Plain(iso) {
    try {
      const d = iso ? new Date(iso) : new Date();
      const shifted = new Date(d.getTime() + 7 * 60 * 60 * 1000);
      const Y = shifted.getUTCFullYear();
      const M = String(shifted.getUTCMonth() + 1).padStart(2, '0');
      const D = String(shifted.getUTCDate()).padStart(2, '0');
      const h = String(shifted.getUTCHours()).padStart(2, '0');
      const m = String(shifted.getUTCMinutes()).padStart(2, '0');
      const s = String(shifted.getUTCSeconds()).padStart(2, '0');
      return `${Y}-${M}-${D} ${h}:${m}:${s}`;
    } catch (_) {
      const d = new Date();
      const shifted = new Date(d.getTime() + 7 * 60 * 60 * 1000);
      const Y = shifted.getUTCFullYear();
      const M = String(shifted.getUTCMonth() + 1).padStart(2, '0');
      const D = String(shifted.getUTCDate()).padStart(2, '0');
      const h = String(shifted.getUTCHours()).padStart(2, '0');
      const m = String(shifted.getUTCMinutes()).padStart(2, '0');
      const s = String(shifted.getUTCSeconds()).padStart(2, '0');
      return `${Y}-${M}-${D} ${h}:${m}:${s}`;
    }
  }

  static _nowGmt7Plain() {
    return this._isoToGmt7Plain(new Date().toISOString());
  }

  // Build batch payload with absolute counts from state.counts (idempotent)
  static _toBatchPayload() {
    const s = this._state || this._createEmptyState();
    const deviceId = s.deviceId || this.getDeviceId();

    // Get user email from localStorage
    let userEmail = null;
    try {
      const email = localStorage.getItem('user.email');
      userEmail = email ? String(email).trim().toLowerCase() : null;
    } catch (_) {}

    const events = (Array.isArray(s.events) ? s.events : []).map(ev => ({
      type: ev.featureId,
      action: ev.action,
      event_name: `${ev.featureId}.${ev.action}`,
      device_id: deviceId,
      properties: ev.meta || {},
      created_time: this._isoToGmt7Plain(ev.ts || new Date().toISOString()),
    }));

    // Build device_usage from absolute counts in state.counts
    const device_usage = [];
    const nowPlain = this._nowGmt7Plain();
    const counts = s.counts || {};
    
    for (const [tool_id, actions] of Object.entries(counts)) {
      if (!actions || typeof actions !== 'object') continue;
      for (const [action, count] of Object.entries(actions)) {
        const c = Number(count || 0);
        if (c > 0) {
          device_usage.push({
            device_id: deviceId,
            user_email: userEmail,
            tool_id: String(tool_id),
            action: String(action),
            count: c,
            updated_time: nowPlain,
          });
        }
      }
    }

    return { device_id: deviceId, user_email: userEmail, events, device_usage };
  }

  // Send batch to backend (idempotent - sends absolute counts)
  static async _flushBatch() {
    if (!this._enabled) return;
    try {
      const payload = this._toBatchPayload();
      if ((payload.events && payload.events.length) || (payload.device_usage && payload.device_usage.length)) {
        await AnalyticsSender.sendBatch(payload);
        // After successful send, clear events (counts remain for next sync)
        this._state.events = [];
        // Persist local storage changes immediately
        this.flushSync();
      }
    } catch (_) {
      // Swallow errors; will retry on next interval
    }
  }

  static _getOrCreateDeviceId() {
    try {
      const keyNew = 'adtools.deviceId';
      const keyOld = 'adtools.installId';
      const existingNew = (typeof localStorage !== 'undefined') ? localStorage.getItem(keyNew) : null;
      let id = existingNew;
      if (!id) {
        const existingOld = (typeof localStorage !== 'undefined') ? localStorage.getItem(keyOld) : null;
        id = existingOld || ((typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Math.random()}`);
        if (id && typeof id === 'string' && id.startsWith('anon-')) {
          const suffix = id.slice(5);
          id = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(suffix)
            ? suffix
            : ((typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Math.random()}`);
        }
      }
      if (typeof localStorage !== 'undefined') localStorage.setItem(keyNew, id);
      return id;
    } catch (_) {
      return (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Math.random()}`;
    }
  }

  static getDeviceId() {
    if (this._state?.deviceId) return this._state.deviceId;
    try {
      return localStorage.getItem('adtools.deviceId') || this._getOrCreateDeviceId();
    } catch (_) {
      return this._getOrCreateDeviceId();
    }
  }

  static _getOrCreateInstallId() {
    try {
      const key = 'adtools.installId';
      const existing = (typeof localStorage !== 'undefined') ? localStorage.getItem(key) : null;
      let id = existing;
      if (!id) {
        id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Math.random()}`;
      } else if (id && typeof id === 'string' && id.startsWith('anon-')) {
        const suffix = id.slice(5);
        id = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(suffix)
          ? suffix
          : ((typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Math.random()}`);
      }
      if (typeof localStorage !== 'undefined') localStorage.setItem(key, id);
      return id;
    } catch (_) {
      return (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Math.random()}`;
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
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  static _simpleHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (h << 5) - h + str.charCodeAt(i);
      h |= 0;
    }
    return (h >>> 0).toString(16);
  }

  /** Enable/disable backup writes and fallback */
  static setBackupEnabled(enabled) {
    this._backupEnabled = !!enabled;
    try {
      localStorage.setItem(this.BACKUP_ENABLED_KEY, this._backupEnabled ? "true" : "false");
    } catch (_) {}
  }

  /** Clear stored analytics keys (primary and backup) */
  static clearStorage() {
    try {
      localStorage.removeItem(this.STORAGE_KEY);
      localStorage.removeItem(this.BACKUP_KEY);
    } catch (_) {}
  }

  /** Enable/disable analytics events and persistence */
  static setEnabled(enabled) {
    this._enabled = !!enabled;
    try {
      localStorage.setItem(this.ENABLED_KEY, this._enabled ? "true" : "false");
    } catch (_) {}
  }

  /** Dev convenience: force reset analytics and disable backup */
  static resetDev() {
    try {
      this.setBackupEnabled(false);
      this.clearStorage();
      this._state = null;
    } catch (_) {}
  }
  static getInstallId() {
    // Legacy alias
    return this.getDeviceId();
  }
}

export { UsageTracker };
