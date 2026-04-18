import { AnalyticsSender } from "./AnalyticsSender.js";
import { UsageTracker } from "./UsageTracker.js";
import { getRuntime } from "./Runtime.js";

class ErrorMonitor {
  static _initialized = false;
  static _options = {};
  static _recent = new Map();
  static _dedupeTtlMs = 30 * 1000;

  static init(options = {}) {
    if (this._initialized || typeof window === "undefined") return;
    this._initialized = true;
    this._options = options || {};

    window.addEventListener("error", (event) => this.captureWindowError(event), true);
    window.addEventListener("unhandledrejection", (event) => this.captureUnhandledRejection(event));
  }

  static captureWindowError(event) {
    try {
      const target = event?.target;
      const isResourceError = target && target !== window && (target.src || target.href);
      const payload = isResourceError ? this._fromResourceError(event) : this._fromErrorEvent(event);
      this._send(payload);
    } catch (_) {}
  }

  static captureUnhandledRejection(event) {
    try {
      this._send(this._fromRejection(event));
    } catch (_) {}
  }

  static capture(error, metadata = {}) {
    try {
      this._send(
        this._basePayload({
          error_kind: "captured_error",
          error: error instanceof Error ? error : null,
          message: error?.message || String(error || "Unknown error"),
          metadata,
        })
      );
    } catch (_) {}
  }

  static wrapAsync(context, fn) {
    return async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        this.capture(error, { process_area: context });
        throw error;
      }
    };
  }

  static bindWorker(worker, metadata = {}) {
    if (!worker || typeof worker.addEventListener !== "function") return;
    worker.addEventListener("error", (event) => {
      this.capture(event?.error || event?.message || "Worker error", { ...metadata, process_area: metadata.process_area || "worker" });
    });
  }

  static _fromErrorEvent(event) {
    return this._basePayload({
      error_kind: "uncaught_error",
      error: event?.error || null,
      message: event?.message || event?.error?.message || "Uncaught error",
      source: event?.filename || null,
      lineno: event?.lineno || null,
      colno: event?.colno || null,
    });
  }

  static _fromRejection(event) {
    const reason = event?.reason;
    return this._basePayload({
      error_kind: "unhandled_rejection",
      error: reason instanceof Error ? reason : null,
      message: reason?.message || String(reason || "Unhandled promise rejection"),
      metadata: reason && !(reason instanceof Error) ? { reason_type: typeof reason } : {},
    });
  }

  static _fromResourceError(event) {
    const target = event?.target || {};
    return this._basePayload({
      error_kind: "resource_error",
      message: `Failed to load ${String(target.tagName || "resource").toLowerCase()}`,
      source: target.src || target.href || null,
      metadata: {
        tag: String(target.tagName || "").toLowerCase(),
      },
    });
  }

  static _basePayload({ error_kind, error, message, source, lineno, colno, metadata = {} }) {
    const route = this._getRoute();
    const toolId = this._getToolId(route);
    const processArea = metadata.process_area || (toolId ? "tool" : "shell");
    const enriched = error ? UsageTracker.enrichErrorMeta(error, {}) : {};

    return {
      user_email: this._getUserEmail(),
      device_id: UsageTracker.getDeviceId(),
      runtime: getRuntime(),
      app_version: this._getAppVersion(),
      route,
      tool_id: toolId,
      process_area: processArea,
      error_kind,
      error_name: enriched.name || error?.name || "Error",
      message: message || enriched.message || "Unknown error",
      stack: enriched.stack || null,
      source: this._safeSource(source),
      lineno: Number.isFinite(Number(lineno)) ? Number(lineno) : null,
      colno: Number.isFinite(Number(colno)) ? Number(colno) : null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent || "" : "",
      metadata: UsageTracker.sanitizeErrorMeta(metadata),
      created_time: new Date().toISOString(),
    };
  }

  static _send(payload) {
    if (!payload || this._isDuplicate(payload)) return;
    AnalyticsSender.sendError(this._sanitizePayload(payload)).catch(() => {});
  }

  static _sanitizePayload(payload) {
    const meta = UsageTracker.sanitizeErrorMeta(payload.metadata || {});
    return {
      ...payload,
      user_email: this._clip(payload.user_email, 160),
      device_id: this._clip(payload.device_id, 120),
      runtime: this._clip(payload.runtime, 40),
      app_version: this._clip(payload.app_version, 60),
      route: this._clip(payload.route, 160),
      tool_id: UsageTracker.normalizeFeatureId(this._clip(payload.tool_id, 80)),
      process_area: this._clip(payload.process_area, 80),
      error_kind: this._clip(payload.error_kind, 80),
      error_name: this._clip(payload.error_name, 120),
      message: UsageTracker._sanitizeString(payload.message, UsageTracker.ERROR_MESSAGE_LIMIT),
      stack: payload.stack ? UsageTracker._sanitizeString(payload.stack, UsageTracker.ERROR_STACK_LIMIT) : null,
      source: this._safeSource(payload.source),
      user_agent: this._clip(payload.user_agent, 300),
      metadata: meta,
    };
  }

  static _isDuplicate(payload) {
    const key = [payload.error_kind, payload.message, payload.source, payload.lineno, payload.colno].map((v) => String(v || "")).join("|");
    const now = Date.now();
    const last = this._recent.get(key);
    if (last && now - last < this._dedupeTtlMs) return true;
    this._recent.set(key, now);
    if (this._recent.size > 50) {
      const cutoff = now - this._dedupeTtlMs;
      for (const [k, ts] of this._recent.entries()) {
        if (ts < cutoff) this._recent.delete(k);
      }
    }
    return false;
  }

  static _getRoute() {
    try {
      const hash = window.location.hash || "";
      return hash ? hash.slice(0, 160) : "#home";
    } catch (_) {
      return "#unknown";
    }
  }

  static _getToolId(route) {
    try {
      const fromOption = this._options.getCurrentTool?.();
      const raw = typeof fromOption === "string" ? fromOption : fromOption?.id;
      if (raw) return UsageTracker.normalizeFeatureId(raw);
    } catch (_) {}
    try {
      const path = String(route || "").replace(/^#/, "").split(/[/?]/)[0];
      return UsageTracker.normalizeFeatureId(path || "");
    } catch (_) {
      return "";
    }
  }

  static _getUserEmail() {
    try {
      const email = localStorage.getItem("user.email");
      return email ? String(email).trim().toLowerCase() : null;
    } catch (_) {
      return null;
    }
  }

  static _getAppVersion() {
    try {
      return localStorage.getItem("app.version") || localStorage.getItem("adtools.appVersion") || null;
    } catch (_) {
      return null;
    }
  }

  static _safeSource(source) {
    if (!source) return null;
    try {
      const url = new URL(String(source), window.location.href);
      return `${url.origin}${url.pathname}`.slice(0, 500);
    } catch (_) {
      return String(source).split(/[?#]/)[0].slice(0, 500);
    }
  }

  static _clip(value, limit) {
    if (value === null || value === undefined) return null;
    return String(value).slice(0, limit);
  }
}

export { ErrorMonitor };
