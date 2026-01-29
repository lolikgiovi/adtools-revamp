/**
 * Tests for Oracle Sidecar Client
 */

import { describe, it, expect } from "vitest";
import { OracleSidecarError, SidecarStatus } from "../lib/oracle-sidecar-client.js";

describe("OracleSidecarError", () => {
  describe("Oracle error code parsing", () => {
    it("should parse ORA-12154 (TNS name resolution)", () => {
      const error = new OracleSidecarError("ORA-12154: TNS:could not resolve the connect identifier");
      expect(error.message).toBe("TNS name could not be resolved");
      expect(error.code).toBe("ORA-12154");
      expect(error.hint).toBe("Check the connection host/service name is correct.");
    });

    it("should parse ORA-01017 (invalid credentials)", () => {
      const error = new OracleSidecarError("ORA-01017: invalid username/password; logon denied");
      expect(error.message).toBe("Invalid username or password");
      expect(error.code).toBe("ORA-01017");
      expect(error.hint).toContain("credentials");
    });

    it("should parse ORA-12541 (no listener)", () => {
      const error = new OracleSidecarError("ORA-12541: TNS:no listener");
      expect(error.message).toBe("No listener at the specified host/port");
      expect(error.code).toBe("ORA-12541");
    });

    it("should parse ORA-00942 (table not found)", () => {
      const error = new OracleSidecarError("ORA-00942: table or view does not exist");
      expect(error.message).toBe("Table or view does not exist");
      expect(error.code).toBe("ORA-00942");
    });

    it("should parse ORA-28000 (account locked)", () => {
      const error = new OracleSidecarError("ORA-28000: account is locked");
      expect(error.message).toBe("Account is locked");
      expect(error.hint).toContain("DBA");
    });

    it("should parse DPY-6005 (python driver connection error)", () => {
      const error = new OracleSidecarError("DPY-6005: cannot connect to database");
      expect(error.message).toBe("Cannot connect to database");
      expect(error.hint).toContain("network");
    });
  });

  describe("Generic error patterns", () => {
    it("should detect timeout errors", () => {
      const error = new OracleSidecarError("Connection timeout after 30000ms");
      expect(error.message).toBe("Connection timed out");
      expect(error.code).toBe("TIMEOUT");
    });

    it("should detect network errors", () => {
      const error = new OracleSidecarError("Network error: socket closed");
      expect(error.message).toBe("Network error");
      expect(error.code).toBe("NETWORK");
    });

    it("should detect sidecar not responding", () => {
      const error = new OracleSidecarError("Sidecar not responding");
      expect(error.message).toBe("Oracle sidecar is not responding");
      expect(error.code).toBe("SIDECAR");
      expect(error.hint).toContain("restart");
    });

    it("should preserve unknown error messages", () => {
      const error = new OracleSidecarError("Some completely unknown error");
      expect(error.message).toBe("Some completely unknown error");
      expect(error.code).toBeFalsy(); // null or 0, both indicate no specific code
    });
  });

  describe("Error object input", () => {
    it("should handle error object with message", () => {
      const error = new OracleSidecarError({ message: "ORA-01017: invalid credentials" });
      expect(error.message).toBe("Invalid username or password");
    });

    it("should preserve code from error object if no Oracle code found", () => {
      const error = new OracleSidecarError({ message: "custom error", code: 42 });
      expect(error.code).toBe(42);
    });

    it("should preserve hint from error object", () => {
      const error = new OracleSidecarError({ message: "custom error", hint: "Custom hint" });
      expect(error.hint).toBe("Custom hint");
    });
  });

  describe("rawMessage property", () => {
    it("should preserve the original error message", () => {
      const originalMessage = "ORA-12154: TNS:could not resolve the connect identifier specified";
      const error = new OracleSidecarError(originalMessage);
      expect(error.rawMessage).toBe(originalMessage);
      expect(error.message).toBe("TNS name could not be resolved");
    });
  });
});

describe("SidecarStatus", () => {
  it("should have correct status values", () => {
    expect(SidecarStatus.STOPPED).toBe("stopped");
    expect(SidecarStatus.STARTING).toBe("starting");
    expect(SidecarStatus.READY).toBe("ready");
    expect(SidecarStatus.ERROR).toBe("error");
  });
});
