// Failure cases: wrong source project; leaked credentials; accidental cross-department audience;
// stale preview after edits; ambiguous replacement behavior; source switch retaining old values;
// failed publish losing review; history reuse of another project; overflow on narrow screens;
// people picker missing registered users, search hiding a selection, or sending unselected emails;
// department toggle missing members, an exclusion re-added, or the toggle misreporting a partial pick.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PUBLISHING_TEST_URL || "http://127.0.0.1:1247";
const output = resolve("docs/verification/settings-publisher");
const release = JSON.parse(await readFile("frontend/config/release-content.json", "utf8"));
const checks = [];
const errors = [];
let passed = false;
const browser = await chromium.launch({ channel: "chrome", headless: true });
await mkdir(output, { recursive: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    let published;
    let failPublish = true;
    let expectedTarget = { type: "departments", values: ["RETAIL"] };
    await context.addInitScript(
      ({ release }) => {
        localStorage.setItem("user.email", "fashalli.bilhaq@bankmandiri.co.id");
        localStorage.setItem("user.department", "RETAIL");
        localStorage.setItem("user.registered", "true");
        localStorage.setItem("theme", "dark");
        sessionStorage.setItem("analytics.dashboard.token", "fixture");
        localStorage.setItem(
          "config.projects",
          JSON.stringify({
            version: 1,
            legacyProjectId: "one",
            projects: [
              { id: "one", name: "Livin", department: "RETAIL" },
              { id: "two", name: "Kopra", department: "RETAIL" },
            ],
          }),
        );
        sessionStorage.setItem("config.project.active", "one");
        localStorage.setItem("config.redis.host", "livin-cache");
        localStorage.setItem("config.jira.projectKeys", '["LIVIN"]');
        localStorage.setItem("project:two:config.redis.host", "kopra-cache");
        localStorage.setItem("config.environments", JSON.stringify([{ id: "uat", name: "UAT", criticalConnection: "core" }]));
        localStorage.setItem(
          "config.oracle.environment.catalog",
          JSON.stringify({
            version: 1,
            connections: [
              { id: "core", environmentId: "uat", name: "Core", connect_string: "db.test:1521/UAT", username: "NEVER_PUBLISH" },
            ],
          }),
        );
        localStorage.setItem(`releaseTour.seen.${encodeURIComponent(release.releaseId)}`, "true");
        for (const tip of release.tips)
          localStorage.setItem(`releaseTip.opened.${encodeURIComponent(release.releaseId)}.${encodeURIComponent(tip.id)}`, "true");
      },
      { release },
    );
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/api/settings/admin/")) {
        const payload = route.request().postData() ? route.request().postDataJSON() : null;
        let data = {
          ok: true,
          publications: published
            ? [{ ...published, id: 1, createdAt: new Date().toISOString(), recipientCount: 1, appliedDevices: 0 }]
            : [],
        };
        if (url.pathname.endsWith("/users")) {
          data = {
            ok: true,
            users: [
              { email: "ana@bankmandiri.co.id", department: "RETAIL" },
              { email: "budi@bankmandiri.co.id", department: "SME" },
              { email: "citra@bankmandiri.co.id", department: null },
              { email: "dewi@bankmandiri.co.id", department: "RETAIL" },
            ],
          };
        } else if (url.pathname.endsWith("/preview")) {
          assert.deepEqual(payload.target, expectedTarget);
          assert.doesNotMatch(JSON.stringify(payload), /NEVER_PUBLISH/);
          data = { ok: true, recipients: [{ email: "retail@example.test" }], audienceHash: "fixture" };
        } else if (payload) {
          if (failPublish) {
            failPublish = false;
            return route.fulfill({ status: 500, json: { ok: false, error: "Fixture: retry publishing." } });
          }
          published = payload;
          data = { ok: true, recipientCount: 1 };
        }
        return route.fulfill({ json: data });
      }
      return url.origin === base ? route.continue() : route.fulfill({ status: 401, json: { ok: false } });
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}/#dashboard/publish-settings`);
    await page.locator(".publish-workspace").waitFor();
    assert.equal(await page.locator("#publish-audience").inputValue(), "departments");
    assert.equal(await page.locator('.publish-departments input[value="RETAIL"]').isChecked(), true);
    await page.getByRole("button", { name: "Use project settings", exact: true }).click();
    assert.equal(await page.locator('[data-value-key="config.redis.host"]').inputValue(), "livin-cache");
    assert.equal(await page.locator('[data-value-key="config.jira.projectKey"]').inputValue(), "LIVIN");
    assert.match(await page.locator(".publish-setting-list").innerText(), /db.test:1521\/UAT/);
    assert.equal(await page.locator('[data-setting="config.oracle.connections"]:visible').count(), 0);
    await page.locator(".publish-form").evaluate((element) => element.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: resolve(output, `${width}-project.png`), fullPage: true });
    await page.getByRole("button", { name: "Preview publication" }).click();
    await page.locator(".publish-preview").waitFor();
    assert.match(await page.locator(".publish-preview").innerText(), /Livin/);
    assert.match(await page.locator(".publish-preview").innerText(), /replace/i);
    assert.equal(await page.locator(".publish-recipients li").count(), 1);
    await page.locator("#publish-source").selectOption("two");
    assert.equal(await page.locator(".publish-preview").isVisible(), false);
    assert.equal(await page.locator("[data-setting]:checked").count(), 0);
    assert.equal(await page.locator("#publish-project").inputValue(), "Kopra");
    await page.getByRole("button", { name: "Use project settings", exact: true }).click();
    assert.equal(await page.locator('[data-value-key="config.redis.host"]').inputValue(), "kopra-cache");
    assert.equal(await page.evaluate(() => sessionStorage.getItem("config.project.active")), "one");
    await page.getByRole("button", { name: "Preview publication" }).click();
    await page.locator(".publish-preview").waitFor();
    await page.getByRole("button", { name: "Publish to 1 user", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Fixture: retry" }).waitFor();
    assert.equal(await page.locator('[data-action="publish"]').isEnabled(), true);
    await page.getByRole("button", { name: "Publish to 1 user", exact: true }).click();
    await page.locator(".publish-message").filter({ hasText: "Published to 1 user" }).waitFor();
    assert.equal(published.settings["project.name"], "Kopra");
    assert.equal(published.settings["config.redis.host"], "kopra-cache");
    await page.getByRole("button", { name: "Use as draft" }).click();
    await page.getByRole("button", { name: "Preview publication" }).click();
    await page.locator(".publish-preview").waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: resolve(output, `${width}-review.png`), fullPage: true });
    await page.locator("#publish-audience").selectOption("emails");
    const people = page.locator(".publish-people-list [data-person]");
    const retail = page.locator('.publish-people-list [data-group="RETAIL"]');
    const person = (name) => page.getByRole("checkbox", { name: new RegExp(`${name}@bankmandiri\\.co\\.id`) });
    assert.equal(await people.count(), 4);
    await retail.check();
    assert.equal(await person("ana").isChecked(), true);
    assert.equal(await person("dewi").isChecked(), true);
    await person("dewi").uncheck();
    assert.equal(await retail.evaluate((input) => input.indeterminate), true);
    await page.locator("#publish-people-search").fill("sme");
    assert.equal(await people.filter({ visible: true }).count(), 1);
    assert.equal(await retail.isVisible(), false);
    await person("budi").check();
    await page.locator("#publish-people-search").fill("");
    assert.equal(await person("dewi").isChecked(), false);
    assert.equal(await page.locator(".publish-people-list [data-person]:checked").count(), 2);
    assert.equal(await page.locator('[data-summary="recipients"]').innerText(), "2 people");
    expectedTarget = { type: "emails", values: ["ana@bankmandiri.co.id", "budi@bankmandiri.co.id"] };
    await page.getByRole("button", { name: "Preview publication" }).click();
    await page.locator(".publish-preview").waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.locator(".publish-people").screenshot({ path: resolve(output, `${width}-people.png`) });
    checks.push(
      `${width}px: department default, source isolation, readable connections, secret exclusion, preview invalidation, publish retry, history reuse, people picker search, department select with exclusions, no overflow`,
    );
    await context.close();
  }
  assert.deepEqual(errors, []);
  passed = true;
} catch (error) {
  errors.push(error.message);
  throw error;
} finally {
  await browser.close();
  await writeFile(
    resolve(output, "result.json"),
    JSON.stringify(
      {
        passed,
        checks,
        errors,
        command: `PUBLISHING_TEST_URL=${base} PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node frontend/pages/dashboard/tests/publishing-browser.mjs`,
        base,
      },
      null,
      2,
    ) + "\n",
  );
}
console.log(JSON.stringify({ passed: true, checks, output }));
