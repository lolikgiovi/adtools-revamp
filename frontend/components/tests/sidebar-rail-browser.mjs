// Run against local Vite with an already installed Playwright. See docs/verification/sidebar-rail/README.md.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.SIDEBAR_TEST_URL || "http://127.0.0.1:1247";
const output = resolve("docs/verification/sidebar-rail");
const release = JSON.parse(await readFile("frontend/config/release-content.json", "utf8"));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks = [];
const errors = [];
try {
  for (const mode of ["web", "desktop", "mobile"]) {
    const mobile = mode === "mobile";
    const context = await browser.newContext({
      viewport: { width: mobile ? 390 : 1440, height: 900 },
      hasTouch: mobile,
      isMobile: mobile,
    });
    await context.addInitScript(
      ({ release }) => {
        localStorage.setItem("user.email", "dev@localhost");
        localStorage.setItem("user.registered", "true");
        localStorage.setItem("theme", "github-dark-hc");
        localStorage.setItem("sidebar.pinEducationShown.v1", "1");
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
    await page.locator(".sidebar-project .ad-searchable-dropdown-trigger").waitFor({ state: "attached" });
    await page.waitForTimeout(300);
    await page.evaluate(() => document.fonts.ready);
    if (mode === "desktop") {
      await page.evaluate(async () => {
        window.__TAURI__ = {};
        document.documentElement.dataset.tauri = "true";
        window.app.placeHeaderControls(true);
        await window.app.sidebar.renderTools();
        await window.app.sidebar.renderMenuGroups();
      });
    }
    const sidebar = page.locator(".sidebar");
    const trigger = page.locator(".sidebar-trigger");
    if (mobile) {
      assert.equal(await sidebar.getAttribute("data-state"), "closed");
      await trigger.click();
      assert.equal(await sidebar.getAttribute("data-state"), "open");
      await page.locator('[data-tool="uuid-generator"] .sidebar-menu-button').click();
      await page.waitForFunction(() => document.querySelector(".sidebar").dataset.state === "closed");
      assert.equal(await sidebar.getAttribute("data-state"), "closed");
      assert.equal(await page.locator(".main").evaluate((el) => getComputedStyle(el).marginLeft), "0px");
      await trigger.click();
      await page.screenshot({ path: resolve(output, "mobile.png") });
      await page.keyboard.press("Escape");
      assert.equal(await sidebar.getAttribute("data-state"), "closed");
    } else {
      await page.evaluate(async () => {
        window.sidebarResizeWidths = [];
        window.sidebarResizeObserver = new ResizeObserver(([entry]) => window.sidebarResizeWidths.push(entry.contentRect.width));
        window.sidebarResizeObserver.observe(document.querySelector(".main"));
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        window.sidebarResizeWidths = [];
      });
      const motion = await page.evaluate(async () => {
        const sidebar = document.querySelector(".sidebar");
        const main = document.querySelector(".main");
        document.querySelector(".sidebar-trigger").click();
        await new Promise(requestAnimationFrame);
        const animations = [...sidebar.getAnimations({ subtree: true }), ...main.getAnimations()];
        const layout = animations.some((animation) => ["width", "margin-left"].includes(animation.transitionProperty));
        const movement = main.getAnimations().some((animation) => animation.effect.getKeyframes().some((frame) => frame.transform));
        if (layout || !movement) return { animated: false };
        for (const animation of animations) {
          animation.pause();
          animation.currentTime = 100;
        }
        return {
          animated: true,
          width:
            parseFloat(getComputedStyle(sidebar, "::after").left) + new DOMMatrix(getComputedStyle(sidebar, "::after").transform).m41 + 1,
          offset: main.getBoundingClientRect().left,
        };
      });
      assert.equal(await sidebar.getAttribute("data-state"), "collapsed");
      assert.equal(motion.animated, true);
      assert.ok(motion.width > 52 && motion.width < 192);
      assert.ok(Math.abs(motion.width - motion.offset) < 1);
      await page.screenshot({ path: resolve(output, `${mode}-transition.png`) });
      await page.evaluate(async () => {
        const running = [];
        for (const el of [document.querySelector(".sidebar"), document.querySelector(".main")])
          for (const animation of el.getAnimations({ subtree: el.classList.contains("sidebar") })) {
            animation.play();
            running.push(animation.finished);
          }
        await Promise.all(running);
      });
      await page.waitForFunction(() => document.querySelector(".sidebar").getBoundingClientRect().width === 52);
      assert.equal((await sidebar.boundingBox()).width, 52);
      const workspaceResizes = await page.evaluate(() => window.sidebarResizeWidths.length);
      assert.ok(workspaceResizes <= 1, `Workspace resized ${workspaceResizes} times during collapse`);
      await page.evaluate(() => window.sidebarResizeObserver.disconnect());
      assert.equal((await sidebar.boundingBox()).x, 0);
      assert.equal(await page.locator(".main").evaluate((el) => getComputedStyle(el).marginLeft), "52px");
      for (const button of await page.locator(".sidebar .sidebar-menu-button").all()) {
        assert.ok(await button.isVisible());
        assert.ok(await button.getAttribute("aria-label"));
        const bounds = await button.boundingBox();
        assert.ok(bounds.width >= 36 && bounds.x >= 0 && bounds.x + bounds.width <= 52);
      }
      assert.equal(await page.locator(".sidebar-pin-action:visible").count(), 0);
      const imageTool = page.locator('[data-tool="compress-image"] .sidebar-menu-button');
      await imageTool.hover();
      const tooltip = page.getByRole("tooltip");
      await tooltip.waitFor();
      assert.match(await tooltip.textContent(), /Compress Image/);
      assert.match(await tooltip.textContent(), /losslessly/);
      assert.equal(await imageTool.getAttribute("title"), null);
      assert.equal(await imageTool.getAttribute("aria-describedby"), await tooltip.getAttribute("id"));
      assert.equal(await tooltip.getAttribute("data-placement"), "right");
      assert.equal(await tooltip.evaluate((el) => getComputedStyle(el, "::before").content), '""');
      await tooltip.evaluate(async (el) => Promise.all(el.getAnimations().map((animation) => animation.finished)));
      const tooltipBounds = await tooltip.boundingBox();
      assert.ok(tooltipBounds.x >= 60 && tooltipBounds.x + tooltipBounds.width <= 1440);
      await page.screenshot({ path: resolve(output, `${mode}-tooltip.png`), animations: "disabled" });
      await tooltip.hover();
      await page.waitForTimeout(200);
      assert.equal(await tooltip.isVisible(), true);
      await page.keyboard.press("Escape");
      await tooltip.waitFor({ state: "detached" });
      await imageTool.focus();
      await tooltip.waitFor();
      await page.locator(".sidebar-content").evaluate((el) => {
        el.scrollTop += 50;
      });
      await tooltip.waitFor({ state: "detached" });
      const tool = page.locator('[data-tool="uuid-generator"] .sidebar-menu-button');
      await tool.click();
      await page.waitForURL(/uuid-generator/);
      assert.equal(await tool.getAttribute("data-active"), "true");
      assert.equal(await sidebar.getAttribute("data-state"), "collapsed");
      await tool.focus();
      await page.keyboard.press("Shift+F10");
      await page.getByRole("menuitem", { name: "Pin UUID Generator", exact: true }).click();
      await page.locator('[data-category="pinned"] [data-tool="uuid-generator"]').waitFor();
      await page.waitForFunction(() => document.activeElement?.closest('[data-tool="uuid-generator"]'));
      const project = page.locator(".sidebar-project .ad-searchable-dropdown-trigger");
      await project.click();
      const menu = page.locator(".sidebar-project .ad-searchable-dropdown-menu.is-open");
      await menu.waitFor();
      assert.ok((await menu.boundingBox()).width >= 200);
      await page.screenshot({ path: resolve(output, `${mode}-project-menu.png`), animations: "disabled" });
      await page.keyboard.press("Escape");
      assert.equal(await project.evaluate((el) => el === document.activeElement), true);
      await page.waitForTimeout(200);
      await page.locator(".sidebar-content").evaluate((el) => {
        el.scrollTop = 0;
      });
      await page.screenshot({ path: resolve(output, `${mode}-rail.png`), animations: "disabled" });
      await page.evaluate(() => {
        document.documentElement.classList.remove("github-dark-hc");
        document.documentElement.setAttribute("data-theme", "light");
      });
      await page.screenshot({ path: resolve(output, `${mode}-rail-light.png`), animations: "disabled" });
      await page.evaluate(() => {
        document.documentElement.classList.add("github-dark-hc");
        document.documentElement.setAttribute("data-theme", "github-dark-hc");
      });
      await page.keyboard.press("Control+b");
      assert.equal(await sidebar.getAttribute("data-state"), "expanded");
      await page.locator(".sidebar-menu-label").first().waitFor({ state: "visible" });
      await page.screenshot({ path: resolve(output, `${mode}-expanded.png`), animations: "disabled" });
      const reversalAlignment = await page.evaluate(async () => {
        window.app.sidebar.collapse();
        await new Promise((resolve) => setTimeout(resolve, 60));
        window.app.sidebar.expand();
        await new Promise((resolve) => setTimeout(resolve, 180));
        const edge = getComputedStyle(document.querySelector(".sidebar"), "::after");
        const difference =
          document.querySelector(".main").getBoundingClientRect().left - (parseFloat(edge.left) + new DOMMatrix(edge.transform).m41 + 1);
        window.app.sidebar.collapse();
        await new Promise((resolve) => setTimeout(resolve, 350));
        return Math.abs(difference);
      });
      assert.ok(reversalAlignment < 3, `Sidebar and workspace separated by ${reversalAlignment}px during reversal`);
      assert.equal((await sidebar.boundingBox()).width, 52);
      await trigger.click();
      await page.waitForFunction(() => document.querySelector(".sidebar").getBoundingClientRect().width === 192);
      await page.waitForTimeout(300);
      await trigger.click();
      await page.setViewportSize({ width: 768, height: 900 });
      await page.waitForFunction(() => window.app.sidebar.state.isMobile);
      assert.equal(await sidebar.getAttribute("data-state"), "closed");
      await page.setViewportSize({ width: 769, height: 900 });
      await page.waitForFunction(() => !window.app.sidebar.state.isMobile);
      assert.equal(await sidebar.getAttribute("data-state"), "expanded");
      await trigger.click();
      await page.waitForFunction(() => document.querySelector(".sidebar").getBoundingClientRect().width === 52);
      assert.equal((await sidebar.boundingBox()).width, 52);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await trigger.click();
      assert.equal((await sidebar.boundingBox()).width, 192);
      await trigger.click();
      assert.equal((await sidebar.boundingBox()).width, 52);
      const remaining = await sidebar.evaluate((el) =>
        el.getAnimations({ subtree: true }).map((a) => ({
          state: a.playState,
          property: a.transitionProperty,
          target: a.effect.target.className,
          duration: a.effect.getTiming().duration,
        })),
      );
      assert.deepEqual(remaining, []);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    checks.push({ mode, passed: true });
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, "result.json"), JSON.stringify({ passed: true, checks, errors }, null, 2) + "\n");
  console.log(JSON.stringify({ passed: true, checks, errors }, null, 2));
} catch (error) {
  await writeFile(resolve(output, "result.json"), JSON.stringify({ passed: false, checks, errors, error: error.stack }, null, 2) + "\n");
  throw error;
} finally {
  await browser.close();
}
