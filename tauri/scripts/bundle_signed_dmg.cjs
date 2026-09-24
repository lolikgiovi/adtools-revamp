#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const triple = process.argv[2];
if (!/^(aarch64|x86_64)-apple-darwin$/.test(triple || "")) {
  console.error("Usage: node tauri/scripts/bundle_signed_dmg.cjs <target-triple>");
  process.exit(1);
}

const tauriDir = path.resolve(__dirname, "..");
const config = JSON.parse(fs.readFileSync(path.join(tauriDir, "tauri.conf.json"), "utf8"));
const outputDir = path.join(tauriDir, "target", triple, "release", "bundle", "dmg");
const app = path.join(tauriDir, "target", triple, "release", "bundle", "macos", `${config.productName}.app`);
const suffix = triple.startsWith("aarch64") ? "aarch64" : "x64";
const dmg = path.join(outputDir, `${config.productName}_${config.version}_${suffix}.dmg`);

if (!fs.existsSync(app)) {
  console.error(`Signed app bundle is missing: ${app}`);
  process.exit(1);
}
const verified = spawnSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
if (verified.status !== 0) process.exit(verified.status || 1);

fs.mkdirSync(outputDir, { recursive: true });
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "adtools-dmg-"));
try {
  const stagedApp = path.join(stage, path.basename(app));
  fs.cpSync(app, stagedApp, {
    recursive: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  });
  const stagedFrameworks = path.join(stagedApp, "Contents", "Frameworks");
  if (!fs.lstatSync(stagedFrameworks).isSymbolicLink() || path.isAbsolute(fs.readlinkSync(stagedFrameworks))) {
    throw new Error("Staged Oracle Frameworks link must remain relative inside the app");
  }
  const stagedSignature = spawnSync("codesign", ["--verify", "--deep", "--strict", stagedApp], { stdio: "inherit" });
  if (stagedSignature.status !== 0) throw new Error("Staged app signature verification failed");
  fs.symlinkSync("/Applications", path.join(stage, "Applications"));
  const created = spawnSync("hdiutil", ["create", "-volname", config.productName, "-srcfolder", stage,
    "-format", "UDZO", "-ov", dmg], { stdio: "inherit" });
  if (created.status !== 0) process.exitCode = created.status || 1;
  else {
    const identity = process.env.APPLE_SIGNING_IDENTITY;
    if (identity && identity !== "-") {
      const signed = spawnSync("codesign", ["--force", "--sign", identity, "--timestamp", dmg], { stdio: "inherit" });
      if (signed.status !== 0) process.exitCode = signed.status || 1;
    }
    if (!process.exitCode) console.log(`Bundled signed app DMG: ${dmg}`);
  }
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
