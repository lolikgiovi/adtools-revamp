import { defineConfig } from "vite";

// Production backend URL for Tauri builds
const WORKER_BASE = "https://adtools.lolik.workers.dev";

export default defineConfig(({ mode }) => ({
  root: "./frontend",
  publicDir: "public",
  base: "./",
  // Set VITE_WORKER_BASE for tauri production builds
  define:
    mode === "tauri"
      ? {
          "import.meta.env.VITE_WORKER_BASE": JSON.stringify(WORKER_BASE),
        }
      : {},
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    open: false,
    proxy: {
      "/register": "http://localhost:8787",
      "/analytics": "http://localhost:8787",
      "/whitelist.json": "http://localhost:8787",
      "/api": "http://localhost:8787",
      "/request-otp": "http://localhost:8787",
      "/api/kv": "http://localhost:8787",
    },
  },
  resolve: {
    alias: {
      "@": "/",
    },
  },
}));
