// @vitest-environment node
// Failure cases: prod opt-in ignored, normal dev accidentally live, relative API paths still routed locally.
import { afterEach, expect, it, vi } from "vitest";
import config from "../../../vite.config.mjs";
import { readFileSync } from "node:fs";

afterEach(() => vi.unstubAllEnvs());

it("keeps normal development on the local Worker", () => {
  vi.stubEnv("ADTOOLS_API", "");
  const result = config({ mode: "development" });
  expect(result.define["import.meta.env.VITE_WORKER_BASE"]).toBeUndefined();
  expect(result.server.proxy["/register"].target).toBe("http://localhost:8787");
});

it("routes desktop development to production only when explicitly selected", () => {
  vi.stubEnv("ADTOOLS_API", "production");
  const result = config({ mode: "development" });
  expect(JSON.parse(result.define["import.meta.env.VITE_WORKER_BASE"])).toBe("https://adtools.lolik.workers.dev");
  for (const path of ["/dashboard", "/approval", "/feedback", "/register", "/analytics", "/api"]) {
    expect(result.server.proxy[path]).toEqual({ target: "https://adtools.lolik.workers.dev", changeOrigin: true });
  }
});

it("keeps packaged desktop builds on production", () => {
  vi.stubEnv("ADTOOLS_API", "");
  expect(JSON.parse(config({ mode: "tauri" }).define["import.meta.env.VITE_WORKER_BASE"])).toBe("https://adtools.lolik.workers.dev");
});

it("starts the Tauri development frontend in production API mode by default", () => {
  const tauriConfig = JSON.parse(readFileSync(new URL("../../../tauri/tauri.conf.json", import.meta.url), "utf8"));
  expect(tauriConfig.build.beforeDevCommand).toBe("npm run dev -- --mode tauri");
  vi.stubEnv("ADTOOLS_API", "");
  const result = config({ mode: "tauri" });
  expect(JSON.parse(result.define["import.meta.env.VITE_WORKER_BASE"])).toBe("https://adtools.lolik.workers.dev");
  expect(result.server.proxy["/api"].target).toBe("https://adtools.lolik.workers.dev");
});
