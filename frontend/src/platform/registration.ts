import { initializeLocalRegistrationDefaults, isUserRegistered } from "../../core/RegistrationState.js";

export function initializeDevelopmentRegistration(): void {
  if (import.meta.env.DEV && ["localhost", "127.0.0.1"].includes(location.hostname)) {
    initializeLocalRegistrationDefaults(localStorage, { registerDevelopmentIdentity: true });
  }
}

export function hasRegistration(): boolean {
  const localDevelopment = import.meta.env.DEV && ["localhost", "127.0.0.1"].includes(location.hostname);
  return isUserRegistered(localStorage, { allowDevelopmentIdentity: localDevelopment });
}
