import { defineConfig } from "vite";

// Production backend URL for Tauri builds
const WORKER_BASE = "https://adtools.lolik.workers.dev";

export default defineConfig(({ mode, command }) => {
  const useProductionApi = mode === "tauri" || process.env.ADTOOLS_API === "production";
  const apiTarget = useProductionApi ? WORKER_BASE : "http://localhost:8787";
  if (useProductionApi && command === "serve") console.info(`[AD Tools] API: ${WORKER_BASE} (production)`);
  return {
    root: "./frontend",
    publicDir: "public",
    base: "./",
    // Set VITE_WORKER_BASE for tauri production builds
    define: useProductionApi
      ? {
          "import.meta.env.VITE_WORKER_BASE": JSON.stringify(WORKER_BASE),
        }
      : {},
    worker: { format: "es" },
    build: {
      outDir: "../dist",
      emptyOutDir: true,
    },
    server: {
      open: false,
      strictPort: true,
      proxy: Object.fromEntries(
        ["/register", "/analytics", "/feedback", "/whitelist.json", "/api", "/request-otp", "/dashboard", "/approval"].map((path) => [
          path,
          { target: apiTarget, changeOrigin: true },
        ]),
      ),
    },
    resolve: {
      alias: {
        "@": "/",
      },
    },
  };
});
