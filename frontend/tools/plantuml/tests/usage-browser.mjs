// Real browser checks that PlantUML usage counts each diagram once per day as a view and once as an edit.
// Ways it could go wrong: renders from typing pauses, file switches, tab resume, renderer restart or reload
// count again (overcount); a read-only open or an edit that renders never counts (undercount).
// Run with Vite: PLAYWRIGHT_MODULE=/tmp/adtools-plantuml-e2e/node_modules/playwright/index.mjs \
//   node frontend/tools/plantuml/tests/usage-browser.mjs
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PLANTUML_TEST_URL || "http://127.0.0.1:1234";
const output = process.env.PLANTUML_TEST_OUTPUT || "docs/verification/plantuml/usage";
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
const ready = () => page.waitForFunction(() => document.querySelector("#puml-status")?.dataset.state === "ready", null, { timeout: 60000 });
async function open() {
  await page.goto(base);
  await page.waitForFunction(() => Boolean(window.app));
  await page.evaluate(async () => {
    const { UsageTracker } = await import("/core/UsageTracker.js");
    window.__plantumlUses = [];
    const original = UsageTracker.trackToolUse.bind(UsageTracker);
    UsageTracker.trackToolUse = (tool, action, meta) => {
      if (tool === "plantuml") window.__plantumlUses.push(action);
      return original(tool, action, meta);
    };
    window.app.router.navigate("plantuml");
  });
  await page.locator("#puml-editor .monaco-editor").waitFor();
  await ready();
}
const uses = () => page.evaluate(() => window.__plantumlUses.slice());
async function type(text) {
  await page.evaluate((text) => {
    const editor = window.app.currentTool.editor;
    const end = editor.getModel().getFullModelRange().getEndPosition();
    editor.executeEdits("test", [
      { range: { startLineNumber: end.lineNumber, startColumn: 1, endLineNumber: end.lineNumber, endColumn: 1 }, text },
    ]);
  }, text);
  await page.waitForTimeout(1300);
  await ready();
}
try {
  await page.goto(base);
  await page.evaluate(() => localStorage.removeItem("plantuml.usage.counted"));
  await open();
  await check("opening a diagram counts one view", async () => assert.deepEqual(await uses(), ["view"]));
  await check("re-renders without edits do not count again", async () => {
    await page.evaluate(() => window.app.currentTool.refresh());
    await ready();
    await page.evaluate(() => window.app.currentTool.onWarmResume());
    await ready();
    assert.deepEqual(await uses(), ["view"]);
  });
  await check("several edits with render pauses count one edit", async () => {
    for (const text of ["' one\n", "' two\n", "' three\n"]) await type(text);
    assert.deepEqual(await uses(), ["view", "edit"]);
  });
  await check("raw renders are never reported as uses", async () => assert.ok(!(await uses()).includes("render")));
  await open();
  await check("reloading the same day counts nothing new", async () => {
    await type("' four\n");
    assert.deepEqual(await uses(), []);
  });
  await page.screenshot({ path: `${output}/after-reload.png` });
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
