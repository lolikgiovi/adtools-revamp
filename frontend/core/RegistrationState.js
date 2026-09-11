export const DEVELOPMENT_REGISTRATION_EMAIL = "dev@localhost";
const REGISTERED_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isUserRegistered(storage = globalThis.localStorage, { allowDevelopmentIdentity = false } = {}) {
  try {
    const registered = storage.getItem("user.registered") === "true";
    const email = String(storage.getItem("user.email") || "")
      .trim()
      .toLowerCase();
    if (!registered) return false;
    if (email === DEVELOPMENT_REGISTRATION_EMAIL) return allowDevelopmentIdentity;
    return REGISTERED_EMAIL_PATTERN.test(email);
  } catch (_) {
    return false;
  }
}

export function initializeLocalRegistrationDefaults(storage = globalThis.localStorage, { registerDevelopmentIdentity = false } = {}) {
  try {
    if (!storage.getItem("user.username")) storage.setItem("user.username", "Dev User");
    if (!storage.getItem("user.email")) storage.setItem("user.email", DEVELOPMENT_REGISTRATION_EMAIL);

    const email = String(storage.getItem("user.email") || "")
      .trim()
      .toLowerCase();
    if (email === DEVELOPMENT_REGISTRATION_EMAIL) {
      storage.setItem("user.registered", registerDevelopmentIdentity ? "true" : "false");
    }
  } catch (_) {}
}
