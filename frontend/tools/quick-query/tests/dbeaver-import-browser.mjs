// Failure cases: clipboard permission blocks opening, cancel edits the active schema,
// header rows become fields, old and displayed layouts disagree, errors close the dialog,
// duplicate openers leak grids, keyboard focus escapes, or mobile controls overflow.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.DBEAVER_TEST_URL || "http://127.0.0.1:1249";
const output = resolve(process.env.DBEAVER_TEST_OUTPUT || "docs/verification/dbeaver-import");
const release = JSON.parse(await readFile("frontend/config/release-content.json", "utf8"));
const browser = await chromium.launch({ channel: "chrome", headless: true });
await mkdir(output, { recursive: true });
const checks = [];
const errors = [];
const headers = "Column Name\t#\tType\tType Mod\tNot Null\tDefault\tComment";
const rows = [
  "EVENT_CODE\t1\tVARCHAR2(100)\t\ttrue\t\t",
  "SPLUNK_TEMPLATE\t2\tCLOB\t\ttrue\t\t",
  "IS_DELETED\t3\tNUMBER(1,0)\t\ttrue\t0\t",
  "CREATED_TIME\t4\tTIMESTAMP\t\ttrue\t\t",
  "CREATED_BY\t5\tVARCHAR2(50)\t\ttrue\t'SYSTEM'\t",
  "UPDATED_TIME\t6\tTIMESTAMP\t\tfalse\t\t",
  "UPDATED_BY\t7\tVARCHAR2(50)\t\tfalse\t'SYSTEM'\t",
];
try {
  for (const [width, theme] of [
    [1440, "dark"],
    [390, "light"],
  ]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.route("**/*", (route) => (new URL(route.request().url()).origin === base ? route.continue() : route.abort()));
    await context.addInitScript(
      ({ release, theme }) => {
        localStorage.setItem("user.email", "dev@localhost");
        localStorage.setItem("user.registered", "true");
        localStorage.setItem("theme", theme);
        localStorage.setItem(`releaseTour.seen.${encodeURIComponent(release.releaseId)}`, "true");
        for (const tip of release.tips)
          localStorage.setItem(`releaseTip.opened.${encodeURIComponent(release.releaseId)}.${encodeURIComponent(tip.id)}`, "true");
      },
      { release, theme },
    );
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await page.waitForFunction(() => Boolean(window.app));
    await page.evaluate(() => window.app.router.navigate("quick-query"));
    await page.waitForFunction(() => Boolean(window.app.tools.get("quick-query")?.ui?.schemaTable));
    await page.evaluate(async () => {
      const ui = window.app.tools.get("quick-query").ui;
      await ui.ready;
      ui.schemaTable.loadData([["ORIGINAL_ID", "NUMBER", "No", "", "1", "Yes"]]);
      ui.updateDataSpreadsheet();
      ui.dataTable.loadData([["ORIGINAL_ID"], ["42"]]);
      window.clipboardReads = 0;
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          readText: async () => {
            window.clipboardReads++;
            throw new Error("Clipboard denied");
          },
        },
      });
    });
    const trigger = page.getByRole("button", { name: "Paste from DBeaver", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Paste from DBeaver", exact: true });
    await dialog.waitFor();
    assert.equal(await page.evaluate(() => window.clipboardReads), 0);
    await dialog.getByText(/Copy Advanced Info/).waitFor();
    const before = await page.evaluate(() => window.app.tools.get("quick-query").ui.schemaTable.getData());
    const dataBefore = await page.evaluate(() => window.app.tools.get("quick-query").ui.dataTable.getData());
    const paste = async (text) => {
      await dialog.locator(".ht_master tbody tr:first-child td:first-of-type").click();
      await page.evaluate((text) => {
        const data = new DataTransfer();
        data.setData("text/plain", text);
        document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
      }, text);
    };
    await paste([headers, ...rows].join("\n"));
    await dialog.locator(".ht_master").getByText("EVENT_CODE", { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.app.tools.get("quick-query").ui.schemaTable.getData()), before);
    await page.screenshot({ path: resolve(output, `${width}-${theme}-staged.png`), animations: "disabled" });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.app.tools.get("quick-query").ui.schemaTable.getData()), before);
    assert.deepEqual(await page.evaluate(() => window.app.tools.get("quick-query").ui.dataTable.getData()), dataBefore);
    assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
    await trigger.click();
    // No header is needed when rows follow the displayed DBeaver columns.
    await paste(rows.join("\n"));
    await dialog.getByRole("button", { name: "Convert schema", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    const converted = await page.evaluate(() => window.app.tools.get("quick-query").ui.schemaTable.getData());
    assert.equal(converted.length, 7);
    assert.deepEqual(converted[2], ["IS_DELETED", "NUMBER(1,0)", "No", "0", "3", "No"]);
    assert.deepEqual(converted[6], ["UPDATED_BY", "VARCHAR2(50)", "Yes", "'SYSTEM'", "7", "No"]);
    await trigger.click();
    await paste(
      "Column Name\tColumn Type\tType Name\tColumn Size\tNot Null\tDefault Value\tComments\nLEGACY_ID\tVARCHAR\tVARCHAR2(36)\t36\ttrue\t[NULL]\tIdentifier",
    );
    await dialog.getByRole("button", { name: "Convert schema", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.deepEqual(await page.evaluate(() => window.app.tools.get("quick-query").ui.schemaTable.getData()), [
      ["LEGACY_ID", "VARCHAR2(36)", "No", "", "1", "No"],
    ]);
    await trigger.click();
    await paste("BROKEN\t1\t\t\ttrue");
    await dialog.getByRole("button", { name: "Convert schema", exact: true }).click();
    await dialog.getByRole("alert").getByText(/Type/).waitFor();
    assert.equal(await dialog.isVisible(), true);
    assert.equal(await page.evaluate(() => window.app.tools.get("quick-query").ui.schemaTable.getData()[0][0]), "LEGACY_ID");
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    await page.screenshot({ path: resolve(output, `${width}-${theme}-error.png`), animations: "disabled" });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await trigger.click();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await trigger.click();
    await page.evaluate(() => window.app.router.navigate("home"));
    await dialog.waitFor({ state: "hidden" });
    checks.push(
      `${width}px ${theme}: no clipboard read; staged paste; cancel preserves schema and focus; headerless and legacy conversion; inline error; Escape; viewport bounds`,
    );
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, "result.json"), JSON.stringify({ passed: true, checks, errors }, null, 2) + "\n");
  console.log(checks.join("\n"));
} catch (error) {
  await writeFile(resolve(output, "result.json"), JSON.stringify({ passed: false, checks, errors, error: error.stack }, null, 2) + "\n");
  throw error;
} finally {
  await browser.close();
}
