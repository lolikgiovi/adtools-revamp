#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const triple = process.argv[2];
if (!/^(aarch64|x86_64)-apple-darwin$/.test(triple || "")) {
  console.error("Usage: node tauri/scripts/finalize_sidecar_app.cjs <target-triple>");
  process.exit(1);
}

const tauriDir = path.resolve(__dirname, "..");
const config = JSON.parse(fs.readFileSync(path.join(tauriDir, "tauri.conf.json"), "utf8"));
const app = path.join(tauriDir, "target", triple, "release", "bundle", "macos", `${config.productName}.app`);
const contents = path.join(app, "Contents");
const supportRelative = `Resources/sidecar/sidecar-dist/oracle-sidecar-${triple}/_internal`;
const support = path.join(contents, supportRelative);
const frameworks = path.join(contents, "Frameworks");

if (!fs.existsSync(path.join(support, "base_library.zip"))) {
  console.error(`Oracle sidecar support files are missing: ${support}`);
  process.exit(1);
}

if (fs.existsSync(frameworks) || fs.lstatSync(frameworks, { throwIfNoEntry: false })) {
  if (!fs.lstatSync(frameworks).isSymbolicLink() || fs.readlinkSync(frameworks) !== supportRelative) {
    console.error(`Unexpected Frameworks path; refusing to replace it: ${frameworks}`);
    process.exit(1);
  }
} else {
  // Inside a macOS .app, the PyInstaller bootloader resolves its runtime from
  // Contents/Frameworks. A symlink keeps Python data in Resources, where the
  // app can be code signed without treating metadata folders as frameworks.
  fs.symlinkSync(supportRelative, frameworks);
}

const identity = process.env.APPLE_SIGNING_IDENTITY || "-";
const signArgs = ["--force", "--deep", "--sign", identity];
if (identity !== "-") signArgs.push("--options", "runtime", "--timestamp");
signArgs.push(app);

for (const args of [signArgs, ["--verify", "--deep", "--strict", app]]) {
  const result = spawnSync("codesign", args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`Signed Oracle sidecar app bundle: ${app}`);
