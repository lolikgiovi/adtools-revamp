// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { QuerifyService } from "../service.js";

vi.mock("../../../core/UsageTracker.js", () => ({
  UsageTracker: {
    trackEvent: () => {},
  },
}));

function createService(overrides = {}) {
  const storageService = overrides.storageService || {
    init: vi.fn().mockResolvedValue(undefined),
    getAllTables: vi
      .fn()
      .mockResolvedValue([{ fullName: "INHOUSE_FOREX.RATE_TIERING", schemaName: "INHOUSE_FOREX", tableName: "RATE_TIERING" }]),
    loadSchema: vi.fn().mockResolvedValue([
      ["ID", "NUMBER", "No", "", "", "Yes"],
      ["NAME", "VARCHAR2(50)", "Yes", "", "", "No"],
    ]),
  };
  const excelImportService = overrides.excelImportService || {
    processFromFile: vi.fn().mockResolvedValue({
      header: ["ID", "NAME"],
      data: [
        ["1", "Alpha"],
        ["2", "Beta"],
      ],
      rowCount: 2,
    }),
    processFromUint8Array: vi.fn().mockReturnValue({
      header: ["ID", "NAME"],
      data: [["3", "Gamma"]],
      rowCount: 1,
    }),
  };
  const queryExecutionService = overrides.queryExecutionService || {
    generateQuery: vi.fn().mockResolvedValue({
      sql: "SET DEFINE OFF;\n\nMERGE INTO INHOUSE_FOREX.RATE_TIERING tgt;",
      duplicateResult: { hasDuplicates: false },
      rowCount: 2,
      usedWorker: false,
    }),
    terminate: vi.fn(),
  };

  return {
    service: new QuerifyService({
      storageService,
      excelImportServiceFactory: () => excelImportService,
      queryExecutionService,
    }),
    storageService,
    excelImportService,
    queryExecutionService,
  };
}

describe("QuerifyService filename parsing", () => {
  it("accepts schema.table Excel filenames", () => {
    const { service } = createService();

    expect(service.parseExcelFileName("INHOUSE_FOREX.RATE_TIERING.xlsx")).toEqual({
      fileName: "INHOUSE_FOREX.RATE_TIERING.xlsx",
      requestedFullName: "INHOUSE_FOREX.RATE_TIERING",
      lookupKey: "inhouse_forex.rate_tiering",
      schemaName: "INHOUSE_FOREX",
      tableName: "RATE_TIERING",
    });
  });

  it("rejects non-Excel and non schema.table filenames", () => {
    const { service } = createService();

    expect(() => service.parseExcelFileName("RATE_TIERING.xlsx")).toThrow(/schema_name\.table_name/);
    expect(() => service.parseExcelFileName("a.b.c.xlsx")).toThrow(/schema_name\.table_name/);
    expect(() => service.parseExcelFileName("INHOUSE_FOREX.RATE_TIERING.csv")).toThrow(/Only \.xlsx and \.xls/);
  });
});

describe("QuerifyService schema lookup", () => {
  it("matches saved Quick Query schemas case-insensitively", async () => {
    const { service } = createService();
    const lookup = await service.buildSchemaLookup();
    const parsed = service.parseExcelFileName("inhouse_forex.rate_tiering.xlsx");

    expect(service.resolveSchemaRecord(parsed, lookup).fullName).toBe("INHOUSE_FOREX.RATE_TIERING");
  });

  it("fails when a filename has no saved schema", async () => {
    const { service, queryExecutionService } = createService();

    await expect(service.generateFile({ name: "missing_schema.missing_table.xlsx" }, "merge")).rejects.toThrow(
      /Schema not found in Quick Query/,
    );
    expect(queryExecutionService.generateQuery).not.toHaveBeenCalled();
  });

  it("fails when multiple saved schemas differ only by case", async () => {
    const { service } = createService({
      storageService: {
        init: vi.fn().mockResolvedValue(undefined),
        getAllTables: vi.fn().mockResolvedValue([{ fullName: "APP.CONFIG" }, { fullName: "app.config" }]),
        loadSchema: vi.fn(),
      },
    });

    await expect(service.generateFile({ name: "app.config.xlsx" }, "merge")).rejects.toThrow(/Multiple saved schemas match/);
  });
});

describe("QuerifyService generation", () => {
  it("reuses Quick Query validation and generation services", async () => {
    const { service, storageService, excelImportService, queryExecutionService } = createService();

    const result = await service.generateFile({ name: "inhouse_forex.rate_tiering.xlsx" }, "merge");

    expect(storageService.loadSchema).toHaveBeenCalledWith("INHOUSE_FOREX.RATE_TIERING");
    expect(excelImportService.processFromFile).toHaveBeenCalledWith({ name: "inhouse_forex.rate_tiering.xlsx" });
    expect(queryExecutionService.generateQuery).toHaveBeenCalledWith({
      tableName: "INHOUSE_FOREX.RATE_TIERING",
      queryType: "merge",
      schemaData: expect.any(Array),
      inputData: [
        ["ID", "NAME"],
        ["1", "Alpha"],
        ["2", "Beta"],
      ],
      options: { defaultSysdate: true },
      onProgress: undefined,
    });
    expect(result).toMatchObject({
      fileName: "inhouse_forex.rate_tiering.xlsx",
      tableName: "INHOUSE_FOREX.RATE_TIERING",
      queryType: "merge",
      rowCount: 2,
      usedWorker: false,
    });
  });

  it("builds combined SQL from successful results only", () => {
    const { service } = createService();

    expect(
      service.buildCombinedSql([
        { status: "success", tableName: "APP.ONE", sql: "SET DEFINE OFF;\n\nINSERT INTO APP.ONE VALUES (1);" },
        { status: "failed", tableName: "APP.TWO", sql: "SHOULD_NOT_APPEAR" },
        { status: "success", tableName: "APP.THREE", sql: "UPDATE APP.THREE SET NAME = 'A';\n" },
      ]),
    ).toBe(
      [
        "-- BEGIN APP.ONE",
        "SET DEFINE OFF;\n\nINSERT INTO APP.ONE VALUES (1);",
        "-- END APP.ONE",
        "",
        "-- BEGIN APP.THREE",
        "UPDATE APP.THREE SET NAME = 'A';",
        "-- END APP.THREE",
      ].join("\n"),
    );
  });

  it("can generate from Tauri-read Uint8Array data without browser File APIs", async () => {
    const queryExecutionService = {
      generateQuery: vi.fn().mockResolvedValue({ sql: "INSERT SQL", rowCount: 1, duplicateResult: null, usedWorker: false }),
      terminate: vi.fn(),
    };
    const { service, excelImportService } = createService({ queryExecutionService });
    const uint8Array = new Uint8Array([1, 2, 3]);

    const result = await service.generateFile({ name: "inhouse_forex.rate_tiering.xlsx", uint8Array }, "insert");

    expect(excelImportService.processFromUint8Array).toHaveBeenCalledWith(uint8Array);
    expect(excelImportService.processFromFile).not.toHaveBeenCalled();
    expect(queryExecutionService.generateQuery).toHaveBeenCalledWith({
      tableName: "INHOUSE_FOREX.RATE_TIERING",
      queryType: "insert",
      schemaData: expect.any(Array),
      inputData: [
        ["ID", "NAME"],
        ["3", "Gamma"],
      ],
      options: { defaultSysdate: true },
      onProgress: undefined,
    });
    expect(result).toMatchObject({
      rowCount: 1,
      usedWorker: false,
    });
  });

  it("reads Tauri path files lazily during generation", async () => {
    const queryExecutionService = {
      generateQuery: vi.fn().mockResolvedValue({ sql: "INSERT SQL", rowCount: 1, duplicateResult: null, usedWorker: false }),
      terminate: vi.fn(),
    };
    const { service, excelImportService } = createService({ queryExecutionService });
    const uint8Array = new Uint8Array([4, 5, 6]);
    const readFile = vi.fn().mockResolvedValue(uint8Array);

    const result = await service.generateFile(
      { name: "inhouse_forex.rate_tiering.xlsx", path: "/tmp/inhouse_forex.rate_tiering.xlsx" },
      "insert",
      {
        readFile,
      },
    );

    expect(readFile).toHaveBeenCalledWith("/tmp/inhouse_forex.rate_tiering.xlsx");
    expect(excelImportService.processFromUint8Array).toHaveBeenCalledWith(uint8Array);
    expect(excelImportService.processFromFile).not.toHaveBeenCalled();
    expect(queryExecutionService.generateQuery).toHaveBeenCalledWith({
      tableName: "INHOUSE_FOREX.RATE_TIERING",
      queryType: "insert",
      schemaData: expect.any(Array),
      inputData: [
        ["ID", "NAME"],
        ["3", "Gamma"],
      ],
      options: { defaultSysdate: true },
      onProgress: undefined,
    });
    expect(result).toMatchObject({
      rowCount: 1,
      usedWorker: false,
    });
  });
});
