import { projectEnvironmentStorage, allProjectEnvironmentStores, projectSettingsStorage } from "./Projects.js";

/**
 * Shared testing-environment model.
 *
 * An environment is the app-wide identity that ties together the CDN entry
 * points and the Oracle connections a tool should use for that target. Tools
 * read it through this module instead of re-deriving an environment list from
 * the legacy per-feature keys.
 */
const STORAGE_KEY = "config.environments";
const LEGACY_BASE_URLS_KEY = "config.baseUrls";
const ORACLE_CONNECTIONS_KEY = "config.oracle.connections";

const ROLE_CRITICAL = "critical";
const ROLE_COMPLEMENTARY = "complementary";

function storage() {
  return globalThis.localStorage;
}

function parseArray(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

/**
 * Base URLs are stored without a trailing slash. They may include a path
 * prefix (for example `/uat1/customer`), so join paths by concatenation.
 */
export function normalizeBaseUrl(value) {
  return String(value ?? "")
    .trim()
    .replace(/\/+$/, "");
}

/**
 * Lockey-style paths always start with exactly one slash and carry no
 * trailing slash. A query string is preserved as typed.
 */
export function normalizePath(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  const [pathPart, ...queryParts] = trimmed.split("?");
  const query = queryParts.length ? `?${queryParts.join("?")}` : "";
  const path = pathPart.replace(/^\/+/, "").replace(/\/+$/, "");
  return path ? `/${path}${query}` : "";
}

export function joinUrl(baseUrl, path) {
  const base = normalizeBaseUrl(baseUrl);
  const suffix = normalizePath(path);
  if (!base) return "";
  return suffix ? `${base}${suffix}` : base;
}

function slugify(value) {
  return (
    String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "environment"
  );
}

function makeId(name, taken) {
  const base = slugify(name);
  let id = base;
  let suffix = 2;
  while (taken.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  return id;
}

function normalizeEnvironment(raw, takenIds) {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.name ?? raw.key ?? "").trim();
  if (!name) return null;
  const requestedId = String(raw.id ?? "").trim();
  const id = requestedId && !takenIds.has(requestedId) ? requestedId : makeId(name, takenIds);
  return {
    id,
    name,
    criticalConnection: String(raw.criticalConnection ?? "").trim(),
    complementaryConnection: String(raw.complementaryConnection ?? "").trim(),
    cdnPublicUrl: normalizeBaseUrl(raw.cdnPublicUrl),
    cdnDirectUrl: normalizeBaseUrl(raw.cdnDirectUrl),
  };
}

function normalizeList(list) {
  const ids = new Set();
  const names = new Set();
  const environments = [];

  for (const raw of Array.isArray(list) ? list : []) {
    const environment = normalizeEnvironment(raw, ids);
    if (!environment) continue;
    const nameKey = environment.name.toLowerCase();
    if (names.has(nameKey)) continue;
    names.add(nameKey);
    ids.add(environment.id);
    environments.push(environment);
  }

  return environments;
}

function readLegacyOracleConnections(target = storage()) {
  return parseArray(target?.getItem(ORACLE_CONNECTIONS_KEY)).filter(
    (connection) => connection && typeof connection.name === "string" && connection.connect_string,
  );
}

function syncLegacyBaseUrls(environments, target = storage()) {
  const pairs = environments
    .filter((environment) => environment.cdnPublicUrl)
    .map((environment) => ({ key: environment.name, value: environment.cdnPublicUrl }));
  target?.setItem(LEGACY_BASE_URLS_KEY, JSON.stringify(pairs));
}

/**
 * Build the shared model from the legacy CDN list and Oracle connection names.
 * Runs once, when `config.environments` has never been written.
 */
function migrateLegacyEnvironments(target = storage()) {
  const stored = target?.getItem(STORAGE_KEY);
  if (stored !== null && stored !== undefined) return normalizeList(parseArray(stored));

  const environments = [];
  const byName = new Map();

  const add = (environment) => {
    const nameKey = environment.name.toLowerCase();
    const existing = byName.get(nameKey);
    if (existing) return existing;
    environments.push(environment);
    byName.set(nameKey, environment);
    return environment;
  };

  for (const pair of parseArray(target?.getItem(LEGACY_BASE_URLS_KEY))) {
    const name = String(pair?.key ?? "").trim();
    if (!name) continue;
    add({ name, cdnPublicUrl: String(pair?.value ?? "").trim() });
  }

  for (const connection of readLegacyOracleConnections(target)) {
    const environment = add({ name: connection.name });
    environment.criticalConnection = connection.name;
  }

  const normalized = normalizeList(environments);
  target?.setItem(STORAGE_KEY, JSON.stringify(normalized));
  syncLegacyBaseUrls(normalized, target);
  return normalized;
}

export function readEnvironments(target = storage()) {
  const environments = migrateLegacyEnvironments(projectEnvironmentStorage(target));
  const raw = projectSettingsStorage(target).getItem("config.oracle.environment.catalog");
  const connections = raw ? JSON.parse(raw).connections : [];
  return environments.map((environment) => {
    const result = { ...environment };
    for (const field of ["criticalConnection", "complementaryConnection"]) {
      const connection = connections.find(
        (entry) =>
          entry.environmentId === environment.id &&
          (entry.id === result[field] || entry.name === result[field] || entry.legacyCredentialName === result[field]),
      );
      if (connection) result[field] = connection.id;
    }
    return result;
  });
}

const CATALOG_KEY = "config.oracle.environment.catalog";

/** A single versioned write preserves legacy profiles and makes migration retryable on storage failure. */
export function readProjectConnections(target = storage()) {
  const scoped = projectSettingsStorage(target);
  const raw = scoped.getItem(CATALOG_KEY);
  if (raw !== null) {
    const catalog = JSON.parse(raw);
    if (catalog.version !== 1 || !Array.isArray(catalog.connections)) throw new Error("Invalid Oracle connection catalog.");
    return catalog.connections.map((connection) => ({ ...connection, projectId: scoped.projectId }));
  }
  const environments = migrateLegacyEnvironments(projectEnvironmentStorage(target));
  const legacy =
    scoped.getItem(ORACLE_CONNECTIONS_KEY) !== null
      ? readLegacyOracleConnections(scoped)
      : readLegacyOracleConnections(scoped.sourceStorage);
  const connections = [];
  for (const connection of legacy) {
    const bound = environments.filter((environment) =>
      [environment.criticalConnection, environment.complementaryConnection].includes(connection.name),
    );
    // Nonlegacy projects receive only their explicit legacy bindings, never the entire global catalog.
    const owners = bound.length
      ? bound.map((environment) => environment.id)
      : scoped.keyFor(ORACLE_CONNECTIONS_KEY) === ORACLE_CONNECTIONS_KEY
        ? [""]
        : [];
    for (const environmentId of owners)
      connections.push({
        ...connection,
        id: crypto.randomUUID(),
        environmentId,
        legacyCredentialName: connection.name,
      });
  }
  if (connections.length) scoped.setItem(CATALOG_KEY, JSON.stringify({ version: 1, connections }));
  return connections.map((connection) => ({ ...connection, projectId: scoped.projectId }));
}

export function readEnvironmentConnections(environmentId, target = storage()) {
  const connections = readProjectConnections(target);
  if (environmentId) return connections.filter((connection) => connection.environmentId === environmentId);
  const environments = new Set(readEnvironments(target).map((environment) => environment.id));
  return connections.filter((connection) => !connection.environmentId || !environments.has(connection.environmentId));
}

/** Tool selection values are stable IDs; labels retain environment and connection names. */
export function readOracleToolConnections(target = storage()) {
  const connections = readProjectConnections(target);
  const environments = readEnvironments(target);
  return connections.map((connection) => ({
    ...connection,
    label: [environments.find((environment) => environment.id === connection.environmentId)?.name, connection.name]
      .filter(Boolean)
      .join(" / "),
    name: connection.environmentId ? connection.id : connection.name,
  }));
}

export function saveEnvironmentConnections(environmentId, list, target = storage()) {
  const scoped = projectSettingsStorage(target);
  const current = readProjectConnections(target);
  const previous = readEnvironmentConnections(environmentId, target);
  const next = list.map((connection) => {
    const saved = previous.find((entry) => entry.id === connection.id || entry.name === connection.name);
    return { ...saved, ...connection, id: saved?.id || connection.id || crypto.randomUUID(), environmentId };
  });
  const names = new Set(next.map((connection) => connection.name));
  if (names.size !== next.length) throw new Error("Connection names must be unique within an environment.");
  const previousIds = new Set(previous.map((connection) => connection.id));
  const connections = [...current.filter((connection) => !previousIds.has(connection.id)), ...next];
  scoped.setItem(CATALOG_KEY, JSON.stringify({ version: 1, connections }));
  globalThis.dispatchEvent?.(new Event("adtools:connection-settings-changed"));
  return next;
}

export function bindEnvironmentConnection(environmentId, connectionId, target = storage()) {
  const connections = readProjectConnections(target);
  const connection = connections.find((entry) => entry.id === connectionId);
  if (!connection || connection.environmentId === environmentId) return connectionId;
  if (connection.environmentId && readEnvironments(target).some((environment) => environment.id === connection.environmentId)) {
    throw new Error("Choose a connection belonging to this environment.");
  }
  const existing = readEnvironmentConnections(environmentId, target).find((entry) => entry.sourceConnectionId === connection.id);
  if (existing) return existing.id;
  const owned = {
    ...connection,
    id: crypto.randomUUID(),
    environmentId,
    sourceConnectionId: connection.id,
    legacyCredentialName: connection.legacyCredentialName || `oracle:${connection.projectId}:${connection.id}`,
  };
  saveEnvironmentConnections(environmentId, [...readEnvironmentConnections(environmentId, target), owned], target);
  return owned.id;
}

/** Cancelling/deleting an environment must not strand connections already saved in its editor. */
export function unassignEnvironmentConnections(environmentId, target = storage()) {
  const scoped = projectSettingsStorage(target);
  const connections = readProjectConnections(target);
  const names = new Set(connections.filter((connection) => !connection.environmentId).map((connection) => connection.name));
  for (const connection of connections.filter((entry) => entry.environmentId === environmentId)) {
    const base = connection.name;
    let suffix = 2;
    while (names.has(connection.name)) connection.name = `${base} (${suffix++})`;
    names.add(connection.name);
    connection.environmentId = "";
  }
  scoped.setItem(CATALOG_KEY, JSON.stringify({ version: 1, connections }));
}

export function writeEnvironments(list, target = storage(), projectId) {
  target = projectEnvironmentStorage(target, projectId);
  const environments = normalizeList(list);
  target?.setItem(STORAGE_KEY, JSON.stringify(environments));
  syncLegacyBaseUrls(environments, target);
  return environments;
}

export function listBaseUrls(target = storage()) {
  return readEnvironments(target)
    .filter((environment) => environment.cdnPublicUrl)
    .map((environment) => ({ name: environment.name, url: environment.cdnPublicUrl, directUrl: environment.cdnDirectUrl }));
}

/**
 * Fold a legacy CDN pair list into the shared model without dropping existing
 * environment bindings. Used when defaults arrive from KV under the old key.
 */
export function mergeLegacyBaseUrls(pairs, target = storage()) {
  const environments = readEnvironments(target);
  const byName = new Map(environments.map((environment) => [environment.name.toLowerCase(), environment]));

  for (const pair of Array.isArray(pairs) ? pairs : []) {
    const name = String(pair?.key ?? "").trim();
    if (!name) continue;
    const url = String(pair?.value ?? "").trim();
    const existing = byName.get(name.toLowerCase());
    if (existing) {
      existing.cdnPublicUrl = url;
      continue;
    }
    const environment = { name, cdnPublicUrl: url };
    environments.push(environment);
    byName.set(name.toLowerCase(), environment);
  }

  return writeEnvironments(environments, target);
}

export function resolveConnection(environment, role, target = storage()) {
  const name = role === ROLE_COMPLEMENTARY ? environment?.complementaryConnection : environment?.criticalConnection;
  if (!name) return null;
  return (
    readProjectConnections(target).find(
      (connection) =>
        (!environment.id || connection.environmentId === environment.id) && (connection.id === name || connection.name === name),
    ) || null
  );
}

function replaceConnectionReference(environment, previousName, nextName) {
  let changed = false;
  if (environment.criticalConnection === previousName) {
    environment.criticalConnection = nextName;
    changed = true;
  }
  if (environment.complementaryConnection === previousName) {
    environment.complementaryConnection = nextName;
    changed = true;
  }
  return changed;
}

function changeConnectionReference(previousName, nextName, target) {
  let changed = false;
  for (const scoped of allProjectEnvironmentStores(target)) {
    // Do not run legacy discovery for inactive projects.
    const raw = scoped.getItem(STORAGE_KEY);
    if (raw === null) continue;
    const environments = normalizeList(parseArray(raw));
    const catalog = JSON.parse(scoped.getItem(CATALOG_KEY) || '{"connections":[]}');
    const connection = catalog.connections.find((entry) => entry.id === previousName);
    let projectChanged = false;
    for (const environment of environments) {
      if (connection && connection.environmentId === environment.id) {
        for (const field of ["criticalConnection", "complementaryConnection"]) {
          if ([connection.id, connection.name, connection.legacyCredentialName].filter(Boolean).includes(environment[field])) {
            environment[field] = nextName;
            projectChanged = true;
          }
        }
      }
      if (replaceConnectionReference(environment, previousName, nextName)) projectChanged = true;
    }
    if (projectChanged) {
      scoped.setItem(STORAGE_KEY, JSON.stringify(environments));
      changed = true;
    }
  }
  return changed;
}

export function updateConnectionReference(previousName, nextName, target = storage()) {
  if (!previousName || !nextName || previousName === nextName) return false;
  return changeConnectionReference(previousName, nextName, target);
}

export function clearConnectionReference(name, target = storage()) {
  if (!name) return false;
  return changeConnectionReference(name, "", target);
}

export { ROLE_CRITICAL, ROLE_COMPLEMENTARY };
