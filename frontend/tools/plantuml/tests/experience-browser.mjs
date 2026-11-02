// Failure cases: center-anchored pinch, unlimited wheel/drag pan, resize drift, scale-limit drift,
// multi-touch jumps, unreadable role/variable/response colors, theme preference loss, global theme leakage.
// Reproduce: PLAYWRIGHT_MODULE=/tmp/adtools-plantuml-e2e/node_modules/playwright/index.mjs \
//   node frontend/tools/plantuml/tests/experience-browser.mjs
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PLANTUML_TEST_URL || "http://127.0.0.1:1234";
const output = process.env.PLANTUML_TEST_OUTPUT || "docs/verification/plantuml/experience";
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
try {
  await open();
  await check("compact rail has workspace/search and no Commands button", async () => {
    assert.equal(await page.locator('[data-action="commands"]').count(), 0);
    assert.equal(Math.round((await page.locator(".puml-activity").boundingBox()).width), 36);
    assert.equal(Math.round((await page.locator('[data-action="explorer"] svg').boundingBox()).width), 18);
  });
  await check("trackpad pinch holds the diagram point under the cursor", async () => {
    const error = await page.evaluate(() => {
      const p = window.app.currentTool.preview;
      p.reset();
      p.scale = 1;
      p.layout();
      const rect = p.viewport.getBoundingClientRect();
      const anchor = {
        x: Math.round(rect.left + rect.width / 2 + 35) - rect.left,
        y: Math.round(rect.top + rect.height / 2 - 45) - rect.top,
      };
      const before = { x: (anchor.x - rect.width / 2 - p.x) / p.currentScale(), y: (anchor.y - rect.height / 2 - p.y) / p.currentScale() };
      p.viewport.dispatchEvent(
        new WheelEvent("wheel", {
          ctrlKey: true,
          deltaY: -18,
          clientX: rect.left + anchor.x,
          clientY: rect.top + anchor.y,
          cancelable: true,
        }),
      );
      return Math.max(
        Math.abs((anchor.x - rect.width / 2 - p.x) / p.currentScale() - before.x),
        Math.abs((anchor.y - rect.height / 2 - p.y) / p.currentScale() - before.y),
      );
    });
    assert.ok(error < 0.01, `cursor anchor drifted ${error}px`);
  });
  await check("drag and wheel remain within 30% overscroll at all scales and after resize", async () => {
    const results = await page.evaluate(() => {
      const p = window.app.currentTool.preview;
      const results = [];
      for (const scale of [0.05, 0.5, 1, 4]) {
        p.scale = scale;
        for (const sign of [-1, 1]) {
          p.viewport.dispatchEvent(new WheelEvent("wheel", { deltaX: sign * 100000, deltaY: sign * 100000 }));
          const w = p.viewport.clientWidth,
            h = p.viewport.clientHeight;
          const sw = p.size.width * scale,
            sh = p.size.height * scale;
          results.push(Math.abs(p.x) <= Math.max(0, (sw - w) / 2) + Math.min(sw, w) * 0.3 + 0.01);
          results.push(Math.abs(p.y) <= Math.max(0, (sh - h) / 2) + Math.min(sh, h) * 0.3 + 0.01);
        }
      }
      p.reset();
      return results;
    });
    assert.ok(results.every(Boolean));
    const box = await page.locator("#puml-preview").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width + 800, box.y + box.height + 800);
    await page.mouse.up();
    await page.setViewportSize({ width: 1000, height: 700 });
    await page.waitForTimeout(100);
    assert.ok(
      await page.evaluate(() => {
        const p = window.app.currentTool.preview,
          rect = p.image.getBoundingClientRect(),
          v = p.viewport.getBoundingClientRect();
        return rect.right > v.left && rect.left < v.right && rect.bottom > v.top && rect.top < v.bottom;
      }),
    );
    await page.setViewportSize({ width: 1440, height: 900 });
  });
  await check("touch pinch zooms and translates without jumping when a finger lifts", async () => {
    const result = await page.evaluate(() => {
      const p = window.app.currentTool.preview;
      p.reset();
      p.scale = 1;
      p.layout();
      const r = p.viewport.getBoundingClientRect(),
        x = r.left + r.width / 2,
        y = r.top + r.height / 2;
      // Synthetic touch input still uses real pointer capture targets in the event path.
      const capture = p.viewport.setPointerCapture;
      p.viewport.setPointerCapture = () => {};
      const send = (type, id, dx) =>
        p.viewport.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", button: 0, clientX: x + dx, clientY: y }));
      send("pointerdown", 11, -40);
      send("pointerdown", 12, 40);
      send("pointermove", 12, 80);
      const scale = p.currentScale();
      send("pointerup", 12, 80);
      const before = p.x;
      send("pointermove", 11, -30);
      const delta = p.x - before;
      send("pointerup", 11, -30);
      p.viewport.setPointerCapture = capture;
      p.reset();
      return { scale, delta };
    });
    assert.ok(Math.abs(result.scale - 1.5) < 0.001);
    assert.ok(Math.abs(result.delta - 10) < 0.001);
  });
  await check("syntax separates variables, functions, responses, note text and node members", async () => {
    const tokens = await page.evaluate(async () => {
      const { monaco } = await import("/tools/plantuml/editor.js");
      const source =
        "@startuml\n!$dynamic = 1\n!define LIMIT 3\ncontrol API\ndatabase DB\nAPI -> DB: $find($dynamic)\nDB --> API: response ${value}\nnote right of API\nSELECT id FROM config\nend note\nclass Record {\n+id: String\n}\n@enduml";
      return monaco.editor
        .tokenize(source, "plantuml")
        .flat()
        .map((t) => t.type);
    });
    for (const type of ["variable", "constant", "function", "message.response", "note.content", "member"]) {
      assert.ok(tokens.includes(`${type}.plantuml`), `missing ${type}: ${tokens.join(", ")}`);
    }
  });
  await check("compact arrows and inline notes do not leak syntax state", async () => {
    const lines = await page.evaluate(async () => {
      const { monaco } = await import("/tools/plantuml/editor.js");
      return monaco.editor
        .tokenize(
          `@startuml
control API
database DB
API->DB: request
DB-->API: response
note right of API: Inline text
note "Floating text" as N
' !define FAKE 1
class Record {
+id: String
}
@enduml`,
          "plantuml",
        )
        .map((line) => line.map((token) => token.type));
    });
    assert.ok(lines[3].includes("message.request.plantuml"));
    assert.ok(lines[4].includes("message.response.plantuml"));
    assert.ok(lines[5].includes("note.content.plantuml"));
    assert.ok(lines[6].includes("string.plantuml"));
    assert.ok(lines[7].includes("comment.plantuml"));
    assert.ok(lines[8].includes("class.plantuml"));
    assert.ok(lines[9].includes("member.plantuml"));
  });
  await check("theme chooser persists, keeps role references neutral, and survives app theme changes", async () => {
    await page.getByRole("button", { name: /^Editor theme:/ }).click();
    await page.getByRole("option", { name: "Dark", exact: true }).click();
    const source = "@startuml\ncontrol API\ndatabase DB\nentity Record\nnode Host\nAPI -> DB: find($value)\nDB --> API: response\n@enduml";
    await page.evaluate((source) => window.app.currentTool.editor.getModel().setValue(source), source);
    await page.waitForTimeout(700);
    const roleColors = await page.locator("#puml-editor .view-lines").evaluate((el) => {
      const names = ["API", "DB", "Record", "Host"];
      return names.map((name) => {
        const span = [...el.querySelectorAll("span")].find((s) => s.textContent.trim() === name);
        return span && getComputedStyle(span).color;
      });
    });
    assert.equal(new Set(roleColors).size, 1, JSON.stringify(roleColors));
    assert.ok(roleColors.every(Boolean));
    await page.evaluate(() => document.dispatchEvent(new Event("themeChange")));
    assert.equal(
      await page.locator("#puml-editor .monaco-editor").evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(30, 30, 30)",
    );
    await page.waitForFunction(() => document.querySelector("#puml-status").dataset.state === "ready", null, { timeout: 10000 });
    await page.screenshot({ path: `${output}/dark.png` });
    await open();
    assert.equal(await page.locator("#puml-editor-theme").inputValue(), "dark");
    await page.getByRole("button", { name: /^Editor theme:/ }).click();
    await page.getByRole("option", { name: "Light", exact: true }).click();
    await page.screenshot({ path: `${output}/light.png` });
    await page.getByRole("button", { name: /^Editor theme:/ }).click();
    await page.getByRole("option", { name: "High contrast", exact: true }).click();
    assert.equal(await page.locator("#puml-editor .monaco-editor").evaluate((el) => getComputedStyle(el).backgroundColor), "rgb(0, 0, 0)");
    await page.screenshot({ path: `${output}/high-contrast.png` });
    await page.getByRole("button", { name: /^Editor theme:/ }).click();
    await page.getByRole("option", { name: "Follow app", exact: true }).click();
    const initialTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "dark";
      document.dispatchEvent(new Event("themeChange"));
    });
    assert.equal(
      await page.locator("#puml-editor .monaco-editor").evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(30, 30, 30)",
    );
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
      document.dispatchEvent(new Event("themeChange"));
    }, initialTheme);
    await page.evaluate(() => window.app.router.navigate("json-tools"));
    await page.locator("#json-editor .monaco-editor").waitFor();
    await page.evaluate(() => window.app.router.navigate("plantuml"));
    await page.locator("#puml-editor .monaco-editor").waitFor();
    assert.equal(await page.locator("#puml-editor-theme").inputValue(), "auto");
  });
  for (const width of [1440, 1000, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(100);
    await check(`layout fits ${width}px`, async () => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    });
    await page.screenshot({ path: `${output}/width-${width}.png` });
  }
  assert.deepEqual(errors, []);
} finally {
  await writeFile(
    `${output}/result.json`,
    JSON.stringify({ passed: failures.length === 0 && errors.length === 0, base, checks, failures, errors }, null, 2) + "\n",
  );
  await browser.close();
}
console.log(JSON.stringify({ checks, failures, errors }, null, 2));
assert.deepEqual(failures, []);
