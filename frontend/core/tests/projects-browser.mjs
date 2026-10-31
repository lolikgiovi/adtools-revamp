// End-to-end project isolation. Run against Vite with an already installed Playwright.
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "vite";
import { resolve } from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PROJECTS_TEST_URL || "http://localhost:1234";
const output = resolve("docs/verification/projects");
const release = JSON.parse(await readFile("frontend/config/release-content.json", "utf8"));
await mkdir(output, { recursive: true });
async function chooseProject(page, id) {
  const name = await page.locator(`select.project-settings-select option[value="${id}"]`).innerText();
  await page.locator(".project-controls .ad-searchable-dropdown-trigger").click();
  await page.getByRole("option", { name, exact: true }).click();
}
// Run the actual Worker routes against a disposable SQLite database (D1 adapter).
const sqlite = new DatabaseSync(":memory:");
for (const file of (await readdir("backend-workers/migrations")).filter((file) => file.endsWith(".sql")).sort()) {
  sqlite.exec(await readFile(`backend-workers/migrations/${file}`, "utf8"));
}
const DB = {
  prepare(sql) {
    const bound = (args) => ({
      all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
      first: async () => sqlite.prepare(sql).get(...args) || null,
      run: async () => ({ meta: sqlite.prepare(sql).run(...args) }),
    });
    return { ...bound([]), bind: (...args) => bound(args) };
  },
};
sqlite.exec(`INSERT INTO users (id,email,department,created_time,last_seen) VALUES
  ('publisher','dev@localhost','RETAIL','2026-10-30','2026-10-30'),
  ('chooser','chooser@example.test','SME','2026-10-30','2026-10-30');
  INSERT INTO device (device_id,user_id,created_time,last_seen) VALUES
  ('project-publisher','publisher','2026-10-30','2026-10-30'),
  ('project-chooser','chooser','2026-10-30','2026-10-30');`);
const moduleServer = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { default: worker } = await moduleServer.ssrLoadModule(resolve("backend-workers/worker.js"));
const directoryRequests = [];
async function intercept(route) {
  const request = route.request();
  if (new URL(request.url()).pathname.startsWith("/api/settings/")) {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/projects")) {
      directoryRequests.push(request.postDataJSON());
    }
    const response = await worker.fetch(
      new Request(request.url(), {
        method: request.method(),
        headers: request.headers(),
        ...(["GET", "HEAD"].includes(request.method()) ? {} : { body: request.postData() }),
      }),
      { DB },
    );
    return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
  }
  return new URL(request.url()).origin === base ? route.continue() : route.abort();
}
async function seedCredential(context, email, deviceId) {
  const response = await worker.fetch(
    new Request("http://localhost/api/settings/enroll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, deviceId, isDevelopment: true }),
    }),
    { DB },
  );
  const identity = await response.json();
  assert.equal(identity.ok, true);
  await context.addInitScript(
    ({ identity, email, deviceId }) => {
      localStorage.setItem("user.email", email);
      localStorage.setItem("adtools.deviceId", deviceId);
      localStorage.setItem("settings.sync.credential", JSON.stringify(identity));
    },
    { identity, email, deviceId },
  );
}
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addInitScript(
      ({ release }) => {
        if (localStorage.getItem("projects-fixture")) return;
        localStorage.setItem("projects-fixture", "1");
        localStorage.setItem("user.email", "dev@localhost");
        localStorage.setItem("user.registered", "true");
        localStorage.setItem("user.department", "RETAIL");
        localStorage.setItem(`releaseTour.seen.${encodeURIComponent(release.releaseId)}`, "true");
        for (const tip of release.tips)
          localStorage.setItem(`releaseTip.opened.${encodeURIComponent(release.releaseId)}.${encodeURIComponent(tip.id)}`, "true");
        localStorage.setItem("config.environments", JSON.stringify([{ id: "uat", name: "UAT", cdnPublicUrl: "https://legacy.example" }]));
      },
      { release },
    );
    await seedCredential(context, "dev@localhost", "project-publisher");
    await context.route("**/*", intercept);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await page.waitForFunction(() => Boolean(window.app));
    await page.evaluate(() => window.app.router.navigate("settings"));
    await page.locator(".project-add").waitFor();
    assert.match(await page.locator(".environments-list").innerText(), /legacy.example/);
    const firstId = await page.locator("select.project-settings-select").inputValue();
    await page.locator(".project-add").click();
    await page.locator(".project-name-input").fill("Payments");
    await Promise.all([page.waitForEvent("load"), page.locator(".project-name-save").click()]);
    await page.locator(".project-add").waitFor();
    assert.equal(await page.locator(".project-settings-select option:checked").innerText(), "Payments");
    assert.match(await page.locator(".environments-list").innerText(), /No environments/);
    await page.locator(".environment-add-btn").click();
    await page.locator(".environment-name").fill("SIT");
    await page.locator(".environment-public-url").fill("https://payments.example");
    await page.locator(".environment-save").click();
    const secondId = await page.locator("select.project-settings-select").inputValue();
    await page.locator(".project-rename").click();
    await page.locator(".project-name-input").fill("Payments v2");
    await page.locator(".project-name-save").click();
    assert.equal(await page.locator(".project-settings-select option:checked").innerText(), "Payments v2");
    const catalogs = await page.evaluate(async () => {
      const { IndexedDBStorageService } = await import("/tools/quick-query/services/IndexedDBStorageService.js");
      const storage = new IndexedDBStorageService();
      await storage.init();
      await storage.saveSchema("APP.PAYMENTS", [["ID", "NUMBER", "Yes", "", "", ""]]);
      await storage.saveQueryTab({ id: "draft", tableName: "APP.PAYMENTS", inputData: [["project-only"]] });
      return (await storage.getAllTables()).map((table) => table.fullName);
    });
    assert.deepEqual(catalogs, ["APP.PAYMENTS"]);
    await Promise.all([page.waitForEvent("load"), chooseProject(page, firstId)]);
    await page.locator(".project-add").waitFor();
    assert.match(await page.locator(".environments-list").innerText(), /legacy.example/);
    const first = await page.evaluate(async () => {
      const { IndexedDBStorageService } = await import("/tools/quick-query/services/IndexedDBStorageService.js");
      const storage = new IndexedDBStorageService();
      await storage.init();
      return { tables: await storage.getAllTables(), draft: await storage.getQueryTab("draft") };
    });
    assert.deepEqual(first.tables, []);
    assert.equal(first.draft, null);
    await Promise.all([page.waitForEvent("load"), chooseProject(page, secondId)]);
    await page.locator(".project-add").waitFor();
    assert.match(await page.locator(".environments-list").innerText(), /payments.example/);
    assert.equal(await page.locator(".header-actions > .header-project select").inputValue(), secondId);
    assert.equal(await page.locator(".sidebar-project").count(), 0);
    const header = await page.locator(".header-project").boundingBox();
    assert.ok(header.x + header.width <= width + 1 && header.x > width / 2, JSON.stringify({ width, header }));
    await page.locator(".header-project .ad-searchable-dropdown-trigger").click();
    const menu = page.locator(".ad-searchable-dropdown-menu[aria-hidden='false']");
    await menu.waitFor({ state: "visible" });
    const bounds = await menu.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (width === 1440) {
      await page.locator("html").evaluate((root) => {
        root.dataset.tauri = "true";
        window.app.placeHeaderControls(true);
      });
      const connection = await page.locator(".connection-indicators").boundingBox();
      const project = await page.locator(".header-project").boundingBox();
      assert.ok(connection.x + connection.width < project.x);
      await page.screenshot({ path: resolve(output, "1440-desktop-header.png"), animations: "disabled" });
      await page.locator("html").evaluate((root) => {
        root.dataset.tauri = "false";
        window.app.placeHeaderControls(false);
      });
    }
    await page.screenshot({ path: resolve(output, `${width}-projects.png`), fullPage: true, animations: "disabled" });
    await page.locator(".project-schema-manage").click();
    await page.locator("#schemaOverlay:not(.hidden)").waitFor();
    assert.equal(await page.locator("#schemaOverlay h3").innerText(), "Payments v2 — Saved schemas");
    assert.match(await page.locator("#savedSchemasList").innerText(), /PAYMENTS/);
    await page.screenshot({ path: resolve(output, `${width}-schemas.png`), fullPage: true, animations: "disabled" });
    await page.locator("#closeSchemaOverlay").click();
    await page.evaluate(() => window.app.router.navigate("settings"));
    await page.locator(".project-add").waitFor();
    await Promise.all([page.waitForEvent("load"), chooseProject(page, firstId)]);
    await page.locator(".project-schema-manage").click();
    await page.locator("#schemaOverlay:not(.hidden)").waitFor();
    assert.match(await page.locator("#schemaOverlay h3").innerText(), /Default project/);
    assert.doesNotMatch(await page.locator("#savedSchemasList").innerText(), /PAYMENTS/);
    assert.deepEqual(errors, []);
    checks.push(
      `${width}px: migrated legacy environment, created/renamed/switched projects, isolated schemas and drafts, restored environments, no overflow/errors`,
    );
    // Publish from one user, choose from a separate user's context, preserve private data.
    await page.locator("#closeSchemaOverlay").click();
    await page.evaluate(() => window.app.router.navigate("settings"));
    await page.locator(".project-add").waitFor();
    await Promise.all([page.waitForEvent("load"), chooseProject(page, secondId)]);
    await page.locator(".project-publish").click();
    await page.getByText("“Payments v2” is available for everyone to choose.", { exact: true }).waitFor();
    assert.deepEqual(directoryRequests.at(-1), { name: "Payments v2" });
    const chooser = await browser.newContext({ viewport: { width, height: 1000 } });
    await chooser.addInitScript(
      ({ release }) => {
        localStorage.setItem("user.registered", "true");
        localStorage.setItem("user.department", "SME");
        localStorage.setItem(`releaseTour.seen.${encodeURIComponent(release.releaseId)}`, "true");
        for (const tip of release.tips)
          localStorage.setItem(`releaseTip.opened.${encodeURIComponent(release.releaseId)}.${encodeURIComponent(tip.id)}`, "true");
      },
      { release },
    );
    await seedCredential(chooser, "chooser@example.test", "project-chooser");
    await chooser.route("**/*", intercept);
    const teammate = await chooser.newPage();
    teammate.on("pageerror", (error) => errors.push(error.message));
    await teammate.goto(base);
    await teammate.waitForFunction(() => Boolean(window.app));
    await teammate.evaluate(() => window.app.router.navigate("settings"));
    await teammate.locator("select.project-directory-select:not([disabled])").waitFor({ state: "attached" });
    const trigger =
      width === 1440 ? ".project-directory-controls .ad-searchable-dropdown-trigger" : ".header-project .ad-searchable-dropdown-trigger";
    await teammate.locator(trigger).click();
    await Promise.all([
      teammate.waitForEvent("load"),
      width === 1440
        ? (async () => {
            await teammate.getByRole("option", { name: "Payments v2", exact: true }).click();
            await teammate.locator(".project-use-shared").click();
          })()
        : teammate.getByRole("option", { name: "Payments v2", exact: true }).click(),
    ]);
    await teammate.locator(".project-add").waitFor();
    assert.equal(await teammate.locator(".project-settings-select option:checked").innerText(), "Payments v2");
    assert.match(await teammate.locator(".environments-list").innerText(), /No environments/);
    await teammate.locator(".project-schema-manage").click();
    await teammate.locator("#schemaOverlay:not(.hidden)").waitFor();
    assert.doesNotMatch(await teammate.locator("#savedSchemasList").innerText(), /PAYMENTS/);
    await teammate.screenshot({ path: resolve(output, `${width}-shared-project.png`), fullPage: true, animations: "disabled" });
    checks.push(`${width}px: actual Worker API shares names across users and departments without sharing schemas or environments`);
    assert.deepEqual(errors, []);
    await chooser.close();
    await context.close();
  }
  await writeFile(resolve(output, "result.json"), JSON.stringify({ passed: true, checks }, null, 2) + "\n");
  console.log(checks.join("\n"));
} catch (error) {
  const snapshots = [];
  for (const context of browser.contexts())
    for (const page of context.pages()) {
      snapshots.push(
        await page.evaluate(() => ({
          hash: location.hash,
          text: document.body.innerText.slice(-1800),
          tool: Boolean(window.app?.tools.get("quick-query")?.ui),
          active: window.app?.tools.get("quick-query")?.isActive,
        })),
      );
    }
  await writeFile(resolve(output, "result.json"), JSON.stringify({ passed: false, checks, error: error.stack, snapshots }, null, 2));
  throw error;
} finally {
  await browser.close();
  sqlite.close();
  await moduleServer.close();
}
