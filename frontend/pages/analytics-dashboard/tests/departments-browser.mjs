// Department usage E2E: migrated SQLite, real authenticated Worker handler, real dashboard UI.
// Failure cases: registered departments without activity vanish, missing departments vanish instead of
// showing as Unknown, excluded/development devices leak, one person with two devices counts twice,
// reconstructed (non-client) rows inflate actions, tools from one department bleed into another,
// the range is ignored, the endpoint answers without a dashboard token, the matrix overflows on phones.
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { createServer } from "vite";

const moduleServer = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { default: worker } = await moduleServer.ssrLoadModule("/../backend-workers/worker.js");

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.DASHBOARD_TEST_URL || "http://127.0.0.1:1246";
const output = resolve("docs/verification/dashboard-departments");
await mkdir(output, { recursive: true });
const db = new DatabaseSync(":memory:");
const migrations = new URL("../../../../backend-workers/migrations/", import.meta.url);
for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
  db.exec(await readFile(new URL(file, migrations), "utf8"));
}
const env = {
  ANALYTICS_DASHBOARD_PASSWORD: "departments-fixture-only",
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
};
db.exec(`INSERT INTO users (id,email,created_time,last_seen,department) VALUES
  ('ana','ana@example.test',datetime('now'),datetime('now'),'RETAIL'),
  ('ben','ben@example.test',datetime('now'),datetime('now'),'RETAIL'),
  ('sme','sme@example.test',datetime('now'),datetime('now'),'SME'),
  ('quiet','quiet@example.test',datetime('now'),datetime('now'),'WHOLESALE'),
  ('nodept','nodept@example.test',datetime('now'),datetime('now'),NULL),
  ('hidden','hidden@example.test',datetime('now'),datetime('now'),'NBDS');
  INSERT INTO device (device_id,user_id,platform,created_time,last_seen) VALUES
  ('ana-mac','ana','macOS',datetime('now'),datetime('now')),
  ('ana-win','ana','Windows',datetime('now'),datetime('now')),
  ('ben-mac','ben','macOS',datetime('now'),datetime('now')),
  ('sme-mac','sme','macOS',datetime('now'),datetime('now')),
  ('quiet-mac','quiet','macOS',datetime('now'),datetime('now')),
  ('nodept-mac','nodept','macOS',datetime('now'),datetime('now')),
  ('excluded-device','hidden','macOS',datetime('now'),datetime('now'));`);
const insert = db.prepare(`INSERT INTO tool_usage (event_id,user_email,device_id,tool_id,action,source,created_time)
  VALUES (?,?,?,?,?,?,datetime('now','+7 hours','start of day',?,'+10 hours'))`);
const rows = [
  ["ana@example.test", "ana-mac", "json-tools", "prettify", "client", "-1 day", 4],
  ["ana@example.test", "ana-win", "json-tools", "copy_output", "client", "-2 days", 2],
  ["ana@example.test", "ana-mac", "quick-query", "merge", "client", "-3 days", 1],
  ["ben@example.test", "ben-mac", "json-tools", "prettify", "client", "-1 day", 3],
  ["sme@example.test", "sme-mac", "run-query", "run_success", "client", "-1 day", 5],
  ["sme@example.test", "sme-mac", "run-query", "run_success", "historical_event", "-1 day", 50],
  ["sme@example.test", "sme-mac", "uuid-generator", "generate_uuid", "client", "-20 days", 6],
  ["nodept@example.test", "nodept-mac", "base64-tools", "encode", "client", "-2 days", 2],
  ["hidden@example.test", "excluded-device", "kafka", "publish", "client", "-1 day", 9],
];
let id = 0;
for (const [email, device, tool, action, source, offset, count] of rows)
  for (let index = 0; index < count; index++) insert.run(`e${id++}`, email, device, tool, action, source, offset);

const call = (path, body, token) =>
  worker.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: JSON.stringify(body),
    }),
    env,
  );
const checks = [];
const report = async (range) => {
  const body = await (await call("/dashboard/query", { tabId: "departments", range }, token)).json();
  assert.equal(body.ok, true, body.error);
  assert.deepEqual(body.data, body.analysis.departments);
  return body.analysis;
};
assert.equal((await call("/dashboard/query", { tabId: "departments", range: "7d" })).status, 401);
const { token } = await (await call("/dashboard/verify", { password: env.ANALYTICS_DASHBOARD_PASSWORD })).json();
assert.ok(token);
const week = await report("7d");
const dept = (report, name) => report.departments.find((row) => row.department === name);
assert.deepEqual(
  week.departments.map((row) => row.department),
  ["RETAIL", "SME", "Unknown", "WHOLESALE"],
);
assert.deepEqual(
  { ...dept(week, "RETAIL"), last_active: undefined },
  { department: "RETAIL", registered_people: 2, active_people: 2, devices: 3, actions: 10, tools: 2, last_active: undefined },
);
assert.match(dept(week, "RETAIL").last_active, /^\d{4}-\d{2}-\d{2}T/);
assert.equal(dept(week, "SME").actions, 5);
assert.equal(dept(week, "WHOLESALE").actions, 0);
assert.equal(dept(week, "WHOLESALE").registered_people, 1);
assert.equal(dept(week, "Unknown").active_people, 1);
assert.equal(dept(week, "NBDS"), undefined);
const tool = (report, department, toolId) => report.tools.find((row) => row.department === department && row.tool_id === toolId);
assert.deepEqual(tool(week, "RETAIL", "json-tools"), { department: "RETAIL", tool_id: "json-tools", actions: 9, people: 2 });
assert.deepEqual(tool(week, "RETAIL", "quick-query"), { department: "RETAIL", tool_id: "quick-query", actions: 1, people: 1 });
assert.equal(tool(week, "SME", "json-tools"), undefined);
assert.equal(tool(week, "SME", "uuid-generator"), undefined);
assert.equal(
  week.tools.some((row) => row.tool_id === "kafka"),
  false,
);
const month = await report("30d");
assert.deepEqual(tool(month, "SME", "uuid-generator"), { department: "SME", tool_id: "uuid-generator", actions: 6, people: 1 });
assert.equal(dept(month, "SME").tools, 2);
checks.push(
  "API: token required; registered-but-idle and Unknown departments kept; exclusions, reconstructed rows, and device double counting rejected; range applied",
);

const release = JSON.parse(await readFile("frontend/config/release-content.json", "utf8"));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: "dark" });
    await context.addInitScript(
      ({ token, release }) => {
        localStorage.setItem("analytics.dashboard.token", token);
        localStorage.setItem("user.email", "ana@example.test");
        localStorage.setItem("user.registered", "true");
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
    await page.locator('[data-tab="departments"]').click();
    const view = page.locator(".department-usage");
    await view.locator(".department-row").first().waitFor();
    assert.equal(await page.locator("#dashboard-range").evaluate((select) => select.value), "30d");
    assert.equal(await page.locator(".dashboard-search").isVisible(), false);
    assert.deepEqual(await view.locator(".department-row th").allInnerTexts(), ["RETAIL", "SME", "Unknown", "WHOLESALE"]);
    assert.match(await view.locator(".department-row").first().innerText(), /2\s*\/\s*2/);
    const matrix = view.locator(".department-matrix");
    assert.match(await matrix.locator("thead").innerText(), /RETAIL/);
    assert.match(await matrix.locator("tbody").innerText(), /JSON Tools/);
    assert.equal(await matrix.locator("tbody").getByText("Kafka").count(), 0);
    assert.equal(await matrix.locator('[data-cell="RETAIL:json-tools"]').innerText(), "2");
    await view.locator('[data-department-metric="actions"]').click();
    assert.equal(await matrix.locator('[data-cell="RETAIL:json-tools"]').innerText(), "9");
    await view.locator('[data-department-metric="people"]').click();
    assert.equal(await matrix.locator('[data-cell="RETAIL:json-tools"]').innerText(), "2");
    await matrix.locator("tbody").getByText("UUID Generator").waitFor();
    // Native select is upgraded by the shared searchable-dropdown component in the full application.
    await page.evaluate(() => {
      const select = document.querySelector("#dashboard-range");
      select.value = "7d";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => {
      const text = document.querySelector(".department-matrix tbody")?.innerText || "";
      return text.includes("JSON Tools") && !text.includes("UUID Generator");
    });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (!process.env.SKIP_SCREENSHOTS) await page.screenshot({ path: resolve(output, `${width}-departments.png`), fullPage: true });
    checks.push(
      `${width}: Analytics Departments tab ranks departments, people/actions matrix toggle, range change refetches, no page overflow`,
    );
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
        data: "Synthetic SQLite fixtures; actual authenticated Worker handlers",
        command:
          "DASHBOARD_TEST_URL=http://127.0.0.1:1246 PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node frontend/pages/analytics-dashboard/tests/departments-browser.mjs",
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
