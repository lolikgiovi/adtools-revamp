import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PROJECTS_TEST_URL || "http://127.0.0.1:1247";
const output = resolve("docs/verification/project-settings");
const release = JSON.parse(await readFile("frontend/config/release-content.json", "utf8"));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks = [];
const errors = [];
await mkdir(output, { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route("**/*", (route) => (new URL(route.request().url()).origin === base ? route.continue() : route.abort()));
  await context.addInitScript(
    ({ release }) => {
      if (localStorage.getItem("project-settings-fixture")) return;
      localStorage.setItem("project-settings-fixture", "1");
      localStorage.setItem("user.email", "dev@localhost");
      localStorage.setItem("user.registered", "true");
      localStorage.setItem("user.department", "RETAIL");
      localStorage.setItem(`releaseTour.seen.${encodeURIComponent(release.releaseId)}`, "true");
      for (const tip of release.tips)
        localStorage.setItem(`releaseTip.opened.${encodeURIComponent(release.releaseId)}.${encodeURIComponent(tip.id)}`, "true");
      localStorage.setItem("config.jira.projectKeys", '["ONE","TWO"]');
      localStorage.setItem("config.jira.username", "shared-person");
      localStorage.setItem("config.redis.host", "legacy-cache");
      localStorage.setItem("config.oracle.connections", JSON.stringify([{ name: "CORE", connect_string: "db:1521/legacy" }]));
      localStorage.setItem(
        "config.environments",
        JSON.stringify([
          { id: "uat", name: "UAT", criticalConnection: "CORE" },
          { id: "sit", name: "SIT", criticalConnection: "CORE" },
        ]),
      );
    },
    { release },
  );
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.waitForFunction(() => Boolean(window.app));
  await page.evaluate(() => window.app.router.navigate("settings"));
  await page.locator("select.project-settings-select").waitFor({ state: "attached" });
  await page.locator('.project-settings-nav button[data-project-section="jira-project"]').click();
  await page.locator('select[aria-label="Jira Project Key"]').selectOption("TWO", { force: true });
  checks.push("multiple legacy Jira keys require an explicit choice");
  const ids = await page.evaluate(
    async ({ sharedModule }) => {
      const projects = await import("/core/Projects.js");
      const env = await import("/core/Environments.js");
      const { SettingsService } = await import("/pages/settings/service.js");
      const first = projects.getActiveProject();
      const service = new SettingsService();
      const uat = env.readEnvironmentConnections("uat");
      const sit = env.readEnvironmentConnections("sit");
      if (uat[0].id === sit[0].id) throw new Error("Environment identity collision");
      env.saveEnvironmentConnections("uat", [{ ...uat[0], name: "RENAMED" }]);
      if (env.resolveConnection(env.readEnvironments()[0], "critical").name !== "RENAMED") throw new Error("Rename broke binding");
      const second = projects.createProject("Second");
      projects.selectProject(second.id);
      const next = new SettingsService();
      if (next.getValue("config.redis.host", "string", "") !== "") throw new Error("Inherited Redis host");
      if (next.getValue("config.jira.username", "string", "") !== "shared-person") throw new Error("Lost shared credentials");
      for (const [key, value] of Object.entries({
        "config.redis.host": "second-cache",
        "config.jira.projectKey": "SECOND",
        "config.lockeyPath": "/second",
        "config.velocityValidator.url": "https://second.invalid/validate",
      }))
        next.setValue(key, "string", value);
      next.setValue("config.mergeSql.squadNames", "string-list", ["Second squad"]);
      const { saveKafkaBrokerProfiles } = await import("/tools/kafka/service.js");
      saveKafkaBrokerProfiles([{ name: "Second", brokers: "second:9092" }]);
      service.setValue("config.lockeyPath", "string", "/first");
      if (next.getValue("config.lockeyPath", "string", "") !== "/second") throw new Error("Late save leaked");
      env.writeEnvironments([{ id: "uat", name: "UAT", criticalConnection: "CORE", cdnPublicUrl: "https://second.invalid" }]);
      const oldBinding = env.readEnvironmentConnections("uat", next.storage);
      if (oldBinding[0]?.legacyCredentialName !== "CORE") throw new Error("Existing project lost legacy Oracle binding");
      env.saveEnvironmentConnections("uat", [{ name: "CORE", connect_string: "second:1521/db" }]);
      const { applyPublication } = await import("/core/PublishedSettings.js");
      applyPublication({ id: 900, settings: { "project.name": first.name, "config.redis.port": 6388 } }, "fixture");
      if (projects.projectSettingsStorage().getItem("config.redis.port") !== null) throw new Error("Publication changed wrong project");
      const beforeRegistry = localStorage.getItem("config.projects");
      const originalSet = Storage.prototype.setItem;
      let rejected = false;
      Storage.prototype.setItem = function (key, value) {
        if (key.endsWith("config.redis.host") && value === "fail-write") throw new Error("Fixture quota");
        return originalSet.call(this, key, value);
      };
      try {
        applyPublication({ id: 901, settings: { "project.name": "Rollback project", "config.redis.host": "fail-write" } }, "fixture");
      } catch {
        rejected = true;
      } finally {
        Storage.prototype.setItem = originalSet;
      }
      if (!rejected || localStorage.getItem("config.projects") !== beforeRegistry) throw new Error("Publication failed rollback");
      const { validateSettings } = await import(sharedModule);
      let secureRejected = false;
      try {
        validateSettings({
          "config.oracle.environment.catalog": [
            { id: "one", environmentId: "uat", name: "DB", connect_string: "db:1521/service", legacyCredentialName: "private" },
          ],
        });
      } catch {
        secureRejected = true;
      }
      if (!secureRejected) throw new Error("Publication accepted credential metadata");
      projects.selectProject(first.id);
      if (projects.projectSettingsStorage().getItem("config.redis.port") !== "6388") throw new Error("Publication missed destination");
      if (projects.readJiraProjectKey() !== "TWO") throw new Error("Jira key lost");
      return { first: first.id, second: second.id };
    },
    { sharedModule: `/@fs${resolve("shared/published-settings.js")}` },
  );
  checks.push("project fields, pinned saves, shared credentials, environment migration and rename, targeted publication");
  await page.reload();
  await page.waitForFunction(() => Boolean(window.app));
  await page.evaluate(() => window.app.router.navigate("settings"));
  await page.locator("select.project-settings-select").waitFor({ state: "attached" });
  await page.locator('.project-settings-nav button[data-project-section="lockey"]').click();
  assert.equal(
    await page
      .locator('.setting-item[data-setting="config.lockeyPath"]')
      .innerText()
      .then((v) => v.includes("/first")),
    true,
  );
  assert.equal(await page.locator("#settings-category-connections").count(), 0);
  assert.equal(await page.locator("#settings-category-tool-settings").count(), 0);
  await page.screenshot({ path: resolve(output, "settings-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.app.sidebar.close());
  await page.waitForFunction(() => document.querySelector(".sidebar").dataset.mobile === "true");
  await page.evaluate(() => window.app.sidebar.close());
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".sidebar-overlay")).opacity === "0");
  await page.screenshot({ path: resolve(output, "settings-mobile.png"), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  checks.push("reload, desktop and mobile hierarchy without horizontal overflow");
  // Exercise the real project selector and reload, then inspect consumers in the newly selected document.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await Promise.all([page.waitForEvent("load"), page.locator("select.project-settings-select").selectOption(ids.second, { force: true })]);
  await page.locator("select.project-settings-select").waitFor({ state: "attached" });
  const snapshot = await page.evaluate(async () => {
    const { readRedisConfig } = await import("/tools/redis-cache/service.js");
    const { readKafkaConfig } = await import("/tools/kafka/service.js");
    const { readLockeyPath } = await import("/tools/master-lockey/config.js");
    const { readVelocityValidatorSettings } = await import("/tools/velocity-template/validator.js");
    return { redis: readRedisConfig(), kafka: readKafkaConfig(), path: readLockeyPath(), validator: readVelocityValidatorSettings() };
  });
  assert.equal(snapshot.redis.host, "second-cache");
  assert.equal(snapshot.redis.credentialScope, ids.second);
  assert.equal(snapshot.kafka.brokers, "second:9092");
  assert.equal(snapshot.path, "/second");
  assert.equal(snapshot.validator.url, "https://second.invalid/validate");
  checks.push("actual project switch refreshes Redis, Kafka, Lockey, and validator consumers");
  // Desktop commands are mocked; no credentials or external databases are contacted.
  await page.evaluate(async () => {
    window.nativeCalls = [];
    window.__TAURI_INTERNALS__ = {
      invoke: async (command, args) => {
        window.nativeCalls.push({ command, args });
        if (command === "get_arch") return "aarch64";
        if (command === "plugin:app|version") return "1.3.13";
        if (command === "get_oracle_username") return "fixture-user";
        return null;
      },
    };
    const { SettingsPage } = await import("/pages/settings/main.js");
    const config = (await import("/pages/settings/config.json")).default;
    const settings = new SettingsPage();
    settings.runtime = "tauri";
    settings.currentConfig = config;
    settings.categoriesRoot = document.querySelector(".settings-categories");
    settings.service.shouldShowItem = () => true;
    settings.service.shouldShowCategory = () => true;
    settings.renderCategories(config.categories);
    window.fixtureSettings = settings;
  });
  await page.locator('.project-settings-nav button[data-project-section="environments"]').click();
  await page.locator(".environment-add-btn").click();
  await page.locator(".environment-name").fill("New environment");
  const critical = page.locator("select.environment-critical");
  const addValue = await critical.locator('option[data-action="add-connection"]').getAttribute("value");
  await critical.selectOption(addValue, { force: true });
  const oracle = page.locator("dialog[open]");
  await oracle.locator(".oracle-name").fill("CORE");
  await oracle.locator(".oracle-connect-string").fill("new:1521/db");
  await oracle.locator(".oracle-username").fill("fixture-user");
  await oracle.locator(".oracle-password").fill("fixture-password");
  await oracle.locator(".oracle-save-btn").click();
  await page.getByRole("dialog", { name: "Add Environment", exact: true }).waitFor();
  await page.locator(".environment-save").click();
  await page.locator('.project-settings-nav button[data-project-section="redis"]').click();
  await page.locator('[data-setting="secure.redis.password"] .setting-edit').click();
  await page.locator('dialog[open] input[type="password"]').fill("fixture-cache-password");
  await page.locator("dialog[open] .setting-confirm").click();
  await page.waitForFunction(() => window.nativeCalls.some((call) => call.command === "set_redis_credentials"));
  await page.evaluate(async () => {
    const { OracleConnectionService } = await import("/core/OracleConnectionService.js");
    const { readProjectConnections, unassignEnvironmentConnections, readEnvironmentConnections } = await import("/core/Environments.js");
    const connection = readProjectConnections().find((entry) => entry.environmentId === "uat");
    await OracleConnectionService.invokeTauri("oracle_sidecar_query_batch", {
      queries: [{ connection_name: connection.name, config: connection, sql: "SELECT 1 FROM DUAL" }],
    });
    const command = window.nativeCalls.find((call) => call.command === "oracle_sidecar_query_batch");
    if (command.args.queries[0].connection_name !== `oracle:${connection.projectId}:${connection.id}`)
      throw new Error("Batch used wrong credentials");
    unassignEnvironmentConnections(connection.environmentId);
    if (!readEnvironmentConnections("").some((entry) => entry.id === connection.id)) throw new Error("Unassigned connection lost");
  });
  const native = await page.evaluate(() => window.nativeCalls);
  assert.equal(native.find((call) => call.command === "set_redis_credentials").args.credentialScope, ids.second);
  const saved = native.find((call) => call.command === "set_oracle_credentials");
  assert.ok(saved.args.name.startsWith(`oracle:${ids.second}:`));
  assert.equal(await page.locator(".environment-entry").count(), 2);
  await page.screenshot({ path: resolve(output, "environment-oracle-desktop.png"), fullPage: true });
  checks.push(
    "nested Desktop Oracle creation restores environment draft; Oracle batch and Redis commands use project-specific secure identities; saved connections remain assignable",
  );
  await Promise.all([
    page.waitForEvent("load"),
    page.evaluate(async (projectId) => {
      const previousInvoke = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = async (command, args) => {
        if (command === "check_oracle_sidecar_status") return true;
        if (command === "oracle_sidecar_pool_connections") return ["fixture-pool"];
        return previousInvoke(command, args);
      };
      const reload = window.app.reloadForProjectChange.bind(window.app);
      window.app.reloadForProjectChange = () => {
        sessionStorage.setItem("fixture-native-command-names", JSON.stringify(window.nativeCalls.map((call) => call.command)));
        reload();
      };
      await window.app.switchProject(projectId);
    }, ids.first),
  ]);
  await page.waitForFunction(() => Boolean(window.app));
  const closed = await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-native-command-names")));
  for (const command of ["redis_disconnect", "kafka_disconnect", "oracle_sidecar_disconnect"]) assert.ok(closed.includes(command));
  checks.push("Desktop project switching closes native Redis/Kafka sessions and existing Oracle pools before reload");
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, "result.json"), JSON.stringify({ ok: true, checks, snapshot, errors }, null, 2));
  console.log(JSON.stringify({ ok: true, checks }, null, 2));
} catch (error) {
  await writeFile(resolve(output, "result.json"), JSON.stringify({ ok: false, checks, errors, error: error.stack }, null, 2));
  throw error;
} finally {
  await browser.close();
}
