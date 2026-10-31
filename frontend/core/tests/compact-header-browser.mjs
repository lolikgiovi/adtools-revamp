// Run with the existing Vite server and installed Playwright; no native services are contacted.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.HEADER_TEST_URL || "http://127.0.0.1:1247";
const output = resolve("docs/verification/compact-header");
const release = JSON.parse(await readFile("frontend/config/release-content.json", "utf8"));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks = [];
const errors = [];
try {
  for (const width of [1440, 900, 620, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
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
    await page.waitForFunction(() => Boolean(window.app?.connectionIndicators));
    await page.waitForTimeout(300);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(async () => {
      const { getActiveProject, renameProject, createProject } = await import("/core/Projects.js");
      renameProject(getActiveProject().id, "Livin");
      createProject("IHSP");
      createProject("NBDS");
      createProject("Livin — Integration testing environments");
      window.app.projectSelector.render();
    });
    assert.equal((await page.locator(".main-header").boundingBox()).height, 40);
    assert.equal(await page.locator(".connection-indicators").isVisible(), false);
    assert.equal(await page.locator(".main-header .connection-indicators").count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: resolve(output, `${width}-web.png`), animations: "disabled" });
    checks.push(`${width}px web: 40px header, project selector visible, native title bar hidden, no overflow`);
    if (width >= 620) {
      await page.evaluate(() => {
        // Exercise the actual connection controller with native calls stubbed.
        window.__TAURI__ = {};
        window.app.connectionIndicators.native = async () => null;
        document.documentElement.dataset.tauri = "true";
        document.querySelector(".main-header").dataset.runtime = "tauri";
        window.app.placeHeaderControls(true);
      });
      assert.equal(await page.locator(".main-header").isVisible(), false);
      const nativeBar = await page.locator(".window-titlebar").boundingBox();
      const content = await page.locator(".main-content").boundingBox();
      assert.ok(Math.abs(content.y - nativeBar.height) < 1, "Workspace starts immediately below title bar");
      assert.equal(await page.locator(".sidebar-header").isVisible(), false);
      assert.equal(await page.locator(".window-titlebar-center .header-search").count(), 1);
      const sidebar = page.locator(".sidebar");
      const originalState = await sidebar.getAttribute("data-state");
      const toggle = page.locator(".window-titlebar-leading .sidebar-trigger");
      assert.equal(await toggle.count(), 1);
      await toggle.click();
      assert.notEqual(await sidebar.getAttribute("data-state"), originalState);
      await toggle.click();
      assert.equal(await sidebar.getAttribute("data-state"), originalState);
      if (originalState === "expanded") await toggle.click();
      await page.locator(".window-titlebar-center .header-search").click();
      await page.locator(".global-search-overlay[aria-hidden='false']").waitFor();
      await page.keyboard.press("Escape");
      if (originalState === "expanded") await toggle.click();
      const home = page.locator(".window-titlebar-leading #breadcrumb-home");
      assert.equal(await home.isVisible(), true);
      const connections = await page.locator(".connection-indicators").boundingBox();
      const project = await page.locator(".header-project").boundingBox();
      const navigation = await page.locator(".window-titlebar-leading").boundingBox();
      const search = await page.locator(".window-titlebar-center .header-search").boundingBox();
      assert.ok(Math.abs(search.x + search.width / 2 - width / 2) < 1, "Search is centered in the desktop window");
      assert.ok(navigation.x + navigation.width <= search.x);
      assert.ok(search.x + search.width < connections.x);
      assert.equal(await page.locator(".main-header .header-project").count(), 0);
      assert.ok((await toggle.boundingBox()).x >= 100, "Reserve the traffic-light area");
      assert.ok(connections.x + connections.width < project.x);
      assert.ok(project.y < 36 && project.width < 140, "Project trigger should fit Livin");
      const sizing = await page.evaluate(() => {
        const read = (selector) => {
          const node = document.querySelector(selector);
          return {
            height: node.getBoundingClientRect().height,
            fontSize: getComputedStyle(node).fontSize,
            chevronWidth: node.querySelector("svg").getBoundingClientRect().width,
          };
        };
        return { project: read(".header-project .ad-searchable-dropdown-trigger"), connection: read(".connection-indicator") };
      });
      assert.deepEqual(sizing.project, sizing.connection, "Project uses the same sizing as connection controls");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.locator(".header-project .ad-searchable-dropdown-trigger").click();
      const projectMenu = page.locator(".ad-searchable-dropdown-menu[aria-hidden='false']");
      await projectMenu.waitFor({ state: "visible" });
      await page.waitForTimeout(180);
      const menuBounds = await projectMenu.boundingBox();
      assert.ok(menuBounds.width > project.width + 80, "Menu should fit option contents independently of trigger");
      assert.ok(menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= width);
      const longOption = projectMenu.locator(".ad-searchable-dropdown-option-label").filter({ hasText: "Livin — Integration" });
      assert.equal(await longOption.evaluate((label) => label.scrollWidth <= label.clientWidth + 1), true);
      assert.ok(menuBounds.width <= (await longOption.evaluate((label) => label.scrollWidth + 90)), "Avoid unused menu width");
      await page.screenshot({ path: resolve(output, `${width}-project-menu.png`), animations: "disabled" });
      await page.keyboard.press("Escape");
      await projectMenu.waitFor({ state: "hidden" });
      await page.evaluate(async () => {
        const { getActiveProject, renameProject } = await import("/core/Projects.js");
        renameProject(getActiveProject().id, "Livin Retail");
      });
      const renamed = await page.locator(".header-project").boundingBox();
      assert.ok(renamed.width > project.width && renamed.width < project.width + 90);
      await page.evaluate(() => {
        window.app.openReleaseTourPreview = () => {
          window.previewClicked = true;
        };
      });
      if (originalState !== "expanded") await toggle.click();
      await page.locator(".sidebar-footer .release-tour-dev-preview").click();
      if (originalState !== "expanded") await toggle.click();
      assert.equal(await page.evaluate(() => window.previewClicked), true);
      for (const service of ["oracle", "kafka", "redis"]) {
        const trigger = page.locator(`button[data-connection='${service}']`);
        await trigger.click();
        const menu = page.locator(`#${service}-connection-menu`);
        await menu.waitFor({ state: "visible" });
        const bounds = await menu.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y > 26 && bounds.y + bounds.height <= 900);
        assert.equal(
          await menu.evaluate((node) => {
            const r = node.getBoundingClientRect();
            return node.contains(document.elementFromPoint(r.left + 12, r.top + 12));
          }),
          true,
        );
        assert.equal(await trigger.getAttribute("data-tauri-drag-region"), null);
        await page.keyboard.press("Escape");
        assert.equal(await trigger.getAttribute("aria-expanded"), "false");
        assert.equal(await trigger.evaluate((node) => document.activeElement === node), true);
      }
      await page.evaluate(async () => {
        const { getActiveProject, renameProject } = await import("/core/Projects.js");
        renameProject(getActiveProject().id, "Livin Retail " + "x".repeat(65));
      });
      const longProject = await page.locator(".header-project").boundingBox();
      const compressedConnections = await page.locator(".connection-indicators").boundingBox();
      assert.ok(search.x + search.width < compressedConnections.x);
      assert.ok(compressedConnections.x + compressedConnections.width < longProject.x);
      assert.ok(longProject.x + longProject.width <= width);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.evaluate(async () => {
        const { getActiveProject, renameProject } = await import("/core/Projects.js");
        renameProject(getActiveProject().id, "Livin Retail");
      });
      await page.screenshot({ path: resolve(output, `${width}-desktop.png`), animations: "disabled" });
      await page.evaluate(() => window.app.router.navigate("quick-query"));
      await page.waitForFunction(() => Boolean(window.app.tools.get("quick-query")?.ui));
      await page.evaluate(() => window.app.tools.get("quick-query").ui.ready);
      const tabs = await page.locator(".qq-tab-strip").boundingBox();
      assert.ok(tabs.y >= nativeBar.height && tabs.y < nativeBar.height + 25, JSON.stringify({ tabs, nativeBar }));
      await page.screenshot({ path: resolve(output, `${width}-quick-query.png`), animations: "disabled" });
      assert.equal(await page.locator(".window-titlebar-leading #breadcrumb-current").innerText(), "Quick Query");
      await home.click();
      await page.waitForFunction(() => window.app.router.getCurrentRoute() === "home");
      assert.equal(await page.locator(".window-titlebar-leading .breadcrumb-current").isVisible(), false);
      checks.push(
        `${width}px desktop simulation: one desktop row, working Home breadcrumbs, centered search, prominent project selector, working sidebar, no clipping, Escape focus`,
      );
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, "result.json"), JSON.stringify({ passed: true, checks, errors }, null, 2) + "\n");
  console.log(checks.join("\n"));
} catch (error) {
  await writeFile(resolve(output, "result.json"), JSON.stringify({ passed: false, checks, errors, error: error.stack }, null, 2) + "\n");
  throw error;
} finally {
  await browser.close();
}
