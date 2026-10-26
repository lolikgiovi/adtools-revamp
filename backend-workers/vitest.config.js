import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL("..", import.meta.url)),
  plugins: [
    cloudflareTest({
      remoteBindings: false,
      wrangler: { configPath: fileURLToPath(new URL("../wrangler.toml", import.meta.url)) },
      miniflare: {
        assets: { directory: fileURLToPath(new URL("./test-assets", import.meta.url)) },
        kvNamespaces: ["WHITELIST", "adtools", "ANALYTICS"],
        d1Databases: ["DB"],
        r2Buckets: ["UPDATES"],
        bindings: {
          ANALYTICS_DASHBOARD_PASSWORD: "testpassword123",
        },
      },
    }),
  ],
  test: {
    include: ["backend-workers/tests/**/*.test.js"],
    // node:sqlite tests run in the root Node suite; workerd cannot load that module.
    exclude: [
      "backend-workers/tests/settings-publishing.test.js",
      "backend-workers/tests/analytics-count-integrity.test.js",
      "backend-workers/tests/capability-adoption.test.js",
      "backend-workers/tests/canonical-tool-usage-migration.test.js",
      "backend-workers/tests/dashboard-performance.test.js",
      "backend-workers/tests/dashboard-device-exclusions.test.js",
      "backend-workers/tests/dashboard-ordering.test.js",
      "backend-workers/tests/dashboard-person.test.js",
      "backend-workers/tests/dashboard-tabs-smoke.test.js",
      "backend-workers/tests/dashboard-trends.test.js",
      "backend-workers/tests/lifetime-usage-baseline.test.js",
    ],
  },
});
