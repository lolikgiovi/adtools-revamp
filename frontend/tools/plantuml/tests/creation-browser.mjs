// PLAYWRIGHT_MODULE=/Users/ddl/node_modules/playwright/index.mjs node frontend/tools/plantuml/tests/creation-browser.mjs
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const output = process.env.PLANTUML_TEST_OUTPUT || "docs/verification/plantuml/creation";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const checks = [],
  errors = [];
let passed = false;
page.on("pageerror", (error) => errors.push(error.message));
const input = page.locator("#puml-new-name");
const nodes = () => page.evaluate(() => window.app.currentTool.workspace.nodes);
const start = (kind) => page.locator(`[data-action="new-${kind}"]`).click();
const create = async (kind, name) => {
  await start(kind);
  assert.equal(await input.evaluate((el) => el === document.activeElement), true);
  assert.equal(await page.locator("dialog[open]").count(), 0);
  await input.fill(name);
  await input.press("Enter");
};
try {
  await page.goto(process.env.PLANTUML_TEST_URL || "http://127.0.0.1:1234");
  await page.waitForFunction(() => Boolean(window.app));
  await page.evaluate(() => window.app.router.navigate("plantuml"));
  await page.locator("#puml-editor .monaco-editor").waitFor();
  assert.equal(await page.locator('[data-action="root"]').count(), 0);
  await create("folder", "e2e-folder");
  const folder = (await nodes()).find((node) => node.name === "e2e-folder");
  assert.equal(folder.parentId, null);
  await create("file", "nested.puml");
  const file = (await nodes()).find((node) => node.name === "nested.puml");
  assert.equal(file.parentId, folder.id);
  assert.match(await page.locator("#puml-path").innerText(), /e2e-folder\/nested.puml/);
  checks.push("root button removed; inline folder creation; selected folder expands; new file opens in editor");
  await start("file");
  await input.fill("NESTED.puml");
  await input.press("Enter");
  assert.equal(await input.getAttribute("aria-invalid"), "true");
  assert.match(await page.locator(".puml-creation-error").innerText(), /already exists/);
  await input.fill("../unsafe");
  await input.press("Enter");
  assert.match(await page.locator(".puml-creation-error").innerText(), /without slashes/);
  await page.screenshot({ path: `${output}/invalid-name.png` });
  await input.fill("sibling.puml");
  await input.press("Enter");
  assert.equal((await nodes()).find((node) => node.name === "sibling.puml").parentId, folder.id);
  checks.push("duplicate and invalid names stay editable; correction succeeds; selected file creates sibling");
  const count = (await nodes()).length;
  await start("folder");
  await input.fill("cancelled");
  await input.press("Escape");
  assert.equal(await input.count(), 0);
  assert.equal((await nodes()).length, count);
  await start("file");
  await input.press("Enter");
  assert.equal(await input.count(), 0);
  await start("file");
  await input.fill("click-away");
  await page.locator("#puml-path").click();
  assert.equal(await input.count(), 0);
  assert.equal((await nodes()).length, count);
  checks.push("Escape, empty Enter, and click away cancel without creating items");
  await page.locator("#puml-explorer").click({ position: { x: 30, y: 650 } });
  assert.equal(await page.locator(".puml-node.selected").count(), 0);
  await create("file", "root.puml");
  assert.equal((await nodes()).find((node) => node.name === "root.puml").parentId, null);
  await page.locator('[data-action="search-files"]').click();
  await page.locator("#puml-search").fill("does-not-exist");
  await start("folder");
  assert.equal(await page.locator("#puml-file-search").isVisible(), false);
  await input.fill("from-search");
  await input.press("Enter");
  checks.push("empty space selects root; creation clears filtering and remains visible");
  await start("file");
  await input.fill("desktop-preview.puml");
  await page.screenshot({ path: `${output}/desktop.png` });
  await input.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-action="explorer"]').click();
  await start("folder");
  await input.fill("mobile-folder");
  const box = await input.boundingBox();
  assert.ok(box.width > 30 && box.x >= 0 && box.x + box.width <= 390);
  await page.screenshot({ path: `${output}/mobile.png` });
  await input.press("Enter");
  checks.push("inline creation fits desktop and mobile");
  await page.waitForFunction(() => document.querySelector("#puml-save")?.textContent === "Saved locally");
  await page.reload();
  await page.waitForFunction(() => Boolean(window.app));
  await page.evaluate(() => window.app.router.navigate("plantuml"));
  await page.locator("#puml-editor .monaco-editor").waitFor();
  assert.ok((await nodes()).some((node) => node.name === "nested.puml"));
  assert.ok((await nodes()).some((node) => node.name === "mobile-folder"));
  checks.push("created files and folders persist after reload");
  assert.deepEqual(errors, []);
  passed = true;
} finally {
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(
      {
        passed,
        checks,
        errors,
        reproduce:
          "Start npm run dev, then PLAYWRIGHT_MODULE=/Users/ddl/node_modules/playwright/index.mjs node frontend/tools/plantuml/tests/creation-browser.mjs",
      },
      null,
      2,
    ),
  );
  await browser.close();
}
console.log(JSON.stringify({ checks, errors }, null, 2));
