// Updater core (Phase 2, desktop-only)
// - Provides: checkUpdate, performUpdate, evaluatePolicy, getCurrentVersionSafe, setupAutoUpdate
// - Desktop-only: web runtime does not participate in update checks or UI

import { isTauri } from "./Runtime.js";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";

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
      // Normalize to plugin-updater platform keys (darwin-*)
      if (arch === "aarch64" || arch === "arm64") return "darwin-aarch64";
      if (arch === "x86_64" || arch === "x64" || arch === "amd64") return "darwin-x86_64";
      const a = String(arch || "").trim().toLowerCase();
      if (a.includes("arm") || a.includes("aarch")) return "darwin-aarch64";
      return "darwin-x86_64";
    } catch (_) {
      // fallthrough
    }
  }
  // Browser: not used (web does not support updates); return a sensible default
  return "darwin-aarch64";
}

async function fetchManifest(channel) {
  // Unify on plugin-updater JSON schema served at /update/<channel>.json
  const url = `https://adtools.lolik.workers.dev/update/${channel}.json`;
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
      const { getVersion } = await import(/* @vite-ignore */ "@tauri-apps/api/app");
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
  // Desktop-only: web runtime does not enforce or check update policy
  if (!isTauri()) {
    return { autoCheck: false, mustForce: false, forceMinVersion: undefined, current: "0.0.0", channel: "stable" };
  }
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
  // Desktop-only: return unsupported for web runtime
  if (!isTauri()) {
    const current = opts.current || (await getCurrentVersionSafe());
    const channel = opts.channel || getChannelFromSettings();
    return { available: false, version: undefined, current, channel, arch: undefined, error: "unsupported: web runtime" };
  }
  const channel = opts.channel || getChannelFromSettings();
  const current = opts.current || (await getCurrentVersionSafe());
  const arch = opts.arch || (await detectArch());

  try {
    const { manifest, etag } = await fetchManifest(channel);
    const latest = manifest?.version || manifest?.latest || undefined;
    const available = Boolean(latest && semverGt(latest, current));
    // Unified schema: plugin-updater style platforms with darwin-* keys; support fallback mapping
    const platformEntry = manifest?.platforms?.[arch]
      || manifest?.platforms?.[arch.replace("darwin-", "")] // tolerate old keys
      || undefined;
    const base = "https://adtools.lolik.workers.dev";
    const normalizeUrl = (u) => (typeof u === "string" && u.startsWith("/") ? base + u : u);
    const url = normalizeUrl(platformEntry?.url || manifest?.url || undefined);
    const signature = platformEntry?.signature || manifest?.signature || undefined;
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
    const updater = await import(/* @vite-ignore */ "@tauri-apps/plugin-updater");
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
      // Robust restart sequence: plugin-process → core app → window reload (dev fallback)
      try {
        await relaunch();
        return true;
      } catch (e1) {
        try {
          const appApi = await import(/* @vite-ignore */ "@tauri-apps/api/app");
          if (appApi?.relaunch) {
            await appApi.relaunch();
            return true;
          }
        } catch (e2) {
          // Dev-mode fallback: a full relaunch can fail when running under cargo
          // Reloading the window keeps the session alive enough for local testing
          console.warn("Relaunch failed; falling back to window reload", e1);
          try {
            window.location.reload();
            return true;
          } catch (_) {}
        }
      }
      return true;
    }
  } catch (_) {
    // fallthrough
  }

  // No legacy fallback: project depends on Tauri v2 plugin-updater

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

  // Desktop-only: no scheduling or events on web
  if (!isTauri()) {
    return {
      cancel() {}
    };
  }

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
      emit("update:forced", { policy, unsupported: false });
      console.log("Forced update enforced");
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
