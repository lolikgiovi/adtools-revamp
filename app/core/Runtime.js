export function isTauri() {
  try {
    const g = typeof globalThis !== 'undefined' ? globalThis : {};
    const w = typeof window !== 'undefined' ? window : g;
    const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';
    const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};

    // Build-time/env hints (present in tauri builds or CLI-driven dev)
    const envHints = !!(env.TAURI || env.TAURI_PLATFORM || env.TAURI_ARCH || env.TAURI_FAMILY);

    // Runtime globals injected by Tauri WebView (v1/v2)
    const globalHints = !!(w.__TAURI__ || w.__TAURI_IPC__ || w.__TAURI_METADATA__ || w.__TAURI_INTERNALS__);

    // User-agent hint (some versions include 'Tauri')
    const uaHint = /tauri/i.test(ua);

    return envHints || globalHints || uaHint;
  } catch (_) {
    return false;
  }
}

export function getRuntime() {
  return isTauri() ? 'tauri' : 'web';
}