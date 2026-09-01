// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { convertDbeaverSchemaRows, importSchemasPayload, parseDbeaverSchemaClipboard } from "../services/SchemaImportService.js";
import { IndexedDBStorageService } from "../services/IndexedDBStorageService.js";

describe("SchemaImportService (KV nested tables payload)", () => {
  let storageService;

  beforeEach(() => {
    storageService = {
      saveSchema: vi.fn().mockResolvedValue(true),
    };
  });

  it("maps new_data_model_schema.json into storage writes", async () => {
    const jsonPath = path.resolve(__dirname, "../new_data_model_schema.json");
    const payload = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

    const count = await importSchemasPayload(payload, storageService);
    expect(count).toBeGreaterThanOrEqual(2); // two tables in the JSON
    expect(storageService.saveSchema).toHaveBeenCalledWith(
      "inhouse_forex.rate_tiering",
      expect.arrayContaining([["RATE_TIERING_ID", "VARCHAR2(36)", "Yes", null, null, "No"]]),
    );
    expect(storageService.saveSchema).toHaveBeenCalledWith(
      "inhouse_forex.other_table",
      expect.arrayContaining([["OTHER_TABLE_ID", "VARCHAR2(36)", "Yes", null, null, "Yes"]]),
    );
  });
});

describe("IndexedDBStorageService legacy migration", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("moves legacy schema and data through the active IndexedDB service", async () => {
    localStorage.setItem(
      "tool:quick-query:schema",
      JSON.stringify({
        inhouse_forex: {
          tables: {
            rate_tiering: {
              columns: { RATE_TIERING_ID: { type: "VARCHAR2(36)" } },
              pk: ["RATE_TIERING_ID"],
              last_updated: "2026-01-01T00:00:00.000Z",
            },
          },
        },
      }),
    );
    localStorage.setItem(
      "tool:quick-query:data",
      JSON.stringify({
        inhouse_forex: {
          rate_tiering: {
            rows: [{ RATE_TIERING_ID: "tier-1" }],
            query_type: "INSERT",
            last_updated: "2026-01-02T00:00:00.000Z",
          },
        },
      }),
    );

    const service = new IndexedDBStorageService();
    service._openDatabase = vi.fn().mockResolvedValue();
    service._putRecord = vi.fn().mockResolvedValue(true);

    await service.init();

    expect(service._putRecord).toHaveBeenCalledWith(
      "schemas",
      expect.objectContaining({ fullName: "inhouse_forex.rate_tiering", schemaName: "inhouse_forex", tableName: "rate_tiering" }),
    );
    expect(service._putRecord).toHaveBeenCalledWith(
      "tableData",
      expect.objectContaining({
        fullName: "inhouse_forex.rate_tiering",
        rows: [{ RATE_TIERING_ID: "tier-1" }],
        queryType: "insert",
      }),
    );
    expect(localStorage.getItem("tool:quick-query:schema")).toBeNull();
    expect(localStorage.getItem("tool:quick-query:data")).toBeNull();
  });
});

describe("SchemaImportService (DBeaver clipboard payload)", () => {
  it("parses copied DBeaver columns into Quick Query schema rows", () => {
    const clipboard = [
      "Column Name\tColumn Type\tType Name\tColumn Size\tNot Null\tDefault Value\tComments",
      "CUSTOMER_ID\tVARCHAR\tVARCHAR2(36)\t36\ttrue\t[NULL]\tPrimary identifier",
      "CUSTOMER_NAME\tVARCHAR\tVARCHAR2(100)\t100\tfalse\tUNKNOWN\tDisplay name",
    ].join("\n");

    expect(parseDbeaverSchemaClipboard(clipboard)).toEqual([
      ["CUSTOMER_ID", "VARCHAR2(36)", "No", "", "1", "No"],
      ["CUSTOMER_NAME", "VARCHAR2(100)", "Yes", "UNKNOWN", "2", "No"],
    ]);
  });

  it("rejects non-DBeaver clipboard text", () => {
    expect(() => convertDbeaverSchemaRows([["Field Name", "Data Type"]])).toThrow(/DBeaver column export/);
  });
});
