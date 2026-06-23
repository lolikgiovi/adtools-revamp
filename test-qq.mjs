import { chromium } from '/Users/mcomacbook/.npm-global/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ headless: false, slowMo: 200 });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

console.log('=== Step 1: Navigate to app ===');
await page.goto('http://localhost:1234', { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(2000);

console.log('=== Step 2: Click Quick Query ===');
const qqButton = page.locator('button, a, [role="button"], .tool-card').filter({ hasText: /quick\s*query/i }).first();
await qqButton.waitFor({ state: 'visible', timeout: 10000 });
await qqButton.click();
await page.waitForTimeout(3000);
await page.screenshot({ path: '/Users/mcomacbook/Documents/projects/ad-tools-revamp/qq-1-initial.png' });
console.log('-> Initial state captured');

console.log('=== Step 3: Type in table name input ===');
const tableInput = page.locator('#tableNameInput');
await tableInput.waitFor({ state: 'visible', timeout: 5000 });
await tableInput.click();
await tableInput.fill('');
await tableInput.type('TEST_TABLE', { delay: 80 });
await page.waitForTimeout(2000);

// Check dropdown
const dropdown = page.locator('#tableNameDropdown');
const ddExists = await dropdown.count();
const ddVisible = ddExists > 0 ? await dropdown.isVisible() : false;
console.log(`-> Dropdown (#tableNameDropdown) exists: ${ddExists}, visible: ${ddVisible}`);

if (ddVisible) {
  const items = await dropdown.locator('> *').count();
  console.log(`-> Dropdown items count: ${items}`);
}

await page.screenshot({ path: '/Users/mcomacbook/Documents/projects/ad-tools-revamp/qq-2-typed-table.png' });

console.log('=== Step 4: Open Schemas overlay ===');
const schemasBtn = page.locator('button').filter({ hasText: 'Schemas' }).first();
console.log(`-> Schemas button text: "${await schemasBtn.textContent()}"`);
await schemasBtn.click();
await page.waitForTimeout(1500);
await page.screenshot({ path: '/Users/mcomacbook/Documents/projects/ad-tools-revamp/qq-3-overlay.png' });

// Close overlay using Escape key instead
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
const overlay = page.locator('#schemaOverlay');
const stillVisible = await overlay.isVisible();
console.log(`-> Overlay still visible after Escape: ${stillVisible}`);

// Try closing via clicking overlay backdrop
if (stillVisible) {
  // Click the overlay background (not the content box)
  await overlay.click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(500);
  const stillVisible2 = await overlay.isVisible();
  console.log(`-> Overlay still visible after backdrop click: ${stillVisible2}`);
}

console.log('=== Step 5: Examine the schema table area ===');
// Check for Handsontable instance
const htTables = await page.locator('.handsontable, .htCore, .ht_master').count();
console.log(`-> Handsontable tables found: ${htTables}`);

// Check what's in the schema table
const schemaCells = await page.locator('.ht_master td, .handsontable td').count();
console.log(`-> Schema table cells: ${schemaCells}`);

if (schemaCells > 0) {
  const firstCellText = await page.locator('.ht_master td').first().textContent();
  console.log(`-> First cell text: "${firstCellText}"`);
}

await page.screenshot({ path: '/Users/mcomacbook/Documents/projects/ad-tools-revamp/qq-4-state.png' });
console.log('-> Final state captured');

console.log('\n=== Summary ===');
const debugInfo = await page.evaluate(() => ({
  url: window.location.href,
  toolTitle: document.querySelector('h1, h2, .tool-title, [class*="title"]')?.textContent?.trim().substring(0, 50),
  schemaTableExists: !!window.QuickQueryUI?.schemaTable,
  tableNameValue: document.getElementById('tableNameInput')?.value,
  overlayClass: document.getElementById('schemaOverlay')?.className,
  overlayHTML: document.getElementById('schemaOverlay')?.innerHTML?.substring(0, 200),
}));
console.log(JSON.stringify(debugInfo, null, 2));

await browser.close();
