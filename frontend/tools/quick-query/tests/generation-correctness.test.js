// Failure modes for generated SQL correctness:
// 1. A BLOB cell or BLOB filename containing a quote ends the SQL literal (broken SQL or injected statements).
// 2. A NUMBER CONFIG_ID used as the match key is replaced by MAX+1, so UPDATE matches nothing and MERGE always inserts.
// 3. A CONFIG_ID match key skips numeric validation because its value used to be discarded.
// 4. A reserved-word column is quoted in most places but left bare in the running-number subquery or ORDER BY.
// 5. An uppercase reserved-word column (as Oracle imports report it) is emitted unquoted.
// 6. A data header with surrounding spaces generates SQL but duplicate detection throws "not found".
// 7. Valid Oracle types (FLOAT, INTEGER, NVARCHAR2, NCHAR, RAW, LONG) are rejected as invalid schema types.
// 8. Accepting those types lets invalid values through (letters in INTEGER, too long NVARCHAR2, non-hex RAW).
import { describe, expect, it, vi } from "vitest";
import { QueryGenerationService } from "../services/QueryGenerationService.js";
import { ValueProcessorService } from "../services/ValueProcessorService.js";
import { SchemaValidationService } from "../services/SchemaValidationService.js";
import { collectInputIssues } from "../services/InputValidationService.js";

vi.mock("../../../core/UsageTracker.js", () => ({ UsageTracker: { track() {}, trackEvent() {}, flushSync() {} } }));

const svc = new QueryGenerationService();
const values = new ValueProcessorService();
const blobSchema = [
  ["id", "NUMBER", "No", "", "", "Yes"],
  ["doc", "BLOB", "Yes", "", "", ""],
];

describe("BLOB literals", () => {
  it("escapes quotes in BLOB text so a cell cannot end the literal", () => {
    const sql = svc.generateQuery(
      "s.t",
      "insert",
      blobSchema,
      [
        ["id", "doc"],
        ["1", "x')); DELETE FROM s.t; --"],
      ],
      [],
    );
    expect(sql).toContain("utl_raw.cast_to_raw('x'')); DELETE FROM s.t; --')");
    expect(sql).not.toMatch(/cast_to_raw\('x'\)\);/);
  });

  it("escapes quotes in attachment filenames kept for later", () => {
    const attachment = { name: "John's.pdf", type: "application/pdf", processedFormats: { base64: "data:application/pdf;base64,QUJD" } };
    const sql = svc.generateQuery(
      "s.t",
      "insert",
      blobSchema,
      [
        ["id", "doc"],
        ["1", "John's.pdf"],
      ],
      [attachment],
      {
        blobAttachmentMode: "filename",
      },
    );
    expect(sql).toContain("utl_raw.cast_to_raw('John''s.pdf')");
  });
});

describe("CONFIG_ID as the match key", () => {
  const schema = [
    ["config_id", "NUMBER", "No", "", "", "Yes"],
    ["name", "VARCHAR2(10)", "Yes", "", "", ""],
  ];

  it("matches UPDATE rows by the entered CONFIG_ID", () => {
    const sql = svc.generateQuery(
      "s.feature_flags",
      "update",
      schema,
      [
        ["config_id", "name"],
        ["42", "x"],
      ],
      [],
    );
    expect(sql).toContain("WHERE config_id = 42;");
    expect(sql).not.toContain("MAX(config_id)");
  });

  it("matches MERGE rows by the entered CONFIG_ID", () => {
    const sql = svc.generateQuery(
      "s.feature_flags",
      "merge",
      schema,
      [
        ["config_id", "name"],
        ["42", "x"],
      ],
      [],
    );
    expect(sql).toContain("42 AS config_id");
    expect(sql).not.toContain("MAX(config_id)");
    expect(sql).toContain("WHERE config_id IN (42)");
  });

  it("still generates CONFIG_ID for INSERT", () => {
    const sql = svc.generateQuery(
      "s.feature_flags",
      "insert",
      schema,
      [
        ["config_id", "name"],
        ["42", "x"],
      ],
      [],
    );
    expect(sql).toContain("(SELECT NVL(MAX(config_id)+1, 1) FROM s.feature_flags)");
  });

  it("still generates CONFIG_ID when PARAMETER_KEY is the match key", () => {
    const configSchema = [
      ["parameter_key", "VARCHAR2(50)", "No", "", "", "Yes"],
      ["config_id", "NUMBER", "No", "", "", ""],
    ];
    const sql = svc.generateQuery(
      "s.app_config",
      "merge",
      configSchema,
      [
        ["parameter_key", "config_id"],
        ["k", "7"],
      ],
      [],
    );
    expect(sql).toContain("(SELECT NVL(MAX(config_id)+1, 1) FROM s.app_config) AS config_id");
  });

  it("validates a CONFIG_ID match key as a number", () => {
    const { issues } = collectInputIssues({
      schemaData: schema,
      inputData: [
        ["config_id", "name"],
        ["abc", "x"],
      ],
      queryType: "update",
      tableName: "s.feature_flags",
    });
    expect(issues).toEqual([expect.objectContaining({ row: 1, col: 0, type: "invalid_number" })]);
    expect(() =>
      svc.generateQuery(
        "s.feature_flags",
        "update",
        schema,
        [
          ["config_id", "name"],
          ["abc", "x"],
        ],
        [],
      ),
    ).toThrow(/Invalid numeric value/);
  });
});

describe("reserved-word columns", () => {
  it("quotes a lowercase reserved column inside the running-number subquery and ORDER BY", () => {
    const schema = [
      ["number", "NUMBER", "No", "", "", "Yes"],
      ["name", "VARCHAR2(10)", "Yes", "", "", ""],
    ];
    const sql = svc.generateQuery(
      "s.t",
      "merge",
      schema,
      [
        ["number", "name"],
        ["max", "a"],
      ],
      [],
    );
    expect(sql).toContain('(SELECT NVL(MAX("number")+1, 1) FROM s.t) AS "number"');
    expect(sql).toContain('SELECT * FROM s.t ORDER BY "number" DESC FETCH FIRST 1 ROWS ONLY;');
  });

  it("quotes uppercase reserved columns with their stored uppercase name", () => {
    const schema = [
      ["ID", "NUMBER", "No", "", "", "Yes"],
      ["LEVEL", "NUMBER", "Yes", "", "", ""],
      ["COMMENT", "VARCHAR2(10)", "Yes", "", "", ""],
    ];
    const sql = svc.generateQuery(
      "s.t",
      "merge",
      schema,
      [
        ["ID", "LEVEL", "COMMENT"],
        ["1", "2", "x"],
      ],
      [],
    );
    expect(sql).toContain('2 AS "LEVEL"');
    expect(sql).toContain('tgt."COMMENT" = src."COMMENT"');
    expect(sql).toContain('INSERT (id, "LEVEL", "COMMENT")');
  });

  it("keeps ordinary uppercase columns unquoted", () => {
    expect(svc.formatFieldName("NAME")).toBe("name");
    expect(svc.formatFieldName("name")).toBe("name");
    expect(svc.formatFieldName("level")).toBe('"level"');
  });
});

describe("data headers with surrounding spaces", () => {
  it("detects duplicates instead of failing generation", () => {
    const schema = [
      ["id", "NUMBER", "No", "", "", "Yes"],
      ["name", "VARCHAR2(10)", "Yes", "", "", ""],
    ];
    const data = [
      ["id ", " name"],
      ["1", "a"],
      ["1", "b"],
    ];
    expect(() => svc.generateQuery("s.t", "insert", schema, data, [])).not.toThrow();
    expect(svc.detectDuplicatePrimaryKeys(schema, data, "s.t").hasDuplicates).toBe(true);
  });
});

describe("Oracle types reported by schema imports", () => {
  const schemaSvc = new SchemaValidationService();

  it("accepts FLOAT, INTEGER, NVARCHAR2, NCHAR, RAW and LONG", () => {
    for (const type of ["FLOAT", "FLOAT(126)", "INTEGER", "NVARCHAR2(10)", "NCHAR(2)", "RAW(16)", "LONG"]) {
      expect(schemaSvc.isValidOracleDataType(type), type).toBe(true);
    }
    expect(() =>
      schemaSvc.validateSchema(
        [
          ["amount", "FLOAT(126)", "Yes"],
          ["code", "RAW(16)", "No"],
        ],
        "s.t",
      ),
    ).not.toThrow();
  });

  it("validates values for those types", () => {
    expect(values.getConstraintIssue("1.5", "INTEGER", "Yes", "qty")).toMatchObject({ type: "scale_exceeded" });
    expect(values.getConstraintIssue("abc", "INTEGER", "Yes", "qty")).toMatchObject({ type: "invalid_number" });
    expect(values.getConstraintIssue("abc", "FLOAT(126)", "Yes", "rate")).toMatchObject({ type: "invalid_number" });
    expect(values.getConstraintIssue("1.25", "FLOAT(126)", "Yes", "rate")).toBeNull();
    expect(values.getConstraintIssue("ééé", "NVARCHAR2(3)", "Yes", "label")).toBeNull();
    expect(values.getConstraintIssue("éééé", "NVARCHAR2(3)", "Yes", "label")).toMatchObject({ type: "max_length_exceeded", unit: "CHAR" });
    expect(values.getConstraintIssue("0A1B", "RAW(2)", "Yes", "code")).toBeNull();
    expect(values.getConstraintIssue("0A1B2C", "RAW(2)", "Yes", "code")).toMatchObject({ type: "max_length_exceeded" });
    expect(values.getConstraintIssue("XYZ", "RAW(2)", "Yes", "code")).toMatchObject({ type: "invalid_raw" });
  });

  it("generates literals Oracle accepts for those types", () => {
    const schema = [
      ["id", "INTEGER", "No", "", "", "Yes"],
      ["rate", "FLOAT(126)", "Yes", "", "", ""],
      ["label", "NVARCHAR2(10)", "Yes", "", "", ""],
      ["code", "RAW(16)", "Yes", "", "", ""],
      ["notes", "LONG", "Yes", "", "", ""],
    ];
    const sql = svc.generateQuery(
      "s.t",
      "insert",
      schema,
      [
        ["id", "rate", "label", "code", "notes"],
        ["max", "1,5", "O'Neil", "0a1b", "x"],
      ],
      [],
    );
    expect(sql).toContain("VALUES ((SELECT NVL(MAX(id)+1, 1) FROM s.t), 1.5, 'O''Neil', HEXTORAW('0A1B'), 'x');");
  });
});
