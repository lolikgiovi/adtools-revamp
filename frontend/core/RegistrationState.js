export const DEVELOPMENT_REGISTRATION_EMAIL = "dev@localhost";

export function isUserRegistered(storage = globalThis.localStorage) {
  try {
    const registered = storage.getItem("user.registered") === "true";
    const email = String(storage.getItem("user.email") || "")
      .trim()
      .toLowerCase();
    return registered && email !== DEVELOPMENT_REGISTRATION_EMAIL;
  } catch (_) {
    return false;
  }
}

export function initializeLocalRegistrationDefaults(storage = globalThis.localStorage) {
  try {
    if (!storage.getItem("user.username")) storage.setItem("user.username", "Dev User");
    if (!storage.getItem("user.email")) storage.setItem("user.email", DEVELOPMENT_REGISTRATION_EMAIL);

    const email = String(storage.getItem("user.email") || "")
      .trim()
      .toLowerCase();
    if (email === DEVELOPMENT_REGISTRATION_EMAIL) storage.setItem("user.registered", "false");
  } catch (_) {}
}
