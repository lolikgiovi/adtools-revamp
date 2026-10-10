export function isDesktop(): boolean {
  const tauriWindow = window as Window & {
    __TAURI__?: unknown;
    __TAURI_IPC__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };
  return Boolean(tauriWindow.__TAURI__ || tauriWindow.__TAURI_IPC__ || tauriWindow.__TAURI_INTERNALS__);
}
