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
    cdnPublicUrl: String(raw.cdnPublicUrl ?? "").trim(),
    cdnDirectUrl: String(raw.cdnDirectUrl ?? "").trim(),
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

function readOracleConnections(target = storage()) {
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

  for (const connection of readOracleConnections(target)) {
    const environment = add({ name: connection.name });
    environment.criticalConnection = connection.name;
  }

  const normalized = normalizeList(environments);
  target?.setItem(STORAGE_KEY, JSON.stringify(normalized));
  syncLegacyBaseUrls(normalized, target);
  return normalized;
}

export function readEnvironments(target = storage()) {
  return migrateLegacyEnvironments(target);
}

export function writeEnvironments(list, target = storage()) {
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
  return readOracleConnections(target).find((connection) => connection.name === name) || null;
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

export function updateConnectionReference(previousName, nextName, target = storage()) {
  if (!previousName || !nextName || previousName === nextName) return false;
  const environments = readEnvironments(target);
  let changed = false;
  for (const environment of environments) {
    if (replaceConnectionReference(environment, previousName, nextName)) changed = true;
  }
  if (changed) writeEnvironments(environments, target);
  return changed;
}

export function clearConnectionReference(name, target = storage()) {
  if (!name) return false;
  const environments = readEnvironments(target);
  let changed = false;
  for (const environment of environments) {
    if (replaceConnectionReference(environment, name, "")) changed = true;
  }
  if (changed) writeEnvironments(environments, target);
  return changed;
}

export { ROLE_CRITICAL, ROLE_COMPLEMENTARY };
