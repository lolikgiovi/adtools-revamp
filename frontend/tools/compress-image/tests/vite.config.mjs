import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import appConfig from "../../../../vite.config.mjs";

// Build the same production app/worker/WASM assets with an additional repeatable
// verification entry. The normal application build never includes this harness.
export default defineConfig(({ mode }) =>
  mergeConfig(appConfig({ mode }), {
    build: {
      outDir: fileURLToPath(new URL("../../../../tauri/target/image-optimizer-verification", import.meta.url)),
      rollupOptions: {
        input: {
          app: fileURLToPath(new URL("../../../index.html", import.meta.url)),
          verification: fileURLToPath(new URL("./browser.html", import.meta.url)),
          cachePreview: fileURLToPath(new URL("./cache-preview-roundtrip.html", import.meta.url)),
        },
      },
    },
  }),
);
