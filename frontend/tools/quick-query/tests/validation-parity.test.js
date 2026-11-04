// Failure cases: expanded UUID/audit/attachment content bypasses constraints; attachment
// names hide invalid numbers; nullable aliases or Unicode are rejected; floating-point
// rounding and exponent notation corrupt precision checks; row filtering offsets alerts.
import { describe, it, expect, vi } from "vitest";
import { collectInputIssues } from "../services/InputValidationService.js";
import { QueryGenerationService } from "../services/QueryGenerationService.js";
vi.mock("../../../core/UsageTracker.js", () => ({ UsageTracker: { trackEvent: vi.fn() } }));

function run(type, value, { field = "VALUE", nullable = "No", attachments = [], options = {} } = {}) {
  const schemaData = [
    ["ID", "NUMBER", "No", "", "1", "Yes"],
    [field, type, nullable, "", "2", "No"],
  ];
  const inputData = [
    ["ID", field],
    ["1", value],
  ];
  return {
    issues: collectInputIssues({ schemaData, inputData, queryType: "insert", tableName: "APP.TEST", attachments, options }).issues,
    generate: () => new QueryGenerationService().generateQuery("APP.TEST", "insert", schemaData, inputData, attachments, options),
  };
}

describe("live/generation constraint parity", () => {
  // Audit-user values are quoted literals, including strings that are tokens in ordinary cells.
  it.each(["uuid", "NULL"])("keeps audit user %s literal while applying its actual length", (value) => {
    const result = run("VARCHAR2(4)", value, { field: "CREATED_BY" });
    expect(result.issues).toEqual([]);
    expect(result.generate()).toContain(`'${value.toUpperCase()}'`);
  });
  it.each([
    ["VARCHAR2(3)", "uuid", {}],
    ["VARCHAR2(3)", "ABCDEFG", { field: "CREATED_BY" }],
    ["VARCHAR2(3)", "", { field: "UPDATED_BY", options: { auditUserMode: "system" } }],
    ["VARCHAR2(3)", "", { field: "CREATED_BY", options: { auditUserMode: "custom", customAuditUser: "LONG" } }],
    ["NUMBER(5)", "1e21", {}],
    ["VARCHAR2 (3 BYTE)", "abcdef", {}],
    ["NUMBER", "bad.txt", { attachments: [{ name: "bad.txt", type: "text/plain", processedFormats: { original: "hello" } }] }],
  ])("rejects %s %s both before and during generation", (type, value, options) => {
    const result = run(type, value, options);
    expect(result.issues).toHaveLength(1);
    expect(result.generate).toThrow();
  });

  it.each([
    ["NUMBER(2,2)", "0.12", {}],
    ["NUMBER(20)", "99999999999999999999", {}],
    ["VARCHAR2(3)", "", { nullable: "Y" }],
    ["VARCHAR2(1 CHAR)", "😀", {}],
    ["NUMBER (4, 2)", "12.34", {}],
    ["NUMBER(2,5)", "0.00012", {}],
    ["NUMBER(3,-2)", "12300", {}],
  ])("accepts valid %s %s in both paths", (type, value, options) => {
    const result = run(type, value, options);
    expect(result.issues).toEqual([]);
    expect(result.generate()).toContain("INSERT INTO");
  });

  it("keeps decimal literals intact and ignores trailing fractional zeros for scale", () => {
    expect(run("NUMBER(20)", "99999999999999999999").generate()).toContain("99999999999999999999");
    expect(run("NUMBER(3,2)", "1.2300").issues).toEqual([]);
    expect(run("NUMBER(2,5)", "0.00123").issues).toHaveLength(1);
    expect(run("NUMBER(3,-2)", "12301").issues).toHaveLength(1);
  });

  it("checks expanded attachment content with BYTE and CHAR semantics instead of silently using the filename", () => {
    const attachments = [{ name: "x", type: "text/plain", processedFormats: { original: "éé" } }];
    const invalid = run("VARCHAR2(3 BYTE)", "x", { attachments });
    expect(invalid.issues[0].type).toBe("max_length_exceeded");
    expect(invalid.generate).toThrow(/maximum length/);
    const valid = run("VARCHAR2(2 CHAR)", "x", { attachments });
    expect(valid.issues).toEqual([]);
    expect(valid.generate()).toContain("'éé'");
  });
});

describe("data-sheet row coordinates", () => {
  const service = new QueryGenerationService();
  const schema = [
    ["ID", "NUMBER", "No", "", "1", "Yes"],
    ["NAME", "VARCHAR2(3)", "No", "", "2", "No"],
  ];
  it("numbers duplicates from the first data row and preserves gaps", () => {
    const result = service.detectDuplicatePrimaryKeys(
      schema,
      [
        ["ID", "NAME"],
        ["1", "ok"],
        [null, null],
        ["1", "ok"],
      ],
      "APP.TEST",
    );
    expect(result.duplicates[0].rows).toEqual([1, 3]);
    expect(result.warningMessage.details).toContain("rows: 1, 3");
    expect(result.warningMessage.duplicates[0].columns).toEqual([0]);
  });
  it("reports generation errors at the displayed row after a blank row", () => {
    expect(() =>
      service.generateQuery(
        "APP.TEST",
        "insert",
        schema,
        [
          ["ID", "NAME"],
          ["1", "ok"],
          [null, null],
          ["2", "long"],
        ],
        [],
      ),
    ).toThrow(/Cell B3/);
    expect(() =>
      service.generateQuery(
        "APP.TEST",
        "update",
        schema,
        [
          ["ID", "NAME"],
          ["1", "ok"],
          [null, null],
          ["", "ok"],
        ],
        [],
      ),
    ).toThrow(/Cell A3/);
  });
});
