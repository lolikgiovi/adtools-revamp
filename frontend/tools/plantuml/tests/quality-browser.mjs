import { formatFixtures } from "./format-fixtures.mjs";
// Browser checks for dialog centering, the real Format action, render debounce,
// and actionable errors. Fixtures record exact expected indentation and idempotence.
// Run: PLAYWRIGHT_MODULE=/tmp/adtools-plantuml-e2e/node_modules/playwright/index.mjs \
//   node frontend/tools/plantuml/tests/quality-browser.mjs
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PLANTUML_TEST_URL || "http://127.0.0.1:1234";
const output = process.env.PLANTUML_TEST_OUTPUT || "docs/verification/plantuml/quality";
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
const failures = [];
async function check(name, run) {
  try {
    await run();
    checks.push(name);
  } catch (error) {
    failures.push({ name, error: error.message });
  }
}
async function renderNow() {
  await page.evaluate(() => {
    const tool = window.app.currentTool;
    tool.renderer.render(tool.activeFile, tool.workspace.nodes);
  });
  await page.waitForFunction(() => ["ready", "error"].includes(document.querySelector("#puml-status").dataset.state), null, {
    timeout: 10000,
  });
  assert.equal(await page.locator("#puml-status").getAttribute("data-state"), "ready", await page.locator("#puml-error").textContent());
  return page.evaluate(
    () => new DOMParser().parseFromString(window.app.currentTool.diagram.svg, "image/svg+xml").documentElement.textContent,
  );
}
async function source(text) {
  await page.evaluate((text) => window.app.currentTool.editor.getModel().setValue(text), text);
}
try {
  await open();
  const example = await page.evaluate(() => window.app.currentTool.editor.getValue());
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (await page.locator("#puml-explorer").isHidden()) await page.locator('[data-action="explorer"]').click();
    for (const action of ["new-file", "new-folder", "palette"]) {
      if (width <= 760 && action === "palette") await page.locator('[data-action="explorer"]').click();
      await check(`${action} dialog is centered at ${width}px`, async () => {
        await page.locator(`[data-action="${action}"]`).click();
        const box = await page.locator(".puml-dialog").boundingBox();
        assert.ok(Math.abs(box.x + box.width / 2 - width / 2) < 2);
        assert.ok(Math.abs(box.y + box.height / 2 - 450) < 2);
      });
      await page.keyboard.press("Escape");
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await check("preview icon flips and its accessible action changes", async () => {
    const button = page.locator('[data-action="preview"]');
    const before = await button.innerHTML();
    await button.click();
    assert.notEqual(await button.innerHTML(), before);
    assert.match(await button.getAttribute("aria-label"), /Show preview/);
    await button.click();
    assert.equal(await button.innerHTML(), before);
    assert.match(await button.getAttribute("aria-label"), /Hide preview/);
  });
  if (await page.locator(".puml-preview-pane").isHidden()) await page.locator('[data-action="preview"]').click();
  await check("activity rail omits Commands", async () => {
    assert.equal(await page.locator('[data-action="commands"]').count(), 0);
  });
  const results = [];
  for (const fixture of [
    { name: "bundled sequence example", source: example, expected: example },
    {
      name: "unindented bundled sequence",
      source: example
        .split("\n")
        .map((line) => line.trim())
        .join("\n"),
      expected: example,
    },
    ...formatFixtures,
  ]) {
    await check(`format: ${fixture.name}`, async () => {
      await source(fixture.source);
      await page.evaluate(() => window.app.currentTool.action("format"));
      const formatted = await page.evaluate(() => window.app.currentTool.editor.getValue());
      assert.equal(formatted, fixture.expected);
      await page.evaluate(() => window.app.currentTool.action("format"));
      assert.equal(await page.evaluate(() => window.app.currentTool.editor.getValue()), formatted);
      results.push({ name: fixture.name, source: fixture.source, formatted });
      if (!/quoted and commented|one-line headers|multiple diagrams|non-UML/.test(fixture.name)) {
        await source(fixture.source);
        const originalText = await renderNow();
        await source(formatted);
        assert.equal(await renderNow(), originalText, "formatting must preserve rendered text");
      }
    });
  }
  await source("@startuml\nAlice -> Bob: valid\n@enduml");
  await page.waitForFunction(() => document.querySelector("#puml-status").dataset.state === "ready", null, { timeout: 60000 });
  const previous = await page.locator("#puml-preview img").getAttribute("src");
  await check("editing waits one second, preserves the diagram, and explains syntax errors", async () => {
    await source("@startuml\nAlice -> Bob: valid\nthis is definitely invalid $$$\n@enduml");
    await page.waitForTimeout(400);
    assert.equal(await page.locator("#puml-status").getAttribute("data-state"), "waiting");
    assert.equal(await page.locator("#puml-error").isVisible(), false);
    assert.equal(await page.locator("#puml-preview img").getAttribute("src"), previous);
    await source("@startuml\nAlice -> Bob: valid\nthis is definitely invalid $$$ again\n@enduml");
    await page.waitForTimeout(400);
    assert.equal(await page.locator("#puml-status").getAttribute("data-state"), "waiting");
    await page.waitForFunction(() => document.querySelector("#puml-status").dataset.state === "error", null, { timeout: 10000 });
    const message = await page.locator("#puml-error").innerText();
    assert.match(message, /line 3/i);
    assert.doesNotMatch(message, /git|commit|PlantUML version|1\.2026|java\./i);
    assert.equal(await page.locator("#puml-preview img").getAttribute("src"), previous);
    await page.getByRole("button", { name: "Go to error", exact: true }).click();
    assert.equal(await page.evaluate(() => window.app.currentTool.editor.getPosition().lineNumber), 3);
    await page.screenshot({ path: `${output}/syntax-error.png` });
    await source("@startuml\nAlice -> Bob: fixed\n@enduml");
    assert.equal(await page.locator("#puml-error").isVisible(), false);
    await page.waitForFunction(() => document.querySelector("#puml-status").dataset.state === "ready", null, { timeout: 10000 });
  });
  await page.locator('[data-action="palette"]').click();
  await page.screenshot({ path: `${output}/centered-dialog.png` });
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `${output}/desktop.png` });
  await writeFile(`${output}/formatted-examples.json`, JSON.stringify(results, null, 2) + "\n");
  await writeFile(`${output}/result.json`, JSON.stringify({ passed: failures.length === 0, checks, failures, errors }, null, 2) + "\n");
  console.log(JSON.stringify({ checks, failures, errors }, null, 2));
  assert.deepEqual(failures, []);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
