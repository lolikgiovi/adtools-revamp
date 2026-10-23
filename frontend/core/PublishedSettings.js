import { validateSettings } from "../../shared/published-settings.js";
import { writeEnvironments } from "./Environments.js";
import { saveKafkaBrokerProfiles } from "../tools/kafka/service.js";
import { SessionTokenStore } from "./SessionTokenStore.js";

export const SETTINGS_API_BASE = String(
  import.meta.env.VITE_WORKER_BASE || (import.meta.env.DEV ? "http://localhost:8787" : "https://adtools.lolik.workers.dev"),
).replace(/\/$/, "");
const CREDENTIAL_KEY = "settings.sync.credential";
const stateKey = (userId) => `settings.sync.state:${userId}`;
const appliedKey = (userId, id) => `settings.sync.applied:${userId}:${id}`;
const journalKey = "settings.sync.journal";
function read(key, fallback = null) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
function restore(values) {
  for (const [key, value] of Object.entries(values)) {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  }
}

export function applyPublication(publication, userId) {
  if (!userId || !Number.isSafeInteger(publication?.id) || publication.id < 1) throw new Error("Invalid publication.");
  validateSettings(publication.settings);
  const marker = appliedKey(userId, publication.id);
  const interrupted = read(journalKey);
  if (interrupted) {
    if (!localStorage.getItem(interrupted.marker)) restore(interrupted.values);
    localStorage.removeItem(journalKey);
  }
  if (localStorage.getItem(marker)) return false;
  const keys = new Set([...Object.keys(publication.settings), marker]);
  if (keys.has("config.environments")) keys.add("config.baseUrls");
  if (keys.has("tool:kafka:brokers")) keys.add("tool:kafka:active-broker");
  const values = Object.fromEntries([...keys].map((key) => [key, localStorage.getItem(key)]));
  localStorage.setItem(journalKey, JSON.stringify({ marker, values }));
  try {
    for (const [key, value] of Object.entries(publication.settings)) {
      if (key === "config.environments") writeEnvironments(value);
      else if (key === "tool:kafka:brokers") saveKafkaBrokerProfiles(value);
      else localStorage.setItem(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    }
    localStorage.setItem(marker, "1");
    localStorage.removeItem(journalKey);
  } catch (error) {
    restore(values);
    localStorage.removeItem(journalKey);
    throw error;
  }
  globalThis.dispatchEvent?.(new Event("adtools:connection-settings-changed"));
  globalThis.dispatchEvent?.(new CustomEvent("adtools:settings-published", { detail: { id: publication.id, title: publication.title } }));
  return true;
}

export class PublishedSettingsSync {
  constructor({ fetcher = (...args) => fetch(...args), apiBase = SETTINGS_API_BASE } = {}) {
    this.fetcher = fetcher;
    this.apiBase = apiBase;
    this.generation = 0;
    this.status = "idle";
  }

  start({ eventBus } = {}) {
    if (this.timer) return;
    this.eventBus = eventBus;
    this.trigger = () => void this.check();
    this.visibility = () => {
      if (!document.hidden) this.trigger();
    };
    window.addEventListener("online", this.trigger);
    window.addEventListener("focus", this.trigger);
    window.addEventListener("adtools:session-token", this.trigger);
    document.addEventListener("visibilitychange", this.visibility);
    this.unsubscribe = eventBus?.on?.("user:registered", this.trigger);
    this.timer = setInterval(this.trigger, 60_000);
    this.trigger();
  }

  stop() {
    this.generation += 1;
    clearInterval(this.timer);
    this.timer = null;
    this.controller?.abort();
    window.removeEventListener("online", this.trigger);
    window.removeEventListener("focus", this.trigger);
    window.removeEventListener("adtools:session-token", this.trigger);
    document.removeEventListener("visibilitychange", this.visibility);
    if (typeof this.unsubscribe === "function") this.unsubscribe();
  }

  setStatus(status, message = "") {
    this.status = status;
    this.message = message;
    globalThis.dispatchEvent?.(new CustomEvent("adtools:settings-sync-status", { detail: { status, message } }));
  }

  async request(path, token, body) {
    this.controller = new AbortController();
    const timeout = setTimeout(() => this.controller?.abort(), 15_000);
    try {
      const response = await this.fetcher(`${this.apiBase}/api/settings/${path}`, {
        method: body === undefined ? "GET" : "POST",
        cache: "no-store",
        signal: this.controller.signal,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await response.json();
      if (response.status === 401 && read(CREDENTIAL_KEY)?.credential === token) localStorage.removeItem(CREDENTIAL_KEY);
      if (!response.ok || !data.ok)
        throw Object.assign(new Error(data.error || "Settings synchronization failed."), { status: response.status });
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  check() {
    if (this.pending) return this.pending;
    const run = () => this.synchronize();
    this.pending = (globalThis.navigator?.locks ? navigator.locks.request("adtools-settings-sync", run) : run())
      .catch((error) =>
        this.setStatus(
          error.status === 401 ? "auth" : "error",
          error.status === 401 ? "Verify your account to receive published settings." : "Could not sync settings. Retrying automatically.",
        ),
      )
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  async synchronize() {
    const generation = this.generation;
    const email = (localStorage.getItem("user.email") || "").trim().toLowerCase();
    if (!email || email === "dev@localhost") return;
    const current = () => generation === this.generation && (localStorage.getItem("user.email") || "").trim().toLowerCase() === email;
    let identity = read(CREDENTIAL_KEY);
    if (!identity || identity.email.toLowerCase() !== email || identity.expiresAt < Date.now()) {
      const sessionToken = SessionTokenStore.getToken();
      if (!sessionToken) {
        this.setStatus("auth", "Verify your account to receive published settings.");
        return;
      }
      identity = await this.request("enroll", sessionToken, {});
      if (!current() || identity.email.toLowerCase() !== email) return;
      localStorage.setItem(CREDENTIAL_KEY, JSON.stringify(identity));
    }
    const state = read(stateKey(identity.userId), { cursor: 0, pending: [] });
    if (state.pending.length) {
      await this.request("ack", identity.credential, { ids: state.pending });
      if (!current()) return;
      state.pending = [];
      localStorage.setItem(stateKey(identity.userId), JSON.stringify(state));
    }
    let data;
    try {
      data = await this.request(`sync?after=${state.cursor}`, identity.credential);
    } catch (error) {
      if (error.status === 401 && current()) localStorage.removeItem(CREDENTIAL_KEY);
      throw error;
    }
    if (!current()) return;
    if (!Array.isArray(data.publications) || data.publications.length > 50) throw new Error("Invalid settings response.");
    let previous = state.cursor;
    for (const publication of data.publications) {
      validateSettings(publication.settings);
      if (!Number.isSafeInteger(publication.id) || publication.id <= previous) throw new Error("Invalid publication order.");
      previous = publication.id;
    }
    let applied = 0;
    for (const publication of data.publications) {
      if (applyPublication(publication, identity.userId)) applied += 1;
      state.cursor = publication.id;
      state.pending.push(publication.id);
      localStorage.setItem(stateKey(identity.userId), JSON.stringify(state));
    }
    if (state.pending.length) {
      await this.request("ack", identity.credential, { ids: state.pending });
      if (!current()) return;
      state.pending = [];
      localStorage.setItem(stateKey(identity.userId), JSON.stringify(state));
    }
    this.setStatus("synced", "Published settings are up to date.");
    if (applied) this.eventBus?.emit?.("notification:success", { message: "Published settings applied. You can edit them in Settings." });
  }
}

export const publishedSettingsSync = new PublishedSettingsSync();
