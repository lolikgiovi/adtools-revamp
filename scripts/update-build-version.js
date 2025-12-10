#!/usr/bin/env node

/**
 * Update web-build.json with current timestamp
 * This script runs automatically before each build via npm prebuild hook
 */

const fs = require('fs');
const path = require('path');

// Generate build ID from current timestamp
const now = new Date();
const build = now.toISOString().replace(/[-:T.]/g, '').slice(0, 14); // Format: YYYYMMDDHHmmss
const timestamp = now.toISOString();

const buildInfo = {
  build,
  timestamp
};

// Write to public/web-build.json
const targetPath = path.join(__dirname, '..', 'public', 'web-build.json');

try {
  fs.writeFileSync(
    targetPath,
    JSON.stringify(buildInfo, null, 2) + '\n'
  );
  console.log(`✓ Updated web-build.json with build ID: ${build}`);
  console.log(`  Timestamp: ${timestamp}`);
} catch (error) {
  console.error('✗ Failed to update web-build.json:', error.message);
  process.exit(1);
}
