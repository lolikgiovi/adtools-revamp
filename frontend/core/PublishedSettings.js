import { getLegacyProjectId, projectSettingsStorage, listProjects, createProject } from "./Projects.js";
import { validateSettings } from "../../shared/published-settings.js";
import { writeEnvironments } from "./Environments.js";
import { saveKafkaBrokerProfiles } from "../tools/kafka/service.js";
import { UsageTracker } from "./UsageTracker.js";
import { isTauri } from "./Runtime.js";

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

const sameName = (a, b) => a.normalize("NFKC").toLowerCase() === b.normalize("NFKC").toLowerCase();
const CONTROL_KEYS = new Set(["project.name", "project.replaceDefault"]);
const ACTIVE_KEY = "config.project.active";

export function applyPublication(publication, userId, destinationProjectId) {
  return applyPublicationTo(publication, userId, destinationProjectId).applied;
}

/** Returns the destination project and any Oracle logins, which belong in the Keychain rather than local settings. */
function applyPublicationTo(publication, userId, destinationProjectId) {
  if (!userId || !Number.isSafeInteger(publication?.id) || publication.id < 1) throw new Error("Invalid publication.");
  validateSettings(publication.settings);
  const marker = appliedKey(userId, publication.id);
  const interrupted = read(journalKey);
  if (interrupted) {
    if (!localStorage.getItem(interrupted.marker)) restore(interrupted.values);
    localStorage.removeItem(journalKey);
  }
  if (localStorage.getItem(marker)) return { applied: false, logins: [] };
  const projectName = publication.settings["project.name"]?.trim();
  const replace = publication.settings["project.replaceDefault"] === true && !destinationProjectId;
  if (destinationProjectId && !listProjects().some((project) => project.id === destinationProjectId)) {
    throw new Error("Choose a project available in your department.");
  }
  const projects = projectName ? listProjects() : [];
  // Older publications keep their original destination. New publications explicitly name the project.
  const registryBefore = localStorage.getItem("config.projects");
  // Replacing renames the untouched original project in place, so its storage keys and Keychain logins stay valid.
  const original = replace && projects.find((project) => project.id === getLegacyProjectId() && sameName(project.name, "Default project"));
  const duplicates = original ? projects.filter((project) => project.id !== original.id && sameName(project.name, projectName)) : [];
  const existing = original || (projectName && projects.find((project) => sameName(project.name, projectName)));
  const projectId = destinationProjectId || (projectName ? (existing || createProject(projectName)).id : getLegacyProjectId());
  const scoped = projectSettingsStorage(localStorage, projectId);
  const keys = new Set(Object.keys(publication.settings).filter((key) => !CONTROL_KEYS.has(key)));
  if (keys.has("config.environments")) keys.add("config.baseUrls");
  if (keys.has("tool:kafka:brokers")) keys.add("tool:kafka:active-broker");
  if (keys.has("config.jira.projectKeys")) keys.add("config.jira.projectKey");
  if (keys.has("config.oracle.connections")) keys.add("config.oracle.environment.catalog");
  const values = Object.fromEntries([...keys].map((key) => [scoped.keyFor(key), scoped.getItem(key)]));
  values[marker] = localStorage.getItem(marker);
  if (projectName && !existing && !destinationProjectId) {
    values["config.projects"] = registryBefore;
    values[scoped.keyFor("config.environments")] = null;
  }
  const removedKeys = Object.keys(localStorage).filter((key) => duplicates.some((project) => key.startsWith(`project:${project.id}:`)));
  if (replace) values[ACTIVE_KEY] = localStorage.getItem(ACTIVE_KEY);
  if (original) {
    values["config.projects"] = registryBefore;
    for (const key of removedKeys) values[key] = localStorage.getItem(key);
  }
  const logins = [];
  try {
    localStorage.setItem(journalKey, JSON.stringify({ marker, values }));
    if (original) {
      const state = JSON.parse(registryBefore);
      state.projects = state.projects
        .filter((project) => !duplicates.some((duplicate) => duplicate.id === project.id))
        .map((project) => (project.id === original.id ? { ...project, name: projectName } : project));
      localStorage.setItem("config.projects", JSON.stringify(state));
      for (const key of removedKeys) localStorage.removeItem(key);
    }
    if (replace) localStorage.setItem(ACTIVE_KEY, projectId);
    for (const [key, value] of Object.entries(publication.settings)) {
      if (CONTROL_KEYS.has(key)) continue;
      if (key === "config.environments") writeEnvironments(value, scoped);
      else if (key === "tool:kafka:brokers") saveKafkaBrokerProfiles(value, scoped);
      else if (key === "config.oracle.environment.catalog") {
        const connections = value.map(({ username, password, ...connection }) => {
          if (username && password) logins.push({ connection: { ...connection, projectId }, username, password });
          return connection;
        });
        scoped.setItem(key, JSON.stringify({ version: 1, connections }));
      } else if (key === "config.oracle.connections") {
        scoped.setItem(key, JSON.stringify(value));
        // Legacy payloads are retained as unassigned profiles, ready for explicit environment binding.
        scoped.setItem(
          "config.oracle.environment.catalog",
          JSON.stringify({
            version: 1,
            connections: value.map((connection) => ({
              ...connection,
              id: crypto.randomUUID(),
              environmentId: connection.environmentId || "",
            })),
          }),
        );
      } else {
        scoped.setItem(key, typeof value === "object" ? JSON.stringify(value) : String(value));
        if (key === "config.jira.projectKeys") scoped.setItem("config.jira.projectKey", value.length === 1 ? value[0] : "");
      }
    }
    localStorage.setItem(marker, "1");
    localStorage.removeItem(journalKey);
  } catch (error) {
    restore(values);
    localStorage.removeItem(journalKey);
    throw error;
  }
  if (replace) globalThis.sessionStorage?.setItem(ACTIVE_KEY, projectId);
  if (original) globalThis.dispatchEvent?.(new Event("adtools:projects-updated"));
  globalThis.dispatchEvent?.(new Event("adtools:connection-settings-changed"));
  globalThis.dispatchEvent?.(new CustomEvent("adtools:settings-published", { detail: { id: publication.id, title: publication.title } }));
  return { applied: true, projectId, logins };
}

async function saveLoginToKeychain(connection, username, password) {
  if (!isTauri()) throw new Error("Oracle logins can only be saved in AD Tools Desktop.");
  const { OracleConnectionService } = await import("./OracleConnectionService.js");
  await OracleConnectionService.setOracleCredentials(connection, username, password);
}

export class PublishedSettingsSync {
  constructor({ fetcher = (...args) => fetch(...args), apiBase = SETTINGS_API_BASE, saveLogin = saveLoginToKeychain } = {}) {
    this.fetcher = fetcher;
    this.saveLogin = saveLogin;
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
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
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
    const run = async () => {
      const generation = this.generation;
      try {
        await this.synchronize();
      } catch (error) {
        if (error.status !== 401) throw error;
        if (generation !== this.generation) return;
        await this.synchronize();
      }
    };
    this.pending = (globalThis.navigator?.locks ? navigator.locks.request("adtools-settings-sync", run) : run())
      .catch(() => this.setStatus("error", "Could not sync settings. Retrying automatically."))
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  async synchronize() {
    const generation = this.generation;
    const email = (localStorage.getItem("user.email") || "").trim().toLowerCase();
    if (!email || email === "dev@localhost") return;
    const deviceId = UsageTracker.getDeviceId();
    const current = () =>
      generation === this.generation &&
      (localStorage.getItem("user.email") || "").trim().toLowerCase() === email &&
      UsageTracker.getDeviceId() === deviceId;
    let identity = read(CREDENTIAL_KEY);
    if (
      !identity ||
      identity.email.toLowerCase() !== email ||
      identity.deviceId !== deviceId ||
      identity.expiresAt < Date.now() ||
      (import.meta.env.DEV && identity.isDevelopment !== true)
    ) {
      identity = await this.request("enroll", null, { email, deviceId, isDevelopment: import.meta.env.DEV });
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
    let loginsFailed = false;
    for (const publication of data.publications) {
      const result = applyPublicationTo(publication, identity.userId);
      if (result.applied) applied += 1;
      for (const { connection, username, password } of result.logins) {
        try {
          await this.saveLogin(connection, username, password);
        } catch {
          loginsFailed = true;
        }
      }
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
    if (loginsFailed) {
      this.eventBus?.emit?.("notification:error", {
        message: "Published settings applied, but database logins could not be saved. Enter them in Settings.",
      });
    } else if (applied) {
      this.eventBus?.emit?.("notification:success", { message: "Published settings applied. You can edit them in Settings." });
    }
  }
}

export const publishedSettingsSync = new PublishedSettingsSync();
