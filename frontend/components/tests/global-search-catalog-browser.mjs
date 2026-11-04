// Failure cases: unprefixed misses, stale save/delete/rename results, cross-window updates,
// project leakage, cold file navigation, stale async results, payload reads per keystroke, unbounded rendering.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.SEARCH_TEST_URL || "http://localhost:1234";
const output = "docs/verification/global-search-catalog";
const release = JSON.parse(await readFile("frontend/config/release-content.json", "utf8"));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript((release) => {
    localStorage.setItem("user.email", "catalog-test@example.com");
    localStorage.setItem("user.registered", "true");
    localStorage.setItem(`releaseTour.seen.${encodeURIComponent(release.releaseId)}`, "true");
    for (const tip of release.tips)
      localStorage.setItem(`releaseTip.opened.${encodeURIComponent(release.releaseId)}.${encodeURIComponent(tip.id)}`, "true");
  }, release);
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort(),
  );
  const page = await context.newPage();
  await page.routeWebSocket("**", (socket) => socket.close());
  await page.goto(base);
  await page.waitForFunction(() => Boolean(window.app?.globalSearch));
  await page.evaluate(async () => {
    const { IndexedDBStorageService } = await import("/tools/quick-query/services/IndexedDBStorageService.js");
    const service = new IndexedDBStorageService();
    await service.init();
    await new Promise((resolve, reject) => {
      const tx = service.db.transaction("schemas", "readwrite");
      for (let i = 0; i < 10000; i++) {
        const schemaName = i < 20 ? "CONFIG" : "APP";
        const tableName = `TABLE_${i}`;
        tx.objectStore("schemas").put({
          fullName: `${schemaName}.${tableName}`,
          schemaName,
          tableName,
          schema: { payload: "x".repeat(2000) },
        });
      }
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    service.db.close();
    const { initialWorkspace } = await import("/tools/plantuml/workspace.js");
    const workspace = initialWorkspace();
    workspace.nodes = [
      { id: "folder", kind: "folder", name: "diagrams", parentId: null },
      ...Array.from({ length: 4999 }, (_, i) => ({
        id: `file-${i}`,
        kind: "file",
        name: i === 0 ? "checkout-flow.puml" : `diagram-${i}.puml`,
        parentId: "folder",
        content: "@startuml\nAlice -> Bob: hello\n@enduml",
      })),
    ];
    workspace.tabs = ["file-1"];
    workspace.activeId = "file-1";
    workspace.expanded = ["folder"];
    // Seed the prior database version to exercise migration before the editor ever mounts.
    const legacy = await new Promise((resolve, reject) => {
      const request = indexedDB.open("adtools-plantuml", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("workspaces", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = legacy.transaction("workspaces", "readwrite");
      tx.objectStore("workspaces").put({ id: "local", revision: 1, workspace });
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    legacy.close();
    window.catalogReads = [];
    for (const method of ["get", "getAll", "getAllKeys", "openCursor", "openKeyCursor"]) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (...args) {
        window.catalogReads.push(`${this.name}.${method}`);
        return original.apply(this, args);
      };
    }
    window.app.globalSearch.open();
  });
  const input = page.locator("#global-search-input");
  const search = async (term, title) => {
    await input.fill(term);
    await page.locator(".result-title").filter({ hasText: title }).first().waitFor();
    assert.ok((await page.locator(".global-search-result-item").count()) <= 8);
  };
  await search("config", "CONFIG.TABLE_");
  await search("config.table_1", "CONFIG.TABLE_1");
  await search("qq:c.table_1", "CONFIG.TABLE_1");
  await search("c.", "CONFIG.TABLE_");
  await search("checkout", "checkout-flow.puml");
  checks.push("Unprefixed schema/table and filename suggestions, qualified names and qq: remain available; at most 8 results");
  const coldReads = await page.evaluate(() => window.catalogReads);
  assert.equal(coldReads.includes("schemas.getAll"), false);
  assert.equal(coldReads.includes("tableData.getAll"), false);
  assert.ok(coldReads.includes("workspaces.get"), "Legacy migration reads the old workspace once");
  checks.push("Legacy PlantUML workspace migrates to a filename catalog; table search reads keys, not schemas or rows");
  await page.screenshot({ path: `${output}/suggestions.png` });
  await page.locator(".result-title").filter({ hasText: "checkout-flow.puml" }).click();
  await page.waitForFunction(() => window.app.currentTool?.workspace?.activeId === "file-0");
  checks.push("Cold PlantUML navigation opens the selected file");
  await page.evaluate(async () => {
    const tool = window.app.currentTool;
    tool.update({
      ...tool.workspace,
      nodes: tool.workspace.nodes.map((node) => (node.id === "file-0" ? { ...node, name: "renamed-checkout.puml" } : node)),
    });
    tool.flushSave();
    await tool.store.queue;
    window.app.globalSearch.open();
  });
  await search("renamed-checkout", "renamed-checkout.puml");
  checks.push("Renamed filenames update after committed saves");
  await page.evaluate(async () => {
    const { IndexedDBStorageService } = await import("/tools/quick-query/services/IndexedDBStorageService.js");
    window.catalogWriter = new IndexedDBStorageService();
    await window.catalogWriter.init();
    await window.catalogWriter.saveSchema("CONFIG.NEW_SETTING", [["ID", "NUMBER", "N"]]);
  });
  await search("new_setting", "CONFIG.NEW_SETTING");
  await page.evaluate(() => window.catalogWriter.deleteSchema("CONFIG.NEW_SETTING"));
  await input.fill("config");
  await page.evaluate(async () => {
    const search = window.app.globalSearch;
    await search._filter("new_setting");
  });
  assert.equal(await page.locator(".result-title").filter({ hasText: "CONFIG.NEW_SETTING" }).count(), 0);
  checks.push("Saved and deleted tables invalidate a separate search service");
  await search("checkout", "renamed-checkout.puml");
  await page.evaluate(() => {
    window.catalogReads = [];
  });
  const timings = [];
  for (const term of ["config", "diagram-4998", "config.table_19", "checkout", "table_9999", "diagram-2999"]) {
    const elapsed = await page.evaluate(async (term) => {
      const start = performance.now();
      await window.app.globalSearch._filter(term);
      return performance.now() - start;
    }, term);
    timings.push({ term, elapsedMs: elapsed });
  }
  const reads = await page.evaluate(() => window.catalogReads);
  assert.deepEqual(reads, [], "Warm searches must not read IndexedDB payloads or rebuild catalogs");
  assert.ok(
    timings.every(({ elapsedMs }) => elapsedMs < 250),
    JSON.stringify(timings),
  );
  checks.push("10,000 tables + 4,999 files: warm searches do no IndexedDB reads and complete within 250ms including debounce");
  assert.match(await input.getAttribute("title"), /schema.table/i);
  assert.match(await input.getAttribute("title"), /PlantUML/i);
  // Content-only saves must leave filename metadata cached.
  await page.evaluate(async () => {
    const tool = window.app.currentTool;
    const { catalogRevision } = await import("/core/SearchCatalogRevision.js");
    const before = catalogRevision("plantuml");
    tool.editor.getModel().setValue("@startuml\nAlice -> Bob: changed\n@enduml");
    tool.flushSave();
    await tool.store.queue;
    if (before !== catalogRevision("plantuml")) throw new Error("Content edit invalidated filename index");
  });
  checks.push("Content-only edits keep the filename index cached");
  const other = await context.newPage();
  await other.goto(base);
  await other.waitForFunction(() => Boolean(window.app));
  await other.evaluate(async () => {
    const { IndexedDBStorageService } = await import("/tools/quick-query/services/IndexedDBStorageService.js");
    const store = new IndexedDBStorageService();
    await store.init();
    await store.saveSchema("CONFIG.CROSS_WINDOW", [["ID", "NUMBER", "N"]]);
    store.db.close();
    const { PlantUmlStore } = await import("/tools/plantuml/service.js");
    const files = new PlantUmlStore();
    const workspace = await files.load();
    workspace.nodes = workspace.nodes.map((node) => (node.id === "file-2" ? { ...node, name: "cross-window-diagram.puml" } : node));
    await files.save(workspace);
    await files.close();
  });
  await search("cross_window", "CONFIG.CROSS_WINDOW");
  await search("cross-window-diagram", "cross-window-diagram.puml");
  await other.close();
  checks.push("Committed tables and filenames from another browser window invalidate cached catalogs");
  await page.evaluate(async () => {
    const { getActiveProject, createProject, selectProject } = await import("/core/Projects.js");
    const original = getActiveProject().id;
    const other = createProject("Search isolation fixture");
    selectProject(other.id);
    try {
      const matches = await window.app.searchQuickQueryTables("config");
      if (matches.length) throw new Error("Search leaked tables from the previous project");
    } finally {
      selectProject(original);
    }
  });
  checks.push("Quick Query search follows the selected project without leaking the previous catalog");
  await page.evaluate(async () => {
    const search = window.app.globalSearch;
    const original = search.searchPlantUml;
    let calls = 0;
    search.searchPlantUml = async (term) => {
      calls++;
      return original(term);
    };
    await Promise.all([search._filter("check"), search._filter("checkout"), search._filter("cross-window-diagram")]);
    if (calls !== 1 || !search.filtered.some((item) => item.name === "cross-window-diagram.puml"))
      throw new Error("Rapid typing did not cancel superseded catalog searches");
    search.searchPlantUml = original;
  });
  checks.push("Rapid typing coalesces catalog work and only displays the latest query");
  await writeFile(`${output}/result.json`, JSON.stringify({ checks, timings, warmIndexedDBReads: reads }, null, 2) + "\n");
  await writeFile(
    `${output}/README.md`,
    `Run Vite, then:\n\n\`\`\`sh\nPLAYWRIGHT_MODULE=/Users/ddl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs node frontend/components/tests/global-search-catalog-browser.mjs\n\`\`\`\n\nFixture data only; external requests blocked. Timings include debounce and DOM rendering, on this machine.\n\n${checks.map((check) => `- ${check}`).join("\n")}\n`,
  );
  console.log(JSON.stringify({ checks, timings }, null, 2));
} finally {
  await browser.close();
}
