// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OracleConnectionService } from "../../../core/OracleConnectionService.js";
import { OracleEnvImportService } from "../services/OracleEnvImportService.js";

const originalEnsureSidecarStarted = OracleConnectionService.ensureSidecarStarted;
const originalQueryViaSidecar = OracleConnectionService.queryViaSidecar;

describe("OracleEnvImportService shared Oracle connection usage", () => {
  const config = { name: "SIT", connect_string: "sit-db/service" };

  beforeEach(() => {
    OracleConnectionService.ensureSidecarStarted = vi.fn().mockResolvedValue(true);
    OracleConnectionService.queryViaSidecar = vi.fn();
  });

  afterEach(() => {
    OracleConnectionService.ensureSidecarStarted = originalEnsureSidecarStarted;
    OracleConnectionService.queryViaSidecar = originalQueryViaSidecar;
  });

  it("starts Oracle through the shared Oracle service", async () => {
    await expect(OracleEnvImportService.ensureSidecarStarted()).resolves.toBe(true);

    expect(OracleConnectionService.ensureSidecarStarted).toHaveBeenCalledTimes(1);
  });

  it("fetches schemas through the shared query helper", async () => {
    OracleConnectionService.queryViaSidecar.mockResolvedValue({ rows: [["APP"], ["CONTENT"]] });

    await expect(OracleEnvImportService.fetchSchemas("SIT", config)).resolves.toEqual(["APP", "CONTENT"]);

    expect(OracleConnectionService.queryViaSidecar).toHaveBeenCalledTimes(1);
    expect(OracleConnectionService.queryViaSidecar.mock.calls[0][0]).toBe("SIT");
    expect(OracleConnectionService.queryViaSidecar.mock.calls[0][1]).toBe(config);
    expect(OracleConnectionService.queryViaSidecar.mock.calls[0][2]).toContain("FROM ALL_TABLES");
    expect(OracleConnectionService.queryViaSidecar.mock.calls[0][3]).toBe(1000);
  });

  it("ignores flyway schema history tables during table discovery", async () => {
    OracleConnectionService.queryViaSidecar.mockResolvedValue({
      rows: [
        ["CONTENT", "flyway_schema_history"],
        ["CONTENT", "FLYWAY_SCHEMA_HISTORY"],
        ["CONTENT", "MESSAGE_TEMPLATE"],
      ],
    });

    await expect(OracleEnvImportService.fetchTables("SIT", config, ["CONTENT"])).resolves.toEqual([
      { schema: "CONTENT", table: "MESSAGE_TEMPLATE" },
    ]);

    expect(OracleConnectionService.queryViaSidecar.mock.calls[0][2]).toContain("UPPER(TABLE_NAME) NOT IN ('FLYWAY_SCHEMA_HISTORY')");
  });

  it("does not add flyway schema history metadata to the canonical payload", () => {
    const payload = OracleEnvImportService.buildCanonicalPayload(
      [
        ["CONTENT", "flyway_schema_history", "installed_rank", "NUMBER", null, 10, 0, "N", null],
        ["CONTENT", "MESSAGE_TEMPLATE", "ID", "VARCHAR2", 36, null, null, "N", null],
      ],
      [["CONTENT", "flyway_schema_history", "installed_rank", 1]],
    );

    expect(payload.CONTENT.tables.flyway_schema_history).toBeUndefined();
    expect(payload.CONTENT.tables.MESSAGE_TEMPLATE.columns.ID.type).toBe("VARCHAR2(36)");
  });

  it("fetches table metadata through the shared query helper", async () => {
    OracleConnectionService.queryViaSidecar
      .mockResolvedValueOnce({
        rows: [["CONTENT", "MESSAGE_TEMPLATE", "ID", "VARCHAR2", 36, null, null, "N", null, 1]],
      })
      .mockResolvedValueOnce({ rows: [["CONTENT", "MESSAGE_TEMPLATE", "ID", 1]] });

    const payload = await OracleEnvImportService.fetchAllMetadata("SIT", config, ["CONTENT"]);

    expect(OracleConnectionService.queryViaSidecar).toHaveBeenCalledTimes(2);
    expect(payload.CONTENT.tables.MESSAGE_TEMPLATE.columns.ID.type).toBe("VARCHAR2(36)");
    expect(payload.CONTENT.tables.MESSAGE_TEMPLATE.pk).toEqual(["ID"]);
  });
});
