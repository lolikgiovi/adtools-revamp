class AnalyticsSender {
  static _debug = null;

  static _isDebugEnabled() {
    if (this._debug === null) {
      try {
        this._debug = localStorage.getItem("analytics.debug") === "true";
      } catch (_) {
        this._debug = false;
      }
    }
    return this._debug;
  }

  static _log(...args) {
    if (this._isDebugEnabled()) {
      console.log("[AnalyticsSender]", ...args);
    }
  }

  static _resolveUrls(path) {
    const p = path.startsWith("/") ? path : `/${path}`;
    const urls = [];

    // 1. Try VITE_WORKER_BASE first (most reliable for production)
    try {
      const envBase = (import.meta?.env?.VITE_WORKER_BASE || "").replace(/\/$/, "");
      if (envBase) {
        urls.push(`${envBase}${p}`);
        this._log("Added env base URL:", `${envBase}${p}`);
      }
    } catch (_) {}

    // 2. Try localStorage config (user override)
    try {
      const cfgBase = (localStorage.getItem("config.analytics.endpoint") || "").replace(/\/$/, "");
      if (cfgBase) {
        urls.push(`${cfgBase}${p}`);
        this._log("Added config URL:", `${cfgBase}${p}`);
      }
    } catch (_) {}

    // 3. Same-origin fallback (works in Vite dev with proxy, but NOT in Tauri production)
    urls.push(p);
    this._log("Added same-origin URL:", p);

    const unique = Array.from(new Set(urls.filter(Boolean)));
    this._log("Resolved URLs for", path, ":", unique);
    return unique;
  }

  static async _postJson(path, payload = {}, extraHeaders = {}) {
    const urls = this._resolveUrls(path);
    const headers = { "Content-Type": "application/json" };
    Object.entries(extraHeaders || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value)) headers[key] = String(value);
    });

    for (const url of urls) {
      try {
        this._log("Trying POST to:", url);
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          credentials: "omit",
        });
        this._log("POST response:", url, "status:", res.status, "ok:", res.ok);
        if (res.ok) {
          this._log("POST success:", url);
          return true;
        }
      } catch (err) {
        this._log("POST failed:", url, "error:", err?.message || String(err));
      }
    }

    return false;
  }

  // Preferred batch sender for 3-hourly flushes. POST only.
  static async sendBatch(batch = {}) {
    const deviceId = String(batch.device_id || batch.deviceId || "");
    this._log("sendBatch called, usage entries:", batch.device_usage?.length || 0, "events:", batch.events?.length || 0);
    return this._postJson("/analytics/batch", batch, deviceId ? { "X-Device-Id": deviceId } : {});
  }

  // Live usage log sender (fire-and-forget). POST only.
  static async sendLog(log = {}) {
    this._log("sendLog called, tool:", log.tool_id, "action:", log.action);
    return this._postJson("/analytics/log", log);
  }

  // Immediate uncaught error sender. POST only; no local retry queue.
  static async sendError(errorPayload = {}) {
    this._log("sendError called, kind:", errorPayload.error_kind, "name:", errorPayload.error_name);
    return this._postJson("/analytics/error", errorPayload);
  }
}

export { AnalyticsSender };
