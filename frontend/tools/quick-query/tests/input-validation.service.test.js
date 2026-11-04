// Failure cases: wrong row/column after blank rows, empty spare rows reported,
// UPDATE blanks rejected, explicit NULL accepted in required fields, audit defaults ignored,
// UTF-8 bytes confused with characters, header mismatches missed, source data mutated,
// attachment filenames treated as content, repeated live checks emitting analytics, or unbounded issue lists.
import { describe, expect, it, vi } from "vitest";
import { collectInputIssues } from "../services/InputValidationService.js";
import { ValueProcessorService } from "../services/ValueProcessorService.js";
import { UsageTracker } from "../../../core/UsageTracker.js";
vi.mock("../../../core/UsageTracker.js", () => ({ UsageTracker: { trackEvent: vi.fn() } }));
const schema = [
  ["ID", "NUMBER", "No"],
  ["NAME", "VARCHAR2(3 BYTE)", "No"],
];
const check = (inputData, extra = {}) => collectInputIssues({ schemaData: schema, inputData, queryType: "insert", ...extra });

describe("input validation", () => {
  // UPDATE blanks may skip SET fields, but never row-matching keys (including missing key columns).
  it("requires the screenshot's PARAMETER_KEY for UPDATE while allowing blank non-key fields", () => {
    const schemaData = [
      ["CONFIG_ID", "VARCHAR2(36)", "No", "", "1", "No"],
      ["DESCRIPTION", "VARCHAR2(200)", "Yes", "", "2", "No"],
      ["PARAMETER_KEY", "VARCHAR2(100)", "No", "", "3", "Yes"],
    ];
    const inputData = [
      ["CONFIG_ID", "DESCRIPTION", "PARAMETER_KEY"],
      ["uuid", "changed", ""],
      ["", "changed", "banner.image.id"],
    ];
    const result = check(inputData, { schemaData, tableName: "APP.CONFIG", queryType: "update" });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ row: 1, col: 2, type: "missing_primary_key" });
    const missing = check([["DESCRIPTION"], ["changed"]], { schemaData, tableName: "APP.CONFIG", queryType: "update" });
    expect(missing.issues).toContainEqual(expect.objectContaining({ type: "header", message: "Missing key field: PARAMETER_KEY" }));
  });

  it("requires every component of a composite UPDATE key", () => {
    const schemaData = [
      ["ID", "NUMBER", "No", "", "1", "Yes"],
      ["CODE", "VARCHAR2(10)", "No", "", "2", "Yes"],
    ];
    expect(
      check(
        [
          ["ID", "CODE"],
          ["1", ""],
        ],
        { schemaData, queryType: "update" },
      ).issues[0],
    ).toMatchObject({ row: 1, col: 1, type: "missing_primary_key" });
  });
  // Numeric/date preflight must agree with generation, preserve special SQL tokens,
  // reject partial numeric strings, and avoid counting errors while users edit.
  it("collects numeric format, precision, scale and date errors together", () => {
    const schemaData = [
      ["AMOUNT", "NUMBER(4,2)", "No"],
      ["WHOLE", "NUMBER(2)", "No"],
      ["WHEN", "DATE", "No"],
    ];
    const data = [
      ["AMOUNT", "WHOLE", "WHEN"],
      ["1.234", "123", "not-a-date"],
      ["text", "1", "2026-11-04"],
    ];
    const { issues } = check(data, { schemaData });
    expect(issues.map((x) => [x.row, x.col, x.type])).toEqual([
      [1, 0, "scale_exceeded"],
      [1, 1, "precision_exceeded"],
      [1, 2, "invalid_timestamp"],
      [2, 0, "invalid_number"],
    ]);
  });

  it("rejects partial numeric strings and non-finite numbers in preflight and generation", () => {
    const schemaData = [["ID", "NUMBER", "No"]];
    const processor = new ValueProcessorService();
    for (const value of ["12abc", "Infinity", "1e999", "1;DROP TABLE TEST"]) {
      expect(check([["ID"], [value]], { schemaData }).issues[0].type).toBe("invalid_number");
      expect(() => processor.processValue(value, "NUMBER", "No", "ID", "APP.TEST", "insert")).toThrow(/Invalid numeric/);
    }
  });

  it("preserves numeric separators, audit dates and MAX expressions", () => {
    const schemaData = [
      ["AMOUNT", "NUMBER", "No"],
      ["CONFIG_ID", "NUMBER", "No"],
      ["WHEN", "DATE", "No"],
    ];
    for (const number of ["10,000,000", "10,000.50", "10.000,50", "10,5", "-1.2", "1e3", "max"]) {
      expect(
        check(
          [
            ["AMOUNT", "CONFIG_ID", "WHEN"],
            [number, "anything", "SYSDATE"],
          ],
          { schemaData },
        ).issues,
      ).toEqual([]);
    }
  });

  it("does not emit analytics for numeric or date validation", () => {
    vi.clearAllMocks();
    check([["ID"], ["bad"]], { schemaData: [["ID", "NUMBER(2)", "No"]] });
    check([["WHEN"], ["not-a-date"]], { schemaData: [["WHEN", "DATE", "No"]] });
    expect(UsageTracker.trackEvent).not.toHaveBeenCalled();
  });
  it("collects multiple cell errors at their original coordinates without changing data", () => {
    const data = [
      ["ID", "NAME"],
      [null, null],
      ["1", "éé"],
      ["2", ""],
      [null, null],
    ];
    const before = structuredClone(data);
    const { issues } = check(data);
    expect(issues.map(({ row, col, type }) => [row, col, type])).toEqual([
      [2, 1, "max_length_exceeded"],
      [3, 1, "null_not_allowed"],
    ]);
    expect(issues[0].message).toContain("4 / 3 BYTE");
    expect(data).toEqual(before);
  });

  it("allows empty UPDATE values but rejects explicit NULL for required fields", () => {
    expect(
      check(
        [
          ["ID", "NAME"],
          ["1", ""],
        ],
        { queryType: "update" },
      ).issues,
    ).toEqual([]);
    expect(
      check(
        [
          ["ID", "NAME"],
          ["1", "NULL"],
        ],
        { queryType: "update" },
      ).issues[0].type,
    ).toBe("null_not_allowed");
  });

  it("handles audit defaults and custom audit values consistently with generation", () => {
    const schemaData = [
      ["ID", "NUMBER", "No"],
      ["UPDATED_TIME", "DATE", "No"],
      ["UPDATED_BY", "VARCHAR2(36)", "No"],
    ];
    const inputData = [
      ["ID", "UPDATED_TIME", "UPDATED_BY"],
      ["1", "", ""],
    ];
    expect(check(inputData, { schemaData }).issues).toEqual([]);
    expect(check(inputData, { schemaData, options: { defaultSysdate: false } }).issues.map((x) => x.col)).toEqual([1]);
  });

  it("uses character limits for CHAR declarations", () => {
    const schemaData = [["NAME", "VARCHAR2(3 CHAR)", "No"]];
    expect(check([["NAME"], ["ééé"]], { schemaData }).issues).toEqual([]);
    expect(check([["NAME"], ["abcd"]], { schemaData }).issues[0].message).toContain("4 / 3 CHAR");
  });

  it("finds missing, duplicate and unknown headers before checking values", () => {
    expect(
      check([
        ["ID", ""],
        ["1", "x"],
      ]).issues[0],
    ).toMatchObject({ row: 0, col: 1, type: "header" });
    expect(
      check([
        ["ID", "ID"],
        ["1", "x"],
      ]).issues.some((x) => /Duplicate/.test(x.message)),
    ).toBe(true);
    expect(
      check([
        ["ID", "OTHER"],
        ["1", "x"],
      ]).issues.some((x) => /not in schema/.test(x.message)),
    ).toBe(true);
    expect(check([["ID"], ["1"]]).issues.some((x) => /Missing field: NAME/.test(x.message))).toBe(true);
    expect(check([["ID"], ["1"]], { queryType: "update" }).issues).toEqual([]);
  });

  it("leaves an empty draft quiet and skips trailing blank rows", () => {
    expect(
      check([
        ["ID", "NAME"],
        [null, null],
      ]).issues,
    ).toEqual([]);
    expect(check([[], []], { schemaData: [] }).issues).toEqual([]);
  });

  it("validates attachment content instead of the filename", () => {
    expect(
      check(
        [
          ["ID", "NAME"],
          ["1", "file.txt"],
        ],
        { attachments: [{ name: "file.txt", type: "text/plain", processedFormats: { original: "ok" } }] },
      ).issues,
    ).toEqual([]);
  });

  it("bounds issues for large invalid sheets", () => {
    const result = check([["ID", "NAME"], ...Array.from({ length: 2000 }, () => ["1", "long"])], { limit: 100 });
    expect(result.issues).toHaveLength(100);
    expect(result.truncated).toBe(true);
  });

  it("does not emit analytics during live validation", () => {
    vi.clearAllMocks();
    check([
      ["ID", "NAME"],
      ["1", "long"],
    ]);
    expect(UsageTracker.trackEvent).not.toHaveBeenCalled();
  });

  it("keeps the generation guard and preflight on the same constraints", () => {
    const processor = new ValueProcessorService();
    expect(() => processor.processValue("éé", "VARCHAR2(3 BYTE)", "No", "NAME", "APP.TEST", "insert")).toThrow(/maximum length/);
    expect(() => processor.processValue("", "VARCHAR2(3 BYTE)", "No", "NAME", "APP.TEST", "insert")).toThrow(/NULL value/);
    expect(processor.processValue("", "VARCHAR2(3 BYTE)", "No", "NAME", "APP.TEST", "update")).toBe(null);
  });
});
