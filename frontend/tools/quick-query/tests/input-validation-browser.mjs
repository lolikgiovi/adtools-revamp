// Failure cases: warnings arrive only after Generate, Unicode byte limits differ from generation,
// links focus wrong cells after blank rows, fixes leave stale highlights, UPDATE blanks are blocked,
// invalid sheets generate SQL, edits are lost, unsafe text becomes markup, Excel errors target another grid,
// tab switches retain old issues, or a long error list pushes the grid away.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.QUICK_QUERY_TEST_URL || "http://127.0.0.1:1249";
const output = resolve(process.env.QUICK_QUERY_TEST_OUTPUT || "docs/verification/quick-query-input-validation");
const release = JSON.parse(await readFile("frontend/config/release-content.json", "utf8"));
const browser = await chromium.launch({ channel: "chrome", headless: true });
await mkdir(output, { recursive: true });
const checks = [];
const errors = [];
const withUI = (page, fn, arg) =>
  page.evaluate(
    ({ code, arg }) => {
      const ui = window.app.tools.get("quick-query").ui;
      return new Function("ui", "arg", `return (${code})(ui, arg)`)(ui, arg);
    },
    { code: fn.toString(), arg },
  );
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
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base);
    await page.waitForFunction(() => Boolean(window.app));
    await page.evaluate(() => window.app.router.navigate("quick-query"));
    await page.waitForFunction(() => Boolean(window.app.tools.get("quick-query")?.ui?.dataTable));
    await withUI(page, async (ui) => {
      await ui.ready;
      ui.elements.tableNameInput.value = "APP.TEST";
      ui.setQueryTypeValue("insert");
      ui.schemaTable.loadData([
        ["ID", "NUMBER", "No", "", "1", "Yes"],
        ["NAME", "VARCHAR2(3 BYTE)", "No", "", "2", "No"],
        ["BODY", "VARCHAR2(3 CHAR)", "Yes", "", "3", "No"],
      ]);
      ui.updateDataSpreadsheet();
      ui.dataTable.loadData([
        ["ID", "NAME", "BODY"],
        [null, null, null],
        ["1", "éé", "ééé"],
        ["2", "", "abcd"],
      ]);
    });
    const panel = page.locator("#quickQueryInputValidation");
    await panel.getByText("3 cells need attention", { exact: true }).waitFor();
    await panel.locator("summary").click();
    assert.equal(await panel.locator("button").count(), 3);
    await panel.getByRole("button", { name: /B2:.*4 \/ 3 BYTE/ }).click();
    assert.deepEqual(await withUI(page, (ui) => ui.dataTable.getSelectedLast().slice(0, 2)), [2, 1]);
    assert.equal(await page.locator('#spreadsheet-data .ht_master td[aria-invalid="true"]').count(), 3);
    await withUI(page, (ui) => {
      window.beforeValidation = JSON.stringify(ui.dataTable.getData());
    });
    await page.locator("#generateQuery").click();
    await page.waitForFunction(
      () =>
        window.app.tools.get("quick-query").ui.editor.getValue() === "" && !window.app.tools.get("quick-query").ui._queryPreparationPending,
    );
    assert.equal(await withUI(page, (ui) => JSON.stringify(ui.dataTable.getData()) === window.beforeValidation), true);
    await page.screenshot({ path: resolve(output, `${width}-${theme}-issues.png`), animations: "disabled" });
    checks.push(`${width}: live required/BYTE/CHAR issues, exact coordinates, navigation, generation blocked, input preserved`);

    await withUI(page, (ui) => {
      ui.dataTable.setDataAtCell([
        [2, 1, "é"],
        [3, 1, "ok"],
        [3, 2, "abc"],
      ]);
    });
    await page.waitForFunction(() => document.querySelector("#quickQueryInputValidation").hidden);
    assert.equal(await page.locator('#spreadsheet-data .ht_master td[aria-invalid="true"]').count(), 0);
    await page.locator("#generateQuery").click();
    await page
      .waitForFunction(() => window.app.tools.get("quick-query").ui.editor.getValue().includes("INSERT INTO"), null, { timeout: 5000 })
      .catch(async (error) => {
        console.log(
          await withUI(page, (ui) => ({
            error: ui.elements.errorMessages.textContent,
            sql: ui.editor.getValue(),
            data: ui.dataTable.getData(),
            schema: ui.schemaTable.getData(),
            queryType: ui.getQueryTypeValue(),
            generating: ui.isGenerating,
          })),
        );
        throw error;
      });
    checks.push(`${width}: corrections clear markers and successful SQL is produced`);

    await withUI(page, (ui) => {
      ui.setQueryTypeValue("update");
      ui.dataTable.setDataAtCell(3, 1, "");
    });
    await page.waitForTimeout(300);
    assert.equal(await panel.isVisible(), false);
    await withUI(page, (ui) => ui.dataTable.setDataAtCell(3, 1, "NULL"));
    await panel.getByText("1 cell needs attention", { exact: true }).waitFor();
    checks.push(`${width}: blank UPDATE preserves existing value; explicit NULL remains blocked`);

    await withUI(page, (ui) => {
      ui.dataTable.setDataAtCell(0, 1, "<img src=x onerror=alert(1)>");
    });
    await panel.getByRole("button", { name: /Field not in schema/ }).waitFor();
    assert.equal(await panel.locator("img").count(), 0);
    checks.push(`${width}: header errors render as text`);

    await withUI(page, (ui) => {
      ui.setQueryTypeValue("insert");
      ui.schemaTable.loadData([
        ["ID", "NUMBER(3,1)", "No", "", "1", "Yes"],
        ["WHEN", "DATE", "No", "", "2", "No"],
        ["REQ", "VARCHAR2(10)", "No", "", "3", "No"],
      ]);
      ui.updateDataSpreadsheet();
      ui.dataTable.loadData([
        ["ID", "WHEN", "REQ"],
        ["1.23", "not-a-date", ""],
        ["1234", "2026-11-04", "ok"],
        ["12abc", "SYSDATE", "ok"],
      ]);
    });
    await panel.getByText("5 cells need attention", { exact: true }).waitFor();
    await panel.getByRole("button", { name: /A1:.*maximum scale/ }).waitFor();
    await panel.getByRole("button", { name: /B1:.*Invalid date/ }).waitFor();
    await panel.getByRole("button", { name: /A2:.*maximum precision/ }).waitFor();
    await panel.getByRole("button", { name: /A3:.*Invalid numeric/ }).waitFor();
    await page.locator("#generateQuery").click();
    await page.waitForFunction(
      () =>
        window.app.tools.get("quick-query").ui.editor.getValue() === "" && !window.app.tools.get("quick-query").ui._queryPreparationPending,
    );
    await page.screenshot({ path: resolve(output, `${width}-${theme}-numeric-date.png`), animations: "disabled" });
    await withUI(page, (ui) =>
      ui.dataTable.setDataAtCell([
        [1, 0, "1.2"],
        [1, 1, "2026-11-04"],
        [1, 2, "ok"],
        [2, 0, "12.3"],
        [3, 0, "2"],
      ]),
    );
    await page.waitForFunction(() => document.querySelector("#quickQueryInputValidation").hidden);
    await page.locator("#generateQuery").click();
    await page.waitForFunction(() => window.app.tools.get("quick-query").ui.editor.getValue().includes("INSERT INTO"));
    checks.push(`${width}: numeric format, precision, scale and date errors highlighted together; corrected SQL generates`);

    await withUI(page, (ui) => {
      ui.excelImportService.setImportedData({ header: ["REQ", "WHEN", "ID"], data: [["", "not-a-date", "12abc"]], rowCount: 1 });
      ui._onExcelImportSuccess({ header: ["REQ", "WHEN", "ID"], rowCount: 1 }, "validation.xlsx");
    });
    await page.locator("#generateQuery").click();
    await panel.getByText("3 cells need attention in Excel", { exact: true }).waitFor();
    assert.equal(await panel.locator("button").count(), 0);
    await panel.getByText(/Excel row 2, ID:.*Invalid numeric/).waitFor();
    assert.equal(await page.locator('#spreadsheet-data .ht_master td[aria-invalid="true"]').count(), 0);
    await withUI(page, (ui) => ui.handleClearExcelImport());
    await page.waitForFunction(() => document.querySelector("#quickQueryInputValidation").hidden);
    checks.push(`${width}: Excel validation identifies original row and field without highlighting the manual grid`);

    await withUI(page, (ui) =>
      ui.dataTable.loadData([["ID", "WHEN", "REQ"], ...Array.from({ length: 200 }, () => ["invalid", "SYSDATE", "ok"])]),
    );
    await panel.getByText("100+ cells need attention", { exact: true }).waitFor();
    assert.equal(await panel.locator("button").count(), 100);
    assert.ok(await panel.locator(".qq-input-issues").evaluate((el) => el.clientHeight <= 120));
    checks.push(`${width}: large error lists are bounded and scroll independently`);

    await withUI(page, (ui) => {
      ui.elements.tableNameInput.value = "APP.CONFIG";
      ui.setQueryTypeValue("update");
      ui.schemaTable.loadData([
        ["CONFIG_ID", "VARCHAR2(36)", "No", "", "1", "No"],
        ["DESCRIPTION", "VARCHAR2(200)", "Yes", "", "2", "No"],
        ["PARAMETER_KEY", "VARCHAR2(100)", "No", "", "3", "Yes"],
      ]);
      ui.updateDataSpreadsheet();
      ui.dataTable.loadData([
        ["CONFIG_ID", "DESCRIPTION", "PARAMETER_KEY"],
        ["uuid", "changed", ""],
        ["", "changed", "installment.education.banner.image.en"],
      ]);
    });
    await panel.getByText("1 cell needs attention", { exact: true }).waitFor();
    await panel.getByRole("button", { name: /C1:.*PARAMETER_KEY.*required to match/ }).click();
    assert.deepEqual(await withUI(page, (ui) => ui.dataTable.getSelectedLast().slice(0, 2)), [1, 2]);
    assert.equal(await page.locator('#spreadsheet-data .ht_master td[aria-invalid="true"]').count(), 1);
    await page.screenshot({ path: resolve(output, `${width}-${theme}-required-key.png`), animations: "disabled" });
    await page.locator("#generateQuery").click();
    await page.waitForFunction(
      () =>
        window.app.tools.get("quick-query").ui.editor.getValue() === "" && !window.app.tools.get("quick-query").ui._queryPreparationPending,
    );
    await withUI(page, (ui) => ui.dataTable.setDataAtCell(1, 2, "installment.provider.banner.image.id"));
    await page
      .waitForFunction(() => document.querySelector("#quickQueryInputValidation").hidden, null, { timeout: 5000 })
      .catch(async (error) => {
        console.log(
          await withUI(page, (ui) => ({
            panel: ui.elements.inputValidation.textContent,
            queryType: ui.getQueryTypeValue(),
            data: ui.dataTable.getData(),
            schema: ui.schemaTable.getData(),
            excel: ui.excelImportService.hasData(),
          })),
        );
        throw error;
      });
    await page.locator("#generateQuery").click();
    await page.getByRole("dialog", { name: "Update existing CONFIG_IDs?" }).getByRole("button", { name: "Keep existing IDs" }).click();
    await page.waitForFunction(() => window.app.tools.get("quick-query").ui.editor.getValue().includes("UPDATE APP.CONFIG"));
    checks.push(
      `${width}: screenshot's empty PARAMETER_KEY is highlighted for UPDATE; corrected key generates while blank non-key cells remain allowed`,
    );

    const parityCases = [
      { name: "UUID expansion", type: "VARCHAR2(3)", value: "uuid", invalid: true },
      { name: "audit user expansion", type: "VARCHAR2(3)", field: "CREATED_BY", value: "ABCDEFG", invalid: true },
      { name: "numeric exponent", type: "NUMBER(5)", value: "1e21", invalid: true },
      { name: "spaced type declaration", type: "VARCHAR2 (3 BYTE)", value: "abcdef", invalid: true },
      {
        name: "filename in NUMBER",
        type: "NUMBER",
        value: "bad.txt",
        invalid: true,
        attachments: [{ name: "bad.txt", type: "text/plain", processedFormats: { original: "hello" } }],
      },
      { name: "fractional precision", type: "NUMBER(2,2)", value: "0.12" },
      { name: "large exact integer", type: "NUMBER(20)", value: "99999999999999999999" },
      { name: "nullable Y", type: "VARCHAR2(3)", nullable: "Y", value: "" },
      { name: "Unicode CHAR length", type: "VARCHAR2(1 CHAR)", value: "😀" },
    ];
    for (const fixture of parityCases) {
      await withUI(
        page,
        (ui, fixture) => {
          ui.elements.tableNameInput.value = "APP.TEST";
          ui.setQueryTypeValue("insert");
          ui.elements.auditUserMode.value = "off";
          ui.processedFiles = fixture.attachments || [];
          const field = fixture.field || "VALUE";
          ui.schemaTable.loadData([
            ["ID", "NUMBER", "No", "", "1", "Yes"],
            [field, fixture.type, fixture.nullable || "No", "", "2", "No"],
          ]);
          ui.updateDataSpreadsheet();
          ui.dataTable.loadData([
            ["ID", field],
            ["1", fixture.value],
          ]);
        },
        fixture,
      );
      if (fixture.invalid) {
        await panel
          .getByText("1 cell needs attention", { exact: true })
          .waitFor({ timeout: 5000 })
          .catch(async (error) => {
            console.log(
              fixture.name,
              await withUI(page, (ui) => ({
                panel: ui.elements.inputValidation.textContent,
                mode: ui.elements.auditUserMode.value,
                data: ui.dataTable.getData(),
                schema: ui.schemaTable.getData(),
              })),
            );
            throw error;
          });
        await page.locator("#generateQuery").click();
        await page.waitForFunction(() => {
          const ui = window.app.tools.get("quick-query").ui;
          return !ui._queryPreparationPending && ui.editor.getValue() === "";
        });
      } else {
        await page.waitForFunction(() => document.querySelector("#quickQueryInputValidation").hidden);
        await page.locator("#generateQuery").click();
        await page.waitForFunction(() => {
          const ui = window.app.tools.get("quick-query").ui;
          return !ui._queryPreparationPending && ui.editor.getValue().includes("INSERT INTO");
        });
        if (fixture.name === "large exact integer") assert.ok((await withUI(page, (ui) => ui.editor.getValue())).includes(fixture.value));
      }
      checks.push(`${width}: ${fixture.name} ${fixture.invalid ? "highlighted and blocked" : "accepted and generates SQL"}`);
    }

    await withUI(page, (ui) => {
      ui.processedFiles = [];
      ui.elements.tableNameInput.value = "APP.ITEMS";
      ui.setQueryTypeValue("insert");
      ui.schemaTable.loadData([
        ["CONFIG_ID", "VARCHAR2(36)", "Yes", "", "1", "No"],
        ["DESCRIPTION", "VARCHAR2(200)", "Yes", "", "2", "No"],
        ["PARAMETER_KEY", "VARCHAR2(100)", "No", "", "3", "Yes"],
      ]);
      ui.updateDataSpreadsheet();
      const values = Array.from({ length: 1000 }, (_, index) => [String(index), "ok", `key-${index}`]);
      values[0][2] = "123";
      values[1] = [null, null, null];
      values[71][2] = "123";
      ui.dataTable.loadData([["CONFIG_ID", "DESCRIPTION", "PARAMETER_KEY"], ...values]);
    });
    await page.locator("#generateQuery").click();
    const duplicateWarning = page.locator(".qq-duplicate-warning");
    await duplicateWarning.locator("summary").waitFor();
    assert.equal(await withUI(page, (ui) => Boolean(ui.queryExecutionService.worker)), true);
    await duplicateWarning.locator("summary").click();
    assert.equal(await duplicateWarning.getByRole("button").count(), 2);
    await page.screenshot({ path: resolve(output, `${width}-${theme}-duplicate-warning.png`), animations: "disabled" });
    await duplicateWarning.getByRole("button", { name: "C1", exact: true }).click();
    assert.deepEqual(await withUI(page, (ui) => ui.dataTable.getSelectedLast().slice(0, 2)), [1, 2]);
    await duplicateWarning.getByRole("button", { name: "C72", exact: true }).click();
    assert.deepEqual(await withUI(page, (ui) => ui.dataTable.getSelectedLast().slice(0, 2)), [72, 2]);
    await page.screenshot({ path: resolve(output, `${width}-${theme}-duplicate-links.png`), animations: "disabled" });
    checks.push(`${width}: real worker duplicate warning links C1 and C72 to displayed rows, preserving the blank row`);

    await withUI(page, async (ui) => {
      const schema = [
        ["ID", "NUMBER", "No", "", "1", "Yes"],
        ["VALUE", "VARCHAR2(3)", "No", "", "2", "No"],
      ];
      const data = [
        ["ID", "VALUE"],
        ["1", "long"],
      ];
      ui.schemaTable.loadData(schema);
      ui.updateDataSpreadsheet();
      ui.dataTable.loadData(data);
      await ui._generateQuery("APP.TEST", "insert", schema, data);
    });
    const errorLink = page.locator("#errorMessages").getByRole("button", { name: "Cell B1", exact: true });
    await errorLink.scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, `${width}-${theme}-legacy-cell-link.png`), animations: "disabled" });
    await errorLink.click();
    assert.deepEqual(await withUI(page, (ui) => ui.dataTable.getSelectedLast().slice(0, 2)), [1, 1]);
    checks.push(`${width}: legacy generation error uses data row 1 and links to B1`);

    await withUI(page, (ui) => {
      ui.elements.tableNameInput.value = "APP.TEST";
      ui.setQueryTypeValue("insert");
      ui.customAuditUserValue = "R27_ANTARES_" + "X".repeat(36);
      ui.elements.systemCustomLabel.textContent = ui.customAuditUserValue;
      ui.elements.auditUserMode.value = "custom";
      ui.syncAuditUserMode();
      ui.schemaTable.loadData([
        ["ID", "NUMBER", "No", "", "1", "Yes"],
        ["CREATED_BY", "VARCHAR2(36)", "No", "", "2", "No"],
        ["UPDATED_BY", "VARCHAR2(36)", "Yes", "", "3", "No"],
      ]);
      ui.updateDataSpreadsheet();
      ui.dataTable.loadData([
        ["ID", "CREATED_BY", "UPDATED_BY"],
        ...Array.from({ length: 72 }, (_, index) => [String(index), "SYSTEM", "SYSTEM"]),
      ]);
      window.auditSourceData = JSON.stringify(ui.dataTable.getData());
    });
    await panel.getByText("2 issues need attention", { exact: true }).waitFor();
    assert.equal(await panel.getByRole("button").count(), 2);
    assert.equal(await page.locator('#spreadsheet-data .ht_master td[aria-invalid="true"]').count(), 0);
    await page.locator('.system-mode-custom-button[aria-invalid="true"]').waitFor();
    await page.screenshot({ path: resolve(output, `${width}-${theme}-audit-control.png`), animations: "disabled" });
    await panel.getByRole("button", { name: /Custom audit user:.*CREATED_BY/ }).click();
    assert.equal(await page.locator("#customAuditUser").evaluate((el) => el === document.activeElement), true);
    assert.equal(await page.locator("#customAuditUser").getAttribute("aria-invalid"), "true");
    await page.locator("#customAuditUser").fill("R27_ANTARES");
    await page.locator("#systemCustomDone").click();
    await page.waitForFunction(() => document.querySelector("#quickQueryInputValidation").hidden);
    assert.equal(await page.locator('.system-mode-choice[aria-invalid="true"]').count(), 0);
    assert.equal(await withUI(page, (ui) => JSON.stringify(ui.dataTable.getData()) === window.auditSourceData), true);
    checks.push(
      `${width}: 72-row custom audit error groups into two control issues, focuses the custom editor and clears on correction without changing cells`,
    );

    await withUI(page, (ui) => ui.dataTable.setDataAtCell(1, 1, "R27_ANTARES_" + "X".repeat(36)));
    await page.locator('[data-audit-mode="off"]').click();
    await panel.getByText("1 cell needs attention", { exact: true }).waitFor();
    await panel.getByRole("button", { name: /B1:.*CREATED_BY/ }).click();
    assert.deepEqual(await withUI(page, (ui) => ui.dataTable.getSelectedLast().slice(0, 2)), [1, 1]);
    assert.equal(await page.locator('.system-mode-choice[aria-invalid="true"]').count(), 0);
    checks.push(`${width}: Off mode validates and links the real audit cell`);

    await withUI(page, (ui) => ui.schemaTable.setDataAtCell(1, 1, "VARCHAR2(3)"));
    await page.locator('[data-audit-mode="system"]').click();
    await panel.getByText("1 issue needs attention", { exact: true }).waitFor();
    await panel.getByRole("button", { name: /SYSTEM audit user:.*CREATED_BY/ }).click();
    assert.equal(await page.locator('[data-audit-mode="system"]').evaluate((el) => el === document.activeElement), true);
    assert.equal(await page.locator('#spreadsheet-data .ht_master td[aria-invalid="true"]').count(), 0);
    checks.push(`${width}: invalid SYSTEM override highlights and focuses its control`);

    await withUI(page, async (ui) => {
      await ui.createNewTab();
    });
    await page.waitForFunction(() => document.querySelector("#quickQueryInputValidation").hidden);
    assert.equal(await page.locator('.system-mode-choice[aria-invalid="true"]').count(), 0);
    checks.push(`${width}: new tab clears validation from prior data and audit controls`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(output, "result.json"),
    JSON.stringify(
      { passed: true, checks, errors, base, reproduce: "node frontend/tools/quick-query/tests/input-validation-browser.mjs" },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, checks, output }, null, 2));
} finally {
  await browser.close();
}
