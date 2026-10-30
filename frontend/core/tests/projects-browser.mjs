// End-to-end project isolation. Run against Vite with an already installed Playwright.
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PROJECTS_TEST_URL || "http://localhost:1234";
const output = resolve("docs/verification/projects");
const release = JSON.parse(await readFile("frontend/config/release-content.json", "utf8"));
await mkdir(output, { recursive: true });
async function chooseProject(page, id) {
  const name = await page.locator(`select.project-settings-select option[value="${id}"]`).innerText();
  await page.locator(".project-controls .ad-searchable-dropdown-trigger").click();
  await page.getByRole("option", { name, exact: true }).click();
}
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addInitScript(
      ({ release }) => {
        if (localStorage.getItem("projects-fixture")) return;
        localStorage.setItem("projects-fixture", "1");
        localStorage.setItem("user.email", "dev@localhost");
        localStorage.setItem("user.registered", "true");
        localStorage.setItem("user.department", "RETAIL");
        localStorage.setItem(`releaseTour.seen.${encodeURIComponent(release.releaseId)}`, "true");
        for (const tip of release.tips)
          localStorage.setItem(`releaseTip.opened.${encodeURIComponent(release.releaseId)}.${encodeURIComponent(tip.id)}`, "true");
        localStorage.setItem("config.environments", JSON.stringify([{ id: "uat", name: "UAT", cdnPublicUrl: "https://legacy.example" }]));
      },
      { release },
    );
    await context.route("**/*", (route) => (new URL(route.request().url()).origin === base ? route.continue() : route.abort()));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await page.waitForFunction(() => Boolean(window.app));
    await page.evaluate(() => window.app.router.navigate("settings"));
    await page.locator(".project-add").waitFor();
    assert.match(await page.locator(".environments-list").innerText(), /legacy.example/);
    const firstId = await page.locator("select.project-settings-select").inputValue();
    await page.locator(".project-add").click();
    await page.locator(".project-name-input").fill("Payments");
    await Promise.all([page.waitForEvent("load"), page.locator(".project-name-save").click()]);
    await page.locator(".project-add").waitFor();
    assert.equal(await page.locator(".project-settings-select option:checked").innerText(), "Payments");
    assert.match(await page.locator(".environments-list").innerText(), /No environments/);
    await page.locator(".environment-add-btn").click();
    await page.locator(".environment-name").fill("SIT");
    await page.locator(".environment-public-url").fill("https://payments.example");
    await page.locator(".environment-save").click();
    const secondId = await page.locator("select.project-settings-select").inputValue();
    await page.locator(".project-rename").click();
    await page.locator(".project-name-input").fill("Payments v2");
    await page.locator(".project-name-save").click();
    assert.equal(await page.locator(".project-settings-select option:checked").innerText(), "Payments v2");
    const catalogs = await page.evaluate(async () => {
      const { IndexedDBStorageService } = await import("/tools/quick-query/services/IndexedDBStorageService.js");
      const storage = new IndexedDBStorageService();
      await storage.init();
      await storage.saveSchema("APP.PAYMENTS", [["ID", "NUMBER", "Yes", "", "", ""]]);
      await storage.saveQueryTab({ id: "draft", tableName: "APP.PAYMENTS", inputData: [["project-only"]] });
      return (await storage.getAllTables()).map((table) => table.fullName);
    });
    assert.deepEqual(catalogs, ["APP.PAYMENTS"]);
    await Promise.all([page.waitForEvent("load"), chooseProject(page, firstId)]);
    await page.locator(".project-add").waitFor();
    assert.match(await page.locator(".environments-list").innerText(), /legacy.example/);
    const first = await page.evaluate(async () => {
      const { IndexedDBStorageService } = await import("/tools/quick-query/services/IndexedDBStorageService.js");
      const storage = new IndexedDBStorageService();
      await storage.init();
      return { tables: await storage.getAllTables(), draft: await storage.getQueryTab("draft") };
    });
    assert.deepEqual(first.tables, []);
    assert.equal(first.draft, null);
    await Promise.all([page.waitForEvent("load"), chooseProject(page, secondId)]);
    await page.locator(".project-add").waitFor();
    assert.match(await page.locator(".environments-list").innerText(), /payments.example/);
    if (width === 1440) assert.equal(await page.locator("select.sidebar-project-select").inputValue(), secondId);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: resolve(output, `${width}-projects.png`), fullPage: true });
    assert.deepEqual(errors, []);
    checks.push(
      `${width}px: migrated legacy environment, created/renamed/switched projects, isolated schemas and drafts, restored environments, no overflow/errors`,
    );
    await context.close();
  }
  await writeFile(resolve(output, "result.json"), JSON.stringify({ passed: true, checks }, null, 2) + "\n");
  console.log(checks.join("\n"));
} finally {
  await browser.close();
}
