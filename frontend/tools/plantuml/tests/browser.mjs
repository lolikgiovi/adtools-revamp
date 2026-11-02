// Failure cases: stale renders, invalid/remote includes, data loss on reload/disposal,
// conflicting browser tabs, malformed ZIPs, unsafe names/SVG, missing assets in builds,
// shared Monaco worker corruption, and export of outdated content.
// Run with Vite: PLANTUML_TEST_URL=http://127.0.0.1:1234 node frontend/tools/plantuml/tests/browser.mjs
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PLANTUML_TEST_URL || "http://127.0.0.1:1234";
const output = process.env.PLANTUML_TEST_OUTPUT || "docs/verification/plantuml";
const release = JSON.parse(await readFile("frontend/config/release-content.json", "utf8"));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks = [];
const errors = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
await context.addInitScript(
  ({ release }) => {
    localStorage.setItem("user.email", "plantuml-test@example.com");
    localStorage.setItem("user.registered", "true");
    localStorage.setItem(`releaseTour.seen.${encodeURIComponent(release.releaseId)}`, "true");
    for (const tip of release.tips)
      localStorage.setItem(`releaseTip.opened.${encodeURIComponent(release.releaseId)}.${encodeURIComponent(tip.id)}`, "true");
  },
  { release },
);
await context.route("**/*", (route) => (new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort()));
const page = await context.newPage();
page.on("pageerror", (error) => {
  errors.push(error.message);
  console.error(error.stack);
});
async function open() {
  await page.goto(base);
  await page.waitForFunction(() => Boolean(window.app));
  await page.evaluate(() => window.app.router.navigate("plantuml"));
  await page.locator(".plantuml-tool .monaco-editor").waitFor();
}
async function source(value) {
  await page.evaluate((value) => window.app.currentTool.editor.getModel().setValue(value), value);
}
async function rendered() {
  await page.waitForFunction(() => document.querySelector("#puml-status")?.dataset.state === "ready", null, { timeout: 60000 });
}
try {
  await open();
  await rendered();
  assert.equal(await page.locator("#puml-preview img").count(), 1);
  checks.push("starter renders locally with all external requests blocked");
  await page.screenshot({ path: `${output}/desktop.png` });
  await source("@startuml\nAlice -> Bob: verified\n@enduml");
  await rendered();
  const before = await page.locator("#puml-preview img").getAttribute("src");
  await source("@startuml\n!include https://example.com/private.puml\nAlice -> Bob: secret\n@enduml");
  await page.waitForFunction(() => document.querySelector("#puml-status")?.dataset.state === "error");
  assert.equal(await page.locator("#puml-preview img").getAttribute("src"), before);
  assert.equal(await page.locator('[data-action="svg"]').isDisabled(), true);
  checks.push("remote includes rejected; last preview retained; stale export blocked");
  await source("@startuml\n!include ../shared/confluence-colors.puml\nAlice -> Bob: COLOR_BLUE\n@enduml");
  await rendered();
  checks.push("relative workspace includes render");
  const svgDownload = page.waitForEvent("download");
  await page.locator('[data-action="svg"]').click();
  const svg = await svgDownload;
  assert.match(await readFile(await svg.path(), "utf8"), /<svg/);
  const pngDownload = page.waitForEvent("download");
  await page.locator('[data-action="png"]').click();
  const png = await pngDownload;
  assert.equal((await readFile(await png.path())).subarray(1, 4).toString(), "PNG");
  const zipDownload = page.waitForEvent("download");
  await page.locator("#puml-editor").click();
  await page.keyboard.press("ControlOrMeta+Shift+p");
  await page.getByRole("searchbox", { name: "Find a command", exact: true }).fill("Export workspace ZIP");
  await page.keyboard.press("Enter");
  const zip = await zipDownload;
  await zip.saveAs(`${output}/workspace.zip`);
  checks.push("SVG, PNG, and compatible workspace ZIP exported");
  await page.waitForFunction(() => document.querySelector("#puml-save")?.textContent === "Saved locally");
  await open();
  await rendered();
  assert.equal(await page.evaluate(() => window.app.currentTool.editor.getValue().includes("!include ../shared/")), true);
  checks.push("edits survive reload");
  // CRUD, safe names, folder moves, tab switching, and formatting through the real UI.
  await page.locator('[data-action="new-folder"]').click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("../unsafe");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  assert.match(await page.locator(".puml-dialog-error").textContent(), /without slashes/);
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("test-folder");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.locator('[data-action="new-file"]').click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("test.puml");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await source("@startuml\nalt condition\nAlice -> Bob: newest\nend\n@enduml");
  await page.locator('[data-action="format"]').click();
  await page.waitForFunction(() => window.app.currentTool.editor.getValue().includes("\n  Alice -> Bob"));
  assert.match(await page.evaluate(() => window.app.currentTool.editor.getValue()), /\n {2}Alice -> Bob/);
  await rendered();
  await page.getByRole("button", { name: "Rename test.puml", exact: true }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("renamed.puml");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const moved = page.locator(".puml-node").filter({ has: page.getByRole("button", { name: "renamed.puml", exact: true }) });
  await moved.dragTo(page.locator(".puml-root"));
  await page.waitForFunction(() => document.querySelector("#puml-path").textContent === "renamed.puml");
  await page.getByRole("button", { name: "Delete test-folder", exact: true }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.locator('[data-action="palette"]').click();
  assert.equal(await page.locator(".puml-colors button").count(), 36);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  checks.push("file/folder CRUD, unsafe-name rejection, drag move, formatting, and 36-color palette");
  // Rapid edits must leave only the newest render exportable.
  await page.evaluate(() => {
    const model = window.app.currentTool.editor.getModel();
    for (let i = 0; i < 12; i++) model.setValue(`@startuml\nAlice -> Bob: revision-${i}\n@enduml`);
  });
  await rendered();
  assert.match(await page.evaluate(() => window.app.currentTool.diagram.svg), /revision-11/);
  checks.push("rapid edits discard stale render results");
  // Warm resume and actual hard disposal must release iframe/models and restore saved state.
  await page.waitForFunction(() => document.querySelector("#puml-save")?.textContent === "Saved locally");
  await page.evaluate(() => {
    window.plantumlPrevious = window.app.currentTool;
    window.app.router.navigate("json-tools");
  });
  await page.locator("#json-editor .monaco-editor").waitFor();
  await page.evaluate(() => window.app.router.navigate("plantuml"));
  await rendered();
  assert.equal(await page.evaluate(() => window.app.currentTool === window.plantumlPrevious), true);
  await page.evaluate(() => window.app.router.navigate("home"));
  await page.waitForFunction(() => window.app.warmHeavyTools.has("plantuml"));
  await page.evaluate(() => window.app.disposeWarmTool("plantuml", "test-disposal"));
  assert.equal(await page.evaluate(() => window.plantumlPrevious.models.size), 0);
  assert.equal(await page.evaluate(() => window.plantumlPrevious.renderer), null);
  await page.evaluate(() => window.app.router.navigate("plantuml"));
  await page.locator(".plantuml-tool .monaco-editor").waitFor();
  await rendered();
  assert.match(await page.evaluate(() => window.app.currentTool.editor.getValue()), /revision-11/);
  checks.push("shared Monaco tool switch, warm resume, hard disposal, and saved-state restoration");
  await page.locator("#puml-import").setInputFiles(`${output}/workspace.zip`);
  await page.getByRole("button", { name: "Replace workspace", exact: true }).click();
  await rendered();
  assert.equal(await page.locator("#puml-tree").getByText("renamed.puml", { exact: true }).count(), 0);
  assert.match(await page.evaluate(() => window.app.currentTool.editor.getValue()), /!include ../);
  checks.push("workspace ZIP round trip restores files, source, and active tab");
  await page.locator("#puml-editor").click();
  await page.keyboard.press("ControlOrMeta+p");
  await page.getByRole("searchbox", { name: "Find a file", exact: true }).fill("workspace.puml");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("#puml-path").textContent === "diagrams/workspace.puml");
  await rendered();
  await page.locator("#puml-editor").click();
  await page.keyboard.press("ControlOrMeta+Shift+p");
  await page.getByRole("searchbox", { name: "Find a command", exact: true }).fill("fit diagram");
  await page.keyboard.press("Enter");
  await page.locator(".puml-dialog").waitFor({ state: "detached" });
  checks.push("Go to File and command palette keyboard navigation");
  await page.evaluate(() => window.app.eventBus.emit("theme:set", { theme: "github-dark-hc" }));
  await page.waitForFunction(() => document.querySelector("#puml-editor .monaco-editor")?.classList.contains("vs-dark"));
  await page.screenshot({ path: `${output}/dark.png` });
  await page.evaluate(() => window.app.eventBus.emit("theme:set", { theme: "light" }));
  await page.waitForFunction(() => document.querySelector("#puml-editor .monaco-editor")?.classList.contains("vs"));
  checks.push("editor and workspace follow light and dark themes");
  // Malformed import must not replace the current workspace.
  const originalSource = await page.evaluate(() => window.app.currentTool.editor.getValue());
  await page.locator("#puml-import").setInputFiles({ name: "broken.zip", mimeType: "application/zip", buffer: Buffer.from("not a zip") });
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => window.app.currentTool.editor.getValue()), originalSource);
  checks.push("malformed ZIP import retains current files");
  for (const width of [900, 620, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `${output}/width-${width}.png` });
  }
  checks.push("responsive workspace fits at 900, 620, and 390 pixels");
  // A second window saving the same revision must fail visibly without overwriting the first.
  await page.waitForFunction(() => document.querySelector("#puml-save")?.textContent === "Saved locally");
  const other = await context.newPage();
  await other.goto(base);
  await other.waitForFunction(() => Boolean(window.app));
  await other.evaluate(() => window.app.router.navigate("plantuml"));
  await other.locator(".plantuml-tool .monaco-editor").waitFor();
  await other.waitForFunction(() => document.querySelector("#puml-save")?.textContent === "Saved locally");
  await source("@startuml\nAlice -> Bob: conflicting edit\n@enduml");
  await page.waitForFunction(() => document.querySelector("#puml-save")?.textContent === "Not saved");
  assert.match(await page.locator("#puml-storage-error").textContent(), /another window/);
  checks.push("conflicting window save is rejected visibly");
  await other.close();
  assert.deepEqual(errors, []);
  await writeFile(
    `${output}/result.json`,
    JSON.stringify({ passed: true, timestamp: new Date().toISOString(), base, checks, errors }, null, 2) + "\n",
  );
  console.log(checks.join("\n"));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` });
  console.error({ errors, body: (await page.locator("body").innerText()).slice(-2000) });
  throw error;
} finally {
  await browser.close();
}
