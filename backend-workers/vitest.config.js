import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const TESTS = new URL("./tests/", import.meta.url);
const NODE_SQLITE_TESTS = readdirSync(TESTS)
  .filter((name) => name.endsWith(".test.js") && readFileSync(new URL(name, TESTS), "utf8").includes('"node:sqlite"'))
  .map((name) => `backend-workers/tests/${name}`);

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
    exclude: NODE_SQLITE_TESTS,
  },
});
