// Browser assessment of project isolation and cross-department assignments; no product changes.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PROJECTS_TEST_URL || "http://127.0.0.1:1247";
const output = resolve("docs/verification/project-model");
const release = JSON.parse(await readFile("frontend/config/release-content.json", "utf8"));
const checks = [];
const errors = [];
const browser = await chromium.launch({ channel: "chrome", headless: true });
await mkdir(output, { recursive: true });

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(
    ({ release }) => {
      if (localStorage.getItem("project-model-fixture")) return;
      localStorage.setItem("project-model-fixture", "1");
      localStorage.setItem("user.email", "dev@localhost");
      localStorage.setItem("user.registered", "true");
      localStorage.setItem("user.department", "RETAIL");
      localStorage.setItem(`releaseTour.seen.${encodeURIComponent(release.releaseId)}`, "true");
      for (const tip of release.tips) {
        localStorage.setItem(`releaseTip.opened.${encodeURIComponent(release.releaseId)}.${encodeURIComponent(tip.id)}`, "true");
      }
      localStorage.setItem("config.environments", JSON.stringify([{ name: "UAT", cdnPublicUrl: "https://livin.example" }]));
    },
    { release },
  );
  await context.route("**/*", (route) => (new URL(route.request().url()).origin === base ? route.continue() : route.abort()));
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.waitForFunction(() => Boolean(window.app));
  await page.evaluate(() => window.app.router.navigate("settings"));
  await page.locator(".project-add").waitFor();
  const firstId = await page.locator("select.project-settings-select").inputValue();
  await page.locator(".project-rename").click();
  await page.locator(".project-name-input").fill("Livin");
  await page.locator(".project-name-save").click();

  async function storeFixture(marker, column) {
    return page.evaluate(
      async ({ marker, column }) => {
        const { IndexedDBStorageService } = await import("/tools/quick-query/services/IndexedDBStorageService.js");
        const storage = new IndexedDBStorageService();
        await storage.init();
        assertSaved(await storage.saveSchema("APP.CUSTOMER", [[column, "VARCHAR2(100)", "Yes", "", "", ""]], [[column], [marker]]));
        assertSaved(
          await storage.saveQueryTab({
            id: "same-draft",
            tableName: "APP.CUSTOMER",
            generatedSql: marker,
            schemaData: [[column, "VARCHAR2(100)", "Yes", "", "", ""]],
            inputData: [[column], [marker]],
          }),
        );
        assertSaved(await storage.saveQueryTabSession({ tabOrder: ["same-draft"], activeTabId: "same-draft" }));
        const databaseName = storage.databaseName;
        storage.db.close();
        return databaseName;
        function assertSaved(saved) {
          if (!saved) throw new Error("Fixture persistence failed");
        }
      },
      { marker, column },
    );
  }

  async function snapshot(target = page) {
    return target.evaluate(async () => {
      const { IndexedDBStorageService } = await import("/tools/quick-query/services/IndexedDBStorageService.js");
      const { getActiveProject } = await import("/core/Projects.js");
      const { readEnvironments } = await import("/core/Environments.js");
      const storage = new IndexedDBStorageService();
      await storage.init();
      const result = {
        project: getActiveProject(),
        environments: readEnvironments(),
        database: storage.databaseName,
        table: await storage.loadSchema("APP.CUSTOMER", true),
        draft: await storage.getQueryTab("same-draft"),
        session: await storage.loadQueryTabSession(),
      };
      storage.db.close();
      return result;
    });
  }

  async function choose(id) {
    const name = await page.locator(`select.project-settings-select option[value="${id}"]`).innerText();
    await page.locator(".project-controls .ad-searchable-dropdown-trigger").click();
    await Promise.all([page.waitForEvent("load"), page.getByRole("option", { name, exact: true }).click()]);
    await page.locator(".project-add").waitFor();
  }

  const firstDatabase = await storeFixture("livin-data", "LIVIN_ID");
  assert.equal(firstDatabase, "QuickQueryDatabase");
  await page.locator(".project-add").click();
  await page.locator(".project-name-input").fill("Livin Dili");
  await Promise.all([page.waitForEvent("load"), page.locator(".project-name-save").click()]);
  await page.locator(".project-add").waitFor();
  const secondId = await page.locator("select.project-settings-select").inputValue();
  const empty = await snapshot();
  assert.equal(empty.table, null);
  assert.equal(empty.draft, null);
  assert.deepEqual(empty.environments, []);
  checks.push({ name: "New project starts without another project's environments, schemas or drafts", passed: true });
  await page.locator(".environment-add-btn").click();
  await page.locator(".environment-name").fill("UAT");
  await page.locator(".environment-public-url").fill("https://dili.example");
  await page.locator(".environment-save").click();
  const secondDatabase = await storeFixture("dili-data", "DILI_ID");
  assert.notEqual(secondDatabase, firstDatabase);
  const second = await snapshot();
  await choose(firstId);
  const first = await snapshot();
  assert.equal(first.table.schema[0][0], "LIVIN_ID");
  assert.deepEqual(first.table.data, [["LIVIN_ID"], ["livin-data"]]);
  assert.equal(first.draft.generatedSql, "livin-data");
  assert.equal(first.session.activeTabId, "same-draft");
  assert.equal(first.environments[0].cdnPublicUrl, "https://livin.example");
  checks.push({ name: "Identical APP.CUSTOMER, draft IDs and UAT names preserve Livin data", passed: true });
  await choose(secondId);
  assert.deepEqual(await snapshot(), second);
  checks.push({ name: "Switching back restores Livin Dili schemas, table data, draft, session and environment", passed: true });
  await page.reload();
  await page.waitForFunction(() => Boolean(window.app));
  await page.evaluate(() => window.app.router.navigate("settings"));
  await page.locator(".project-add").waitFor();
  assert.deepEqual(await snapshot(), second);
  checks.push({ name: "Project identity and contents survive reload", passed: true });
  const otherTab = await context.newPage();
  await otherTab.goto(base);
  await otherTab.waitForFunction(() => Boolean(window.app));
  assert.equal((await snapshot(otherTab)).project.id, secondId);
  await choose(firstId);
  assert.equal((await snapshot(otherTab)).project.id, secondId);
  checks.push({ name: "Existing tab retains its project when another tab switches", passed: true });
  await page.screenshot({ path: resolve(output, "livin-settings.png"), fullPage: true });
  for (const [id, column, marker, screenshot] of [
    [firstId, "LIVIN_ID", "livin-data", "livin-query.png"],
    [secondId, "DILI_ID", "dili-data", "livin-dili-query.png"],
  ]) {
    if ((await page.locator("select.project-settings-select").inputValue()) !== id) await choose(id);
    await page.evaluate(() => window.app.router.navigate("quick-query"));
    await page.waitForFunction(() => Boolean(window.app.tools.get("quick-query")?.ui));
    const rendered = await page.evaluate(async () => {
      const ui = window.app.tools.get("quick-query").ui;
      await ui.ready;
      return {
        table: ui.elements.tableNameInput.value,
        schema: ui.schemaTable.getData(),
        data: ui.dataTable.getData(),
        sql: ui.editor.getValue(),
      };
    });
    assert.equal(rendered.table, "APP.CUSTOMER");
    assert.equal(rendered.schema[0][0], column);
    assert.equal(rendered.data[1][0], marker);
    assert.equal(rendered.sql, marker);
    await page.screenshot({ path: resolve(output, screenshot), fullPage: true });
    await page.evaluate(() => window.app.router.navigate("settings"));
    await page.locator(".project-add").waitFor();
  }
  checks.push({ name: "Actual Quick Query UI renders the correct project's same-named table, columns, input rows and SQL", passed: true });
  const assignment = await page.evaluate(async () => {
    const projects = await import("/core/Projects.js");
    localStorage.setItem("user.department", "SME");
    const external = projects.createProject("Other department project");
    localStorage.setItem("user.department", "RETAIL");
    let error = null;
    try {
      projects.selectProject(external.id);
    } catch (caught) {
      error = caught.message;
    }
    return { visible: projects.listProjects().some((project) => project.id === external.id), error };
  });
  checks.push({
    name: "Retail user can select an assigned project handled by another department",
    passed: assignment.visible && !assignment.error,
    actual: assignment,
    note: "Assignment is a business scenario; the implementation has no project membership model.",
  });
  assert.deepEqual(errors, []);
  checks.push({ name: "No browser exceptions during the scenarios", passed: true });
  await context.close();
} catch (error) {
  checks.push({ name: "Scenario execution", passed: false, error: error.stack });
} finally {
  await browser.close();
  const result = { checkedAt: new Date().toISOString(), passed: checks.every((check) => check.passed), checks, browserErrors: errors };
  await writeFile(resolve(output, "result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}
