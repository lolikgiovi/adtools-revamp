import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
const base = "https://adtools.lolik.workers.dev";
const releaseDir = resolve(process.argv[2]);
const localManifest = JSON.parse(readFileSync(resolve(releaseDir, "stable.json"), "utf8"));
const manifests = [];
for (const path of ["/update/stable.json", "/update/manifest.json"]) {
  const res = await fetch(`${base}${path}`, { cache: "no-store" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), localManifest);
  manifests.push({ path, status: res.status, version: localManifest.version });
}
const artifacts = [];
for (const platform of Object.keys(localManifest.platforms)) {
  for (const name of readdirSync(resolve(releaseDir, platform))) {
    const bytes = readFileSync(resolve(releaseDir, platform, name));
    const url = `${base}/releases/${localManifest.version}/stable/${platform}/${name}`;
    const res = await fetch(url, { method: "HEAD", cache: "no-store", headers: { "Accept-Encoding": "identity" } });
    assert.equal(res.status, 200, url);
    assert.equal(Number(res.headers.get("content-length")), bytes.length, url);
    const etag = res.headers.get("etag")?.replaceAll('"', "");
    const md5Compared = /^[a-f0-9]{32}$/i.test(etag);
    if (md5Compared) assert.equal(etag.toLowerCase(), createHash("md5").update(bytes).digest("hex"), url);
    artifacts.push({ url, status: res.status, bytes: bytes.length, etag, md5Compared });
  }
}
const web = await fetch(`${base}/web-build.json`, { cache: "no-store" });
assert.equal(web.status, 200);
const metadata = await web.json();
assert.equal(metadata.version, localManifest.version);
assert.equal(metadata.releaseId, localManifest.releaseId);
writeFileSync(
  resolve(import.meta.dirname, "production-desktop.json"),
  JSON.stringify(
    {
      verifiedAt: new Date().toISOString(),
      version: localManifest.version,
      minVersion: localManifest.minVersion,
      manifests,
      artifacts,
      webVersion: metadata.version,
      webBuild: metadata.build,
    },
    null,
    2,
  ) + "\n",
);
console.log(`PASS: both stable manifest routes, ${artifacts.length} artifacts, matching Web release`);
