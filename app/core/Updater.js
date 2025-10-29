// Updater core (Phase 2)
// - Provides: checkUpdate, performUpdate, evaluatePolicy, getCurrentVersionSafe, setupAutoUpdate
// - Works in web and Tauri; gracefully degrades when updater plugin/APIs are unavailable

import { isTauri } from "./Runtime.js";
import { invoke } from "@tauri-apps/api/core";

function getBooleanSetting(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    if (raw === "true") return true;
    if (raw === "false") return false;
    return Boolean(raw);
  } catch (_) {
    return fallback;
  }
}

function getChannelFromSettings() {
  const allowBeta = getBooleanSetting("update.allowBeta", false);
  return allowBeta ? "beta" : "stable";
}

function semverParts(v) {
  if (!v) return { major: 0, minor: 0, patch: 0, pre: "" };
  const [core, pre = ""] = String(v).split("-");
  const [maj, min, pat] = core.split(".").map((x) => parseInt(x, 10) || 0);
  return { major: maj || 0, minor: min || 0, patch: pat || 0, pre };
}

function semverCmp(a, b) {
  const A = semverParts(a);
  const B = semverParts(b);
  if (A.major !== B.major) return A.major - B.major;
  if (A.minor !== B.minor) return A.minor - B.minor;
  if (A.patch !== B.patch) return A.patch - B.patch;
  // Treat pre-release as less than release
  if (A.pre && !B.pre) return -1;
  if (!A.pre && B.pre) return 1;
  if (A.pre && B.pre) return A.pre.localeCompare(B.pre);
  return 0;
}

function semverLt(a, b) {
  return semverCmp(a, b) < 0;
}
function semverGt(a, b) {
  return semverCmp(a, b) > 0;
}

async function detectArch() {
  if (isTauri()) {
    try {
      const arch = await invoke("get_arch");
      // Normalize common outputs to expected worker labels
      if (arch === "aarch64" || arch === "arm64") return "aarch64";
      if (arch === "x86_64" || arch === "x64" || arch === "amd64") return "x86_64";
      return String(arch || "").trim() || "aarch64";
    } catch (_) {
      // fallthrough
    }
  }
  // Browser best-effort
  const ua = navigator.userAgent || "";
  if (/arm64|aarch64|Apple M\d|Apple\s?Silicon/i.test(ua)) return "aarch64";
  if (/x86_64|x64|Intel|amd64/i.test(ua)) return "x86_64";
  return "aarch64";
}

async function fetchManifest(channel) {
  const url = `https://adtools.lolik.workers.dev/manifest/${channel}.json`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Manifest fetch failed: ${res.status}`);
  const etag = res.headers.get("etag") || undefined;
  const json = await res.json();
  return { manifest: json, etag };
}

// --- Public API

export async function getCurrentVersionSafe() {
  // Prefer Tauri app version when available
  if (isTauri()) {
    try {
      const apiAppMod = "@tauri-apps/api/app";
      const { getVersion } = await import(apiAppMod);
      return await getVersion();
    } catch (_) {
      // ignore
    }
  }
  // Best-effort fallback
  try {
    const v = localStorage.getItem("app.version");
    if (v) return v;
  } catch (_) {}
  return "0.0.0";
}

export async function evaluatePolicy() {
  const channel = getChannelFromSettings();
  const current = await getCurrentVersionSafe();
  let minVersion = undefined;
  try {
    const { manifest } = await fetchManifest(channel);
    minVersion = manifest?.minVersion || manifest?.minimumVersion || undefined;
  } catch (_) {
    // If manifest not reachable, do not force
  }
  const mustForce = Boolean(minVersion && semverLt(current, minVersion));
  const autoCheck = getBooleanSetting("update.autoCheck", true);
  return { autoCheck, mustForce, forceMinVersion: minVersion, current, channel };
}

export async function checkUpdate(opts = {}) {
  const channel = opts.channel || getChannelFromSettings();
  const current = opts.current || (await getCurrentVersionSafe());
  const arch = opts.arch || (await detectArch());

  try {
    const { manifest, etag } = await fetchManifest(channel);
    const latest = manifest?.version || manifest?.latest || undefined;
    const available = Boolean(latest && semverGt(latest, current));
    const url = manifest?.artifacts?.[arch]?.url || manifest?.url || undefined;
    const signature = manifest?.artifacts?.[arch]?.signature || manifest?.signature || undefined;
    return { available, version: latest, current, channel, arch, url, signature, manifest, etag };
  } catch (err) {
    return { available: false, current, channel, arch, error: String(err) };
  }
}

export async function performUpdate(progressCb, stageCb) {
  const setStage = (s) => {
    try {
      stageCb && stageCb(s);
    } catch (_) {}
  };
  const setProgress = (loaded, total) => {
    try {
      progressCb && progressCb(loaded, total);
    } catch (_) {}
  };

  if (!isTauri()) {
    return false;
  }

  // Preferred path: Tauri 2 plugin-updater
  try {
    const v2UpdaterMod = "@tauri-apps/plugin-updater";
    const updater = await import(v2UpdaterMod);
    if (updater && typeof updater.check === "function") {
      setStage("checking");
      const update = await updater.check();
      if (!update?.available) {
        setStage("uptodate");
        return false;
      }
      setStage("downloading");
      await update.downloadAndInstall((loaded, total) => {
        setProgress(loaded || 0, total || 0);
      });
      setStage("restarting");
      const apiProcessMod = "@tauri-apps/api/process";
      const { relaunch } = await import(apiProcessMod);
      await relaunch();
      return true;
    }
  } catch (_) {
    // fallthrough
  }

  // Fallback: Tauri 1 updater API
  try {
    const v1UpdaterMod = "@tauri-apps/api/updater";
    const api = await import(v1UpdaterMod);
    if (api && typeof api.checkUpdate === "function") {
      const { checkUpdate, installUpdate, onUpdaterEvent } = api;
      const unlisten = await onUpdaterEvent(({ status }) => {
        // Map coarse statuses to stages
        if (status === "PENDING") setStage("downloading");
        else if (status === "DONE") setStage("installing");
        else if (status === "ERROR") setStage("error");
      });
      setStage("checking");
      const info = await checkUpdate();
      if (!info?.shouldUpdate) {
        setStage("uptodate");
        await unlisten();
        return false;
      }
      setStage("downloading");
      await installUpdate();
      setStage("restarting");
      await unlisten();
      return true;
    }
  } catch (_) {
    // fallthrough
  }

  // Neither updater API is available
  return false;
}

// Schedule and auto-run update checks, and enforce forced updates when required
export function setupAutoUpdate(options = {}) {
  const eventBus = options.eventBus || null;

  const emit = (evt, payload) => {
    try {
      eventBus && typeof eventBus.emit === "function" && eventBus.emit(evt, payload);
    } catch (_) {}
  };

  const runOptionalCheck = async () => {
    try {
      const res = await checkUpdate();
      if (res.available) emit("update:show-banner", { result: res });
      else emit("update:hide-banner");
    } catch (err) {
      emit("update:error", { message: String(err) });
    }
  };

  const runForcedIfNeeded = async () => {
    try {
      const policy = await evaluatePolicy();
      if (!policy.mustForce) return false;
      if (!isTauri()) {
        emit("update:forced", { policy, unsupported: true });
        return false;
      }
      emit("update:forced", { policy, unsupported: false });
      const ok = await performUpdate(
        (loaded, total) => emit("update:progress", { loaded, total }),
        (stage) => emit("update:stage", { stage })
      );
      if (!ok) emit("update:error", { message: "Update not available or install failed" });
      return ok;
    } catch (err) {
      emit("update:error", { message: String(err) });
      return false;
    }
  };

  // On startup: enforce forced update or do optional check per policy
  (async () => {
    const policy = await evaluatePolicy();
    if (policy.mustForce) {
      await runForcedIfNeeded();
      return;
    }
    if (policy.autoCheck) await runOptionalCheck();
  })();

  // Schedule checks at 9:00, 12:00, 15:00 local time
  const timers = [];
  const HOURS = [9, 12, 15];
  const scheduleForHour = (hour) => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = next.getTime() - now.getTime();
    const id = setTimeout(async function tick() {
      try {
        const policy = await evaluatePolicy();
        if (policy.mustForce) await runForcedIfNeeded();
        else if (policy.autoCheck) await runOptionalCheck();
      } finally {
        const daily = setTimeout(tick, 24 * 60 * 60 * 1000);
        timers.push(daily);
      }
    }, delay);
    timers.push(id);
  };
  HOURS.forEach(scheduleForHour);

  return {
    cancel() {
      timers.splice(0).forEach((t) => {
        try {
          clearTimeout(t);
        } catch (_) {}
      });
    },
  };
}

// Named export group for clarity in imports
export default { checkUpdate, performUpdate, evaluatePolicy, getCurrentVersionSafe, setupAutoUpdate };
