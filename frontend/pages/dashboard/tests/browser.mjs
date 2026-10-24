import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.DASHBOARD_TEST_URL || "http://localhost:1245";
const output = resolve("docs/verification/dashboard");
const release = JSON.parse(await readFile("frontend/config/release-content.json", "utf8"));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks = [];
const errors = [];
const apiRequests = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addInitScript(
      ({ release }) => {
        localStorage.setItem("user.email", "fashalli.bilhaq@bankmandiri.co.id");
        localStorage.setItem("user.username", "Dashboard fixture");
        localStorage.setItem("user.registered", "true");
        localStorage.setItem("theme", "dark");
        localStorage.setItem(`releaseTour.seen.${encodeURIComponent(release.releaseId)}`, "true");
        for (const tip of release.tips)
          localStorage.setItem(`releaseTip.opened.${encodeURIComponent(release.releaseId)}.${encodeURIComponent(tip.id)}`, "true");
      },
      { release },
    );
    // Mock every API; this test never approves accounts or publishes to a real audience.
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.port === "8787" || url.hostname === "adtools.lolik.workers.dev") {
        apiRequests.push(url.href);
        return route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ error: "Fixture: authentication required" }),
        });
      }
      return url.origin === base ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}/#dashboard`);
    await page.locator(".dashboard-navigation").waitFor();
    assert.equal(await page.locator('[data-page="dashboard"]').count(), 1);
    assert.equal(await page.locator('[data-page="analytics-dashboard"], [data-page="approval"]').count(), 0);
    for (const [label, selector] of [
      ["Analytics", "#dashboard-auth-form"],
      ["Approvals", "#approval-auth-form"],
      ["Publish Settings", ".publish-auth"],
    ]) {
      await page.getByRole("link", { name: label, exact: true }).click();
      await page.locator(selector).waitFor({ state: "visible" });
      assert.equal(await page.locator('.dashboard-navigation [aria-current="page"]').innerText(), label);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false, `${label} overflow at ${width}`);
      await page.screenshot({ path: resolve(output, `${width}-${label.toLowerCase().replaceAll(" ", "-")}.png`), fullPage: true });
      const response = page.waitForResponse((response) => response.url().endsWith("/dashboard/verify"));
      await page.locator(`${selector} input[type="password"]`).fill("invalid-browser-fixture");
      await page.locator(`${selector} button[type="submit"]`).click();
      await response;
      checks.push(`${width}: ${label} navigation, password gate, no overflow, API auth request`);
    }
    await page.goto(`${base}/#approval`);
    await page.locator("#approval-auth-form").waitFor();
    assert.equal(new URL(page.url()).hash, "#dashboard/approvals");
    await page.goto(`${base}/#analytics-dashboard`);
    await page.locator("#dashboard-auth-form").waitFor();
    assert.equal(new URL(page.url()).hash, "#dashboard/analytics");
    await page.goto(`${base}/#settings`);
    if (width < 768) await page.locator(".sidebar-trigger").click();
    await page.locator('[data-page="settings"] .sidebar-menu-button').click();
    await page.locator(".settings-categories").waitFor();
    assert.equal(await page.locator(".settings-publish, #settings-publishing").count(), 0);
    checks.push(`${width}: legacy bookmarks, Settings has no publishing entry`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  if (process.env.EXPECT_PRODUCTION_API === "true") {
    assert.equal(
      apiRequests.some((url) => new URL(url).port === "8787"),
      false,
    );
    assert.equal(apiRequests.filter((url) => url === "https://adtools.lolik.workers.dev/dashboard/verify").length, 6);
    checks.push("All three sections authenticate against the production Worker in explicit production API mode");
  }
  await writeFile(
    resolve(output, "result.json"),
    JSON.stringify(
      {
        passed: true,
        base,
        checks,
        errors,
        apiRequests,
        api: "mocked",
        command: "PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node frontend/pages/dashboard/tests/browser.mjs",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ passed: true, checks: checks.length, output }));
} finally {
  await browser.close();
}
