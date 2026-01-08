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

    this._log("Resolved URLs for", path, ":", urls);
    return urls.filter(Boolean);
  }

  // Preferred batch sender for 3-hourly flushes
  // Strategy: Try POST on each URL sequentially (stop on first success), fallback to GET if all POSTs fail
  static async sendBatch(batch = {}) {
    const urls = this._resolveUrls("/analytics/batch");
    const deviceId = String(batch.device_id || batch.deviceId || "");
    const headers = { "Content-Type": "application/json" };
    if (deviceId) headers["X-Device-Id"] = deviceId;

    this._log("sendBatch called, usage entries:", batch.device_usage?.length || 0, "events:", batch.events?.length || 0);

    // Step 1: Try POST requests sequentially (stop on first success to avoid duplicates)
    for (const url of urls) {
      try {
        this._log("Trying POST to:", url);
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(batch),
          credentials: "omit",
        });
        this._log("POST response:", url, "status:", res.status, "ok:", res.ok);
        if (res.ok) {
          this._log("sendBatch SUCCESS via POST to:", url);
          return true;
        }
      } catch (err) {
        this._log("POST failed:", url, "error:", err?.message || String(err));
        // Continue to next URL
      }
    }

    // Step 2: All POSTs failed - fallback to individual GET requests for device_usage
    if (!Array.isArray(batch.device_usage) || batch.device_usage.length === 0) {
      return false;
    }

    // Send GETs in small batches to avoid overwhelming the browser
    // Note: GETs also try URLs sequentially per usage entry
    const BATCH_SIZE = 5;
    const usages = batch.device_usage;
    let anySuccess = false;

    for (let i = 0; i < usages.length; i += BATCH_SIZE) {
      const chunk = usages.slice(i, i + BATCH_SIZE);

      for (const usage of chunk) {
        // Try each URL sequentially for this usage entry
        for (const baseUrl of urls) {
          try {
            const params = new URLSearchParams({
              device_id: String(usage.device_id || deviceId || ""),
              user_email: String(usage.user_email || batch.user_email || ""),
              tool_id: String(usage.tool_id || ""),
              action: String(usage.action || ""),
              count: String(usage.count || 0),
              updated_time: String(usage.updated_time || ""),
            });
            const url = `${baseUrl}?${params.toString()}`;
            const res = await fetch(url, { method: "GET", credentials: "omit" });
            if (res.ok) {
              anySuccess = true;
              break; // Success for this entry - move to next usage
            }
          } catch (_) {
            // Continue to next URL
          }
        }
      }

      // Small delay between batches to avoid overwhelming
      if (i + BATCH_SIZE < usages.length) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    return anySuccess;
  }

  // Live usage log sender (fire-and-forget)
  // Strategy: Try POST on each URL sequentially (stop on first success), fallback to GET if all POSTs fail
  static async sendLog(log = {}) {
    const urls = this._resolveUrls("/analytics/log");

    this._log("sendLog called, tool:", log.tool_id, "action:", log.action);

    // Step 1: Try POST requests sequentially (stop on first success to avoid duplicates)
    for (const url of urls) {
      try {
        this._log("Trying POST log to:", url);
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(log),
          credentials: "omit",
        });
        this._log("POST log response:", url, "status:", res.status, "ok:", res.ok);
        if (res.ok) {
          this._log("sendLog SUCCESS via POST to:", url);
          return true;
        }
      } catch (err) {
        this._log("POST log failed:", url, "error:", err?.message || String(err));
        // Continue to next URL
      }
    }

    // Step 2: All POSTs failed - fallback to GET (also sequential)
    const params = new URLSearchParams({
      user_email: String(log.user_email || ""),
      device_id: String(log.device_id || ""),
      tool_id: String(log.tool_id || ""),
      action: String(log.action || ""),
      created_time: String(log.created_time || ""),
    });

    for (const baseUrl of urls) {
      try {
        const url = `${baseUrl}?${params.toString()}`;
        const res = await fetch(url, { method: "GET", credentials: "omit" });
        if (res.ok) return true; // Success - stop here
      } catch (_) {
        // Continue to next URL
      }
    }

    return false; // All attempts failed
  }
}

export { AnalyticsSender };
