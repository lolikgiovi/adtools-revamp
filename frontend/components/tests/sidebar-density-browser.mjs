// Reproduce with Vite and an already installed Playwright; no production requests.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.SIDEBAR_TEST_URL || "http://127.0.0.1:1247";
const output = resolve("docs/verification/sidebar-density");
const release = JSON.parse(await readFile("frontend/config/release-content.json", "utf8"));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks = [];
const errors = [];
try {
  for (const touch of [false, true]) {
    const context = await browser.newContext({ viewport: { width: touch ? 390 : 1440, height: 900 }, hasTouch: touch, isMobile: touch });
    await context.addInitScript(
      ({ release }) => {
        localStorage.setItem("user.email", "dev@localhost");
        localStorage.setItem("user.registered", "true");
        localStorage.setItem("theme", "github-dark-hc");
        localStorage.setItem(`releaseTour.seen.${encodeURIComponent(release.releaseId)}`, "true");
        for (const tip of release.tips)
          localStorage.setItem(`releaseTip.opened.${encodeURIComponent(release.releaseId)}.${encodeURIComponent(tip.id)}`, "true");
      },
      { release },
    );
    await context.route("**/*", (route) => (new URL(route.request().url()).origin === base ? route.continue() : route.abort()));
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await page.waitForFunction(() => Boolean(window.app?.sidebar));
    await page.waitForTimeout(300);
    await page.evaluate(() => document.fonts.ready);
    if (touch) {
      await page.locator(".sidebar-trigger").click();
    } else {
      await page.evaluate(async () => {
        window.__TAURI__ = {};
        document.documentElement.dataset.tauri = "true";
        window.app.placeHeaderControls(true);
        await window.app.sidebar.renderTools();
        await window.app.sidebar.renderMenuGroups();
      });
    }
    await page.waitForTimeout(200);
    await page.evaluate(() => window.app.router.navigate("settings"));
    await page.locator(".project-name-save").waitFor();
    const metrics = await page.locator(".sidebar").evaluate((sidebar) => {
      const button = sidebar.querySelector(".sidebar-menu-button");
      const label = sidebar.querySelector(".sidebar-group-label");
      const list = sidebar.querySelector(".sidebar-content");
      const project = sidebar.querySelector(".sidebar-project .ad-searchable-dropdown-trigger");
      return {
        rowHeight: button.getBoundingClientRect().height,
        projectHeight: project.getBoundingClientRect().height,
        projectFontSize: getComputedStyle(project).fontSize,
        projectWeight: getComputedStyle(project).fontWeight,
        rowWeight: getComputedStyle(button).fontWeight,
        projectPadding: getComputedStyle(project).paddingInlineStart,
        rowPadding: getComputedStyle(button).paddingInlineStart,
        fontSize: getComputedStyle(button).fontSize,
        iconSize: getComputedStyle(button.querySelector("svg")).width,
        groupFontSize: getComputedStyle(label).fontSize,
        contentHeight: list.scrollHeight,
        visibleHeight: list.clientHeight,
        searchHeight: document.querySelector(".header-search").getBoundingClientRect().height,
      };
    });
    if (!process.env.SIDEBAR_BASELINE) {
      assert.equal(metrics.rowHeight, touch ? 40 : 30);
      assert.equal(metrics.fontSize, touch ? "14px" : "13px");
      assert.equal(metrics.projectHeight, metrics.rowHeight);
      assert.equal(metrics.projectFontSize, metrics.fontSize);
      assert.equal(metrics.projectWeight, metrics.rowWeight);
      assert.equal(metrics.projectPadding, metrics.rowPadding);
      assert.equal(metrics.iconSize, touch ? "16px" : "14px");
      assert.equal(metrics.searchHeight, touch ? 32 : 26);
      assert.equal(await page.locator('.sidebar [data-active="true"]').count(), 1);
    }
    await page.locator(".header-search").click();
    await page.locator(".global-search-overlay[aria-hidden='false']").waitFor();
    await page.keyboard.press("Escape");
    if (touch && (await page.locator(".sidebar").getAttribute("data-state")) !== "open") await page.locator(".sidebar-trigger").click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const mode = touch ? "touch" : "desktop";
    await page.screenshot({ path: resolve(output, `${mode}${process.env.SIDEBAR_BASELINE ? "-before" : ""}.png`), animations: "disabled" });
    checks.push({ mode, metrics, passed: true });
    await context.close();
  }
  assert.deepEqual(errors, []);
  const result = { passed: true, checks, errors };
  await writeFile(resolve(output, process.env.SIDEBAR_BASELINE ? "baseline.json" : "result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await writeFile(resolve(output, "result.json"), JSON.stringify({ passed: false, checks, errors, error: error.stack }, null, 2) + "\n");
  throw error;
} finally {
  await browser.close();
}
