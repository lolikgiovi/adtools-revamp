import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { once } from "node:events";

// Uses only installed tooling. Registered devices enroll without sessions, OTP, or a Settings visit.
const root = resolve(import.meta.dirname, "../..");
const output = resolve(root, ".wrangler/settings-publishing-verification", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(output, { recursive: true });
const persist = resolve(output, "state");
const env = { ...process.env, WRANGLER_SEND_METRICS: "false", VITE_WORKER_BASE: "http://localhost:8787" };
const logs = [];
const processes = [];
const checks = [];
const failures = [];
let browser;
let passed = false;
function start(tool, args) {
  const child = spawn(resolve(root, "node_modules/.bin", tool), args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (data) => logs.push(data.toString()));
  child.stderr.on("data", (data) => logs.push(data.toString()));
  return child;
}
async function run(tool, args) {
  const child = start(tool, args);
  const [code] = await once(child, "exit");
  assert.equal(code, 0, `${tool} failed; see commands.log`);
}
async function ready(url) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Server did not start: ${url}`);
}
async function check(name, action) {
  await action();
  checks.push(name);
  console.log(`PASS ${name}`);
}
const users = [
  { userId: "publishing-one", email: "publishing.one@bankmandiri.co.id", deviceId: "publishing-device-one", department: "RETAIL" },
  { userId: "publishing-two", email: "publishing.two@bankmandiri.co.id", deviceId: "publishing-device-two", department: "SME" },
];
try {
  // Refuse to borrow a server that may belong to another task.
  for (const port of [8787, 1244]) {
    const { createServer } = await import("node:net");
    const probe = createServer();
    probe.listen(port, "127.0.0.1");
    await once(probe, "listening");
    await new Promise((resolve) => probe.close(resolve));
  }
  await run("wrangler", ["d1", "migrations", "apply", "adtools", "--local", "--persist-to", persist]);
  const seed = users
    .map(
      (user) => `INSERT INTO users (id,email,department,created_time,last_seen)
    VALUES ('${user.userId}','${user.email}','${user.department}','2026-10-23','2026-10-23');
    INSERT INTO device (device_id,user_id,created_time,last_seen)
    VALUES ('${user.deviceId}','${user.userId}','2026-10-23','2026-10-23');`,
    )
    .join("\n");
  writeFileSync(resolve(output, "fixtures.sql"), seed);
  await run("wrangler", ["d1", "execute", "adtools", "--local", "--persist-to", persist, "--file", resolve(output, "fixtures.sql")]);
  processes.push(
    start("wrangler", [
      "dev",
      "--local",
      "--port",
      "8787",
      "--persist-to",
      persist,
      "--assets",
      "backend-workers/test-assets",
      "--var",
      "ANALYTICS_DASHBOARD_PASSWORD:local-settings-test",
    ]),
  );
  processes.push(start("vite", ["--host", "127.0.0.1", "--port", "1244"]));
  await ready("http://localhost:8787/register/auth-mode");
  await ready("http://127.0.0.1:1244");
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || "chrome" });
  const release = JSON.parse(readFileSync(resolve(root, "frontend/config/release-content.json"), "utf8"));
  async function client(index) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return ["localhost", "127.0.0.1"].includes(url.hostname) ? route.continue() : route.abort();
    });
    await context.addInitScript(
      ({ user, releaseId, tipIds }) => {
        if (localStorage.getItem("publishing-fixture")) return;
        localStorage.setItem("publishing-fixture", "1");
        localStorage.setItem("user.email", user.email);
        localStorage.setItem("user.username", "Publishing fixture");
        localStorage.setItem("user.registered", "true");
        localStorage.setItem("user.department", user.department);
        localStorage.setItem("adtools.deviceId", user.deviceId);
        localStorage.setItem(`releaseTour.seen.${encodeURIComponent(releaseId)}`, "true");
        for (const id of tipIds)
          localStorage.setItem(`releaseTip.opened.${encodeURIComponent(releaseId)}.${encodeURIComponent(id)}`, "true");
        localStorage.setItem("theme", "dark");
        localStorage.setItem("update.autoCheck", "false");
        localStorage.setItem("config.redis.port", "6379");
        localStorage.setItem("config.jira.projectKey", "PERSONAL");
        localStorage.setItem("config.jenkins.username", "personal-user");
        localStorage.setItem(
          "config.environments",
          JSON.stringify([{ id: "personal", name: "Personal", cdnPublicUrl: "https://personal.test" }]),
        );
      },
      { user: users[index], releaseId: release.releaseId, tipIds: release.tips.map((tip) => tip.id) },
    );
    const page = await context.newPage();
    page.on("pageerror", (error) => failures.push(error.message));
    await page.goto("http://127.0.0.1:1244/#home");
    await page.waitForFunction(() => Boolean(localStorage.getItem("settings.sync.credential")));
    return page;
  }
  const one = await client(0);
  const two = await client(1);
  await check("Old registered devices enroll without sessions or visiting Settings", async () => {
    for (const page of [one, two]) {
      assert.equal(await page.evaluate(() => localStorage.getItem("adtools.sessionToken")), null);
      assert.equal(await page.locator(".settings-sync-verify").count(), 0);
      assert.equal(
        await page.evaluate(() => JSON.parse(localStorage.getItem("settings.sync.credential")).deviceId),
        users[page === one ? 0 : 1].deviceId,
      );
    }
  });
  await check("Admin password gate", async () => {
    await one.goto("http://127.0.0.1:1244/#dashboard/publish-settings");
    await one.locator("#publish-password").fill("local-settings-test");
    await one.getByRole("button", { name: "Unlock publishing" }).click();
    await one.locator(".publish-workspace").waitFor({ state: "visible" });
  });
  await check("Preview selects a department and excludes personal and credential fields", async () => {
    await one.locator("#publish-title").fill("Retail environment rollout");
    await one.locator("#publish-audience").selectOption("departments");
    await one.locator('.publish-departments input[value="RETAIL"]').check();
    await one.locator('[data-setting="config.redis.port"]').check();
    await one.locator('[data-value-key="config.redis.port"]').fill("6380");
    await one.locator('.publish-setting-list [data-setting="config.oracle.connections"]').check();
    await one
      .locator('[data-value-key="config.oracle.connections"]')
      .fill(JSON.stringify([{ name: "Retail UAT", connect_string: "db.test:1521/UAT" }]));
    await one.locator('.publish-setting-list [data-setting="config.environments"]').check();
    await one
      .locator('[data-value-key="config.environments"]')
      .fill(JSON.stringify([{ id: "retail-uat", name: "Retail UAT", criticalConnection: "Retail UAT", cdnPublicUrl: "https://cdn.test" }]));
    assert.equal(
      await one
        .locator(
          '.publish-setting-list [data-setting="theme"], .publish-setting-list [data-setting^="update."], .publish-setting-list [data-setting^="secure."]',
        )
        .count(),
      0,
    );
    await one.getByRole("button", { name: "Preview publication" }).click();
    await one.locator(".publish-preview").waitFor({ state: "visible" });
    assert.equal(await one.locator(".publish-recipients li").count(), 1);
    assert.match(await one.locator(".publish-recipients").innerText(), /publishing.one/);
    assert.doesNotMatch(await one.locator(".publish-recipients").innerText(), /publishing.two/);
    await one.screenshot({ path: resolve(output, "wide-preview.png"), animations: "disabled" });
  });
  await check("Any draft edit invalidates the preview", async () => {
    await one.locator("#publish-title").fill("Retail setup");
    assert.equal(await one.locator(".publish-preview").isVisible(), false);
    await one.getByRole("button", { name: "Preview publication" }).click();
    await one.locator(".publish-preview").waitFor({ state: "visible" });
  });
  await check("Publish, synchronize target, and leave the non-target unchanged", async () => {
    await one.getByRole("button", { name: "Publish to 1 user", exact: true }).click();
    await one.locator(".publish-message").filter({ hasText: "Published to 1 user" }).waitFor();
    for (const page of [one, two]) await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await one.waitForFunction(() => localStorage.getItem("config.redis.port") === "6380");
    assert.equal(await one.evaluate(() => localStorage.getItem("config.redis.port")), "6380");
    assert.equal(await two.evaluate(() => localStorage.getItem("config.redis.port")), "6379");
    assert.equal(await two.evaluate(() => JSON.parse(localStorage.getItem("config.environments"))[0].name), "Personal");
    assert.deepEqual(
      await one.evaluate(async () => {
        const { readEnvironments, resolveConnection } = await import("/core/Environments.js");
        const environment = readEnvironments()[0];
        return [
          environment.name,
          resolveConnection(environment, "critical").connect_string,
          JSON.parse(localStorage.getItem("config.baseUrls"))[0].value,
        ];
      }),
      ["Retail UAT", "db.test:1521/UAT", "https://cdn.test"],
    );
    for (const page of [one, two]) {
      assert.deepEqual(
        await page.evaluate(() => ["theme", "update.autoCheck", "config.jira.projectKey"].map((key) => localStorage.getItem(key))),
        ["dark", "false", "PERSONAL"],
      );
      assert.equal(await page.evaluate(() => localStorage.getItem("config.jenkins.username")), "personal-user");
    }
  });
  await check("Visible Settings refresh keeps the page usable", async () => {
    await one.goto("http://127.0.0.1:1244/#settings");
    await one.locator('[data-page="settings"] .sidebar-menu-button').click();
    await one.locator(".settings-categories").waitFor();
    await one.evaluate(() => window.dispatchEvent(new Event("adtools:settings-published")));
    await one.getByRole("button", { name: "Refresh settings", exact: true }).click();
    await one.getByRole("button", { name: "Refresh settings", exact: true }).waitFor({ state: "hidden" });
  });
  await check("Replay preserves later local edits, including after reload", async () => {
    await one.evaluate(async () => {
      localStorage.setItem("config.redis.port", "6390");
      const { publishedSettingsSync } = await import("/core/PublishedSettings.js");
      await publishedSettingsSync.check();
    });
    await one.reload();
    await one.locator('[data-page="settings"] .sidebar-menu-button').click();
    await one.locator(".settings-categories").waitFor();
    assert.equal(await one.evaluate(() => localStorage.getItem("config.redis.port")), "6390");
  });
  await check("Email targeting updates only the selected email", async () => {
    await one.goto("http://127.0.0.1:1244/#dashboard/publish-settings");
    await one.locator(".publish-workspace").waitFor({ state: "visible" });
    await one.locator("#publish-title").fill("Selected user setup");
    await one.locator("#publish-emails").fill(users[1].email);
    await one.locator('[data-setting="config.redis.port"]').check();
    await one.locator('[data-value-key="config.redis.port"]').fill("6382");
    await one.getByRole("button", { name: "Preview publication" }).click();
    await one.getByRole("button", { name: "Publish to 1 user", exact: true }).click();
    await one.locator(".publish-message").filter({ hasText: "Published to 1 user" }).waitFor();
    for (const page of [one, two]) await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await two.waitForFunction(() => localStorage.getItem("config.redis.port") === "6382");
    assert.equal(await one.evaluate(() => localStorage.getItem("config.redis.port")), "6390");
    assert.equal(await two.evaluate(() => localStorage.getItem("config.redis.port")), "6382");
  });
  await check("History shows acknowledgements and supports reusing and stopping delivery", async () => {
    await one.getByRole("button", { name: "Refresh", exact: true }).click();
    await one.locator(".publish-history-row").first().filter({ hasText: "1 device applied" }).waitFor();
    await one.locator(".publish-history-row").first().getByRole("button", { name: "Use as draft" }).click();
    assert.equal(await one.locator("#publish-title").inputValue(), "Selected user setup");
    await one.locator(".publish-history-row").first().getByRole("button", { name: "Stop delivery" }).click();
    await one.locator(".publish-history-row").first().filter({ hasText: "Stopped" }).waitFor();
  });
  await check("Offline clients recover automatically on reconnect", async () => {
    await two.evaluate(() => {
      const identity = JSON.parse(localStorage.getItem("settings.sync.credential"));
      identity.expiresAt = 1;
      localStorage.setItem("settings.sync.credential", JSON.stringify(identity));
    });
    await two.context().setOffline(true);
    await two.evaluate(async () => {
      const { publishedSettingsSync } = await import("/core/PublishedSettings.js");
      await publishedSettingsSync.check();
    });
    await one.locator("#publish-title").fill("Reconnect delivery");
    await one.locator('[data-value-key="config.redis.port"]').fill("6383");
    await one.getByRole("button", { name: "Preview publication" }).click();
    await one.getByRole("button", { name: "Publish to 1 user", exact: true }).click();
    await one.locator(".publish-message").filter({ hasText: "Published to 1 user" }).waitFor();
    assert.equal(await two.evaluate(() => localStorage.getItem("config.redis.port")), "6382");
    await two.context().setOffline(false);
    await two.waitForFunction(() => localStorage.getItem("config.redis.port") === "6383");
    assert.equal(await one.evaluate(() => localStorage.getItem("config.redis.port")), "6390");
  });
  await check("Narrow layout and final scroll position", async () => {
    await one.setViewportSize({ width: 390, height: 844 });
    await one.locator('.sidebar[data-mobile="true"][data-state="closed"]').waitFor({ state: "attached" });
    await one.locator(".publish-form").scrollIntoViewIfNeeded();
    await one.screenshot({ path: resolve(output, "narrow-publishing.png"), animations: "disabled" });
    assert.equal(await one.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await one.locator(".publish-history").scrollIntoViewIfNeeded();
    await one.screenshot({ path: resolve(output, "narrow-history.png"), animations: "disabled" });
    await one.goto("http://127.0.0.1:1244/#settings");
    await one.locator(".settings-categories").waitFor();
    assert.equal(await one.locator(".settings-sync-verify").count(), 0);
    await one.locator(".settings-category").last().scrollIntoViewIfNeeded();
    await one.screenshot({ path: resolve(output, "narrow-bottom.png"), animations: "disabled" });
    await one.evaluate(() => window.app.themeManager.setTheme("light"));
    await one.locator(".settings-header").scrollIntoViewIfNeeded();
    await one.screenshot({ path: resolve(output, "narrow-light.png"), animations: "disabled" });
    await one.setViewportSize({ width: 1440, height: 1000 });
    await one.screenshot({ path: resolve(output, "wide-light.png"), animations: "disabled" });
  });
  assert.deepEqual(failures, [], "Browser errors");
  passed = true;
} catch (error) {
  failures.push(error.message);
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) await page.screenshot({ path: resolve(output, "failure.png"), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  for (const child of processes) child.kill("SIGTERM");
  writeFileSync(resolve(output, "commands.log"), logs.join(""));
  writeFileSync(
    resolve(output, "result.json"),
    JSON.stringify({ passed, checks, errors: failures, completedAt: new Date().toISOString() }, null, 2),
  );
  console.log(`Evidence: ${output}`);
}
