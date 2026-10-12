// @vitest-environment node
import { describe, expect, it } from "vitest";
import { OracleSidecarError } from "../../../core/OracleConnectionService.js";
import { describeOracleImportError } from "../services/OracleImportErrorService.js";

describe("describeOracleImportError", () => {
  it("maps a Tauri JSON error payload and keeps the Oracle detail", () => {
    const raw = JSON.stringify({
      code: 12514,
      message: "ORA-12514: TNS:listener does not currently know of service requested in connect descriptor",
      hint: "Verify the service name exists on the target database.",
    });

    const info = describeOracleImportError(raw);

    expect(info.isOracle).toBe(true);
    expect(info.code).toBe("ORA-12514");
    expect(info.title).toBe("Service name not found");
    expect(info.hint).toContain("service name");
    expect(info.detail).toContain("ORA-12514");
    expect(info.detail).toContain("listener does not currently know of service");
  });

  it("maps ORA-00942 (object not found)", () => {
    const info = describeOracleImportError("ORA-00942: table or view does not exist");

    expect(info.isOracle).toBe(true);
    expect(info.code).toBe("ORA-00942");
    expect(info.title).toBe("Table or view does not exist");
    expect(info.detail).toBe("ORA-00942: table or view does not exist");
  });

  it("accepts a structured error object with a numeric code", () => {
    const info = describeOracleImportError({ code: 12154, message: "TNS:could not resolve the connect identifier specified" });

    expect(info.isOracle).toBe(true);
    expect(info.code).toBe("ORA-12154");
    expect(info.title).toBe("TNS name could not be resolved");
    expect(info.detail).toBe("ORA-12154: TNS:could not resolve the connect identifier specified");
  });

  it("unwraps an OracleSidecarError instance to the raw Oracle detail", () => {
    const error = new OracleSidecarError(
      JSON.stringify({ code: 1017, message: "ORA-01017: invalid username/password; logon denied", hint: null }),
    );

    const info = describeOracleImportError(error);

    expect(info.isOracle).toBe(true);
    expect(info.code).toBe("ORA-01017");
    expect(info.title).toBe("Invalid username or password");
    expect(info.detail).toContain("ORA-01017");
  });

  it("keeps an unmapped Oracle code readable while preserving the detail", () => {
    const info = describeOracleImportError("ORA-20001: custom application error raised by trigger");

    expect(info.isOracle).toBe(true);
    expect(info.code).toBe("ORA-20001");
    expect(info.title).toContain("custom application error raised by trigger");
    expect(info.title).not.toContain("ORA-20001");
    expect(info.detail).toBe("ORA-20001: custom application error raised by trigger");
  });

  it("maps DPY driver connection errors", () => {
    const info = describeOracleImportError("DPY-6005: cannot connect to database");

    expect(info.isOracle).toBe(true);
    expect(info.code).toBe("DPY-6005");
    expect(info.title).toBe("Cannot connect to database");
    expect(info.detail).toContain("DPY-6005");
  });

  it("treats plain validation messages as non-Oracle", () => {
    const info = describeOracleImportError("Enter one SELECT statement. Other statements are not supported for import.");

    expect(info.isOracle).toBe(false);
    expect(info.code).toBeNull();
    expect(info.title).toBe("Enter one SELECT statement. Other statements are not supported for import.");
    expect(info.detail).toBeNull();
    expect(info.hint).toBeNull();
  });

  it("treats sidecar lifecycle errors as non-Oracle", () => {
    const info = describeOracleImportError(new Error("Oracle sidecar is not responding. Check that the sidecar is configured correctly."));

    expect(info.isOracle).toBe(false);
    expect(info.title).toContain("sidecar");
    expect(info.detail).toBeNull();
  });

  it("falls back to a generic message for empty input", () => {
    const info = describeOracleImportError(null);

    expect(info.isOracle).toBe(false);
    expect(info.title).toBe("An unknown error occurred.");
  });
});
