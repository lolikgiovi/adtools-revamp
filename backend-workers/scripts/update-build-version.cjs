#!/usr/bin/env node

/**
 * Update web-build.json with the current build identity and release content
 * This script runs automatically before each build via npm prebuild hook
 */

const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..", "..");
const packagePath = path.join(projectRoot, "package.json");
const releaseContentPath = path.join(projectRoot, "frontend", "config", "release-content.json");

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return fallback;
  }
}

// Generate build ID from current timestamp
const now = new Date();
const build = now
  .toISOString()
  .replace(/[-:T.]/g, "")
  .slice(0, 14); // Format: YYYYMMDDHHmmss
const timestamp = now.toISOString();
const packageInfo = readJson(packagePath, {});
const releaseInfo = readJson(releaseContentPath, {});

const buildInfo = {
  build,
  timestamp,
  releaseId: releaseInfo.releaseId || undefined,
  version: releaseInfo.version || packageInfo.version || undefined,
  title: releaseInfo.title || undefined,
  summary: releaseInfo.summary || undefined,
  notes: releaseInfo.notes || undefined,
  image: releaseInfo.image || undefined,
  imageAlt: releaseInfo.imageAlt || undefined,
  imageCaption: releaseInfo.imageCaption || undefined,
  links: Array.isArray(releaseInfo.links) ? releaseInfo.links : undefined,
  action: releaseInfo.action || undefined,
  slides: Array.isArray(releaseInfo.slides) ? releaseInfo.slides : undefined,
  tour: Array.isArray(releaseInfo.tour) ? releaseInfo.tour : undefined,
  tips: Array.isArray(releaseInfo.tips) ? releaseInfo.tips : undefined,
};

Object.keys(buildInfo).forEach((key) => {
  if (buildInfo[key] === undefined) delete buildInfo[key];
});

// Write to frontend/public/web-build.json
const targetPath = path.join(projectRoot, "frontend", "public", "web-build.json");

try {
  fs.writeFileSync(targetPath, JSON.stringify(buildInfo, null, 2) + "\n");
  console.log(`✓ Updated web-build.json with build ID: ${build}`);
  console.log(`  Timestamp: ${timestamp}`);
} catch (error) {
  console.error("✗ Failed to update web-build.json:", error.message);
  process.exit(1);
}
