// Start npm run dev first, then: node frontend/core/tests/feedback-browser.mjs
// Uses installed Chrome/Playwright. External requests are blocked; delivery is mocked.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const { chromium } = await import("playwright");
const base = process.env.FEEDBACK_TEST_URL || "http://127.0.0.1:1234";
const output = resolve("docs/verification/feedback");
const release = JSON.parse(await readFile("frontend/config/release-content.json", "utf8"));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks = [];
try {
  for (const [runtime, width, theme] of [["web", 1440, "light"], ["web", 390, "github-dark-hc"], ["desktop", 1440, "github-dark-hc"], ["desktop", 900, "light"]]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript(({ release, theme }) => {
      localStorage.setItem("user.email", "feedback-test@example.com");
      localStorage.setItem("user.registered", "true");
      localStorage.setItem("welcome.seen.v1.feedback-test@example.com", "true");
      localStorage.setItem("theme", theme);
      localStorage.setItem(`releaseTour.seen.${encodeURIComponent(release.releaseId)}`, "true");
      for (const tip of release.tips)
        localStorage.setItem(`releaseTip.opened.${encodeURIComponent(release.releaseId)}.${encodeURIComponent(tip.id)}`, "true");
    }, { release, theme });
    let fails = true;
    let sent;
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/feedback/public-improvement") {
        sent = route.request().postDataJSON();
        return route.fulfill({ status: fails ? 503 : 201, contentType: "application/json",
          body: JSON.stringify(fails ? { ok: false, error: "Please retry feedback." } : { ok: true, notification_sent: true }) });
      }
      if (url.origin !== base || url.pathname.startsWith("/analytics/")) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    await page.goto(base);
    await page.waitForFunction(() => Boolean(window.app?.connectionIndicators));
    await page.evaluate(async runtime => {
      if (runtime === "desktop") {
        window.__TAURI__ = {};
        window.app.connectionIndicators.native = async () => null;
        document.documentElement.dataset.tauri = "true";
        document.querySelector(".main-header").dataset.runtime = "tauri";
        window.app.placeHeaderControls(true);
      }
      window.app.router.navigate("json-tools");
    }, runtime);
    await page.waitForFunction(() => window.app.currentTool?.id === "json-tools");
    const button = page.getByRole("button", { name: "Feedback", exact: true });
    await button.click();
    const dialog = page.locator(".feedback-dialog");
    await dialog.waitFor({ state: "visible" });
    assert.equal(await dialog.locator("select").inputValue(), "json-tools");
    await dialog.locator("select").selectOption("quick-query");
    await dialog.locator("textarea").fill("Feedback verification draft");
    await page.keyboard.press("Escape");
    assert.equal(await button.evaluate(node => document.activeElement === node), true);
    await button.click();
    assert.equal(await dialog.locator("textarea").inputValue(), "Feedback verification draft");
    await dialog.getByRole("button", { name: "Send feedback", exact: true }).click();
    await dialog.getByText("Please retry feedback.", { exact: true }).waitFor();
    assert.equal(await dialog.locator("textarea").inputValue(), "Feedback verification draft");
    fails = false;
    await dialog.getByRole("button", { name: "Send feedback", exact: true }).click();
    await dialog.getByText("Feedback sent.", { exact: true }).waitFor();
    assert.equal(sent.tool_id, "quick-query");
    assert.equal(sent.email, "feedback-test@example.com");
    assert.equal(await dialog.locator("textarea").inputValue(), "");
    await page.keyboard.press("Escape");
    await button.click();
    await dialog.locator("textarea").fill("A clear place to report an issue or suggest an improvement.");
    await page.screenshot({ path: `${output}/${runtime}-${width}.png` });
    await page.keyboard.press("Escape");
    const feedback = await button.boundingBox();
    if (runtime === "desktop") {
      const oracle = await page.locator('[data-connection="oracle"]').boundingBox();
      assert.equal(feedback.height, oracle.height);
    } else assert.equal(feedback.height, 28);
    assert.ok(feedback.x >= 0 && feedback.x + feedback.width <= width);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `${output}/${runtime}-${width}-header.png` });
    checks.push(`${runtime} ${width}px ${theme}: visible matching height; active tool/change tool; draft dismissal/retry; successful payload; focus restored; no overflow`);
    await context.close();
  }
  await writeFile(`${output}/results.md`, `# Feedback verification\n\nRun: npm run dev, then node frontend/core/tests/feedback-browser.mjs\n\nEmail delivery mocked; desktop uses the shared shell with native calls stubbed.\n\n${checks.map(x => `- PASS ${x}`).join("\n")}\n`);
} finally { await browser.close(); }
console.log(checks.join("\n"));
