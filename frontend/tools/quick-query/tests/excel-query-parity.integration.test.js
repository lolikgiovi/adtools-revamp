import { beforeAll, describe, expect, it, vi } from "vitest";
import { prepareExcelDataForSchema } from "../services/SchemaImportService.js";
import { QueryExecutionService } from "../services/QueryExecutionService.js";

vi.mock("../../../core/UsageTracker.js", () => ({ UsageTracker: { trackEvent: vi.fn() } }));

// Failure modes: reordered values land in the wrong columns; omitted fields bypass
// required/null/audit rules; duplicate or unknown headers lose data; Excel mutates;
// worker generation diverges; absent audit columns produce invalid SQL; options
// or duplicate-PK warnings differ from the data sheet; blank rows become inserts.
const schema = [
  ["ID", "NUMBER", "No", "", "", "Yes"],
  ["NAME", "VARCHAR2(30)", "No"],
  ["NOTES", "VARCHAR2(50)", "Yes"],
  ["CREATED_TIME", "DATE", "Yes"],
  ["CREATED_BY", "VARCHAR2(30)", "Yes"],
  ["UPDATED_TIME", "DATE", "Yes"],
  ["UPDATED_BY", "VARCHAR2(30)", "Yes"],
];
const sheet = [schema.map((row) => row[0]), ["101", "Alice", null, null, null, null, null]];
const excel = [
  ["name", "id"],
  ["Alice", "101"],
];
let workerScope;

beforeAll(async () => {
  workerScope = { postMessage: vi.fn() };
  vi.stubGlobal("self", workerScope);
  await import("../services/query.worker.js");
});

function execution(useWorker) {
  return new QueryExecutionService({
    workerRowThreshold: useWorker ? 1 : 1000,
    workerFactory: () => {
      const worker = {
        terminate: vi.fn(),
        postMessage: (message) => queueMicrotask(() => workerScope.onmessage({ data: message })),
      };
      workerScope.postMessage = (data) => worker.onmessage({ data });
      return worker;
    },
  });
}

for (const useWorker of [false, true]) {
  describe(`Excel/data-sheet parity (${useWorker ? "worker handler" : "direct"})`, () => {
    it.each(["insert", "update", "merge"])("uses the existing %s value rules", async (queryType) => {
      const service = execution(useWorker);
      const request = { tableName: "app.customers", queryType, schemaData: schema };
      const expected = await service.generateQuery({ ...request, inputData: sheet });
      const actual = await service.generateQuery({ ...request, inputData: prepareExcelDataForSchema(excel, schema) });
      expect(actual).toEqual(expected);
      expect(actual.sql).toContain("SYSDATE");
      expect(actual.sql).toContain("'SYSTEM'");
      expect(actual.sql).toContain("WHERE updated_time >= SYSDATE - INTERVAL '2' MINUTE");
      if (queryType === "insert") expect(actual.sql).toContain("101, 'Alice', NULL");
      if (queryType === "update") {
        expect(actual.sql).toContain("updated_time = SYSDATE");
        expect(actual.sql).not.toContain("notes =");
        expect(actual.sql).not.toContain("created_time =");
      }
      if (queryType === "merge") {
        expect(actual.sql).toContain("NULL AS notes");
        expect(actual.sql).toContain("tgt.notes = src.notes");
      }
      service.terminate();
    });

    it.each(["insert", "merge"])("rejects missing required fields for %s", async (queryType) => {
      const service = execution(useWorker);
      await expect(
        service.generateQuery({
          tableName: "app.customers",
          queryType,
          schemaData: schema,
          inputData: prepareExcelDataForSchema([["id"], ["101"]], schema),
        }),
      ).rejects.toThrow('NULL value not allowed for non-nullable field "NAME"');
      service.terminate();
    });

    it("rejects missing UPDATE primary-key values", async () => {
      const service = execution(useWorker);
      await expect(
        service.generateQuery({
          tableName: "app.customers",
          queryType: "update",
          schemaData: schema,
          inputData: prepareExcelDataForSchema([["name"], ["Alice"]], schema),
        }),
      ).rejects.toThrow("Primary key values are required");
      service.terminate();
    });

    it("honors disabled timestamps and custom audit users", async () => {
      const service = execution(useWorker);
      const result = await service.generateQuery({
        tableName: "app.customers",
        queryType: "update",
        schemaData: schema,
        inputData: prepareExcelDataForSchema(excel, schema),
        options: { defaultSysdate: false, auditUserMode: "custom", customAuditUser: "operator" },
      });
      expect(result.sql).not.toContain("updated_time = SYSDATE");
      expect(result.sql).toContain("updated_by = 'OPERATOR'");
      service.terminate();
    });

    it("does not introduce audit fields absent from the schema", async () => {
      const service = execution(useWorker);
      const result = await service.generateQuery({
        tableName: "app.customers",
        queryType: "update",
        schemaData: schema.slice(0, 3),
        inputData: prepareExcelDataForSchema(excel, schema.slice(0, 3)),
      });
      expect(result.sql).not.toContain("updated_time");
      expect(result.sql).not.toContain("updated_by");
      service.terminate();
    });

    it("retains duplicate-key warnings", async () => {
      const service = execution(useWorker);
      const result = await service.generateQuery({
        tableName: "app.customers",
        queryType: "update",
        schemaData: schema,
        inputData: prepareExcelDataForSchema([...excel, ["Bob", "101"]], schema),
      });
      expect(result.duplicateResult.hasDuplicates).toBe(true);
      service.terminate();
    });
  });
}

describe("Excel header adaptation", () => {
  it("fills missing cells without changing imported data", () => {
    const original = structuredClone(excel);
    expect(prepareExcelDataForSchema(excel, schema)).toEqual(sheet);
    expect(excel).toEqual(original);
  });

  it.each([
    [
      [
        ["id", "ID", "name"],
        ["101", "202", "Alice"],
      ],
      /Duplicate field name/,
    ],
    [
      [
        ["id", "unknown"],
        ["101", "Alice"],
      ],
      /Fields in data but not in schema/,
    ],
    [
      [
        ["id", ""],
        ["101", "Alice"],
      ],
      /Empty field name.*column B/,
    ],
  ])("rejects invalid headers: %j", (input, error) => {
    expect(() => prepareExcelDataForSchema(input, schema)).toThrow(error);
  });

  it("rejects ambiguous schema fields", () => {
    expect(() => prepareExcelDataForSchema(excel, [...schema, ["id", "NUMBER", "No"]])).toThrow(/Duplicate field name/);
  });

  it("keeps blank rows empty for the generator to skip", () => {
    const result = prepareExcelDataForSchema([...excel, [null, null]], schema);
    expect(result[2]).toEqual(Array(schema.length).fill(null));
  });
});
