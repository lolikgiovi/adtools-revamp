import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// Serve and emit the same pinned engine files, without bundling the engine into the SPA.
export function plantumlAssets() {
  const root = dirname(createRequire(import.meta.url).resolve("@plantuml/core/package.json"));
  const files = ["plantuml.js", "viz-global.js", "themes.js", "emoji.js", "openiconic.js", "LICENSE"];
  return {
    name: "plantuml-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split("?")[0];
        const file = files.find((name) => path === `/plantuml/engine/${name}`);
        if (!file) return next();
        response.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/plain");
        response.end(readFileSync(join(root, file)));
      });
    },
    generateBundle() {
      for (const file of files) {
        this.emitFile({ type: "asset", fileName: `plantuml/engine/${file}`, source: readFileSync(join(root, file)) });
      }
    },
  };
}
