// Start Vite on port 1259, then run with PLAYWRIGHT_MODULE pointing to an installed Playwright module.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.TABS_TEST_URL || "http://127.0.0.1:1259";
const output = resolve("docs/verification/tool-tabs");
const release = JSON.parse(await readFile("frontend/config/release-content.json", "utf8"));
const strips = {
  plantuml: "#puml-tabs", "quick-query": ".qq-tab-strip", "html-template": ".html-document-bar",
  "splunk-template": ".splunk-document-bar", "velocity-template": ".velocity-document-bar",
  "lockey-update": ".lu-tabs-row", "master-lockey": ".ml-tabs", "run-query": ".jr-tabs",
  "run-batch": ".rb-tabs", kafka: ".kafka-tab-strip", "json-tools": ".json-tools-tabs",
  "base64-tools": ".tab-navigation", "qr-tools": ".qr-tlv > .tabs-container",
};
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks = [];
try {
  for (const width of [1440, 900, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript(({ release }) => {
      if (window !== window.top) return;
      localStorage.setItem("user.email", "dev@localhost");
      localStorage.setItem("user.registered", "true");
      localStorage.setItem(`releaseTour.seen.${encodeURIComponent(release.releaseId)}`, "true");
      for (const tip of release.tips)
        localStorage.setItem(`releaseTip.opened.${encodeURIComponent(release.releaseId)}.${encodeURIComponent(tip.id)}`, "true");
    }, { release });
    await context.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const page = await context.newPage();
    page.on("pageerror", error => console.log("PAGE", error.message));
    page.on("console", msg => { if (msg.type() === "error") console.log("CONSOLE", msg.text()); });
    await page.goto(base);
    await page.waitForFunction(() => window.app?.router?.routes.has("plantuml"));
    for (const [tool, selector] of Object.entries(strips)) {
      await page.evaluate(tool => {
        // Render desktop-only tool layouts in the browser; no native services are available or contacted.
        window.app.getToolDefinition(tool).requiresTauri = false;
        window.app.router.navigate(tool);
      }, tool);
      console.log("Checking", width, tool);
      await page.locator(selector).waitFor({ state: "visible", timeout: 15000 }).catch(async error => {
        await page.screenshot({ path: resolve(output, "failure.png") });
        console.log(await page.locator(".main-content").innerText());
        throw error;
      });
      await page.evaluate(() => document.fonts.ready);
      const metrics = await page.locator(selector).evaluate(node => {
        const box = node.getBoundingClientRect();
        const main = document.querySelector(".main-content").getBoundingClientRect();
        return { height: box.height, topGap: box.top - main.top, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      checks.push({ width, tool, ...metrics });
      if (!process.env.TABS_BASELINE) {
        assert.ok(Math.abs(metrics.topGap - (tool === "plantuml" ? 40 : 0)) < 1, `${tool} ${width}: top gap ${metrics.topGap}`);
        if (width >= 900) assert.equal(metrics.height, 39, `${tool} ${width}: tab height`);
        assert.equal(metrics.overflow, false, `${tool} ${width}: page overflow`);
        const buttons = page.locator(`${selector} .tab-button`);
        if (await buttons.count() > 1) {
          await buttons.nth(1).click();
          assert.ok((await buttons.nth(1).getAttribute("class")).includes("active"));
          await buttons.first().click();
        }
      }
      if (["plantuml", "quick-query", "json-tools", "master-lockey"].includes(tool))
        await page.screenshot({ path: resolve(output, `${width}-${tool}${process.env.TABS_BASELINE ? "-before" : ""}.png`), animations: "disabled" });
    }
    await context.close();
  }
  await writeFile(resolve(output, process.env.TABS_BASELINE ? "baseline.json" : "result.json"), JSON.stringify({ passed: true, checks }, null, 2) + "\n");
  console.log(JSON.stringify(checks, null, 2));
} catch (error) {
  await writeFile(resolve(output, "failure.json"), JSON.stringify({ checks, error: error.stack }, null, 2) + "\n");
  throw error;
} finally { await browser.close(); }
