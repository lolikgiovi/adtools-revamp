import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 10000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:1234",
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    permissions: ["clipboard-read", "clipboard-write"],
  },
  projects: [
    { name: "desktop-dark", use: { viewport: { width: 1280, height: 900 }, colorScheme: "dark" } },
    { name: "half-desktop-light", use: { viewport: { width: 820, height: 900 }, colorScheme: "light", reducedMotion: "reduce" } },
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --strictPort",
    url: "http://127.0.0.1:1234",
    reuseExistingServer: !process.env.CI,
  },
});
