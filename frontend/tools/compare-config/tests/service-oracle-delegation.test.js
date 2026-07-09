// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OracleConnectionService } from "../../../core/OracleConnectionService.js";
import { CompareConfigService } from "../service.js";

const originalStartSidecar = OracleConnectionService.startSidecar;
const originalEnsureSidecarStarted = OracleConnectionService.ensureSidecarStarted;
const originalQueryViaSidecar = OracleConnectionService.queryViaSidecar;
const originalQueryBatchViaSidecar = OracleConnectionService.queryBatchViaSidecar;
const originalGetOracleCredentials = OracleConnectionService.getOracleCredentials;
const originalHasOracleCredentials = OracleConnectionService.hasOracleCredentials;

describe("CompareConfigService Oracle delegation", () => {
  beforeEach(() => {
    OracleConnectionService.startSidecar = vi.fn().mockResolvedValue(true);
    OracleConnectionService.ensureSidecarStarted = vi.fn().mockResolvedValue(true);
    OracleConnectionService.queryViaSidecar = vi.fn().mockResolvedValue({
      columns: ["ID"],
      rows: [[1]],
      row_count: 1,
      execution_time_ms: 5,
    });
    OracleConnectionService.queryBatchViaSidecar = vi.fn().mockResolvedValue({
      results: [
        {
          columns: ["ID", "NAME"],
          rows: [[1, "Alpha"]],
          row_count: 1,
          execution_time_ms: 7,
        },
        { error: "ORA-00942" },
      ],
    });
    OracleConnectionService.getOracleCredentials = vi.fn().mockResolvedValue(["user", "pass"]);
    OracleConnectionService.hasOracleCredentials = vi.fn().mockResolvedValue(true);
  });

  afterEach(() => {
    OracleConnectionService.startSidecar = originalStartSidecar;
    OracleConnectionService.ensureSidecarStarted = originalEnsureSidecarStarted;
    OracleConnectionService.queryViaSidecar = originalQueryViaSidecar;
    OracleConnectionService.queryBatchViaSidecar = originalQueryBatchViaSidecar;
    OracleConnectionService.getOracleCredentials = originalGetOracleCredentials;
    OracleConnectionService.hasOracleCredentials = originalHasOracleCredentials;
  });

  it("keeps existing sidecar lifecycle methods backed by the shared Oracle service", async () => {
    await expect(CompareConfigService.startSidecar()).resolves.toBe(true);
    await expect(CompareConfigService.ensureSidecarStarted()).resolves.toBe(true);

    expect(OracleConnectionService.startSidecar).toHaveBeenCalledTimes(1);
    expect(OracleConnectionService.ensureSidecarStarted).toHaveBeenCalledTimes(1);
  });

  it("keeps existing credential methods backed by the shared Oracle service", async () => {
    await expect(CompareConfigService.getOracleCredentials("SIT")).resolves.toEqual(["user", "pass"]);
    await expect(CompareConfigService.hasOracleCredentials("SIT")).resolves.toBe(true);

    expect(OracleConnectionService.getOracleCredentials).toHaveBeenCalledWith("SIT");
    expect(OracleConnectionService.hasOracleCredentials).toHaveBeenCalledWith("SIT");
  });

  it("keeps queryViaSidecar compatible for Compare Config callers", async () => {
    const config = { name: "SIT", connect_string: "sit-db/service" };

    await expect(CompareConfigService.queryViaSidecar("SIT", config, "SELECT 1 FROM DUAL", 10)).resolves.toEqual({
      columns: ["ID"],
      rows: [[1]],
      row_count: 1,
      execution_time_ms: 5,
    });

    expect(OracleConnectionService.queryViaSidecar).toHaveBeenCalledWith("SIT", config, "SELECT 1 FROM DUAL", 10);
  });

  it("keeps queryBatchViaSidecar result normalization compatible", async () => {
    const queries = [{ connection_name: "SIT", config: { name: "SIT", connect_string: "sit-db/service" }, sql: "SELECT * FROM T" }];

    await expect(CompareConfigService.queryBatchViaSidecar(queries)).resolves.toEqual([
      {
        columns: ["ID", "NAME"],
        rows: [{ ID: 1, NAME: "Alpha" }],
        row_count: 1,
        execution_time_ms: 7,
      },
      { error: "ORA-00942", columns: [], rows: [], row_count: 0 },
    ]);

    expect(OracleConnectionService.queryBatchViaSidecar).toHaveBeenCalledWith(queries);
  });
});
