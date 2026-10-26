import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../../..");
const releaseDir = resolve(process.argv[2]);
const manifest = JSON.parse(readFileSync(resolve(releaseDir, "stable.json"), "utf8"));
const config = JSON.parse(readFileSync(resolve(root, "tauri/tauri.conf.json"), "utf8"));
const content = JSON.parse(readFileSync(resolve(root, "frontend/config/release-content.json"), "utf8"));
assert.equal(manifest.version, "1.3.12");
assert.equal(manifest.minVersion, "0.0.0");
for (const field of ["releaseId", "title", "summary", "slides", "tour", "tips"]) assert.deepEqual(manifest[field], content[field]);
assert.equal(manifest.notes, content.notes.join("\n"));
const publicText = Buffer.from(config.plugins.updater.pubkey, "base64").toString("utf8");
const publicBytes = Buffer.from(publicText.trim().split(/\r?\n/)[1], "base64");
assert.equal(publicBytes.length, 42);
const publicKey = createPublicKey({
  key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicBytes.subarray(10)]),
  type: "spki",
  format: "der",
});
const platforms = [];
for (const [triple, label, architecture] of [
  ["aarch64-apple-darwin", "mac-arm64", "arm64"],
  ["x86_64-apple-darwin", "mac-intel", "x86_64"],
]) {
  const platform = triple.startsWith("aarch64") ? "darwin-aarch64" : "darwin-x86_64";
  const entry = manifest.platforms[platform];
  const tarName = `ADTools-${manifest.version}-${label}.app.tar.gz`;
  const tarPath = resolve(releaseDir, platform, tarName);
  const bytes = readFileSync(tarPath);
  const signature = readFileSync(`${tarPath}.sig`, "utf8").trim();
  assert.equal(entry.signature, signature);
  const lines = Buffer.from(signature, "base64").toString("utf8").trim().split(/\r?\n/);
  const signed = Buffer.from(lines[1], "base64");
  assert.equal(signed.length, 74);
  assert.deepEqual(signed.subarray(2, 10), publicBytes.subarray(2, 10));
  const algorithm = signed.subarray(0, 2).toString("ascii");
  assert.ok(["Ed", "ED"].includes(algorithm));
  const message = algorithm === "ED" ? createHash("blake2b512").update(bytes).digest() : bytes;
  assert.ok(verify(null, message, publicKey, signed.subarray(10)), `${platform}: updater signature`);
  assert.ok(lines[2].startsWith("trusted comment: "));
  assert.ok(
    verify(null, Buffer.concat([signed.subarray(10), Buffer.from(lines[2].slice(17))]), publicKey, Buffer.from(lines[3], "base64")),
    `${platform}: trusted comment signature`,
  );
  const entries = execFileSync("tar", ["-tzf", tarPath], { maxBuffer: 16 * 1024 * 1024 })
    .toString()
    .trim()
    .split("\n");
  assert.ok(entries.every((path) => path === "AD Tools.app" || path.startsWith("AD Tools.app/")));
  assert.ok(entries.every((path) => !path.split("/").some((part) => part.startsWith("._"))));
  const archivedPlist = execFileSync("tar", ["-xOf", tarPath, "AD Tools.app/Contents/Info.plist"]);
  assert.equal(
    execFileSync("plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", "-"], { input: archivedPlist }).toString().trim(),
    manifest.version,
  );
  const app = resolve(root, "tauri/target", triple, "release/bundle/macos/AD Tools.app");
  execFileSync("codesign", ["--verify", "--deep", "--strict", app]);
  const binary = resolve(app, "Contents/MacOS/adtools");
  assert.ok(execFileSync("file", [binary]).toString().includes(architecture));
  assert.ok(entries.some((path) => path.endsWith("_internal/base_library.zip")));
  const dmg = resolve(releaseDir, platform, `ADTools-${manifest.version}-${label}.dmg`);
  const dmgSha = createHash("sha256").update(readFileSync(dmg)).digest("hex");
  assert.equal(dmgSha, entry.installer_sha256);
  const suffix = architecture === "arm64" ? "aarch64" : "x64";
  const builtDmg = resolve(root, "tauri/target", triple, "release/bundle/dmg", `AD Tools_${manifest.version}_${suffix}.dmg`);
  assert.equal(createHash("sha256").update(readFileSync(builtDmg)).digest("hex"), dmgSha);
  execFileSync("hdiutil", ["verify", dmg]);
  platforms.push({
    platform,
    architecture,
    version: manifest.version,
    updaterSignature: "verified against configured public key",
    codeSignature: "valid ad-hoc signature",
    installerSha256: dmgSha,
    tarBytes: bytes.length,
    installerBytes: readFileSync(dmg).length,
    oracleSupport: true,
  });
  console.log(`PASS ${platform}`);
}
writeFileSync(
  resolve(import.meta.dirname, "desktop-artifacts.json"),
  JSON.stringify(
    { verifiedAt: new Date().toISOString(), releaseDir, version: manifest.version, minVersion: manifest.minVersion, platforms },
    null,
    2,
  ) + "\n",
);
