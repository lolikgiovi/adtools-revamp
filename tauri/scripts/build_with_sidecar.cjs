#!/usr/bin/env node
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const triple = process.argv.find((arg) => /^(aarch64|x86_64)-apple-darwin$/.test(arg))
  || (process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin");
const config = triple.startsWith("aarch64") ? "tauri/tauri.sidecar-aarch64.conf.json" : "tauri/tauri.sidecar-x86_64.conf.json";
// librdkafka's configure script otherwise compiles native C objects for the
// build machine (arm64), even when Cargo is targeting x86_64.
const buildEnv = triple.startsWith("x86_64")
  ? {
      ...process.env,
      CFLAGS: [process.env.CFLAGS, "-arch x86_64"].filter(Boolean).join(" "),
      CXXFLAGS: [process.env.CXXFLAGS, "-arch x86_64"].filter(Boolean).join(" "),
      LDFLAGS: [process.env.LDFLAGS, "-arch x86_64"].filter(Boolean).join(" "),
    }
  : process.env;

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env: buildEnv });
  if (result.status !== 0) process.exit(result.status || 1);
}

const args = ["build", "--target", triple, "--bundles", "app", "--config", config];
if (process.argv.includes("--skip-before-build")) args.push("--config", '{"build":{"beforeBuildCommand":""}}');
if (process.argv.includes("--oracle-feature")) args.push("--features", "oracle");
run(path.join(root, "node_modules", ".bin", "tauri"), args);
run(process.execPath, [path.join(__dirname, "finalize_sidecar_app.cjs"), triple]);
run(process.execPath, [path.join(__dirname, "bundle_signed_dmg.cjs"), triple]);
