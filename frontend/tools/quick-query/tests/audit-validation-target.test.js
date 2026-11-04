// Failure cases: an override marks unchanged sheet values, floods the issue limit,
// hides ordinary errors, misses implicit UPDATE audit fields, or stays grouped in Off mode.
import { describe, expect, it, vi } from "vitest";
import { collectInputIssues } from "../services/InputValidationService.js";
vi.mock("../../../core/UsageTracker.js", () => ({ UsageTracker: { trackEvent: vi.fn() } }));
const schemaData = [
  ["ID", "NUMBER", "No", "", "1", "Yes"],
  ["CREATED_BY", "VARCHAR2(10)", "No"],
  ["UPDATED_BY", "VARCHAR2(10)", "Yes"],
  ["NAME", "VARCHAR2(3)", "Yes"],
];
const rows = Array.from({ length: 200 }, (_, index) => [String(index), "SYSTEM", "SYSTEM", "ok"]);
const inputData = [["ID", "CREATED_BY", "UPDATED_BY", "NAME"], ...rows];
const check = (extra = {}) => collectInputIssues({ schemaData, inputData, tableName: "APP.TEST", queryType: "insert", ...extra });

describe("audit validation source", () => {
  it("reports an invalid custom override once per field at the audit control", () => {
    const result = check({ options: { auditUserMode: "custom", customAuditUser: "R27_ANTARES_TOO_LONG" } });
    expect(result.truncated).toBe(false);
    expect(result.issues).toHaveLength(2);
    expect(result.issues.map(({ target, field, row, col }) => ({ target, field, row, col }))).toEqual([
      { target: "audit_user", field: "CREATED_BY", row: null, col: null },
      { target: "audit_user", field: "UPDATED_BY", row: null, col: null },
    ]);
  });

  it("keeps errors in actual cells when audit mode is Off", () => {
    const result = check({
      inputData: [
        ["ID", "CREATED_BY", "UPDATED_BY", "NAME"],
        ["1", "TOO_LONG_VALUE", "SYSTEM", "ok"],
      ],
      options: { auditUserMode: "off", customAuditUser: "TOO_LONG_VALUE" },
    });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ row: 1, col: 1 });
    expect(result.issues[0].target).not.toBe("audit_user");
  });

  it("also targets the SYSTEM control when SYSTEM exceeds the schema constraint", () => {
    const result = check({
      schemaData: schemaData.map((row) => (row[0] === "CREATED_BY" ? ["CREATED_BY", "VARCHAR2(3)", "No"] : row)),
      options: { auditUserMode: "system" },
    });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ target: "audit_user", field: "CREATED_BY" });
  });

  it("does not hide an ordinary invalid cell beside an invalid audit override", () => {
    const result = check({
      inputData: [
        ["ID", "CREATED_BY", "UPDATED_BY", "NAME"],
        ["1", "SYSTEM", "SYSTEM", "long"],
      ],
      options: { auditUserMode: "custom", customAuditUser: "TOO_LONG_VALUE" },
    });
    expect(result.issues).toHaveLength(3);
    expect(result.issues.filter((issue) => issue.target !== "audit_user")[0]).toMatchObject({ row: 1, col: 3 });
  });

  it("validates the shared UPDATED_BY that generation appends to a partial UPDATE", () => {
    const result = check({
      queryType: "update",
      inputData: [
        ["ID", "NAME"],
        ["1", "ok"],
      ],
      options: { auditUserMode: "custom", customAuditUser: "TOO_LONG_VALUE" },
    });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ target: "audit_user", field: "UPDATED_BY" });
  });

  it("clears shared issues after correcting the override and leaves source data untouched", () => {
    const before = structuredClone(inputData);
    expect(check({ options: { auditUserMode: "custom", customAuditUser: "R27" } }).issues).toEqual([]);
    expect(inputData).toEqual(before);
  });
});
