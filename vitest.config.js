import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["frontend/**/tests/*.test.js", "backend-workers/**/*.test.js"],
    // Exclude Cloudflare-specific tests that require wrangler's test infrastructure
    exclude: ["**/node_modules/**", "backend-workers/tests/dashboard.test.js"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
