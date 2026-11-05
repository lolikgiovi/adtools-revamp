import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    "/Users/ddl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs"
);
const base = process.env.TEST_URL || "http://127.0.0.1:1234";
const output = new URL("./", import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const release = JSON.parse(await readFile("frontend/config/release-content.json", "utf8"));
  await context.addInitScript((release) => {
    localStorage.setItem("user.email", "diagrams-check@example.com");
    localStorage.setItem("user.registered", "true");
    localStorage.setItem("theme", "github-dark");
    localStorage.setItem(`releaseTour.seen.${encodeURIComponent(release.releaseId)}`, "true");
    for (const tip of release.tips)
      localStorage.setItem(`releaseTip.opened.${encodeURIComponent(release.releaseId)}.${encodeURIComponent(tip.id)}`, "true");
  }, release);
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort(),
  );
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForFunction(() => Boolean(window.app?.homeWorkspace));
  assert.equal(await page.locator(".home-recent-diagrams").isVisible(), false);
  checks.push("No diagram history: section hidden");
  await page.evaluate(async () => {
    const { PlantUmlStore } = await import("/tools/plantuml/service.js");
    const store = new PlantUmlStore();
    const workspace = await store.load();
    workspace.nodes = Array.from({ length: 6 }, (_, i) => ({
      id: `recent-${i}`,
      name: i === 4 ? "<b>checkout.puml" : `sequence-${i}.puml`,
      kind: "file",
      parentId: null,
      content: "@startuml\nAlice -> Bob: hello\n@enduml",
    }));
    workspace.activeId = "recent-0";
    workspace.tabs = ["recent-0"];
    workspace.expanded = [];
    await store.save(workspace);
    await store.close();
    window.app.globalSearch.recentInteractionStore.touch("quick-query-table:CONFIG.APP");
    window.app.router.navigate("plantuml");
  });
  await page.locator("#puml-editor .monaco-editor").waitFor();
  for (let i = 1; i < 6; i++) await page.locator(`#puml-tree [data-action="open"][data-id="recent-${i}"]`).click();
  await page.waitForFunction(() => document.querySelector("#puml-save")?.textContent === "Saved locally");
  await page.evaluate(() => window.app.router.navigate("home"));
  const section = page.locator(".home-recent-diagrams");
  await section.waitFor({ state: "visible" });
  const ids = () => page.locator("[data-home-diagram]").evaluateAll((rows) => rows.map((row) => row.dataset.homeDiagram));
  assert.deepEqual(await ids(), ["recent-5", "recent-4", "recent-3", "recent-2"]);
  assert.equal(await section.locator("b").count(), 0);
  assert.match(await section.innerText(), /<b>checkout.puml/);
  assert.equal(await section.evaluate((el) => el.previousElementSibling.className), "home-recent-tables");
  checks.push("Four most recent opened files in order, below Recent tables; names escaped");
  await page.screenshot({ path: new URL("desktop.png", output).pathname, fullPage: true });
  await page.locator('[data-home-diagram="recent-4"]').click();
  await page.waitForFunction(() => window.app.currentTool?.activeFile?.id === "recent-4");
  await page.evaluate(() => window.app.currentTool.editor.getModel().setValue("@startuml\nAlice -> Bob: edited\n@enduml"));
  await page.waitForFunction(() => document.querySelector("#puml-save")?.textContent === "Saved locally");
  await page.evaluate(() => window.app.router.navigate("home"));
  await section.waitFor({ state: "visible" });
  assert.equal((await ids())[0], "recent-4");
  checks.push("Home item opens exact file; editing updates recency");
  await page.reload();
  await section.waitFor({ state: "visible" });
  assert.equal((await ids())[0], "recent-4");
  checks.push("History persists across reload");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.mobile === "true");
  if (await page.locator('.sidebar-overlay[data-state="open"]').count()) await page.locator(".sidebar-trigger").click();
  await page.waitForFunction(() => document.querySelector(".sidebar-overlay")?.dataset.state === "closed");
  await page.waitForTimeout(350);
  assert.equal(await section.evaluate((el) => el.scrollWidth <= el.clientWidth), true);
  await page.screenshot({ path: new URL("mobile.png", output).pathname, fullPage: true });
  checks.push("Mobile section has no horizontal overflow");
  await page.evaluate(async () => {
    const { PlantUmlStore } = await import("/tools/plantuml/service.js");
    const store = new PlantUmlStore();
    const workspace = await store.load();
    workspace.nodes = workspace.nodes.filter((node) => node.id !== "recent-4");
    workspace.tabs = workspace.tabs.filter((id) => id !== "recent-4");
    workspace.activeId = "recent-5";
    await store.save(workspace);
    await store.close();
    window.app.renderHomeWorkspace();
  });
  await page.waitForFunction(() => !document.querySelector('[data-home-diagram="recent-4"]'));
  assert.deepEqual(await ids(), ["recent-5", "recent-3", "recent-2", "recent-1"]);
  checks.push("Deleted file excluded; next recent file fills the limit");
  await page.evaluate(() => {
    window.app.homeWorkspace.options.tools = window.app.homeWorkspace.options.tools.filter((tool) => tool.id !== "plantuml");
    window.app.homeWorkspace.render();
  });
  assert.equal(await section.isVisible(), false);
  checks.push("Hidden PlantUML tool hides its recent files");
  console.log(checks.join("\n"));
  await writeFile(new URL("results.json", output), JSON.stringify({ status: "PASS", checks }, null, 2) + "\n");
} finally {
  await browser.close();
}
