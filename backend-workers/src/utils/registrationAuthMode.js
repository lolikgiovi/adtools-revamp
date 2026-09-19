export const REGISTRATION_AUTH_MODE_KEY = "config:registration-auth-mode";

export function normalizeRegistrationAuthMode(value) {
  const mode = String(value || "")
    .trim()
    .toLowerCase();
  return mode === "otp" || mode === "manual" ? mode : null;
}

export async function getRegistrationAuthMode(env) {
  try {
    const storedMode = normalizeRegistrationAuthMode(await env.adtools?.get(REGISTRATION_AUTH_MODE_KEY));
    if (storedMode) return storedMode;
  } catch (_) {
    // Fall back to the Worker variable when KV is unavailable.
  }
  return normalizeRegistrationAuthMode(env.REGISTRATION_AUTH_MODE) || "manual";
}
