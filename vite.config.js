import { defineConfig } from "vite";

export default defineConfig({
  root: "./frontend",
  publicDir: "public",
  base: "./",
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
});
