import { joinUrl, normalizeBaseUrl, normalizePath, readEnvironments } from "../../core/Environments.js";

const PATH_KEY = "config.lockeyPath";
const LEGACY_DOMAINS_KEY = "config.lockeyDomains";
const BASE_PREFERENCE_KEY = "masterLockeyBase";

function storage() {
  return globalThis.localStorage;
}

export function readLockeyPath(target = storage()) {
  return normalizePath(target?.getItem(PATH_KEY) ?? "");
}

export function readBasePreference(target = storage()) {
  return target?.getItem(BASE_PREFERENCE_KEY) === "direct" ? "direct" : "public";
}

export function writeBasePreference(value, target = storage()) {
  target?.setItem(BASE_PREFERENCE_KEY, value === "direct" ? "direct" : "public");
}

export function listLockeyEnvironments(target = storage()) {
  return readEnvironments(target).filter((environment) => environment.cdnPublicUrl || environment.cdnDirectUrl);
}

export function resolveEnvironmentBase(environment, preference = "public") {
  if (preference === "direct" && environment?.cdnDirectUrl) return { base: environment.cdnDirectUrl, source: "direct" };
  if (environment?.cdnPublicUrl) return { base: environment.cdnPublicUrl, source: "public" };
  if (environment?.cdnDirectUrl) return { base: environment.cdnDirectUrl, source: "direct" };
  return { base: "", source: "" };
}

export function resolveLockeyUrl(environment, { path = readLockeyPath(), base = readBasePreference() } = {}) {
  const selected = resolveEnvironmentBase(environment, base);
  return { url: joinUrl(selected.base, path), base: selected.base, source: selected.source };
}

function parseLegacyDomains(target = storage()) {
  try {
    const parsed = JSON.parse(target?.getItem(LEGACY_DOMAINS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && entry.key && entry.value) : [];
  } catch (_) {
    return [];
  }
}

function suffixAfterBase(url, base) {
  const trimmedUrl = String(url ?? "").trim();
  const normalizedBase = normalizeBaseUrl(base);
  if (!trimmedUrl || !normalizedBase || !trimmedUrl.startsWith(normalizedBase)) return "";
  const suffix = trimmedUrl.slice(normalizedBase.length);
  return suffix.startsWith("/") ? suffix : "";
}

/**
 * Collapse the legacy per-environment full URLs into one shared path when
 * every environment yields the same suffix. Differing suffixes are left alone
 * so a later migration does not silently pick one environment's path.
 */
export function migrateLegacyLockeyPath(target = storage()) {
  const stored = target?.getItem(PATH_KEY);
  if (stored !== null) return normalizePath(stored);

  const legacy = parseLegacyDomains(target);
  if (!legacy.length) return "";

  const environments = listLockeyEnvironments(target);
  const suffixes = new Set();
  for (const entry of legacy) {
    const environment = environments.find((candidate) => candidate.name.toLowerCase() === String(entry.key).toLowerCase());
    const bases = [environment?.cdnPublicUrl, environment?.cdnDirectUrl].filter(Boolean);
    let suffix = "";
    for (const base of bases) {
      suffix = suffixAfterBase(entry.value, base);
      if (suffix) break;
    }
    const path = normalizePath(suffix);
    if (path) suffixes.add(path);
  }

  if (suffixes.size !== 1) return "";
  const [path] = suffixes;
  target?.setItem(PATH_KEY, path);
  return path;
}
