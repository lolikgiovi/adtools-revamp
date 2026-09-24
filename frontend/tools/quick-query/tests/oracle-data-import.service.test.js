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

  it("rejects aliases, expressions, unknown columns, and other data sources", () => {
    expect(() => OracleDataImportService.parseQuery("SELECT ID AS KEY FROM APP.ITEM", schema)).toThrow("without aliases");
    expect(() => OracleDataImportService.parseQuery("SELECT LOWER(NAME) FROM APP.ITEM", schema)).toThrow("without aliases");
    expect(() => OracleDataImportService.parseQuery("SELECT MISSING FROM APP.ITEM", schema)).toThrow("exactly match");
    expect(() => OracleDataImportService.parseQuery("SELECT ID FROM APP.ITEM JOIN APP.OTHER ON 1=1", schema)).toThrow("one table");
    expect(() => OracleDataImportService.parseQuery("SELECT ID FROM APP.ITEM; DELETE FROM APP.ITEM", schema)).toThrow("one SELECT");
  });

  it("fetches through the shared Oracle bridge and checks returned column names", async () => {
    const query = OracleDataImportService.parseQuery("SELECT ID, NAME FROM APP.ITEM", schema);
    OracleConnectionService.queryViaSidecar = vi.fn().mockResolvedValue({ columns: ["ID", "NAME"], rows: [[1, "A"]] });
    await expect(OracleDataImportService.fetch({ name: "SIT", connect_string: "db/service" }, query)).resolves.toEqual([[1, "A"]]);
    expect(OracleConnectionService.queryViaSidecar).toHaveBeenCalledWith(
      "SIT", { name: "SIT", connect_string: "db/service" }, "SELECT ID, NAME FROM APP.ITEM", 1000,
    );
    OracleConnectionService.queryViaSidecar.mockResolvedValue({ columns: ["ID", "ALIAS"], rows: [[1, "A"]] });
    await expect(OracleDataImportService.fetch({ name: "SIT" }, query)).rejects.toThrow("do not match");
  });
});
