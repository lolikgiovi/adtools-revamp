import { SessionTokenStore } from "./SessionTokenStore.js";

const DEFAULT_WORKER_BASE = "https://adtools.lolik.workers.dev";

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
    urls.push(`${DEFAULT_WORKER_BASE}${normalizedPath}`);
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

  static getRegisteredIdentity({ deviceId = "" } = {}) {
    try {
      if (localStorage.getItem("user.registered") !== "true") return null;
      const email = normalizeIdentityEmail(localStorage.getItem("user.email"));
      if (!email) return null;
      return { email, deviceId: String(deviceId || "").trim() };
    } catch (_) {
      return null;
    }
  }

  static async fetchPublicOverview({ email = "" } = {}) {
    const normalizedEmail = normalizeIdentityEmail(email);
    if (!normalizedEmail) throw new Error("A registered email is required to sync analytics.");

    const payload = await this._request("/analytics/public-overview", {
      method: "POST",
      cache: "no-store",
      body: JSON.stringify({ email: normalizedEmail }),
      includeAuth: false,
    });
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

  static async submitPublicImprovement({ email = "", deviceId = "", toolId = "", message = "" } = {}) {
    const normalizedEmail = normalizeIdentityEmail(email);
    if (!normalizedEmail) throw new Error("A registered email is required to send feedback.");

    return this._request("/feedback/public-improvement", {
      method: "POST",
      body: JSON.stringify({
        email: normalizedEmail,
        device_id:
          String(deviceId || "public-browser")
            .trim()
            .slice(0, 120) || "public-browser",
        tool_id: String(toolId || "").trim(),
        message: String(message || "").trim(),
      }),
      includeAuth: false,
    });
  }

  static async _request(path, options = {}) {
    const { includeAuth = true, ...requestOptions } = options;
    const headers = {
      Accept: "application/json",
      ...(includeAuth ? SessionTokenStore.getAuthHeader() : {}),
    };
    if (requestOptions.body !== undefined) headers["Content-Type"] = "application/json";

    let lastError = null;
    for (const url of this._resolveUrls(path)) {
      try {
        const response = await fetch(url, {
          ...requestOptions,
          headers: { ...headers, ...(requestOptions.headers || {}) },
          credentials: "omit",
        });
        const payload = await response.json().catch(() => ({}));
        if (response.ok && payload?.ok !== false) return payload;
        if (response.status === 404) {
          lastError = new Error(payload?.error || "Analytics endpoint not found");
          continue;
        }
        if (response.status === 401 && includeAuth) {
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

function normalizeIdentityEmail(value) {
  const email = String(value || "")
    .trim()
    .toLowerCase();
  return email === "dev@localhost" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

export { UsageOverviewService };
