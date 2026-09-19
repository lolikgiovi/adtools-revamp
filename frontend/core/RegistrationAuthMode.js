export const REGISTRATION_AUTH_MODE = Object.freeze({
  MANUAL: "manual",
  OTP: "otp",
});

function normalizeMode(value) {
  return value === REGISTRATION_AUTH_MODE.OTP ? REGISTRATION_AUTH_MODE.OTP : REGISTRATION_AUTH_MODE.MANUAL;
}

export async function fetchRegistrationAuthMode() {
  const base = (import.meta?.env?.VITE_WORKER_BASE || "").trim().replace(/\/$/, "");
  const endpoints = [base ? `${base}/register/auth-mode` : "", "/register/auth-mode"].filter(Boolean);

  for (const endpoint of [...new Set(endpoints)]) {
    try {
      const response = await fetch(endpoint, { headers: { Accept: "application/json" }, credentials: "omit", cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data?.ok) return normalizeMode(data.mode);
    } catch (_) {
      // Try the next endpoint before falling back to manual approval.
    }
  }

  return REGISTRATION_AUTH_MODE.MANUAL;
}
