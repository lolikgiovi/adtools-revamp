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

  // Preferred batch sender for hourly flushes (sends both POST and GET simultaneously)
  static async sendBatch(batch = {}) {
    const urls = this._resolveUrls('/analytics/batch');
    const deviceId = String(batch.device_id || batch.deviceId || '');
    const headers = { 'Content-Type': 'application/json' };
    if (deviceId) headers['X-Device-Id'] = deviceId;
    
    const promises = [];
    
    // Send POST requests
    for (const url of urls) {
      promises.push(
        fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(batch),
          credentials: 'omit',
        }).catch(() => null)
      );
    }
    
    // Send GET requests for device_usage entries
    if (Array.isArray(batch.device_usage) && batch.device_usage.length > 0) {
      for (const usage of batch.device_usage) {
        for (const baseUrl of urls) {
          const params = new URLSearchParams({
            device_id: String(usage.device_id || deviceId || ''),
            user_email: String(usage.user_email || batch.user_email || ''),
            tool_id: String(usage.tool_id || ''),
            action: String(usage.action || ''),
            count: String(usage.count || 0),
            updated_time: String(usage.updated_time || ''),
          });
          const url = `${baseUrl}?${params.toString()}`;
          promises.push(
            fetch(url, {
              method: 'GET',
              credentials: 'omit',
            }).catch(() => null)
          );
        }
      }
    }
    
    // Wait for all requests to complete
    const results = await Promise.allSettled(promises);
    
    // Return true if at least one request succeeded
    return results.some(r => r.status === 'fulfilled' && r.value?.ok);
  }

  // Live usage log sender (fire-and-forget, sends both POST and GET simultaneously)
  static async sendLog(log = {}) {
    const urls = this._resolveUrls('/analytics/log');
    const promises = [];
    
    // Send POST requests
    for (const url of urls) {
      promises.push(
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(log),
          credentials: 'omit',
        }).catch(() => null)
      );
    }
    
    // Send GET requests
    for (const baseUrl of urls) {
      const params = new URLSearchParams({
        user_email: String(log.user_email || ''),
        device_id: String(log.device_id || ''),
        tool_id: String(log.tool_id || ''),
        action: String(log.action || ''),
        created_time: String(log.created_time || ''),
      });
      const url = `${baseUrl}?${params.toString()}`;
      promises.push(
        fetch(url, {
          method: 'GET',
          credentials: 'omit',
        }).catch(() => null)
      );
    }
    
    // Wait for all requests to complete
    const results = await Promise.allSettled(promises);
    
    // Return true if at least one request succeeded
    return results.some(r => r.status === 'fulfilled' && r.value?.ok);
  }
}

export { AnalyticsSender };