// Lightweight session token store for OTP-verified KV access
// Persists a short-lived token issued by /register/verify and reuses it
// across modules to avoid repeat OTP prompts while still valid.

const TOKEN_KEY = "adtools.sessionToken";
const TOKEN_TS_KEY = "adtools.sessionTokenTs"; // milliseconds since epoch

export const SessionTokenStore = {
  getToken() {
    try {
      const t = localStorage.getItem(TOKEN_KEY) || "";
      return t || null;
    } catch (_) {
      return null;
    }
  },

  getIssuedAt() {
    try {
      const ts = Number(localStorage.getItem(TOKEN_TS_KEY) || 0);
      return Number.isFinite(ts) && ts > 0 ? ts : null;
    } catch (_) {
      return null;
    }
  },

  saveToken(token) {
    if (!token) return;
    try {
      localStorage.setItem(TOKEN_KEY, String(token));
      localStorage.setItem(TOKEN_TS_KEY, String(Date.now()));
    } catch (_) {}
  },

  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(TOKEN_TS_KEY);
    } catch (_) {}
  },

  getAuthHeader() {
    const token = this.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  },
};