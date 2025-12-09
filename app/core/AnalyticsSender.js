class AnalyticsSender {
  static _resolveUrls(path) {
    const p = path.startsWith('/') ? path : `/${path}`;
    const urls = [p]; // same-origin first
    try {
      const envBase = (import.meta?.env?.VITE_WORKER_BASE || '').replace(/\/$/, '');
      if (envBase) urls.push(`${envBase}${p}`);
    } catch (_) {}
    try {
      const cfgBase = (localStorage.getItem('config.analytics.endpoint') || '').replace(/\/$/, '');
      if (cfgBase) urls.push(`${cfgBase}${p}`);
    } catch (_) {}
    return urls.filter(Boolean);
  }

  // Legacy single-event send (kept for compatibility; batch is preferred)
  static async send(event = {}) {
    const payload = {
      ...event,
      ts: event.ts || new Date().toISOString(),
    };
    const urls = this._resolveUrls('/analytics');
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          credentials: 'omit',
        });
        if (res.ok) return true; // stop after first success
      } catch (_) {
        // try next candidate
      }
    }
    return false;
  }

  // Preferred batch sender for hourly flushes
  static async sendBatch(batch = {}) {
    const urls = this._resolveUrls('/analytics/batch');
    const deviceId = String(batch.device_id || batch.deviceId || '');
    const headers = { 'Content-Type': 'application/json' };
    if (deviceId) headers['X-Device-Id'] = deviceId;
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(batch),
          credentials: 'omit',
        });
        if (res.ok) return true;
      } catch (_) {
        // try next candidate
      }
    }
    return false;
  }

  // Live usage log sender (fire-and-forget)
  static async sendLog(log = {}) {
    const urls = this._resolveUrls('/analytics/log');
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(log),
          credentials: 'omit',
        });
        if (res.ok) return true;
      } catch (_) {
        // try next candidate
      }
    }
    return false;
  }
}

export { AnalyticsSender };