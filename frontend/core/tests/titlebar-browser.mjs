// Replay the installed Tauri macOS title-bar handler against the actual app DOM.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.HEADER_TEST_URL || "http://127.0.0.1:1247";
const runtimePath = process.env.TAURI_DRAG_SCRIPT;
assert.ok(runtimePath, "Set TAURI_DRAG_SCRIPT to the installed tauri-2.9.5/src/window/scripts/drag.js");
const dragScript = (await readFile(runtimePath, "utf8")).replace("__TEMPLATE_os_name__", JSON.stringify("macos"));
const output = resolve("docs/verification/titlebar");
await mkdir(output, { recursive: true });
const release = JSON.parse(await readFile("frontend/config/release-content.json", "utf8"));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(
    ({ release }) => {
      localStorage.setItem("user.email", "dev@localhost");
      localStorage.setItem("user.registered", "true");
      localStorage.setItem(`releaseTour.seen.${encodeURIComponent(release.releaseId)}`, "true");
      for (const tip of release.tips)
        localStorage.setItem(`releaseTip.opened.${encodeURIComponent(release.releaseId)}.${encodeURIComponent(tip.id)}`, "true");
    },
    { release },
  );
  await context.route("**/*", (route) => (new URL(route.request().url()).origin === base ? route.continue() : route.abort()));
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForFunction(() => Boolean(window.app?.connectionIndicators));
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    window.__TAURI__ = {};
    window.app.connectionIndicators.native = async () => null;
    document.documentElement.dataset.tauri = "true";
    window.app.placeHeaderControls(true);
    window.titlebarCalls = [];
    window.__TAURI_INTERNALS__ = {
      invoke: async (command) => {
        window.titlebarCalls.push(command);
      },
    };
  });
  await page.addScriptTag({ content: dragScript });
  const breadcrumb = page.locator(".window-titlebar .breadcrumb");
  const bounds = await breadcrumb.boundingBox();
  const position = { x: bounds.width - 2, y: bounds.height / 2 };
  const toggleCount = () =>
    page.evaluate(() => window.titlebarCalls.filter((cmd) => cmd === "plugin:window|internal_toggle_maximize").length);
  await breadcrumb.dblclick({ position });
  assert.equal(await toggleCount(), 1, "Double-clicking blank title-bar navigation must request maximize/restore");
  await breadcrumb.dblclick({ position });
  assert.equal(await toggleCount(), 2, "A second double-click must request restore");
  checks.push("Real Tauri macOS drag handler dispatches maximize/restore once per double-click on navigation whitespace");
  await page.locator(".header-search").dblclick();
  assert.equal(await toggleCount(), 2, "Search must not resize the window");
  await page.keyboard.press("Escape");
  await page.locator("button[data-connection='oracle']").dblclick();
  assert.equal(await toggleCount(), 2, "Connection controls must not resize the window");
  await page.keyboard.press("Escape");
  assert.ok(await page.evaluate(() => window.titlebarCalls.includes("plugin:window|start_dragging")));
  checks.push("Single-click retains native dragging; search and connection controls do not trigger window resize");
  const capabilities = JSON.parse(await readFile("tauri/capabilities/default.json", "utf8"));
  assert.ok(capabilities.permissions.includes("core:window:allow-start-dragging"), "Native dragging needs its Tauri permission");
  assert.equal(await page.locator(".window-titlebar .release-tour-dev-preview").count(), 0);
  assert.equal(await page.locator(".sidebar-footer .release-tour-dev-preview").count(), 1);
  await page.evaluate(() => {
    window.app.openReleaseTourPreview = () => {
      window.previewClicked = true;
    };
  });
  await page.locator(".sidebar-footer .release-tour-dev-preview").click();
  assert.equal(await page.evaluate(() => window.previewClicked), true);
  checks.push("Preview remains usable in the sidebar footer, outside the desktop header");
  await page.screenshot({ path: resolve(output, "desktop.png"), animations: "disabled" });
  await writeFile(resolve(output, "result.json"), JSON.stringify({ passed: true, checks, runtimePath }, null, 2) + "\n");
  console.log(checks.join("\n"));
} catch (error) {
  await writeFile(resolve(output, "result.json"), JSON.stringify({ passed: false, checks, error: error.stack }, null, 2) + "\n");
  throw error;
} finally {
  await browser.close();
}
