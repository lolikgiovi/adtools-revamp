// Real UI -> local analytics queue. No external requests or native services.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.ANALYTICS_TEST_URL || "http://127.0.0.1:1234";
const output = "docs/verification/analytics-coverage";
const release = JSON.parse(await readFile("frontend/config/release-content.json", "utf8"));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks = [];
const errors = [];
const diagnostics = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
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
await context.route("**/*", (route) => {
  const url = new URL(route.request().url());
  if (url.pathname.startsWith("/api/")) {
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Offline fixture" }) });
  }
  return url.origin === base ? route.continue() : route.abort();
});
const page = await context.newPage();
page.on("pageerror", (error) => {
  if (error.message === "Canceled" && error.stack?.includes("Delayer.dispose") && error.stack.includes("monaco-editor")) {
    diagnostics.push({ message: error.message, source: "Existing Monaco delayed-highlight disposal", stack: error.stack });
  } else errors.push(error.message);
});
async function events() {
  return page.evaluate(() => window.analyticsEvents);
}
async function signal(feature, stage, capability) {
  await page.waitForFunction(
    ({ feature, stage, capability }) => {
      return window.analyticsEvents.some(
        (event) => event.featureId === feature && event.action === `capability_${stage}` && event.meta.capability === capability,
      );
    },
    { feature, stage, capability },
  );
}
try {
  await page.goto(base);
  await page.waitForFunction(() => Boolean(window.app));
  await page.evaluate(async () => {
    const { createProject } = await import("/core/Projects.js");
    window.analyticsTarget = createProject("PRIVATE_PROJECT_MARKER").id;
    window.app.reloadForProjectChange = () => {}; // Keep the queue inspectable after successful selection.
    const { UsageTracker } = await import("/core/UsageTracker.js");
    UsageTracker.setEnabled(true); // Development sessions default to analytics off.
    UsageTracker._state.events = [];
    window.analyticsEvents = [];
    window.app.eventBus.on("usage:event", (event) => window.analyticsEvents.push(JSON.parse(JSON.stringify(event))));
    window.ledgerBefore = UsageTracker._state.toolUses?.length || 0;
  });
  await page.evaluate(() => window.app.router.navigate("settings"));
  await page.locator(".project-controls .ad-searchable-dropdown-trigger").click();
  await page.getByRole("option", { name: "New project…", exact: true }).click();
  await page.locator(".project-name-input").fill("PRIVATE_CREATED_MARKER");
  await page.locator(".project-name-save").click();
  await signal("settings", "succeeded", "create_project");
  await signal("settings", "failed", "publish_project");
  await page.locator(".project-name-save").click();
  await page.waitForFunction(() => {
    return window.analyticsEvents.filter((event) => event.action === "project_publish_result").length === 2;
  });
  const retryEvents = await events();
  assert.equal(retryEvents.filter((event) => event.action === "project_create_result" && event.meta.outcome === "success").length, 1);
  assert.equal(retryEvents.filter((event) => event.action === "project_rename_result").length, 0);
  await page.locator(".project-cancel").click();
  checks.push("Project creation succeeds locally while publishing fails; retry does not duplicate creation or invent a rename");
  await page.locator('.project-settings-nav button[data-project-section="schemas"]').click();
  await page.locator(".project-schema-manage").click();
  const manager = page.locator(".schema-manager-dialog").first();
  await manager.getByText("No saved schemas in this project.", { exact: true }).waitFor();
  await signal("settings", "opened", "manage_schemas");
  const columns = [["ID", "NUMBER", "No", null, null, "Yes"]];
  const schema = { APP: { PRIVATE_SCHEMA_MARKER: columns, PRIVATE_MOVE_MARKER: columns, PRIVATE_DELETE_MARKER: columns } };
  await manager
    .locator('input[type="file"]')
    .setInputFiles({ name: "private.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(schema)) });
  await signal("settings", "succeeded", "schema_import");
  const row = manager.locator('.schema-manager-row[data-table="APP.PRIVATE_SCHEMA_MARKER"]');
  await row.getByRole("button", { name: "Copy…", exact: true }).click();
  const transfer = page.locator(".schema-transfer-dialog");
  await transfer.getByRole("button", { name: "Copy schema", exact: true }).click();
  await signal("settings", "succeeded", "schema_copy");
  await transfer.waitFor({ state: "hidden" });
  await row.getByRole("button", { name: "Copy…", exact: true }).click();
  await transfer.getByRole("button", { name: "Copy schema", exact: true }).click();
  await signal("settings", "failed", "schema_copy");
  await page.keyboard.press("Escape");
  const download = page.waitForEvent("download");
  await manager.getByRole("button", { name: "Export", exact: true }).click();
  await download;
  await signal("settings", "succeeded", "schema_export");
  await manager
    .locator('input[type="file"]')
    .setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from("{}") });
  await signal("settings", "failed", "schema_import");
  await manager
    .locator('.schema-manager-row[data-table="APP.PRIVATE_MOVE_MARKER"]')
    .getByRole("button", { name: "Move…", exact: true })
    .click();
  await transfer.getByRole("button", { name: "Move schema", exact: true }).click();
  await signal("settings", "succeeded", "schema_move");
  await transfer.waitFor({ state: "hidden" });
  await manager
    .locator('.schema-manager-row[data-table="APP.PRIVATE_DELETE_MARKER"]')
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await page.getByRole("button", { name: "Delete schema", exact: true }).click();
  await signal("settings", "succeeded", "schema_delete");
  checks.push(
    "Schema import/export/copy/move/delete successes and invalid/duplicate failures reach adoption events through real UI and IndexedDB",
  );
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    window.app.tools.set("analytics-busy-fixture", { hasActiveBackgroundWork: () => true });
    await window.app.switchProject(window.analyticsTarget);
    window.app.tools.delete("analytics-busy-fixture");
  });
  await signal("settings", "blocked", "switch_project");
  await page.evaluate(() => window.app.switchProject(window.analyticsTarget));
  await signal("settings", "succeeded", "switch_project");
  const facts = JSON.stringify(await events());
  assert.ok(
    !facts.includes("PRIVATE_PROJECT_MARKER") &&
      !facts.includes("PRIVATE_SCHEMA_MARKER") &&
      !facts.includes("PRIVATE_MOVE_MARKER") &&
      !facts.includes("PRIVATE_DELETE_MARKER") &&
      !facts.includes("private.json") &&
      !facts.includes("PRIVATE_CREATED_MARKER"),
  );
  assert.equal(
    await page.evaluate(
      async () => ((await import("/core/UsageTracker.js")).UsageTracker._state.toolUses?.length || 0) === window.ledgerBefore,
    ),
    true,
  );
  checks.push("Project switch success/blocked outcomes exclude identifiers and leave completed-tool totals unchanged");
  await page.evaluate(() => window.app.router.navigate("plantuml"));
  await page.locator(".plantuml-tool .monaco-editor").waitFor();
  await page.waitForFunction(
    () => window.app.currentTool?.editor && document.querySelector("#puml-status")?.dataset.state === "ready",
    null,
    { timeout: 60000 },
  );
  await page.locator("#puml-editor-theme").selectOption("auto");
  await signal("plantuml", "configured", "editor_theme");
  await page.locator('[data-action="format"]').click();
  await signal("plantuml", "succeeded", "format");
  await page.evaluate(() =>
    window.app.currentTool.editor.getModel().setValue("@startuml\n!include https://example.test/PRIVATE_DIAGRAM_MARKER\n@enduml"),
  );
  await signal("plantuml", "failed", "local_render");
  assert.ok(!JSON.stringify(await events()).includes("PRIVATE_DIAGRAM_MARKER"));
  await page.screenshot({ path: `${output}/plantuml-error.png` });
  checks.push("PlantUML editor theme, successful formatting and rejected remote includes produce content-free capability signals");
  await page.evaluate(() => window.app.router.navigate("char-counter"));
  await page.locator("#charCounterRowMode").click();
  await signal("char-counter", "configured", "per_row");
  const configuredBefore = (await events()).filter(
    (event) => event.action === "capability_configured" && event.meta.capability === "per_row",
  ).length;
  await page.locator("#charCounterSummaryMode").click();
  assert.equal(
    (await events()).filter((event) => event.action === "capability_configured" && event.meta.capability === "per_row").length,
    configuredBefore,
  );
  await page.evaluate(() => window.app.router.navigate("splunk-template"));
  await page.waitForFunction(() => Boolean(window.app.currentTool?.parametersEditor));
  await page.evaluate(() => window.app.currentTool.parametersEditor.setValue("{"));
  await page.locator("#btnGenerateParameters").click();
  await signal("splunk-template", "blocked", "parameters");
  await page.evaluate(() => window.app.currentTool.parametersEditor.setValue("{}"));
  await page.locator("#btnGenerateParameters").click();
  await signal("splunk-template", "succeeded", "parameters");
  checks.push("Splunk context synchronization distinguishes invalid JSON from successful completion");
  const optOut = await page.evaluate(async () => {
    const { UsageTracker } = await import("/core/UsageTracker.js");
    const { trackWorkflowEvent } = await import("/core/WorkflowAnalytics.js");
    const before = window.analyticsEvents.length;
    UsageTracker.setEnabled(false);
    trackWorkflowEvent("settings", "project_publish_result", { outcome: "success" });
    const unchanged = before === window.analyticsEvents.length;
    UsageTracker.setEnabled(true);
    return unchanged && UsageTracker._state.events.length > 0;
  });
  assert.equal(optOut, true);
  checks.push("New events enter the local queue and honor analytics opt-out");
  assert.deepEqual(errors, []);
  checks.push("Existing per-row mode event maps to capability configuration without page errors");
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        passed: true,
        checks,
        errors,
        diagnostics,
        recordedAt: new Date().toISOString(),
        reproduce:
          "npm run dev -- --host 127.0.0.1; PLAYWRIGHT_MODULE=<installed playwright module> node frontend/core/tests/analytics-coverage-browser.mjs",
        boundaries:
          "Local browser queue and real IndexedDB; background-job fixture, reload suppressed; no native or deployed ingestion proof",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} finally {
  await browser.close();
}
