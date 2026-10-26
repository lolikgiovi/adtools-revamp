import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const output = resolve(import.meta.dirname);
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = process.env.RELEASE_TOUR_ONLY
  ? JSON.parse(readFileSync(resolve(output, "browser-results.json"), "utf8")).filter((result) => result.name !== "release-tour")
  : [];
try {
  for (const [name, path, selector] of [
    ["quick-query-images", "/tools/compress-image/tests/quick-query-flow.html", "#evidence"],
    ["cached-image-preview", "/tools/compress-image/tests/cache-preview-roundtrip.html?large", "#evidence"],
    ["notification-template", "/tools/html-editor/tests/notification-check.html", null],
  ]) {
    if (process.env.RELEASE_TOUR_ONLY) continue;
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    const editorCancellations = [];
    page.on("pageerror", (error) => {
      if (error.name === "Canceled" && error.message === "Canceled" && error.stack?.includes("monaco-editor")) {
        editorCancellations.push(error.message);
      } else {
        errors.push(error.message);
      }
    });
    await page.goto(`http://localhost:1235${path}`);
    if (selector) {
      await page.waitForFunction(
        (selector) => /"status":\s*"(?:PASS|FAIL)"/.test(document.querySelector(selector)?.textContent),
        selector,
        { timeout: 180000 },
      );
      const result = JSON.parse(await page.locator(selector).textContent());
      results.push({ name, ...result, errors, editorCancellations });
      assert.equal(result.status, "PASS", JSON.stringify(result));
    } else {
      await page.waitForFunction(() => /^(PASS|FAIL):/.test(document.title), null, { timeout: 120000 });
      const title = await page.title();
      const checks = await page.locator("#results li").allTextContents();
      results.push({ name, title, checks, errors, editorCancellations });
      assert.match(title, /^PASS:/);
    }
    assert.deepEqual(errors, [], `${name}: uncaught browser errors`);
    await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true, animations: "disabled" });
    console.log(`PASS ${name}`);
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto("http://localhost:1235/?release-tour=preview");
  await page.locator(".release-tour-dialog").waitFor();
  const titles = [];
  for (let index = 0; index < 5; index++) {
    titles.push(await page.locator("#release-tour-title").textContent());
    await page.screenshot({ path: resolve(output, `release-slide-${index}.png`), animations: "disabled" });
    if (index < 4) await page.locator(".release-tour-next").click();
  }
  assert.deepEqual(titles, [
    "Prepare images and templates in one workspace",
    "Choose the image result that fits",
    "Move images into Quick Query",
    "Validate notification templates with context",
    "Keep working in the browser",
  ]);
  await page.locator(".release-tour-back").click();
  assert.equal(await page.locator("#release-tour-title").textContent(), titles[3]);
  await page.locator(".release-tour-next").click();
  assert.equal(await page.locator(".release-tour-next").textContent(), "Done");
  await page.locator(".release-tour-next").click();
  assert.equal(await page.locator(".release-tour-dialog").count(), 0);
  await page.goto("http://localhost:1235/?release-tour=preview");
  await page.locator(".release-tour-dialog").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".release-tour-dialog").count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://localhost:1235/?release-tour=preview");
  await page.locator(".release-tour-dialog").waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: resolve(output, "release-mobile.png"), animations: "disabled" });
  results.push({
    name: "release-tour",
    status: "PASS",
    titles,
    checks: ["Five slides including closing screen", "Back", "Done", "Escape", "390px viewport"],
  });
  console.log("PASS release-tour");
} finally {
  writeFileSync(resolve(output, "browser-results.json"), JSON.stringify(results, null, 2) + "\n");
  await browser.close();
}
