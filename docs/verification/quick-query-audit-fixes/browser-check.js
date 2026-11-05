// Quick Query audit fixes: end-to-end check against the running dev app.
// Run on http://127.0.0.1:1234/#quick-query (registered dev user) by pasting into the browser console,
// or through an agent's page-evaluate tool. Returns { passed, checks }. It creates two scratch tabs
// and closes them at the end.
(async () => {
  const ui = window.app.currentTool.ui;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const checks = [];
  const check = (name, ok, detail = "") => checks.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 300) });
  const sql = () => ui.editor.getValue();
  const error = () => (ui.elements.errorMessages?.style.display === "block" ? ui.elements.errorMessages.textContent : "");
  const fill = async ({ table, type, schema, data }) => {
    ui.elements.tableNameInput.value = table;
    ui.elements.tableNameInput.dispatchEvent(new Event("input", { bubbles: true }));
    ui.setQueryTypeValue(type);
    ui.schemaTable.loadData(schema);
    ui.updateDataSpreadsheet();
    ui.dataTable.loadData(data);
    await wait(300);
  };
  const generate = async () => {
    ui.editor.setValue("");
    document.getElementById("generateQuery").click();
    for (let i = 0; i < 50 && (ui._queryPreparationPending || ui.isGenerating); i++) await wait(100);
    await wait(200);
  };
  const startTabs = ui.tabs.map((tab) => tab.id);

  // 1 + 9 + 15: BLOB text with a quote, uppercase reserved columns, FLOAT/NVARCHAR2 schema types.
  const tabA = await ui.createNewTab();
  await fill({
    table: "APP.AUDIT_FIX",
    type: "merge",
    schema: [
      ["ID", "NUMBER", "No", "", "", "Yes"],
      ["LEVEL", "NUMBER", "Yes", "", "", ""],
      ["DOC", "BLOB", "Yes", "", "", ""],
      ["AMOUNT", "FLOAT(126)", "Yes", "", "", ""],
      ["LABEL", "NVARCHAR2(10)", "Yes", "", "", ""],
    ],
    data: [
      ["ID", "LEVEL", "DOC", "AMOUNT", "LABEL"],
      ["1", "2", "x')); DELETE FROM APP.AUDIT_FIX; --", "1.5", "O'Neil"],
    ],
  });
  await generate();
  check("schema with FLOAT(126) and NVARCHAR2 generates without errors", sql() && !error(), error());
  check("BLOB text quote is escaped", sql().includes("utl_raw.cast_to_raw('x'')); DELETE FROM APP.AUDIT_FIX; --')"), sql());
  check("no injected statement after the BLOB literal", !/cast_to_raw\('x'\)\);/.test(sql()), sql());
  check("uppercase reserved column is quoted", sql().includes('2 AS "LEVEL"') && sql().includes('tgt."LEVEL" = src."LEVEL"'), sql());

  // 8: CONFIG_ID as the UPDATE match key keeps the entered value.
  await fill({
    table: "APP.FEATURE_FLAGS",
    type: "update",
    schema: [
      ["CONFIG_ID", "NUMBER", "No", "", "", "Yes"],
      ["NAME", "VARCHAR2(10)", "Yes", "", "", ""],
    ],
    data: [
      ["CONFIG_ID", "NAME"],
      ["42", "x"],
    ],
  });
  await generate();
  check(
    "CONFIG_ID match key: UPDATE uses WHERE config_id = 42",
    sql().includes("WHERE config_id = 42;") && !sql().includes("MAX(config_id)"),
    sql() || error(),
  );
  const tabAFingerprintSql = sql();

  // 16: header with surrounding spaces no longer fails generation.
  ui.dataTable.loadData([
    [" CONFIG_ID ", "NAME"],
    ["42", "x"],
  ]);
  await wait(300);
  await generate();
  check("header with spaces generates", sql().includes("WHERE config_id = 42;") && !error(), error());

  // 5 + 17 + 3 + 4: real .xlsx through the file input, kept with its tab, re-import counts as a change.
  const XLSX = await import("/@id/xlsx");
  const xlsxFile = (rows) => {
    const sheet = { "!ref": "A1:E3", ...rows };
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Sheet1");
    return new File([XLSX.write(book, { type: "array", bookType: "xlsx" })], "audit.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  };
  const importFile = async (file) => {
    const input = ui.elements.excelFileInput;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 50 && !ui.excelImportService.hasData(); i++) await wait(100);
    await wait(200);
  };
  const tabB = await ui.createNewTab();
  await fill({
    table: "APP.EXCEL_FIX",
    type: "insert",
    schema: [
      ["ID", "NUMBER", "No", "", "", "Yes"],
      ["BIRTH", "DATE", "Yes", "", "", ""],
      ["AMT", "NUMBER(10,2)", "Yes", "", "", ""],
      ["CODE", "VARCHAR2(5)", "Yes", "", "", ""],
    ],
    data: [
      ["ID", "BIRTH", "AMT", "CODE"],
      ["", "", "", ""],
    ],
  });
  const cells = (amount) => ({
    A1: { t: "s", v: "ID" },
    B1: { t: "s", v: "BIRTH" },
    C1: { t: "s", v: "AMT" },
    D1: { t: "s", v: "CODE" },
    A2: { t: "n", v: 1 },
    B2: { t: "n", v: 45306, z: "yyyy-mm-dd" },
    C2: { t: "n", v: amount },
    D2: { t: "n", v: 123, z: "00000" },
  });
  await importFile(xlsxFile(cells(0.1 * 3)));
  check(
    "Excel import ignores the empty used-range column",
    ui.excelImportService.getHeader()?.join() === "ID,BIRTH,AMT,CODE",
    ui.excelImportService.getHeader(),
  );
  await generate();
  check("Excel date cell becomes 2024-01-15", sql().includes("TO_TIMESTAMP('2024-01-15 00:00:00'"), sql() || error());
  check("Excel calculated 0.3 passes NUMBER(10,2)", sql().includes(", 0.3, ") && !error(), sql() || error());
  check("Excel zero-padded code keeps leading zeros", sql().includes("'00123'"), sql());
  const generatedRecord = ui._generatedSql;
  await importFile(xlsxFile(cells(0.4)));
  check("re-importing a same-shaped file marks the SQL stale", generatedRecord?.fingerprint !== ui.currentQueryFingerprint());

  await ui.switchTab(tabA.id);
  check(
    "Excel rows do not follow into another tab",
    !ui.excelImportService.hasData() && ui.elements.excelImportInfo.classList.contains("hidden"),
  );
  check("tab A shows its own SQL after switching back", sql() === tabAFingerprintSql || sql().includes("APP.FEATURE_FLAGS"), sql());
  ui.dataTable.setDataAtCell(1, 1, "changed");
  await wait(300);
  await ui.switchTab(tabB.id);
  check("Excel rows come back with their tab", ui.excelImportService.getRowCount() === 1);
  await ui.switchTab(tabA.id);
  check(
    "tab A's edited grid is detected as stale after visiting tab B",
    ui._generatedSql && ui._generatedSql.fingerprint !== ui.currentQueryFingerprint(),
  );

  // 2: a tab switch while a worker generation is pending discards that result.
  const realService = ui.queryExecutionService;
  let finish;
  ui.queryExecutionService = { generateQuery: () => new Promise((resolve) => (finish = resolve)), cancel() {} };
  const pending = ui._generateQuery("APP.FEATURE_FLAGS", "update", ui.schemaTable.getData(), ui.dataTable.getData());
  await ui.switchTab(tabB.id);
  finish({ sql: "UPDATE APP.FEATURE_FLAGS -- late result", duplicateResult: null, usedWorker: true });
  await pending;
  ui.queryExecutionService = realService;
  check("late generation result is not written into the other tab", !sql().includes("late result") && !ui.isGenerating, sql());

  await ui.closeTabs([tabA.id, tabB.id], { nextActiveId: startTabs[0] });
  return { passed: checks.every((item) => item.ok), checks };
})();
