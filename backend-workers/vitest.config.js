import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    include: ["backend-workers/tests/**/*.test.js"],
    exclude: [
      "backend-workers/tests/analytics-count-integrity.test.js",
      "backend-workers/tests/canonical-tool-usage-migration.test.js",
      "backend-workers/tests/lifetime-usage-baseline.test.js",
    ],
    poolOptions: {
      workers: {
        wrangler: { configPath: "../wrangler.toml" },
        miniflare: {
          assets: { directory: "./test-assets" },
          kvNamespaces: ["WHITELIST", "adtools", "ANALYTICS"],
          d1Databases: ["DB"],
          r2Buckets: ["UPDATES"],
          bindings: {
            ANALYTICS_DASHBOARD_PASSWORD: "testpassword123",
          },
        },
      },
    },
  },
});
