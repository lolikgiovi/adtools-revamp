// Uses installed Playwright and Chrome. Reproduction is recorded with the artifacts.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PROJECTS_TEST_URL || "http://127.0.0.1:1247";
const output = resolve("docs/verification/settings-navigation");
const release = JSON.parse(await readFile("frontend/config/release-content.json", "utf8"));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.route("**/*", (route) => (new URL(route.request().url()).origin === base ? route.continue() : route.abort()));
    await context.addInitScript(
      ({ release }) => {
        localStorage.setItem("user.registered", "true");
        localStorage.setItem("user.email", "dev@localhost");
        localStorage.setItem("user.department", "RETAIL");
        localStorage.setItem("theme", "dark");
        localStorage.setItem(`releaseTour.seen.${encodeURIComponent(release.releaseId)}`, "true");
        for (const tip of release.tips)
          localStorage.setItem(`releaseTip.opened.${encodeURIComponent(release.releaseId)}.${encodeURIComponent(tip.id)}`, "true");
        localStorage.setItem(
          "config.environments",
          JSON.stringify([
            { id: "uat1", name: "UAT1", cdnPublicUrl: "https://mobile.example.test/uat1/customer" },
            { id: "uat2", name: "UAT2", cdnPublicUrl: "https://mobile.example.test/uat2/customer" },
            { id: "uat3", name: "UAT3", cdnPublicUrl: "https://mobile.example.test/uat3/customer" },
          ]),
        );
      },
      { release },
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await page.waitForFunction(() => Boolean(window.app));
    await page.evaluate(() => window.app.router.navigate("settings"));
    await page.locator(".project-settings-nav").waitFor();
    // Render the real desktop settings with native commands stubbed; no real credentials or services.
    await page.evaluate(async () => {
      window.__TAURI_INTERNALS__ = { invoke: async () => null };
      const { SettingsPage } = await import("/pages/settings/main.js");
      const { SettingsSearch } = await import("/pages/settings/search.js");
      const config = (await import("/pages/settings/config.json")).default;
      const page = new SettingsPage();
      page.runtime = "tauri";
      page.currentConfig = config;
      page.categoriesRoot = document.querySelector(".settings-categories");
      page.searchInput = document.querySelector("#settings-search");
      page.settingsSearch = new SettingsSearch(page.categoriesRoot);
      page.service.shouldShowCategory = () => true;
      page.service.shouldShowItem = () => true;
      page.renderCategories(config.categories);
      page.searchInput.addEventListener("input", () => page.applySearch());
      window.settingsFixture = page;
    });
    if (width === 390) await page.evaluate(() => window.app.sidebar.close());
    assert.equal(await page.locator(".project-directory-retry").count(), 0);
    await page.locator("select.project-settings-select").selectOption("__new__", { force: true });
    const projectDialog = page.getByRole("dialog", { name: "New project", exact: true });
    await projectDialog.waitFor();
    assert.equal(await projectDialog.locator(".setting-actions").evaluate((element) => getComputedStyle(element).borderTopWidth), "0px");
    const nameInput = projectDialog.locator(".project-name-input");
    await projectDialog.getByRole("button", { name: "Cancel", exact: true }).focus();
    const idleBorder = await nameInput.evaluate((element) => getComputedStyle(element).borderColor);
    await nameInput.focus();
    const focused = await nameInput.evaluate((element) => {
      const style = getComputedStyle(element);
      return { border: style.borderColor, outline: style.outlineStyle, shadow: style.boxShadow };
    });
    assert.notEqual(focused.border, idleBorder);
    assert.equal(focused.outline, "none");
    assert.equal(focused.shadow, "none");
    await page.screenshot({ path: resolve(output, `${width}-project-focus.png`), animations: "disabled" });
    await page.keyboard.press("Escape");
    const nav = page.locator(".project-settings-nav");
    const labels = await nav.locator("button").allTextContents();
    assert.deepEqual(labels, [
      "Quick Query schemas",
      "Jira",
      "Testing Environments",
      "Redis",
      "Kafka",
      "Lockey",
      "Merge SQL",
      "Velocity API Validator",
    ]);
    for (const label of labels) {
      await nav.getByRole("button", { name: label, exact: true }).click();
      assert.equal(await page.locator(".project-settings-panel:visible").count(), 1);
      assert.equal(await nav.locator('[aria-current="page"]').innerText(), label);
    }
    await nav.getByRole("button", { name: "Testing Environments", exact: true }).click();
    assert.equal(await page.locator(".environment-entry").count(), 3);
    assert.equal(await page.locator(".environment-connections").count(), 0);
    assert.doesNotMatch(await page.locator(".environments-list").innerText(), /Critical:|Complementary:|No connections/);
    await page.locator(".settings-project").scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, `${width}-environments.png`), fullPage: true, animations: "disabled" });
    await page.locator(".settings-project").screenshot({ path: resolve(output, `${width}-project-panel.png`), animations: "disabled" });
    await page.locator(".environment-edit").first().click();
    const editor = page.getByRole("dialog", { name: "Edit Environment", exact: true });
    await editor.waitFor();
    assert.equal(await editor.locator(".environment-public-url").inputValue(), "https://mobile.example.test/uat1/customer");
    assert.equal(await editor.locator(".oracle-add-btn").count(), 1);
    await editor.locator(".settings-bulk-edit").click();
    const bulk = page.getByRole("dialog", { name: "Bulk Edit Oracle connections", exact: true });
    await bulk.locator(".monaco-editor textarea").waitFor({ state: "attached" });
    await bulk.locator(".monaco-editor textarea").focus();
    const textFocus = await bulk.locator(".monaco-editor textarea").evaluate((element) => ({
      outline: getComputedStyle(element).outlineStyle,
      shadow: getComputedStyle(element).boxShadow,
    }));
    assert.equal(textFocus.outline, "none");
    assert.equal(textFocus.shadow, "none");
    await page.screenshot({ path: resolve(output, `${width}-bulk-focus.png`), animations: "disabled" });
    await bulk.locator(".settings-bulk-cancel").click();
    // A connection modal can open and close without losing the environment draft.
    await editor.locator(".environment-name").fill("UAT1 renamed");
    await editor.locator(".oracle-add-btn").click();
    const connection = page.getByRole("dialog", { name: "Add Connection", exact: true });
    await connection.waitFor();
    await connection.locator(".oracle-cancel-btn").click();
    assert.equal(await editor.locator(".environment-name").inputValue(), "UAT1 renamed");
    await editor.locator(".oracle-add-btn").click();
    await connection.waitFor();
    await connection.locator(".oracle-name").fill("CORE");
    await connection.locator(".oracle-connect-string").fill("db.example.test:1521/CORE");
    await connection.locator(".oracle-username").fill("fixture-user");
    await connection.locator(".oracle-password").fill("fixture-password");
    await connection.locator(".oracle-save-btn").click();
    await connection.waitFor({ state: "hidden" });
    await editor.locator("select.environment-critical").selectOption({ label: "CORE" }, { force: true });
    await editor.locator(".environment-public-url").fill("https://mobile.example.test/updated");
    await page.screenshot({ path: resolve(output, `${width}-environment-editor.png`), animations: "disabled" });
    await editor.locator(".environment-save").click();
    assert.match(await page.locator(".environments-list").innerText(), /UAT1 renamed/);
    assert.match(await page.locator(".environments-list").innerText(), /updated/);
    assert.match(await page.locator(".environments-list").innerText(), /CORE/);
    await page.locator(".environment-edit").last().click();
    await editor.locator(".environment-delete").click();
    const confirmation = page.getByRole("dialog", { name: "Delete environment?", exact: true });
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await page.locator(".environment-entry").count(), 3);
    await editor.locator(".environment-delete").click();
    await confirmation.getByRole("button", { name: "Delete environment", exact: true }).click();
    await editor.waitFor({ state: "hidden" });
    assert.equal(await page.locator(".environment-entry").count(), 2);
    // Search must reveal the matching panel, and clearing it must restore navigation.
    await page.locator("#settings-search").fill("Redis Host");
    assert.equal(await page.locator(".project-settings-panel:visible").count(), 1);
    assert.equal(await nav.locator("button:visible").count(), 1);
    assert.equal(await nav.locator('[aria-current="page"]').innerText(), "Redis");
    await page.locator("#settings-search").fill("");
    assert.equal(await nav.locator("button:visible").count(), 8);
    await page.evaluate(() => window.settingsFixture.focusRequestedSetting("config.velocityValidator.url"));
    assert.equal(await nav.locator('[aria-current="page"]').innerText(), "Velocity API Validator");
    assert.equal(await page.locator(".project-settings-panel:visible").count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    checks.push(
      `${width}px: eight peer sections, one visible panel, compact environments, unified editor, single-border field and JSON focus, project overlay without divider, no retry button, connection creation and binding, safe deletion, saved edits, search, deep links, no overflow or JS errors`,
    );
    await context.close();
  }
  await writeFile(resolve(output, "result.json"), JSON.stringify({ passed: true, checks }, null, 2) + "\n");
  console.log(checks.join("\n"));
} catch (error) {
  for (const context of browser.contexts())
    for (const page of context.pages()) await page.screenshot({ path: resolve(output, "failure.png"), fullPage: true }).catch(() => {});
  await writeFile(resolve(output, "result.json"), JSON.stringify({ passed: false, checks, error: error.stack }, null, 2) + "\n");
  throw error;
} finally {
  await browser.close();
}
