// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OracleConnectionService } from "../../../core/OracleConnectionService.js";
import { OracleEnvImportService } from "../services/OracleEnvImportService.js";

const originalBuildSidecarConnection = OracleConnectionService.buildSidecarConnection;
const originalEnsureSidecarStarted = OracleConnectionService.ensureSidecarStarted;
const originalQueryWithConnection = OracleConnectionService.queryWithConnection;

describe("OracleEnvImportService shared Oracle connection usage", () => {
  const connection = {
    name: "SIT",
    connect_string: "sit-db/service",
    username: "user",
    password: "pass",
  };
  const config = { name: "SIT", connect_string: "sit-db/service" };

  beforeEach(() => {
    OracleConnectionService.buildSidecarConnection = vi.fn().mockResolvedValue(connection);
    OracleConnectionService.ensureSidecarStarted = vi.fn().mockResolvedValue(true);
    OracleConnectionService.queryWithConnection = vi.fn();
  });

  afterEach(() => {
    OracleConnectionService.buildSidecarConnection = originalBuildSidecarConnection;
    OracleConnectionService.ensureSidecarStarted = originalEnsureSidecarStarted;
    OracleConnectionService.queryWithConnection = originalQueryWithConnection;
  });

  it("loads credentials through the shared Oracle service", async () => {
    await expect(OracleEnvImportService.buildConnection("SIT", config)).resolves.toEqual(connection);

    expect(OracleConnectionService.buildSidecarConnection).toHaveBeenCalledWith("SIT", config);
  });

  it("starts Oracle through the shared Oracle service", async () => {
    await expect(OracleEnvImportService.ensureSidecarStarted()).resolves.toBe(true);

    expect(OracleConnectionService.ensureSidecarStarted).toHaveBeenCalledTimes(1);
  });

  it("fetches schemas through the shared query helper", async () => {
    OracleConnectionService.queryWithConnection.mockResolvedValue({ rows: [["APP"], ["CONTENT"]] });

    await expect(OracleEnvImportService.fetchSchemas("SIT", config)).resolves.toEqual(["APP", "CONTENT"]);

    expect(OracleConnectionService.queryWithConnection).toHaveBeenCalledTimes(1);
    expect(OracleConnectionService.queryWithConnection.mock.calls[0][0]).toBe(connection);
    expect(OracleConnectionService.queryWithConnection.mock.calls[0][1]).toContain("FROM ALL_TABLES");
    expect(OracleConnectionService.queryWithConnection.mock.calls[0][2]).toBe(1000);
  });

  it("fetches table metadata through the shared query helper", async () => {
    OracleConnectionService.queryWithConnection
      .mockResolvedValueOnce({
        rows: [["CONTENT", "MESSAGE_TEMPLATE", "ID", "VARCHAR2", 36, null, null, "N", null, 1]],
      })
      .mockResolvedValueOnce({ rows: [["CONTENT", "MESSAGE_TEMPLATE", "ID", 1]] });

    const payload = await OracleEnvImportService.fetchAllMetadata("SIT", config, ["CONTENT"]);

    expect(OracleConnectionService.queryWithConnection).toHaveBeenCalledTimes(2);
    expect(payload.CONTENT.tables.MESSAGE_TEMPLATE.columns.ID.type).toBe("VARCHAR2(36)");
    expect(payload.CONTENT.tables.MESSAGE_TEMPLATE.pk).toEqual(["ID"]);
  });
});
