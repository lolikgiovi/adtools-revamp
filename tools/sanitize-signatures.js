#!/usr/bin/env node
const fs = require('fs');

if (process.argv.length < 3) {
  console.error('Usage: node tools/sanitize-signatures.js <manifest.json>');
  process.exit(1);
}

const manifestPath = process.argv[2];
const data = fs.readFileSync(manifestPath, 'utf8');
const json = JSON.parse(data);

function extractBase64Signature(encoded) {
  const text = Buffer.from(encoded, 'base64').toString('utf8');
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  // Find the first pure base64 line; minisign output provides two base64 lines.
  const base64Line = lines.find(l => /^[A-Za-z0-9+/=]+$/.test(l));
  if (!base64Line) {
    throw new Error('No base64 signature line found in decoded content');
  }
  return base64Line;
}

if (json.platforms && typeof json.platforms === 'object') {
  for (const arch of Object.keys(json.platforms)) {
    const current = json.platforms[arch];
    if (current && typeof current.signature === 'string') {
      try {
        current.signature = extractBase64Signature(current.signature);
      } catch (e) {
        console.error(`Failed to sanitize signature for ${arch}: ${e.message}`);
      }
    }
  }
}

fs.writeFileSync(manifestPath, JSON.stringify(json, null, 2));
console.log('Sanitized signatures in', manifestPath);