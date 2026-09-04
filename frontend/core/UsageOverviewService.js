import { SessionTokenStore } from "./SessionTokenStore.js";

export const UsageOverviewErrorCode = Object.freeze({
  AUTH_REQUIRED: "AUTH_REQUIRED",
});

function createAuthError(message) {
  const error = new Error(message);
  error.code = UsageOverviewErrorCode.AUTH_REQUIRED;
  return error;
}

class UsageOverviewService {
  static _resolveUrls(path) {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const urls = [];

    try {
      const envBase = (import.meta?.env?.VITE_WORKER_BASE || "").replace(/\/$/, "");
      if (envBase) urls.push(`${envBase}${normalizedPath}`);
    } catch (_) {
      // Runtime environments without Vite import metadata use the other URL candidates.
    }

    try {
      const configBase = (localStorage.getItem("config.analytics.endpoint") || "").replace(/\/$/, "");
      if (configBase) urls.push(`${configBase}${normalizedPath}`);
    } catch (_) {
      // A missing local override is expected in a clean installation.
    }

    urls.push(normalizedPath);
    return Array.from(new Set(urls.filter(Boolean)));
  }

  static async fetchOverview() {
    if (!SessionTokenStore.getToken()) {
      throw createAuthError("Analytics session unavailable. Sign in again to sync your activity.");
    }
    const payload = await this._request("/analytics/overview", { method: "GET", cache: "no-store" });
    if (!payload?.user || !payload?.global) throw new Error("Analytics overview returned incomplete data.");
    return payload;
  }

  static async submitImprovement({ toolId = "", message = "" } = {}) {
    if (!SessionTokenStore.getToken()) {
      throw createAuthError("Sign in again before sending feedback.");
    }
    return this._request("/feedback/improvement", {
      method: "POST",
      body: JSON.stringify({ tool_id: String(toolId || "").trim(), message: String(message || "").trim() }),
    });
  }

  static async _request(path, options = {}) {
    const headers = {
      Accept: "application/json",
      ...SessionTokenStore.getAuthHeader(),
    };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";

    let lastError = null;
    for (const url of this._resolveUrls(path)) {
      try {
        const response = await fetch(url, {
          ...options,
          headers: { ...headers, ...(options.headers || {}) },
          credentials: "omit",
        });
        const payload = await response.json().catch(() => ({}));
        if (response.ok && payload?.ok !== false) return payload;
        if (response.status === 404) {
          lastError = new Error(payload?.error || "Analytics endpoint not found");
          continue;
        }
        if (response.status === 401) {
          SessionTokenStore.clear();
          throw createAuthError(payload?.error || "Analytics session expired. Sign in again to sync your activity.");
        }
        throw new Error(payload?.error || `Analytics request failed (${response.status})`);
      } catch (error) {
        if (error?.code === UsageOverviewErrorCode.AUTH_REQUIRED) throw error;
        lastError = error instanceof Error ? error : new Error(String(error || "Analytics request failed"));
      }
    }

    throw lastError || new Error("Analytics request failed");
  }
}

export { UsageOverviewService };
