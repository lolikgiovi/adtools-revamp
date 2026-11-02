// Real Monaco/browser checks for prose-safe syntax, curated themes and compact preview controls.
// Run with Vite: PLAYWRIGHT_MODULE=/tmp/adtools-plantuml-e2e/node_modules/playwright/index.mjs \
//   node frontend/tools/plantuml/tests/quiet-browser.mjs
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PLANTUML_TEST_URL || "http://127.0.0.1:1234";
const output = process.env.PLANTUML_TEST_OUTPUT || "docs/verification/plantuml/quiet";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const checks = [],
  failures = [],
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
async function check(name, run) {
  try {
    await run();
    checks.push(name);
  } catch (error) {
    failures.push({ name, error: error.message });
  }
}
async function open() {
  await page.goto(base);
  await page.waitForFunction(() => Boolean(window.app));
  await page.evaluate(() => window.app.router.navigate("plantuml"));
  await page.locator("#puml-editor .monaco-editor").waitFor();
  await page.waitForFunction(() => document.querySelector("#puml-status")?.dataset.state === "ready", null, { timeout: 60000 });
}
const fixture = `@startuml
control "API" as api
database "Database" as db
title Keep control on the database
api -> db: turn on the control and return 200
note right of api
The feature is on and the user can return true.
Please SELECT a database FROM the list, then JOIN the group.
Keep node, class and entity names in the sentence.
Explicit value: $enabled
end note
group Return to the database if the control is on
api --> db: response $result
end
@enduml`;
try {
  await open();
  await check("ordinary words and numbers in prose are neutral; explicit variables remain highlighted", async () => {
    const tokens = await page.evaluate(async (source) => {
      const { monaco } = await import("/tools/plantuml/editor.js");
      return monaco.editor.tokenize(source, "plantuml").map((line) => line.map((t) => t.type));
    }, fixture);
    for (const index of [3, 4, 6, 7, 8, 11]) {
      const colored = tokens[index].filter((type) =>
        /^(?:keyword|constant|number|function|database|control|entity|node|class)\b/.test(type),
      );
      // Only the leading structural keyword of a title/group should retain its accent.
      assert.equal(colored.length, [3, 11].includes(index) ? 1 : 0, `line ${index + 1}: ${tokens[index]}`);
    }
    assert.ok(tokens[9].includes("variable.plantuml"));
    assert.ok(tokens[12].includes("variable.plantuml"));
  });
  await check("preview footer is at most 30px, with no render-time counter", async () => {
    assert.ok((await page.locator(".puml-preview-footer").boundingBox()).height <= 30);
    assert.equal(await page.locator("#puml-status").innerText(), "");
    for (const action of ["zoom-in", "zoom-out", "actual-size", "fit"])
      assert.ok(await page.locator(`[data-action="${action}"]`).isVisible());
    const before = await page.evaluate(() => window.app.currentTool.preview.currentScale());
    await page.locator('[data-action="zoom-in"]').click();
    assert.ok(await page.evaluate((before) => window.app.currentTool.preview.currentScale() > before, before));
  });
  await page.evaluate((source) => window.app.currentTool.editor.getModel().setValue(source), fixture);
  await page.waitForFunction(() => document.querySelector("#puml-status").dataset.state === "ready", null, { timeout: 10000 });
  await check("expanded themes render, preserve text and persist on reload", async () => {
    const themes = {
      "GitHub Light": "github-light",
      "Solarized Light": "solarized-light",
      "One Dark": "one-dark",
      Dracula: "dracula",
      Nord: "nord",
      "Catppuccin Mocha": "catppuccin-mocha",
    };
    const backgrounds = new Set();
    for (const [label, value] of Object.entries(themes)) {
      await page.getByRole("button", { name: /^Editor theme:/ }).click();
      await page.getByRole("option", { name: label, exact: true }).click();
      assert.equal(await page.locator("#puml-editor-theme").inputValue(), value);
      assert.equal(await page.evaluate(() => window.app.currentTool.editor.getValue()), fixture);
      backgrounds.add(await page.locator("#puml-editor .monaco-editor").evaluate((el) => getComputedStyle(el).backgroundColor));
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${output}/${value}.png` });
    }
    assert.equal(backgrounds.size, Object.keys(themes).length);
    await open();
    assert.equal(await page.locator("#puml-editor-theme").inputValue(), "catppuccin-mocha");
  });
  await check("compact footer retains errors and editing feedback", async () => {
    await page.evaluate(() => window.app.currentTool.editor.getModel().setValue("@startuml\nA -> B: valid\nthis is invalid $$$\n@enduml"));
    assert.match(await page.locator("#puml-status").innerText(), /Editing/);
    await page.waitForFunction(() => document.querySelector("#puml-status").dataset.state === "error", null, { timeout: 10000 });
    assert.ok(await page.locator("#puml-error").isVisible());
    assert.match(await page.locator("#puml-status").innerText(), /fix/);
    await page.evaluate((source) => window.app.currentTool.editor.getModel().setValue(source), fixture);
    await page.waitForFunction(() => document.querySelector("#puml-status").dataset.state === "ready", null, { timeout: 10000 });
  });
  for (const width of [1000, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(250);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    await check(`compact controls fit ${width}px`, async () => {
      assert.ok((await page.locator(".puml-preview-footer").boundingBox()).height <= 30);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    });
    await page.screenshot({ path: `${output}/width-${width}.png` });
  }
} finally {
  await writeFile(
    `${output}/result.json`,
    JSON.stringify({ passed: !failures.length && !errors.length, base, checks, failures, errors }, null, 2) + "\n",
  );
  await browser.close();
}
console.log(JSON.stringify({ checks, failures, errors }, null, 2));
assert.deepEqual(failures, []);
assert.deepEqual(errors, []);
