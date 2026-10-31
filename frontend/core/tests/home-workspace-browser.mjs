// Run against Vite with an already-installed Playwright module. All external traffic is blocked.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.HOME_TEST_URL || "http://127.0.0.1:1247";
const output = resolve("docs/verification/home-workspace");
const release = JSON.parse(await readFile("frontend/config/release-content.json", "utf8"));
const overview = {
  ok: true,
  period: { totals: "all-time", daily: "last-7-days" },
  user: { totalActivities: 3593, toolsUsed: 2, tools: [{ toolId: "json-tools", count: 279 }] },
  global: {
    totalActivities: 52252,
    activeUsers: 53,
    toolsUsed: 18,
    tools: [
      { toolId: "quick-query", count: 19672 },
      { toolId: "json-tools", count: 2229 },
      { toolId: "uuid-generator", count: 2262 },
    ],
  },
};
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks = [];
const errors = [];
try {
  for (const width of [1440, 900, 620, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript(
      ({ release }) => {
        if (localStorage.getItem("home-verification.seeded")) return;
        localStorage.setItem("home-verification.seeded", "true");
        localStorage.setItem("user.email", "home-verification@example.com");
        localStorage.setItem("user.registered", "true");
        localStorage.setItem("theme", "github-dark-hc");
        localStorage.setItem("sidebar.pinnedTools.v1", JSON.stringify(["json-tools", "uuid-generator", "removed-tool"]));
        localStorage.setItem(
          "adtools.global-search.recent-interactions.v1",
          JSON.stringify([
            { key: "tool:base64-tools", lastInteractedAt: Date.now() - 60000 },
            { key: "tool:removed-tool", lastInteractedAt: Date.now() },
          ]),
        );
        localStorage.setItem(`releaseTour.seen.${encodeURIComponent(release.releaseId)}`, "true");
        for (const tip of release.tips)
          localStorage.setItem(`releaseTip.opened.${encodeURIComponent(release.releaseId)}.${encodeURIComponent(tip.id)}`, "true");
      },
      { release },
    );
    let offline = false;
    await context.route("**/*", (route) => {
      if (route.request().url().includes("/analytics/public-overview")) {
        return route.fulfill({
          status: offline ? 503 : 200,
          contentType: "application/json",
          body: JSON.stringify(offline ? { error: "Offline" } : overview),
        });
      }
      if (route.request().url().includes("/feedback/public-improvement")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
      }
      return new URL(route.request().url()).origin === base ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await page.locator(".home-impact-metrics").waitFor();
    assert.match(await page.locator(".home-impact").innerText(), /52,252/);
    assert.match(await page.locator(".home-impact").innerText(), /53/);
    assert.match(await page.locator(".home-impact").innerText(), /All time/);
    assert.equal(await page.locator(".home-pinned [data-home-tool='json-tools']").count(), 1);
    assert.equal(await page.locator("[data-home-tool='removed-tool']").count(), 0);
    assert.equal(await page.locator(".home-recent [data-home-tool='base64-tools']").count(), 1);
    await page.locator("[data-home-search]").focus();
    await page.keyboard.press("Enter");
    await page.locator(".global-search-overlay[aria-hidden='false']").waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("[data-home-search]").evaluate((node) => node === document.activeElement), true);
    await page.getByText("View usage", { exact: true }).click();
    assert.match(await page.locator(".home-usage-details .usage-scope-card-user").innerText(), /3,593/);
    await page.getByText("View usage", { exact: true }).click();
    await page.locator(".home-feedback > summary").click();
    await page.locator("textarea[name='message']").fill("Keep my feedback while analytics refresh.");
    await page.evaluate(() => window.app.eventBus.emit("usage:updated"));
    assert.equal(await page.locator("textarea[name='message']").inputValue(), "Keep my feedback while analytics refresh.");
    await page.locator(".usage-feedback-form button[type='submit']").click();
    await page.getByText("Feedback sent.", { exact: true }).waitFor();
    await page.locator(".home-feedback > summary").click();
    if (width >= 900) {
      await page.locator(".sidebar-menu-item[data-tool='base64-tools']").hover();
      await page.locator(".sidebar-menu-item[data-tool='base64-tools'] .sidebar-pin-action").click();
      await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Unpin Base64 Tools");
    } else {
      await page.evaluate(() => window.app.sidebar.togglePin("base64-tools"));
    }
    assert.equal(await page.locator(".home-pinned [data-home-tool='base64-tools']").count(), 1);
    await page.locator(".home-pinned [data-home-tool='json-tools']").click();
    await page.waitForFunction(() => window.app.currentTool?.id === "json-tools");
    await page.evaluate(() => window.app.router.navigate("home"));
    await page.locator(".home-impact-metrics").waitFor();
    assert.equal(await page.locator(".home-recent [data-home-tool='json-tools']").count(), 1);
    await page.reload();
    await page.locator(".home-impact-metrics").waitFor();
    assert.equal(await page.locator(".home-recent [data-home-tool='json-tools']").count(), 1);
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: resolve(output, `${width}-home.png`), fullPage: true, animations: "disabled" });
    checks.push(`${width}px: real adoption totals, pins, recent navigation and reload, disclosure, feedback persistence, no overflow`);
    if (width >= 620) {
      await page.evaluate(() => {
        // Desktop shell simulation only: native connection calls are stubbed.
        window.__TAURI__ = {};
        document.documentElement.dataset.tauri = "true";
        window.app.connectionIndicators.native = async () => null;
        window.app.placeHeaderControls(true);
        window.app.connectionIndicators.render();
        window.app.renderHomeWorkspace();
      });
      const oracle = page.locator("[data-connection='oracle']");
      assert.match(await oracle.getAttribute("aria-label"), /Not configured/);
      await page.evaluate(() => {
        localStorage.setItem("config.oracle.connections", JSON.stringify([{ name: "UAT", connect_string: "test-db" }]));
        window.app.connectionIndicators.render();
      });
      assert.match(await oracle.getAttribute("aria-label"), /Disconnected/);
      await page.evaluate(() => {
        window.app.connectionIndicators.oraclePools = ["UAT"];
        window.app.connectionIndicators.render();
      });
      assert.match(await oracle.getAttribute("aria-label"), /UAT/);
      assert.equal(await oracle.getAttribute("data-state"), "active");
      if (width > 900) {
        assert.equal(await oracle.locator(".connection-detail").evaluate((node) => node.scrollWidth > node.clientWidth), false);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: resolve(output, `${width}-desktop.png`), fullPage: true, animations: "disabled" });
      checks.push(`${width}px desktop shell: tools and adoption visible, connection states identify configuration and active target`);
    }

    offline = true;
    await page.reload();
    await page.getByRole("button", { name: "Retry team usage" }).waitFor();
    assert.equal(await page.locator(".home-impact-metrics").count(), 0);
    assert.ok((await page.locator(".home-pinned [data-home-tool]").count()) > 0);
    offline = false;
    await page.getByRole("button", { name: "Retry team usage" }).click();
    await page.locator(".home-impact-metrics").waitFor();
    await page.evaluate(() => {
      localStorage.setItem("adtools.global-search.recent-interactions.v1", "broken");
      localStorage.setItem("sidebar.pinnedTools.v1", "[]");
    });
    await page.reload();
    await page.locator(".home-impact-metrics").waitFor();
    assert.ok((await page.locator(".home-start [data-home-tool]").count()) > 0);
    assert.equal(await page.locator(".home-recent").count(), 0);
    checks.push(`${width}px: analytics failure preserves tools, retry works, empty/corrupt local data has usable fallback`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, "result.json"), JSON.stringify({ passed: true, checks, errors, fixtures: true }, null, 2));
  await writeFile(
    resolve(output, "README.md"),
    `# Home workspace verification\n\nScreenshots use explicitly mocked adoption data; they are not production analytics. Desktop screenshots simulate the Tauri shell with native calls stubbed; no live database or broker is contacted.\n\nRun Vite, then:\n\n\`\`\`bash\nPLAYWRIGHT_MODULE=/Users/lolik/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs HOME_TEST_URL=${base} node frontend/core/tests/home-workspace-browser.mjs\n\`\`\`\n\n${checks.map((check) => `- ${check}`).join("\n")}\n`,
  );
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} finally {
  await browser.close();
}
