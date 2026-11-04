// Start Vite on port 1259; use an already installed Playwright module.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.TABS_TEST_URL || "http://127.0.0.1:1259";
const output = resolve("docs/verification/sidebar-header");
const release = JSON.parse(await readFile("frontend/config/release-content.json", "utf8"));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks = [];
try {
  for (const [width, hasTouch] of [[1440, false], [900, false], [390, true]]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch });
    await context.addInitScript(release => {
      if (window !== window.top) return;
      localStorage.setItem("user.email", "dev@localhost");
      localStorage.setItem("user.registered", "true");
      localStorage.setItem(`releaseTour.seen.${encodeURIComponent(release.releaseId)}`, "true");
      for (const tip of release.tips)
        localStorage.setItem(`releaseTip.opened.${encodeURIComponent(release.releaseId)}.${encodeURIComponent(tip.id)}`, "true");
    }, release);
    await context.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const page = await context.newPage();
    await page.goto(base);
    await page.waitForFunction(() => Boolean(window.app?.projectSelector));
    const sidebar = page.locator(".sidebar");
    const toggle = page.locator(".sidebar-trigger:visible");
    if (!["expanded", "open"].includes(await sidebar.getAttribute("data-state"))) await toggle.click();
    const header = page.locator(".sidebar-header");
    const trigger = page.locator(".sidebar-project .ad-searchable-dropdown-trigger");
    assert.equal((await header.boundingBox()).height, hasTouch ? 57 : 39);
    assert.equal((await trigger.boundingBox()).height, hasTouch ? 40 : 28);
    await trigger.click();
    const menu = page.locator(".ad-searchable-dropdown-menu[aria-hidden='false']");
    await menu.waitFor({ state: "visible" });
    await page.waitForTimeout(200);
    const bounds = await menu.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
    assert.ok(bounds.y >= (await header.boundingBox()).y + (await trigger.boundingBox()).height);
    await page.keyboard.press("Escape");
    assert.equal(await trigger.evaluate(node => node === document.activeElement), true);
    await page.screenshot({ path: resolve(output, `${width}.png`), animations: "disabled" });
    if (width > 768) {
      await toggle.click();
      await page.waitForTimeout(320);
      assert.equal((await header.boundingBox()).height, 39);
      const icon = await trigger.boundingBox();
      const row = await header.boundingBox();
      assert.ok(icon.y >= row.y && icon.y + icon.height <= row.y + row.height);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    checks.push({ width, hasTouch, headerHeight: hasTouch ? 57 : 39, dropdownHeight: hasTouch ? 40 : 28,
      menu: "opens within viewport; Escape restores focus", collapsed: width > 768 ? "project icon fits" : "mobile drawer" });
    await context.close();
  }
  await writeFile(resolve(output, "result.json"), JSON.stringify({ passed: true, checks }, null, 2) + "\n");
  console.log(JSON.stringify(checks, null, 2));
} finally { await browser.close(); }
