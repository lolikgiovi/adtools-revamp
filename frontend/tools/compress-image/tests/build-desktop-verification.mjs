import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const cachePreview = process.argv.includes("--cache-preview");
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const output = resolve(root, "tauri/target/image-optimizer-verification");
const config = resolve(root, "tauri/target/image-optimizer-verification.json");
mkdirSync(resolve(root, "tauri/target"), { recursive: true });
writeFileSync(
  config,
  JSON.stringify(
    {
      identifier: "com.adtools.imageoptimizer.verify",
      productName: "AD Tools Image Optimizer Verification",
      build: { beforeBuildCommand: "", frontendDist: output },
      app: {
        windows: [
          {
            label: "main",
            title: "AD Tools — Image optimizer verification",
            width: 1200,
            height: 900,
            url: cachePreview ? "tools/compress-image/tests/cache-preview-roundtrip.html?large" : "tools/compress-image/tests/browser.html",
          },
        ],
      },
      bundle: { externalBin: [] },
    },
    null,
    2,
  ),
);

function run(script, args, cwd) {
  const result = spawnSync(process.execPath, [resolve(root, script), ...args], {
    cwd,
    env: { ...process.env, CARGO_NET_OFFLINE: "true" },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
run("node_modules/vite/bin/vite.js", ["build", "--mode", "tauri", "--config", "frontend/tools/compress-image/tests/vite.config.mjs"], root);
run(
  "node_modules/@tauri-apps/cli/tauri.js",
  ["build", "--debug", "--bundles", "app", "--no-sign", "--ci", "--config", config],
  resolve(root, "tauri"),
);
