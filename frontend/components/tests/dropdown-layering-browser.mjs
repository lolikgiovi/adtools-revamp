// Run with Vite and an already installed Playwright; see the verification README.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.DROPDOWN_TEST_URL || "http://localhost:1234";
const output = "docs/verification/dropdown-layering";
const release = JSON.parse(await readFile("frontend/config/release-content.json", "utf8"));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks = [];
async function checkMenu(page, trigger, label) {
  await trigger.click();
  const menu = page.locator(".ad-searchable-dropdown-menu[aria-hidden='false']");
  await menu.waitFor({ state: "visible" });
  await page.waitForTimeout(200);
  const result = await menu.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const points = [
      [rect.left + 15, rect.top + 15],
      [rect.right - 15, rect.bottom - 15],
    ];
    return {
      uncovered: points.every(([x, y]) => el.contains(document.elementFromPoint(x, y))),
      inside: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
    };
  });
  assert.equal(result.uncovered, true, `${label}: menu is covered or clipped`);
  assert.equal(result.inside, true, `${label}: menu exceeds viewport`);
  await page.screenshot({ path: `${output}/${label}.png` });
  await page.keyboard.press("Escape");
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  checks.push(label);
}
try {
  for (const width of [1440, 620]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript(
      ({ release }) => {
        localStorage.setItem("user.email", "dev@localhost");
        localStorage.setItem("user.registered", "true");
        localStorage.setItem("user.department", "RETAIL");
        localStorage.setItem(`releaseTour.seen.${encodeURIComponent(release.releaseId)}`, "true");
        for (const tip of release.tips)
          localStorage.setItem(`releaseTip.opened.${encodeURIComponent(release.releaseId)}.${encodeURIComponent(tip.id)}`, "true");
      },
      { release },
    );
    await context.route("**/*", (route) => (new URL(route.request().url()).origin === base ? route.continue() : route.abort()));
    const page = await context.newPage();
    await page.goto(base);
    await page.waitForFunction(() => Boolean(window.app));
    await page.evaluate(() => window.app.router.navigate("settings"));
    await checkMenu(page, page.locator(".project-controls .ad-searchable-dropdown-trigger"), `project-${width}`);
    if (width === 1440) await checkMenu(page, page.locator(".sidebar-project .ad-searchable-dropdown-trigger"), `sidebar-project-${width}`);
    await page.goto(`${base}/tools/master-lockey/tests/search-modes.html`);
    await page.locator("#load").click();
    await checkMenu(page, page.locator("#domain-selector-trigger"), `lockey-${width}`);
    await checkMenu(page, page.locator("#search-mode-trigger"), `lockey-mode-${width}`);
    // Exercise the shared component inside a clipped, transformed stacking context,
    // with a later sibling covering it. Also verify menus inside native dialogs.
    for (const nativePopover of [true, false]) {
      await page.evaluate(async (nativePopover) => {
        const { SearchableDropdown } = await import("/components/SearchableDropdown.js");
        const host = document.createElement("dialog");
        host.style.cssText = "width:400px;height:300px;padding:20px";
        host.innerHTML = `<div style="transform:translateZ(0);overflow:hidden;height:40px"><select aria-label="Layer test"><option>Alpha</option><option>Beta</option></select></div><div style="position:relative;z-index:9999;height:220px;background:gray">Cover</div>`;
        document.body.append(host);
        host.showModal();
        const dropdown = new SearchableDropdown(host.querySelector("select"));
        if (!nativePopover) dropdown.menu.showPopover = undefined;
        window.layerFixture = { host, dropdown };
      }, nativePopover);
      await checkMenu(page, page.locator("dialog .ad-searchable-dropdown-trigger"), `dialog-${nativePopover}-${width}`);
      await page.locator("dialog .ad-searchable-dropdown-trigger").click();
      const search = page.locator(".ad-searchable-dropdown-menu[aria-hidden='false'] input");
      assert.equal(await search.isVisible(), false, "Two options must not show search");
      await page.getByRole("option", { name: "Beta", exact: true }).click();
      assert.equal(await page.locator("dialog select").inputValue(), "Beta");
      await page.locator("dialog .ad-searchable-dropdown-trigger").click();
      await page.getByText("Cover", { exact: true }).click({ position: { x: 10, y: 210 } });
      assert.equal(await page.locator("dialog .ad-searchable-dropdown-trigger").getAttribute("aria-expanded"), "false");
      await page.evaluate(() => {
        window.layerFixture.dropdown.destroy();
        window.layerFixture.host.remove();
      });
    }
    // Failure cases: wrong threshold, stale filtering after live option changes,
    // lost focus on mode changes, disabled options selected, duplicate native events.
    await page.evaluate(async () => {
      const { SearchableDropdown } = await import("/components/SearchableDropdown.js");
      const select = document.createElement("select");
      select.id = "adaptive-fixture";
      select.setAttribute("aria-label", "Adaptive fixture");
      document.querySelector("#fixture-controls").append(select);
      window.adaptiveDropdown = new SearchableDropdown(select);
      window.adaptiveChanges = 0;
      select.addEventListener("change", () => window.adaptiveChanges++);
    });
    const adaptiveTrigger = page.locator("#adaptive-fixture-trigger");
    const adaptiveSearch = page.locator("#adaptive-fixture-search");
    for (const count of [0, 1, 2, 3, 4, 8]) {
      await page.evaluate((count) => {
        const select = document.querySelector("#adaptive-fixture");
        select.replaceChildren(...Array.from({ length: count }, (_, index) => new Option(`Option ${index + 1}`, String(index + 1))));
      }, count);
      await adaptiveTrigger.click();
      await page.locator("#adaptive-fixture-menu").waitFor({ state: "visible" });
      assert.equal(await adaptiveSearch.isVisible(), count > 3, `${count} options: search threshold`);
      if (count > 3) {
        await adaptiveSearch.fill(`Option ${count}`);
        assert.equal(await page.locator("#adaptive-fixture-options [role='option']").count(), 1);
        await page.keyboard.press("Enter");
        assert.equal(await page.locator("#adaptive-fixture").inputValue(), String(count));
      } else {
        await page.keyboard.press("Escape");
      }
      assert.equal(await adaptiveTrigger.getAttribute("aria-expanded"), "false");
    }
    await adaptiveTrigger.click();
    await adaptiveSearch.fill("Option 8");
    await page.evaluate(() => {
      const select = document.querySelector("#adaptive-fixture");
      select.replaceChildren(new Option("Alpha", "a"), new Option("Blocked", "b"), new Option("Gamma", "g"));
      select.options[1].disabled = true;
    });
    await page.waitForFunction(() => document.querySelector("#adaptive-fixture-search").closest("div").hidden);
    assert.equal(await page.locator("#adaptive-fixture-options [role='option']").count(), 3);
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#adaptive-fixture").inputValue(), "g");
    assert.equal(await page.evaluate(() => window.adaptiveChanges), 3);
    await adaptiveTrigger.click();
    await page.evaluate(() => document.querySelector("#adaptive-fixture").add(new Option("Delta", "d")));
    await page.waitForFunction(() => document.activeElement === document.querySelector("#adaptive-fixture-search"));
    await adaptiveSearch.fill("Delta");
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#adaptive-fixture").inputValue(), "d");
    await page.evaluate(() => {
      window.adaptiveDropdown.destroy();
      document.querySelector("#adaptive-fixture").remove();
    });
    checks.push(`adaptive-threshold-keyboard-live-updates-${width}`);
    await context.close();
  }
  await writeFile(`${output}/result.json`, JSON.stringify({ passed: true, checks }, null, 2) + "\n");
  console.log(`Passed: ${checks.join(", ")}`);
} finally {
  await browser.close();
}
