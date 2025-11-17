import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
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
      "@": "/app",
    },
  },
});
