import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PROJECTS_TEST_URL || "http://127.0.0.1:1247";
const output = resolve("docs/verification/schema-manager");
const release = JSON.parse(await readFile("frontend/config/release-content.json", "utf8"));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, acceptDownloads: true });
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
      },
      { release },
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await page.waitForFunction(() => Boolean(window.app));
    const ids = await page.evaluate(async () => {
      const { getActiveProject, createProject } = await import("/core/Projects.js");
      const { IndexedDBStorageService } = await import("/tools/quick-query/services/IndexedDBStorageService.js");
      const source = getActiveProject();
      const target = createProject("Payments");
      const storage = new IndexedDBStorageService();
      const destination = new IndexedDBStorageService({ projectId: target.id });
      await storage.init();
      await destination.init();
      const schema = [["ID", "NUMBER", "No", null, null, "Yes"]];
      for (const name of ["APP.COPY_ME", "APP.MOVE_ME", "APP.DUPLICATE"])
        if (!(await storage.saveSchema(name, schema, [["ID"], ["42"]], { queryType: "insert" }))) throw new Error("Fixture save failed");
      await storage.saveQueryTab({ id: "draft", tableName: "APP.MOVE_ME", inputData: [["private draft"]] });
      await destination.saveSchema("APP.DUPLICATE", [["OTHER", "VARCHAR2(20)", "Yes", null, null, "No"]]);
      storage.db.close();
      destination.db.close();
      return { source: source.id, target: target.id };
    });
    await page.evaluate(() => window.app.router.navigate("settings"));
    await page.locator('.project-settings-nav button[data-project-section="schemas"]').click();
    const routeBefore = page.url();
    await page.locator(".project-schema-manage").click();
    const manager = page.getByRole("dialog", { name: "Default project — Saved schemas", exact: true });
    await manager.locator('.schema-manager-row[data-table="APP.COPY_ME"]').waitFor();
    assert.equal(page.url(), routeBefore);
    assert.equal(await page.evaluate(() => Boolean(window.app.tools.get("quick-query")?.ui)), false);
    assert.equal(await manager.locator(".schema-manager-row").count(), 3);
    await manager.getByRole("searchbox").fill("COPY_ME");
    await manager.locator('.schema-manager-row[data-table="APP.MOVE_ME"]').waitFor({ state: "hidden" });
    assert.equal(await manager.locator(".schema-manager-row").count(), 1);
    await manager.getByRole("searchbox").fill("");
    await manager.locator('.schema-manager-row[data-table="APP.MOVE_ME"]').waitFor();
    await page.screenshot({ path: resolve(output, `${width}-settings-schemas.png`), animations: "disabled" });
    const row = (name) => manager.locator(`.schema-manager-row[data-table="${name}"]`);
    await row("APP.COPY_ME").getByRole("button", { name: "Copy…", exact: true }).click();
    const copy = page.getByRole("dialog", { name: "Copy APP.COPY_ME", exact: true });
    assert.equal(await copy.locator("select option").count(), 1);
    assert.equal(await copy.locator("select").inputValue(), ids.target);
    await page.screenshot({ path: resolve(output, `${width}-copy-project.png`), animations: "disabled" });
    await copy.getByRole("button", { name: "Copy schema", exact: true }).click();
    await copy.waitFor({ state: "hidden" });
    await row("APP.COPY_ME").waitFor();
    await row("APP.DUPLICATE").getByRole("button", { name: "Move…", exact: true }).click();
    const duplicate = page.getByRole("dialog", { name: "Move APP.DUPLICATE", exact: true });
    await duplicate.getByRole("button", { name: "Move schema", exact: true }).click();
    await duplicate.getByText(/already exists.*Nothing was overwritten/).waitFor();
    await duplicate.getByRole("button", { name: "Cancel", exact: true }).click();
    await row("APP.MOVE_ME").getByRole("button", { name: "Move…", exact: true }).click();
    const move = page.getByRole("dialog", { name: "Move APP.MOVE_ME", exact: true });
    await move.getByRole("button", { name: "Move schema", exact: true }).click();
    await move.waitFor({ state: "hidden" });
    await row("APP.MOVE_ME").waitFor({ state: "hidden" });
    const result = await page.evaluate(
      async ({ ids }) => {
        const { IndexedDBStorageService } = await import("/tools/quick-query/services/IndexedDBStorageService.js");
        const { getActiveProject } = await import("/core/Projects.js");
        const source = new IndexedDBStorageService({ projectId: ids.source });
        const target = new IndexedDBStorageService({ projectId: ids.target });
        await source.init();
        await target.init();
        const result = {
          source: (await source.getAllTables()).map((t) => t.fullName),
          copied: await target.loadSchema("APP.COPY_ME", true),
          moved: await target.loadSchema("APP.MOVE_ME", true),
          duplicate: await target.loadSchema("APP.DUPLICATE"),
          draft: await source.getQueryTab("draft"),
          active: getActiveProject().id,
        };
        // Move back to the legacy database without switching projects.
        await target.transferSchema("APP.MOVE_ME", ids.source, { move: true });
        result.returned = await source.loadSchema("APP.MOVE_ME", true);
        // A real aborted destination transaction must preserve the source and roll back both stores.
        await source.saveSchema("APP.FAILURE", [["ID", "NUMBER", "Yes", null, null, "No"]]);
        const original = IDBObjectStore.prototype.add;
        IDBObjectStore.prototype.add = function (...args) {
          const request = original.apply(this, args);
          if (this.transaction.db.name === target.databaseName)
            request.addEventListener("success", () => {
              try {
                this.transaction.abort();
              } catch {
                // Another request in this same transaction may already have aborted it.
              }
            });
          return request;
        };
        try {
          await source.transferSchema("APP.FAILURE", ids.target, { move: true });
          result.failure = "unexpected success";
        } catch (error) {
          result.failure = error.message;
        } finally {
          IDBObjectStore.prototype.add = original;
        }
        result.originalKept = Boolean(await source.loadSchema("APP.FAILURE"));
        result.failedDestination = await target.loadSchema("APP.FAILURE");
        source.db.close();
        target.db.close();
        return result;
      },
      { ids },
    );
    assert.deepEqual(result.source, ["APP.COPY_ME", "APP.DUPLICATE"]);
    assert.equal(result.copied.queryType, "insert");
    assert.equal(result.moved.queryType, "insert");
    assert.deepEqual(result.copied.data, [["ID"], ["42"]]);
    assert.deepEqual(result.returned, result.moved);
    assert.equal(result.duplicate[0][0], "OTHER");
    assert.equal(result.draft.inputData[0][0], "private draft");
    assert.equal(result.active, ids.source);
    assert.match(result.failure, /original is unchanged/);
    assert.equal(result.originalKept, true);
    assert.equal(result.failedDestination, null);
    const downloadEvent = page.waitForEvent("download");
    await manager.getByRole("button", { name: "Export", exact: true }).click();
    const download = await downloadEvent;
    const exported = JSON.parse(await readFile(await download.path(), "utf8"));
    assert.ok(exported.APP.COPY_ME);
    await manager.locator('input[type="file"]').setInputFiles({
      name: "schemas.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ EXTRA: { IMPORTED: [["VALUE", "NUMBER", "Yes", null, null, "No"]] } })),
    });
    await row("EXTRA.IMPORTED").waitFor();
    await row("EXTRA.IMPORTED").getByRole("button", { name: "Delete", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Delete saved schema?", exact: true })
      .getByRole("button", { name: "Delete schema", exact: true })
      .click();
    await row("EXTRA.IMPORTED").waitFor({ state: "hidden" });
    await manager.getByRole("button", { name: "Close schema manager", exact: true }).click();
    assert.equal(page.url(), routeBefore);
    await page.evaluate(() => window.app.router.navigate("quick-query"));
    await page.waitForFunction(() => Boolean(window.app.tools.get("quick-query")?.ui?.storageService?.db));
    await page.evaluate(() => window.app.tools.get("quick-query").ui.openSavedSchemas());
    const queryRow = page.locator("#savedSchemasList .schema-item").filter({ has: page.locator(".schema-name", { hasText: /^FAILURE$/ }) });
    await queryRow.getByRole("button", { name: "Copy…", exact: true }).click();
    const queryCopy = page.getByRole("dialog", { name: "Copy APP.FAILURE", exact: true });
    await queryCopy.getByRole("button", { name: "Copy schema", exact: true }).click();
    await queryCopy.waitFor({ state: "hidden" });
    assert.equal(await queryRow.getByRole("button", { name: "Move…", exact: true }).count(), 1);
    await page.screenshot({ path: resolve(output, `${width}-query-actions.png`), animations: "disabled" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    checks.push(
      `${width}px: Settings manager stays in Settings without loading Query; search, copy, move, return to legacy project, saved data and query type preserved, drafts retained, collision and transaction failure safe, import/export/delete, Query transfer actions, no overflow/errors`,
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
