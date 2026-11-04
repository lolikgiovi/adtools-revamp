import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.SEARCH_TEST_URL || "http://127.0.0.1:1248";
const output = resolve("docs/verification/global-search-contrast");
const release = JSON.parse(await readFile("frontend/config/release-content.json", "utf8"));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
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
  await page.routeWebSocket("**", (socket) => socket.close());
  await page.goto(base);
  await page.waitForFunction(() => Boolean(window.app?.globalSearch?.index.length));
  await page.evaluate(() => window.app.globalSearch.open("header"));
  await page.locator(".global-search-result-item.active").waitFor();
  const themes = await page.evaluate(() => window.app.themeManager.constructor.THEMES);
  const accents = [null, "0 100% 50%", "60 100% 50%", "120 100% 50%", "240 100% 50%", "0 0% 0%", "0 0% 100%"];
  for (const theme of themes) {
    console.log(`Checking ${theme}`);
    await page.evaluate((theme) => window.app.themeManager.setTheme(theme, false), theme);
    for (const accent of accents) {
      await page.evaluate((accent) => {
        for (const token of ["--accent", "--primary", "--ring"]) {
          if (accent) document.documentElement.style.setProperty(token, accent);
          else document.documentElement.style.removeProperty(token);
        }
      }, accent);
      for (const state of ["selected", "hovered"]) {
        await page.mouse.move(0, 0);
        if (state === "hovered") await page.locator(".global-search-result-item").nth(1).hover();
        await page.waitForTimeout(150);
        const result = await page.evaluate((state) => {
          const row = document.querySelectorAll(".global-search-result-item")[state === "selected" ? 0 : 1];
          const luminance = (color) => {
            const rgb = color
              .match(/[\d.]+/g)
              .slice(0, 3)
              .map(Number)
              .map((n) => {
                n /= 255;
                return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
              });
            return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
          };
          const background = getComputedStyle(row).backgroundColor;
          const bg = luminance(background);
          return [".result-title", ".result-sub", ".global-search-result-icon"].map((selector) => {
            const color = getComputedStyle(row.querySelector(selector)).color;
            const fg = luminance(color);
            return { selector, color, background, ratio: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05) };
          });
        }, state);
        checks.push({ theme, accent: accent || "theme default", state, result });
      }
    }
  }
  await page.evaluate(() => {
    for (const token of ["--accent", "--primary", "--ring"]) document.documentElement.style.removeProperty(token);
    window.app.themeManager.setTheme("github-dark-hc", false);
  });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(output, "dark.png") });
  await page.evaluate(() => window.app.themeManager.setTheme("light", false));
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(output, "light.png") });
  await page.locator(".global-search-input").fill("json");
  await page.locator(".global-search-result-item.active .result-title").filter({ hasText: "JSON" }).waitFor();
  const firstId = await page.locator(".global-search-result-item.active").getAttribute("id");
  await page.keyboard.press("ArrowDown");
  assert.notEqual(await page.locator(".global-search-result-item.active").getAttribute("id"), firstId);
  await page.keyboard.press("Escape");
  await page.locator(".global-search-modal").waitFor({ state: "hidden" });
  const failures = checks.flatMap((check) =>
    check.result
      .filter((part) => part.ratio < (part.selector === ".global-search-result-icon" ? 3 : 4.5))
      .map((part) => ({ theme: check.theme, accent: check.accent, state: check.state, ...part })),
  );
  await writeFile(resolve(output, "result.json"), JSON.stringify({ checks, failures }, null, 2) + "\n");
  assert.equal(failures.length, 0, JSON.stringify(failures.slice(0, 6), null, 2));
  console.log(`Passed ${checks.length} theme/accent/interaction combinations; filtering, keyboard navigation and Escape passed.`);
} finally {
  await browser.close();
}
