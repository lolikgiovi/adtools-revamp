// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { OracleConnectionService } from "../../../core/OracleConnectionService.js";
import { OracleDataImportService } from "../services/OracleDataImportService.js";

const originalQuery = OracleConnectionService.queryViaSidecar;

afterEach(() => {
  OracleConnectionService.queryViaSidecar = originalQuery;
});

describe("Oracle row import", () => {
  const schema = ["ID", "NAME", "STATUS"];

  it("accepts selected exact fields and unrestricted filter and ordering text", () => {
    const query = OracleDataImportService.parseQuery(
      "SELECT ID, STATUS FROM APP.ITEM WHERE NAME = 'from; select' AND ID IN (1, 2) ORDER BY ID DESC;",
      schema,
    );
    expect(query.tableName).toBe("APP.ITEM");
    expect(query.fields).toEqual(["ID", "STATUS"]);
  });

  it("rejects expressions and unknown columns while accepting supported joins", () => {
    expect(() => OracleDataImportService.parseQuery("SELECT LOWER(NAME) FROM APP.ITEM", schema)).toThrow("without expressions");
    expect(() => OracleDataImportService.parseQuery("SELECT MISSING FROM APP.ITEM", schema)).toThrow("exactly match");
    expect(() => OracleDataImportService.parseQuery("SELECT ID AS KEY FROM APP.ITEM", schema)).toThrow("exactly match");
    const joined = OracleDataImportService.parseQuery("SELECT ID FROM APP.ITEM JOIN APP.OTHER ON 1=1", schema);
    expect(joined.hasJoin).toBe(true);
    expect(joined.fields).toEqual(["ID"]);
    expect(() => OracleDataImportService.parseQuery("SELECT ID FROM APP.ITEM; DELETE FROM APP.ITEM", schema)).toThrow("one SELECT");
  });

  it("accepts qualified and aliased fields that resolve to schema columns", () => {
    const query = OracleDataImportService.parseQuery("SELECT A.ID AS ID, A.NAME AS NAME FROM APP.ITEM A", schema);
    expect(query.tableName).toBe("APP.ITEM");
    expect(query.fields).toEqual(["ID", "NAME"]);
    expect(() => OracleDataImportService.parseQuery("SELECT B.ID FROM APP.ITEM A", schema)).toThrow("qualifiers must match");
  });

  it("fetches through the shared Oracle bridge and checks returned column names", async () => {
    const query = OracleDataImportService.parseQuery("SELECT ID, NAME FROM APP.ITEM", schema);
    OracleConnectionService.queryViaSidecar = vi.fn().mockResolvedValue({ columns: ["ID", "NAME"], rows: [[1, "A"]] });
    await expect(OracleDataImportService.fetch({ name: "SIT", connect_string: "db/service" }, query)).resolves.toEqual({
      rows: [[1, "A"]],
      missingFields: [],
      extraColumns: [],
    });
    expect(OracleConnectionService.queryViaSidecar).toHaveBeenCalledWith(
      "SIT", { name: "SIT", connect_string: "db/service" }, "SELECT ID, NAME FROM APP.ITEM", 1000,
    );
    OracleConnectionService.queryViaSidecar.mockResolvedValue({ columns: ["ID", "ALIAS"], rows: [[1, "A"]] });
    await expect(OracleDataImportService.fetch({ name: "SIT" }, query)).rejects.toThrow("Missing: NAME. Unexpected: ALIAS.");
  });

  // Failure modes for SELECT * against a table whose live columns drifted from the saved schema:
  // 1. Oracle has extra columns  -> import schema columns, report the extras.
  // 2. Oracle lacks schema columns -> leave those cells empty, report the missing ones.
  // 3. No overlap at all          -> fail and name both sides.
  // 4. Duplicate column names     -> fail.
  // 5. Row width differs from columns -> fail.
  it("imports schema columns from SELECT * when the live table has drifted", async () => {
    const query = OracleDataImportService.parseQuery("SELECT * FROM APP.ITEM", schema);
    OracleConnectionService.queryViaSidecar = vi.fn().mockResolvedValue({
      columns: ["NAME", "ID", "CREATED_AT"],
      rows: [["A", 1, "2026-01-01"]],
    });
    await expect(OracleDataImportService.fetch({ name: "SIT" }, query)).resolves.toEqual({
      rows: [[1, "A", null]],
      missingFields: ["STATUS"],
      extraColumns: ["CREATED_AT"],
    });

    OracleConnectionService.queryViaSidecar.mockResolvedValue({ columns: ["OTHER"], rows: [[1]] });
    await expect(OracleDataImportService.fetch({ name: "SIT" }, query)).rejects.toThrow("None of the returned columns");

    OracleConnectionService.queryViaSidecar.mockResolvedValue({ columns: ["ID", "ID"], rows: [[1, 1]] });
    await expect(OracleDataImportService.fetch({ name: "SIT" }, query)).rejects.toThrow("duplicate");

    OracleConnectionService.queryViaSidecar.mockResolvedValue({ columns: ["ID", "NAME", "STATUS"], rows: [[1, "A"]] });
    await expect(OracleDataImportService.fetch({ name: "SIT" }, query)).rejects.toThrow("unexpected row shape");
  });

  it("classifies failures so analytics can tell causes apart", () => {
    expect(OracleDataImportService.classifyError(new Error("ORA-00942: table or view does not exist"))).toBe("ORA-00942");
    expect(OracleDataImportService.classifyError('{"code":1017,"message":"ORA-01017: invalid"}')).toBe("ORA-01017");
    expect(OracleDataImportService.classifyError(new Error("DPY-6005: cannot connect"))).toBe("DPY-6005");
    expect(OracleDataImportService.classifyError(new Error("Oracle returned columns that do not match"))).toBe("column_mismatch");
    expect(OracleDataImportService.classifyError(new Error("None of the returned columns match"))).toBe("column_mismatch");
    expect(OracleDataImportService.classifyError(new Error("Oracle returned an unexpected row shape."))).toBe("row_shape");
    expect(OracleDataImportService.classifyError(new Error("Oracle returned an unsupported BLOB value for X."))).toBe("blob");
    expect(OracleDataImportService.classifyError(new Error("The selected table changed during the fetch."))).toBe("table_changed");
    expect(OracleDataImportService.classifyError(new Error("sidecar exited"))).toBe("other");
  });
  // Failure modes for schemas typed in lowercase (generation treats them case-insensitively):
  // 1. Selecting the same fields in any case is rejected as "must exactly match".
  // 2. SELECT * finds no matching columns because Oracle reports names in uppercase.
  // 3. The grid header loses the schema's spelling, so generation no longer matches the schema.
  // 4. A lowercase BLOB field is not recognized, so its bytes are not marked as BLOB data.
  it("matches lowercase schema fields to Oracle's uppercase columns", async () => {
    const lower = ["id", "name", "doc"];
    expect(OracleDataImportService.parseQuery("SELECT id, NAME FROM APP.ITEM", lower).fields).toEqual(["id", "name"]);
    expect(() => OracleDataImportService.parseQuery("SELECT ID, ID FROM APP.ITEM", lower)).toThrow("only once");
    const query = OracleDataImportService.parseQuery("SELECT * FROM APP.ITEM", lower);
    expect(query.fields).toEqual(["id", "name", "doc"]);
    OracleConnectionService.queryViaSidecar = vi.fn().mockResolvedValue({
      columns: ["ID", "NAME", "DOC"],
      rows: [[1, "A", { __adtools_type: "oracle_blob", encoding: "base64", data: "QUJD" }]],
    });
    await expect(OracleDataImportService.fetch({ name: "SIT" }, query, new Set(["doc"]))).resolves.toEqual({
      rows: [[1, "A", "data:application/octet-stream;base64,QUJD"]],
      missingFields: [],
      extraColumns: [],
    });
  });
});
