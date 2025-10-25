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

  static async send(event = {}) {
    const payload = {
      ...event,
      ts: event.ts || new Date().toISOString(),
    };
    const urls = this._resolveUrls('/analytics');
    for (const url of urls) {
      try {
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          credentials: 'omit',
        });
        return true; // stop after first success
      } catch (_) {
        // try next candidate
      }
    }
    return false;
  }
}

export { AnalyticsSender };