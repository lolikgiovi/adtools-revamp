import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:1235" && !/^\/(api|analytics|register|dashboard)\//.test(url.pathname)) return route.continue();
    return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"publications":[],"tools":[]}' });
  });
  await page.addInitScript(() => {
    localStorage.setItem("user.registered", "true");
    localStorage.setItem("user.email", "fixture@bankmandiri.co.id");
    localStorage.setItem("user.username", "Fixture");
    localStorage.setItem("sidebar.pinnedTools.v1", '["run-query","run-batch"]');
  });
  await page.goto("http://127.0.0.1:1235");
  await page.waitForFunction(() => window.app?.globalSearch);
  for (const department of ["", "SME", "RETAIL", " retail ", "WHOLESALE"]) {
    const allowed = department.trim().toUpperCase() === "RETAIL";
    const visibility = await page.evaluate(async (department) => {
      localStorage.setItem("user.department", department);
      window.__TAURI__ = {};
      window.app.eventBus.emit("user:registered", { username: "Fixture" });
      await window.app.sidebar.renderTools();
      const result = {
        sidebar: !!document.querySelector('[data-tool="run-query"]'),
        search: window.app.globalSearch.index.some((x) => x.id === "run-query"),
        batch: !!document.querySelector('[data-tool="run-batch"]'),
        batchSearch: window.app.globalSearch.index.some((x) => x.id === "run-batch"),
      };
      delete window.__TAURI__;
      return result;
    }, department);
    assert.deepEqual(visibility, { sidebar: allowed, search: allowed, batch: allowed, batchSearch: allowed });
    await page.evaluate(() => window.app.router.navigate("quick-query"));
    await page.locator("#executeInJenkinsRunner").waitFor({ state: "attached" });
    assert.equal(await page.locator("#executeInJenkinsRunner").isVisible(), allowed);
    if (!allowed) {
      for (const toolId of ["run-query", "run-batch"]) {
        await page.evaluate((toolId) => window.app.router.navigate(toolId), toolId);
        await page.waitForFunction(() => window.app.router.getCurrentRoute() === "home");
      }
    }
    results.push({ department: department || "(missing)", allowed, status: "PASS" });
    await page.screenshot({
      path: new URL(`./${department.trim().toLowerCase() || "missing"}.png`, import.meta.url).pathname,
      animations: "disabled",
    });
  }
} finally {
  writeFileSync(new URL("./results.json", import.meta.url), JSON.stringify(results, null, 2) + "\n");
  await browser.close();
}
