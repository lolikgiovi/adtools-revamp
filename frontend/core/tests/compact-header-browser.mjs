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
    const webHeader = await page.locator(".main-header").boundingBox();
    assert.equal(webHeader.height, 39);
    assert.equal(await page.locator(".connection-indicators").isVisible(), false);
    assert.equal(await page.locator(".header-center .header-search").count(), 1);
    assert.equal(await page.locator(".sidebar-header .sidebar-project").count(), 1);
    assert.equal(await page.locator(".sidebar-header .header-search").count(), 0);
    const webSearch = await page.locator(".header-center .header-search").boundingBox();
    assert.equal(webSearch.height, width <= 600 ? 32 : 28);
    assert.ok(Math.abs(webSearch.y + webSearch.height / 2 - webHeader.y - (webHeader.height - 1) / 2) < 1);
    assert.equal((await page.locator(".sidebar-header").boundingBox()).height, 39);
    assert.ok(Math.abs(webSearch.x + webSearch.width / 2 - webHeader.x - webHeader.width / 2) < 1);
    await page.locator(".header-search").click();
    await page.locator(".global-search-overlay[aria-hidden='false']").waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".header-search").evaluate((node) => node === document.activeElement), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: resolve(output, `${width}-web.png`), animations: "disabled" });
    checks.push(`${width}px web: compact 39px header, centered working search, sidebar project selector, no overflow`);
    if (width >= 620) {
      await page.evaluate(() => {
        // Layout simulation: native calls are stubbed; no desktop services are contacted.
        window.__TAURI__ = {};
        window.app.connectionIndicators.native = async () => null;
        document.documentElement.dataset.tauri = "true";
        document.querySelector(".main-header").dataset.runtime = "tauri";
        window.app.placeHeaderControls(true);
      });
      assert.equal(await page.locator(".main-header").isVisible(), false);
      const nativeBar = await page.locator(".window-titlebar").boundingBox();
      const content = await page.locator(".main-content").boundingBox();
      assert.ok(Math.abs(content.y - nativeBar.height) < 1, "No duplicate workspace header on desktop");
      assert.equal(await page.locator(".window-titlebar-center .header-search").count(), 1);
      assert.equal(await page.locator(".window-titlebar-actions > .header-actions").count(), 1);
      assert.equal(await page.locator(".sidebar-footer .release-tour-dev-preview").count(), 1);
      assert.equal(await page.locator(".window-titlebar .release-tour-dev-preview").count(), 0);
      const sidebar = page.locator(".sidebar");
      const toggle = page.locator(".window-titlebar-leading .sidebar-trigger");
      if (!["expanded", "open"].includes(await sidebar.getAttribute("data-state"))) await toggle.click();
      await toggle.click();
      assert.ok(["collapsed", "closed"].includes(await sidebar.getAttribute("data-state")));
      await page.locator(".header-search").click();
      await page.locator(".global-search-overlay[aria-hidden='false']").waitFor();
      await page.keyboard.press("Escape");
      await toggle.click();
      await page.waitForTimeout(200);
      assert.equal(await page.locator(".sidebar-header").isVisible(), true);
      const project = await page.locator(".sidebar-project").boundingBox();
      const search = await page.locator(".header-search").boundingBox();
      const navigation = await page.locator(".window-titlebar-leading").boundingBox();
      const connections = await page.locator(".connection-indicators").boundingBox();
      assert.ok(project.x >= 0 && project.y >= nativeBar.height && project.x + project.width <= 192);
      assert.ok(Math.abs(search.x + search.width / 2 - width / 2) < 1, "Native search remains centered");
      assert.ok(navigation.x + navigation.width <= search.x);
      assert.ok(search.x + search.width < connections.x);
      assert.ok((await toggle.boundingBox()).x >= 100, "Reserve native traffic-light area");
      assert.equal(await page.locator(".window-titlebar .sidebar-project").count(), 0);
      await page.locator(".sidebar-project .ad-searchable-dropdown-trigger").click();
      const projectMenu = page.locator(".ad-searchable-dropdown-menu[aria-hidden='false']");
      await projectMenu.waitFor({ state: "visible" });
      await page.waitForTimeout(180);
      const menuBounds = await projectMenu.boundingBox();
      assert.ok(menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= width);
      assert.equal(
        await projectMenu.evaluate((node) => {
          const r = node.getBoundingClientRect();
          return node.contains(document.elementFromPoint(r.left + 12, r.top + 12));
        }),
        true,
      );
      await page.screenshot({ path: resolve(output, `${width}-project-menu.png`), animations: "disabled" });
      await page.keyboard.press("Escape");
      assert.ok(["expanded", "open"].includes(await sidebar.getAttribute("data-state")));
      assert.equal(
        await page.locator(".sidebar-project .ad-searchable-dropdown-trigger").evaluate((node) => node === document.activeElement),
        true,
      );
      await page.evaluate(async () => {
        const { getActiveProject, renameProject } = await import("/core/Projects.js");
        renameProject(getActiveProject().id, "Livin Retail " + "x".repeat(65));
      });
      assert.ok(Math.abs((await page.locator(".sidebar-project").boundingBox()).width - project.width) < 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.evaluate(async () => {
        const { getActiveProject, renameProject } = await import("/core/Projects.js");
        renameProject(getActiveProject().id, "Livin Retail");
      });
      if (width > 1000) {
        await page.evaluate(() => {
          window.app.openReleaseTourPreview = () => {
            window.previewClicked = true;
          };
        });
        await page.locator(".sidebar-footer .release-tour-dev-preview").click();
        assert.equal(await page.evaluate(() => window.previewClicked), true);
      }
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
      await page.evaluate(() => window.app.renderUpdateBanner({ version: "9.9.9", notes: "Layout test" }));
      const updateNotice = await page.locator(".window-titlebar .update-banner").boundingBox();
      assert.ok(updateNotice.y >= nativeBar.height && updateNotice.x >= 0 && updateNotice.x + updateNotice.width <= width);
      await page.locator(".update-banner-later").click();
      await page.screenshot({ path: resolve(output, `${width}-desktop.png`), animations: "disabled" });
      await page.evaluate(() => window.app.router.navigate("quick-query"));
      await page.waitForFunction(() => Boolean(window.app.tools.get("quick-query")?.ui));
      await page.evaluate(() => window.app.tools.get("quick-query").ui.ready);
      const tabs = await page.locator(".qq-tab-strip").boundingBox();
      assert.ok(tabs.y >= nativeBar.height && tabs.y < nativeBar.height + 25);
      await page.screenshot({ path: resolve(output, `${width}-quick-query.png`), animations: "disabled" });
      assert.equal(await page.locator(".window-titlebar-leading #breadcrumb-current").innerText(), "Quick Query");
      await page.locator(".window-titlebar-leading #breadcrumb-home").click();
      await page.waitForFunction(() => window.app.router.getCurrentRoute() === "home");
      assert.equal(await page.locator(".window-titlebar-leading .breadcrumb-current").isVisible(), false);
      // Runtime placement can run repeatedly, including after delayed native initialization.
      await page.evaluate(() => {
        delete window.__TAURI__;
        document.documentElement.dataset.tauri = "false";
        document.querySelector(".main-header").dataset.runtime = "web";
        window.app.placeHeaderControls(false);
        window.app.placeHeaderControls(false);
      });
      assert.equal(await page.locator(".main-header > .header-actions").count(), 1);
      assert.equal(await page.locator(".header-center .header-search").count(), 1);
      assert.equal(await page.locator(".header-context .sidebar-trigger + .breadcrumb").count(), 1);
      assert.equal(await page.locator(".sidebar-header .sidebar-project").count(), 1);
      assert.equal((await page.locator(".main-header").boundingBox()).height, 39);
      checks.push(
        `${width}px desktop simulation: one native toolbar, centered search, sidebar project/menu, native actions and connections, keyboard focus, runtime restoration`,
      );
    }
    if (["collapsed", "closed"].includes(await page.locator(".sidebar").getAttribute("data-state"))) {
      await page.locator(".sidebar-trigger").click();
    }
    await page.locator(".sidebar-project .ad-searchable-dropdown-trigger").click();
    await page.getByRole("option", { name: "Create or manage projects…", exact: true }).click();
    await page.locator("button.project-settings-select").waitFor();
    if (width <= 768) assert.equal(await page.locator(".sidebar").getAttribute("data-state"), "closed");
    const currentCrumb = await page.locator(".header-context .breadcrumb").boundingBox();
    const currentSearch = await page.locator(".header-search").boundingBox();
    assert.ok(currentCrumb.x + currentCrumb.width <= currentSearch.x);
    checks.push(`${width}px sidebar management opens Settings with readable web breadcrumbs`);
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
