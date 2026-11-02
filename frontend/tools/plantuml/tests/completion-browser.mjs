// Real Monaco acceptance checks: keyword-only Tab/Enter, icons, prose context, restrained reference colors.
// Run: PLAYWRIGHT_MODULE=/tmp/adtools-plantuml-e2e/node_modules/playwright/index.mjs \
//   node frontend/tools/plantuml/tests/completion-browser.mjs
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PLANTUML_TEST_URL || "http://127.0.0.1:1234";
const output = process.env.PLANTUML_TEST_OUTPUT || "docs/verification/plantuml/completions";
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
    await page.keyboard.press("Escape");
  }
}
async function suggest(prefix) {
  await page.keyboard.press("Escape");
  await page.evaluate((prefix) => {
    const editor = window.app.currentTool.editor;
    editor.getModel().setValue(`@startuml\n  ${prefix}\n@enduml`);
    editor.setPosition({ lineNumber: 2, column: prefix.length + 3 });
    editor.focus();
    editor.trigger("verification", "editor.action.triggerSuggest", {});
  }, prefix);
  await page.locator("#puml-editor .suggest-widget.visible .monaco-list-row.focused").waitFor({ timeout: 5000 });
}
try {
  await page.goto(base);
  await page.waitForFunction(() => Boolean(window.app));
  await page.evaluate(() => window.app.router.navigate("plantuml"));
  await page.locator("#puml-editor .monaco-editor").waitFor();
  await page.waitForFunction(() => document.querySelector("#puml-status")?.dataset.state === "ready", null, { timeout: 60000 });
  for (const [prefix, word] of [
    ["al", "alt"],
    ["gro", "group"],
    ["loo", "loop"],
    ["not", "note"],
    ["part", "participant"],
    ["act", "activate"],
    ["els", "else"],
    ["opt", "opt"],
    ["endb", "endbox"],
  ]) {
    for (const key of ["Tab", "Enter"])
      await check(`${word} accepts only the keyword with ${key}`, async () => {
        await suggest(prefix);
        assert.match(await page.locator(".suggest-widget.visible .monaco-list-row.focused").innerText(), new RegExp(`\\b${word}\\b`));
        await page.keyboard.press(key);
        assert.equal(await page.evaluate(() => window.app.currentTool.editor.getValue()), `@startuml\n  ${word}\n@enduml`);
        assert.equal(await page.evaluate(() => window.app.currentTool.editor.getPosition().column), word.length + 3);
      });
  }
  await check("completion in the middle of a keyword replaces its suffix", async () => {
    await page.evaluate(() => {
      const e = window.app.currentTool.editor;
      e.getModel().setValue("@startuml\n  group\n@enduml");
      e.setPosition({ lineNumber: 2, column: 6 });
      e.focus();
      e.trigger("verification", "editor.action.triggerSuggest", {});
    });
    await page.locator(".suggest-widget.visible .monaco-list-row.focused").waitFor();
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => window.app.currentTool.editor.getValue()), "@startuml\n  group\n@enduml");
  });
  await check("symbol completion preserves an adjacent arrow", async () => {
    await page.evaluate(() => {
      const e = window.app.currentTool.editor;
      e.getModel().setValue("@startuml\ncontrol API\ndatabase DB\nAP->DB: request\n@enduml");
      e.setPosition({ lineNumber: 4, column: 3 });
      e.focus();
      e.trigger("verification", "editor.action.triggerSuggest", {});
    });
    await page.locator(".suggest-widget.visible .monaco-list-row.focused").waitFor();
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => window.app.currentTool.editor.getModel().getLineContent(4)), "API->DB: request");
  });
  await check("keyword suggestion has a loaded, visible Monaco icon", async () => {
    await suggest("al");
    const icon = page.locator(".suggest-widget.visible .monaco-list-row.focused .suggest-icon");
    await icon.waitFor();
    assert.match(await icon.getAttribute("class"), /codicon-symbol-keyword/);
    await page.evaluate(() => document.fonts.ready);
    const info = await icon.evaluate((el) => ({
      content: getComputedStyle(el, "::before").content,
      family: getComputedStyle(el, "::before").fontFamily,
      width: el.getBoundingClientRect().width,
      fonts: [...document.fonts].filter((font) => font.family.replaceAll('"', "") === "codicon").map((font) => font.status),
    }));
    assert.ok(info.content && !["none", "normal", '""'].includes(info.content), JSON.stringify(info));
    assert.ok(info.family.includes("codicon") && info.fonts.includes("loaded") && info.width > 0, JSON.stringify(info));
    await page.screenshot({ path: `${output}/keyword-icon.png` });
    await page.keyboard.press("Escape");
  });
  await check("keywords are not suggested as the first word in a multiline note", async () => {
    await page.evaluate(() => {
      const e = window.app.currentTool.editor;
      e.getModel().setValue("@startuml\nA -> B: request\nnote right of B\ngro\nend note\n@enduml");
      e.setPosition({ lineNumber: 4, column: 4 });
      e.focus();
      e.trigger("verification", "editor.action.triggerSuggest", {});
    });
    await page.waitForTimeout(250);
    assert.equal(
      await page
        .locator(".suggest-widget.visible .monaco-list-row")
        .filter({ hasText: /^group\b/ })
        .count(),
      0,
    );
    await page.keyboard.press("Escape");
  });
  await check("database, control and variable references are distinct while note prose stays neutral", async () => {
    await page.evaluate(() => {
      const e = window.app.currentTool.editor;
      e.getModel().setValue(
        "@startuml\n!$value = 1\ncontrol API\ndatabase DB\nAPI -> DB: request $value\nnote right of API\nThe database is on and control returns true.\nend note\n@enduml",
      );
    });
    await page.waitForTimeout(700);
    const colors = await page.locator("#puml-editor .view-lines").evaluate((el) => {
      const spans = [...el.querySelectorAll("span")].filter((span) => !span.children.length);
      const color = (value) => {
        const s = spans.find((s) => s.textContent.replace(/\s/g, " ").trim() === value);
        return s && getComputedStyle(s).color;
      };
      return {
        api: color("API"),
        db: color("DB"),
        variable: color("$value"),
        prose: color("The database is on and control returns true."),
      };
    });
    assert.ok(Object.values(colors).every(Boolean), JSON.stringify(colors));
    assert.equal(new Set(Object.values(colors)).size, 4, JSON.stringify(colors));
    await page.waitForFunction(() => document.querySelector("#puml-status").dataset.state === "ready", null, { timeout: 10000 });
    await page.screenshot({ path: `${output}/references.png` });
  });
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
