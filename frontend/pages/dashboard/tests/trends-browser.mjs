import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { createServer } from "vite";

const moduleServer = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { default: worker } = await moduleServer.ssrLoadModule("/../backend-workers/worker.js");

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.DASHBOARD_TEST_URL || "http://localhost:1246";
const output = resolve("docs/verification/dashboard-patterns");
await mkdir(output, { recursive: true });
const db = new DatabaseSync(":memory:");
const migrations = new URL("../../../../backend-workers/migrations/", import.meta.url);
for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
  db.exec(await readFile(new URL(file, migrations), "utf8"));
}
const env = {
  ANALYTICS_DASHBOARD_PASSWORD: "browser-fixture-only",
  ANALYTICS_EXCLUDED_DEVICE_IDS: "excluded-device",
  DB: {
    prepare(sql) {
      const statement = db.prepare(sql);
      const bound = (args) => ({
        all: async () => ({ results: statement.all(...args) }),
        first: async () => statement.get(...args) || null,
        run: async () => statement.run(...args),
      });
      return { ...bound([]), bind: (...args) => bound(args) };
    },
  },
  adtools: { get: async () => null, put: async () => {}, delete: async () => {} },
  UPDATES: { get: async () => ({ json: async () => ({ version: "1.3.12" }) }) },
};
db.exec(`INSERT INTO users (id,email,created_time,last_seen,department) VALUES
  ('alex','alex@example.test',datetime('now'),datetime('now'),'RETAIL'),
  ('sam','sam@example.test',datetime('now'),datetime('now'),NULL);
  INSERT INTO device (device_id,user_id,platform,created_time,last_seen,app_version) VALUES
  ('macbook-alex-001','alex','macOS',datetime('now','-100 days'),datetime('now','+7 hours'),'1.3.12'),
  ('windows-alex-002','alex','Windows',datetime('now','-100 days'),datetime('now','+7 hours','-45 days'),'1.3.9'),
  ('linux-sam-003','sam','Linux',datetime('now','-100 days'),datetime('now','+7 hours','-12 days'),'1.3.10'),
  ('unknown-sam-004','sam','Unknown',datetime('now'), 'invalid',NULL),
  ('excluded-device','sam','macOS',datetime('now'),datetime('now'),'1.3.12');`);
const insert = db.prepare(`INSERT INTO tool_usage (event_id,user_email,device_id,tool_id,action,source,created_time)
  VALUES (?,?,?,'json-tools','prettify','client',datetime('now','+7 hours','start of day',?,'+12 hours'))`);
for (let day = 1; day < 31; day++) {
  const count = day % 6 === 0 ? 0 : ((day * 7) % 23) + 2;
  for (let event = 0; event < count; event++)
    insert.run(
      `${day}-${event}`,
      event % 3 ? "alex@example.test" : "sam@example.test",
      event % 3 ? "macbook-alex-001" : "linux-sam-003",
      `-${day} days`,
    );
}
db.exec(`INSERT INTO tool_usage (event_id,user_email,device_id,tool_id,action,source,created_time) VALUES
  ('night-merge','sam@example.test','linux-sam-003','quick-query','merge','client',datetime('now','+7 hours','start of day','-1 day','+1 hour')),
  ('prior-example','alex@example.test','macbook-alex-001','json-tools','copy_output','client',datetime('now','+7 hours','start of day','-35 days','+14 hours'));`);
const auth = await worker.fetch(
  new Request("http://localhost/dashboard/verify", {
    method: "POST",
    body: JSON.stringify({ password: env.ANALYTICS_DASHBOARD_PASSWORD }),
  }),
  env,
);
const { token } = await auth.json();
assert.ok(token);
const release = JSON.parse(await readFile("frontend/config/release-content.json", "utf8"));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
const checks = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addInitScript(
      ({ token, release }) => {
        localStorage.setItem("analytics.dashboard.token", token);
        localStorage.setItem("user.email", "alex@example.test");
        localStorage.setItem("user.registered", "true");
        localStorage.setItem("theme", "dark");
        localStorage.setItem(`releaseTour.seen.${encodeURIComponent(release.releaseId)}`, "true");
        for (const tip of release.tips)
          localStorage.setItem(`releaseTip.opened.${encodeURIComponent(release.releaseId)}.${encodeURIComponent(tip.id)}`, "true");
      },
      { token, release },
    );
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname.startsWith("/dashboard/")) {
        const response = await worker.fetch(
          new Request(`http://localhost${url.pathname}`, {
            method: request.method(),
            headers: request.headers(),
            ...(request.method() === "POST" ? { body: request.postData() } : {}),
          }),
          env,
        );
        return route.fulfill({ status: response.status, contentType: "application/json", body: await response.text() });
      }
      if (url.port === "8787" || url.hostname === "adtools.lolik.workers.dev") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: [] }) });
      }
      return url.origin === base ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}/#dashboard`);
    await page.locator('[data-tab="trends"]').click();
    await page.locator(".trend-day").first().waitFor();
    assert.equal(await page.locator(".trend-day").count(), 30);
    assert.equal(await page.locator(".pattern-hour").count(), 24);
    assert.equal(await page.locator(".heatmap-cell").count(), 30 * 24);
    assert.match(await page.locator(".period-comparison").innerText(), /Previous period/);
    assert.match(await page.locator(".department-summary").innerText(), /RETAIL/);
    assert.match(await page.locator(".department-summary").innerText(), /Unknown/);
    assert.equal(await page.locator(".daily-trends").getByText("Successful uses", { exact: true }).count(), 0);
    if (!process.env.SKIP_SCREENSHOTS) await page.screenshot({ path: resolve(output, `${width}-trends.png`), fullPage: true });
    await page.locator('[data-pattern-hour="1"]').click();
    assert.match(await page.locator(".pattern-evidence").innerText(), /Quick Query/);
    await page.locator("[data-pattern-reset]").click();
    await page
      .locator('[data-trend-select="day"]')
      .evaluate((select) => select.closest(".ad-searchable-dropdown").querySelector("button").focus());
    await page.locator('[data-trend-select="day"]').selectOption({ index: 1 });
    assert.equal(
      await page.evaluate(() => document.activeElement.closest(".ad-searchable-dropdown")?.querySelector("select").dataset.trendSelect),
      "day",
    );
    assert.equal(await page.locator('[data-trend-select="day"]').evaluate((element) => element.selectedIndex), 1);
    await page.locator(".trend-day").nth(4).click();
    await page.locator('[data-pattern-hour="12"]').click();
    assert.match(await page.locator(".pattern-evidence").innerText(), /12:00/);
    assert.match(await page.locator(".pattern-evidence").innerText(), /JSON/);
    await page.locator("[data-pattern-reset]").click();
    await page.locator("[data-pattern-department]").selectOption("RETAIL");
    assert.equal(await page.locator('.pattern-evidence [data-pattern-person="sam@example.test"]').count(), 0);
    await page.locator("[data-pattern-department]").selectOption("");
    assert.equal(await page.locator('.trend-day[aria-pressed="true"]').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (!process.env.SKIP_SCREENSHOTS) await page.screenshot({ path: resolve(output, `${width}-detail.png`), fullPage: true });
    checks.push(
      `${width}: 30 calendar days, equal-period comparison, hourly patterns, day/hour drill-down, departments, no document overflow`,
    );
    // Native select is upgraded by the shared searchable-dropdown component in the full application.
    await page.evaluate(() => {
      const select = document.querySelector("#dashboard-range");
      select.value = "7d";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelectorAll(".trend-day").length === 7);
    checks.push(`${width}: range changes fetch 7 calendar days through the real Worker handler`);
    await page.locator('[data-tab="device-health"]').click();
    await page.locator(".device-health tbody tr").first().waitFor();
    assert.equal(await page.locator(".device-health tbody tr").count(), 4);
    assert.match(await page.locator(".device-health thead").innerText(), /Last tool action/);
    assert.match(await page.locator(".device-health thead").innerText(), /App check-in/);
    assert.equal(await page.locator("#dashboard-range").isVisible(), false);
    await page
      .locator('[data-device-filter="activity"]')
      .evaluate((select) => select.closest(".ad-searchable-dropdown").querySelector("button").focus());
    await page.locator('[data-device-filter="activity"]').selectOption({ label: "Inactive 30+ days" });
    assert.equal(
      await page.evaluate(() => document.activeElement.closest(".ad-searchable-dropdown")?.querySelector("select").dataset.deviceFilter),
      "activity",
    );
    assert.equal(await page.locator('.device-health [role="region"][tabindex="0"]').count(), 1);
    assert.equal(await page.locator(".device-health tbody tr").count(), 1);
    assert.match(await page.locator(".device-health tbody").innerText(), /windows-alex-002/);
    await page.locator('[data-device-filter="activity"]').selectOption({ index: 0 });
    await page.locator('[data-device-filter="version"]').selectOption({ label: "Older version" });
    assert.equal(await page.locator(".device-health tbody tr").count(), 2);
    await page.locator("#dashboard-search").fill("sam@example.test");
    assert.equal(await page.locator(".device-health tbody tr").count(), 1);
    await page.locator("#dashboard-search").fill("no-such-device");
    assert.match(await page.locator(".device-health").innerText(), /No matching devices/);
    await page.locator("#dashboard-search").fill("");
    await page.locator('[data-device-filter="version"]').selectOption({ index: 0 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (!process.env.SKIP_SCREENSHOTS) await page.screenshot({ path: resolve(output, `${width}-devices.png`), fullPage: true });
    checks.push(`${width}: device identity, exclusions, update and inactivity filters, search, empty state, no overflow`);
    await page.locator('[data-tab="trends"]').click();
    await page.locator(".pattern-hour").first().waitFor();
    assert.equal(await page.locator(".trend-day").count(), 7);
    const firstCell = page.locator(".heatmap-cell").first();
    await firstCell.focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.evaluate(() => document.activeElement.dataset.patternCellHour), "1");
    checks.push(`${width}: cached Trends keeps analysis data and the heatmap supports arrow-key navigation`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(output, "result.json"),
    JSON.stringify(
      {
        passed: true,
        checks,
        errors,
        data: "Synthetic SQLite fixtures; actual authenticated Worker handlers; stable-release R2 fixture",
        command: "PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node frontend/pages/dashboard/tests/trends-browser.mjs",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ passed: true, checks, output }));
} finally {
  await browser.close();
  db.close();
  await moduleServer.close();
}
