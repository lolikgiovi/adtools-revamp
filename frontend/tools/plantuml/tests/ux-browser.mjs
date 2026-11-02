// Real-browser regression checks: zoom feedback, Monaco hover chrome, resizing,
// preview visibility, font preferences, full-bleed layout, and navigation isolation.
// Reproduce: PLAYWRIGHT_MODULE=/tmp/adtools-plantuml-e2e/node_modules/playwright/index.mjs \
//   node frontend/tools/plantuml/tests/ux-browser.mjs
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PLANTUML_TEST_URL || "http://127.0.0.1:1234";
const output = process.env.PLANTUML_TEST_OUTPUT || "docs/verification/plantuml/ux";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const checks = [];
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
async function open() {
  await page.goto(base);
  await page.waitForFunction(() => Boolean(window.app));
  await page.evaluate(() => window.app.router.navigate("plantuml"));
  await page.locator("#puml-editor .monaco-editor").waitFor();
  await page.waitForFunction(() => document.querySelector("#puml-status")?.dataset.state === "ready", null, { timeout: 60000 });
}
async function drag(selector, delta) {
  const box = await page.locator(selector).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + delta, box.y + box.height / 2, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}
try {
  await open();
  const scale = await page.evaluate(() => window.app.currentTool.preview.currentScale());
  await page.locator('[data-action="zoom-in"]').click();
  const zoom = await page.locator('[data-action="actual-size"]').innerText();
  assert.equal(zoom, `${Math.round(Math.min(4, scale * 1.2) * 100)}%`);
  await page.locator('[data-action="zoom-out"]').click();
  await page.locator('[data-action="actual-size"]').click();
  assert.equal(await page.evaluate(() => window.app.currentTool.preview.currentScale()), 1);
  await page.locator('[data-action="fit"]').click();
  assert.equal(await page.locator('[data-action="fit"]').getAttribute("aria-pressed"), "true");
  checks.push("zoom percentage reflects actual scale; actual size and Fit have distinct states");
  assert.equal(await page.locator(".main-content").evaluate((el) => getComputedStyle(el).padding), "0px");
  const expandedWidth = (await page.locator(".plantuml-tool").boundingBox()).width;
  await page.locator(".sidebar-trigger").click();
  await page.waitForTimeout(300);
  const fullWidth = await page.locator(".plantuml-tool").boundingBox();
  assert.ok(fullWidth.width > expandedWidth + 100);
  assert.ok(fullWidth.x <= 1);
  await page.screenshot({ path: `${output}/sidebar-collapsed.png` });
  await page.locator(".sidebar-trigger").click();
  await page.waitForTimeout(300);
  checks.push("PlantUML fills the shell without outer padding and expands when the app sidebar collapses");
  await page.getByRole("button", { name: /^Editor font size:/ }).click();
  await page.getByRole("option", { name: "11 px", exact: true }).click();
  assert.equal(await page.evaluate(() => window.app.currentTool.editor.getRawOptions().fontSize), 11);
  await open();
  assert.equal(await page.locator("#puml-font-size").inputValue(), "11");
  checks.push("editor font size is adjustable and survives reload");
  await page.locator("#puml-editor").click();
  await page.keyboard.press("ControlOrMeta+f");
  await page.locator('.find-widget textarea[aria-label="Find"]').hover();
  await page.waitForTimeout(1000);
  const hover = page.locator(".workbench-hover:visible");
  assert.equal(await hover.count(), 1);
  assert.equal(await hover.evaluate((el) => getComputedStyle(el).position), "relative");
  assert.notEqual(await hover.evaluate((el) => getComputedStyle(el).backgroundColor), "rgba(0, 0, 0, 0)");
  await page.screenshot({ path: `${output}/find.png` });
  await page.keyboard.press("Escape");
  checks.push("Find hover is a compact opaque tooltip rather than bare overlapping text");
  for (const width of [1440, 1000]) {
    await page.setViewportSize({ width, height: 900 });
    const before = await page.locator(".puml-editor-pane").boundingBox();
    const src = await page.locator("#puml-preview img").getAttribute("src");
    await drag(".puml-resizer", -80);
    const after = await page.locator(".puml-editor-pane").boundingBox();
    assert.ok(after.width < before.width - 30, `editor resize at ${width}px`);
    assert.equal(await page.locator("#puml-preview img").getAttribute("src"), src);
    assert.equal(await page.locator("#puml-preview img").isVisible(), true);
    const explorer = await page.locator("#puml-explorer").boundingBox();
    await drag(".puml-explorer-resizer", 45);
    assert.ok((await page.locator("#puml-explorer").boundingBox()).width > explorer.width + 20);
  }
  checks.push("both dividers resize at desktop and intermediate widths without replacing the diagram");
  await page.locator('[data-action="preview"]').click();
  assert.equal(await page.locator(".puml-preview-pane").isVisible(), false);
  await page.locator('[data-action="preview"]').click();
  assert.equal(await page.locator("#puml-preview img").isVisible(), true);
  await page.locator('[data-action="explorer"]').click();
  await page.locator('[data-action="preview"]').click();
  assert.equal(await page.locator("#puml-explorer").isVisible(), false);
  assert.equal(await page.locator(".puml-preview-pane").isVisible(), false);
  const editorOnly = await page.locator(".puml-editor-pane").boundingBox();
  const workspace = await page.locator(".puml-workspace").boundingBox();
  assert.ok(Math.abs(editorOnly.width - workspace.width) < 1);
  await page.locator('[data-action="explorer"]').click();
  await page.locator('[data-action="preview"]').click();
  const divider = page.locator(".puml-resizer");
  await divider.focus();
  const beforeKey = Number(await divider.getAttribute("aria-valuenow"));
  await page.keyboard.press("ArrowRight");
  assert.ok(Number(await divider.getAttribute("aria-valuenow")) > beforeKey);
  checks.push("preview and files toggle independently; editor expands fully; keyboard resizing works");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: `${output}/desktop.png` });
  for (const width of [620, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('[data-action="preview"]').click();
    assert.equal(await page.locator(".puml-preview-pane").isVisible(), false);
    await page.locator('[data-action="preview"]').click();
    await page.screenshot({ path: `${output}/width-${width}.png` });
  }
  checks.push("narrow layouts fit the viewport and support preview toggling");
  await page.evaluate(() => window.app.router.navigate("json-tools"));
  await page.locator("#json-editor .monaco-editor").waitFor();
  assert.notEqual(await page.locator(".main-content").evaluate((el) => getComputedStyle(el).padding), "0px");
  checks.push("other tools retain their shell padding");
  assert.deepEqual(errors, []);
  await writeFile(`${output}/result.json`, JSON.stringify({ passed: true, base, checks, errors }, null, 2) + "\n");
  console.log(checks.join("\n"));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` });
  throw error;
} finally {
  await browser.close();
}
