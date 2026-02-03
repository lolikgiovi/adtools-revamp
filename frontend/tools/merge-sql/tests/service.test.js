/**
 * Unit tests for MergeSqlService
 */
import { describe, it, expect } from "vitest";
import { MergeSqlService } from "../service.js";

describe("MergeSqlService", () => {
  describe("parseFile", () => {
    it("extracts MERGE INTO statements", () => {
      const content = `SET DEFINE OFF;

MERGE INTO SCHEMA.TABLE_NAME t
USING (SELECT 'value1' col1, 'value2' col2 FROM DUAL) s
ON (t.col1 = s.col1)
WHEN MATCHED THEN UPDATE SET t.col2 = s.col2
WHEN NOT MATCHED THEN INSERT (col1, col2) VALUES (s.col1, s.col2);

SELECT * FROM SCHEMA.TABLE_NAME;`;

      const result = MergeSqlService.parseFile(content, "test.sql");

      expect(result.dmlStatements).toHaveLength(1);
      expect(result.dmlStatements[0]).toContain("MERGE INTO");
      expect(result.selectStatements).toHaveLength(1);
      expect(result.selectStatements[0]).toContain("SELECT * FROM");
    });

    it("extracts INSERT INTO statements", () => {
      const content = `SET DEFINE OFF;

INSERT INTO SCHEMA.TABLE_NAME (col1, col2)
VALUES ('value1', 'value2');

SELECT COUNT(*) FROM SCHEMA.TABLE_NAME;`;

      const result = MergeSqlService.parseFile(content, "test.sql");

      expect(result.dmlStatements).toHaveLength(1);
      expect(result.dmlStatements[0]).toContain("INSERT INTO");
      expect(result.selectStatements).toHaveLength(1);
    });

    it("extracts UPDATE statements", () => {
      const content = `SET DEFINE OFF;

UPDATE SCHEMA.TABLE_NAME
SET col1 = 'new_value'
WHERE col2 = 'filter';

SELECT col1 FROM SCHEMA.TABLE_NAME WHERE col2 = 'filter';`;

      const result = MergeSqlService.parseFile(content, "test.sql");

      expect(result.dmlStatements).toHaveLength(1);
      expect(result.dmlStatements[0]).toContain("UPDATE");
      expect(result.selectStatements).toHaveLength(1);
    });

    it("strips SET DEFINE OFF from statements", () => {
      const content = `SET DEFINE OFF;

INSERT INTO SCHEMA.TABLE (col) VALUES ('test');`;

      const result = MergeSqlService.parseFile(content, "test.sql");

      expect(result.dmlStatements).toHaveLength(1);
      expect(result.dmlStatements[0]).not.toContain("SET DEFINE OFF");
    });

    it("skips SELECT with +1 (subquery pattern)", () => {
      const content = `INSERT INTO SCHEMA.TABLE (id, name)
VALUES ((SELECT NVL(MAX(ID)+1, 1) FROM SCHEMA.TABLE), 'test');

SELECT * FROM SCHEMA.TABLE;`;

      const result = MergeSqlService.parseFile(content, "test.sql");

      expect(result.selectStatements).toHaveLength(1);
      expect(result.selectStatements[0]).toContain("SELECT * FROM");
    });

    it("handles empty content", () => {
      const result = MergeSqlService.parseFile("", "empty.sql");

      expect(result.dmlStatements).toHaveLength(0);
      expect(result.selectStatements).toHaveLength(0);
      expect(result.fileName).toBe("empty.sql");
    });

    it("handles multiple statements in one file", () => {
      const content = `SET DEFINE OFF;

MERGE INTO SCHEMA.TABLE1 t USING DUAL ON (1=0) WHEN NOT MATCHED THEN INSERT (col) VALUES ('a');

INSERT INTO SCHEMA.TABLE2 (col) VALUES ('b');

UPDATE SCHEMA.TABLE3 SET col = 'c' WHERE id = 1;

SELECT * FROM SCHEMA.TABLE1;
SELECT * FROM SCHEMA.TABLE2;
SELECT * FROM SCHEMA.TABLE3;`;

      const result = MergeSqlService.parseFile(content, "multi.sql");

      expect(result.dmlStatements).toHaveLength(3);
      expect(result.selectStatements).toHaveLength(3);
    });

    it("handles multiline HTML inside to_clob with semicolons", () => {
      const content = `SET DEFINE OFF;

MERGE INTO SCHEMA.TABLE_NAME t
USING (SELECT 1 id, to_clob('<html>
<head>
  <style>
    body { color: red; }
  </style>
</head>
<body>
  <p>Hello; world;</p>
</body>
</html>') html_content FROM DUAL) s
ON (t.id = s.id)
WHEN MATCHED THEN UPDATE SET t.html_content = s.html_content
WHEN NOT MATCHED THEN INSERT (id, html_content) VALUES (s.id, s.html_content);

SELECT * FROM SCHEMA.TABLE_NAME WHERE id = 1;`;

      const result = MergeSqlService.parseFile(content, "test.sql");

      expect(result.dmlStatements).toHaveLength(1);
      expect(result.dmlStatements[0]).toContain("MERGE INTO");
      expect(result.dmlStatements[0]).toContain("<html>");
      expect(result.dmlStatements[0]).toContain("</html>");
      expect(result.dmlStatements[0]).toContain("Hello; world;");
      expect(result.selectStatements).toHaveLength(1);
    });

    it("handles escaped quotes inside strings", () => {
      const content = `INSERT INTO SCHEMA.TABLE_NAME (col1, col2)
VALUES ('It''s a test', 'another; value');`;

      const result = MergeSqlService.parseFile(content, "test.sql");

      expect(result.dmlStatements).toHaveLength(1);
      expect(result.dmlStatements[0]).toContain("It''s a test");
    });

    it("handles semicolons inside string literals across multiple lines", () => {
      const content = `UPDATE SCHEMA.CONFIG
SET content = 'line1;
line2;
line3;'
WHERE id = 1;

SELECT * FROM SCHEMA.CONFIG;`;

      const result = MergeSqlService.parseFile(content, "test.sql");

      expect(result.dmlStatements).toHaveLength(1);
      expect(result.dmlStatements[0]).toContain("line1;");
      expect(result.dmlStatements[0]).toContain("line2;");
      expect(result.selectStatements).toHaveLength(1);
    });

    it("handles multiple to_clob calls with HTML in same statement", () => {
      const content = `MERGE INTO SCHEMA.EMAIL_TEMPLATE t
USING (SELECT 1 id,
  to_clob('<div>Header;</div>') header_html,
  to_clob('<div>Footer;</div>') footer_html
FROM DUAL) s
ON (t.id = s.id)
WHEN MATCHED THEN UPDATE SET t.header = s.header_html, t.footer = s.footer_html
WHEN NOT MATCHED THEN INSERT (id, header, footer) VALUES (s.id, s.header_html, s.footer_html);`;

      const result = MergeSqlService.parseFile(content, "test.sql");

      expect(result.dmlStatements).toHaveLength(1);
      expect(result.dmlStatements[0]).toContain("Header;</div>");
      expect(result.dmlStatements[0]).toContain("Footer;</div>");
    });

    it("handles complex HTML with CSS containing semicolons", () => {
      const content = `INSERT INTO SCHEMA.TEMPLATE (id, content)
VALUES (1, to_clob('<style>
  body { font-family: Arial; color: #333; }
  .header { background: #007bff; padding: 20px; }
  .btn { border: 1px solid #ccc; margin: 10px; }
</style>
<div class="header">Title</div>'));`;

      const result = MergeSqlService.parseFile(content, "test.sql");

      expect(result.dmlStatements).toHaveLength(1);
      expect(result.dmlStatements[0]).toContain("font-family: Arial;");
      expect(result.dmlStatements[0]).toContain("padding: 20px;");
    });

    it("handles JavaScript code inside HTML with semicolons", () => {
      const content = `MERGE INTO SCHEMA.SCRIPT_CONFIG t
USING (SELECT 'init' code, to_clob('<script>
  var x = 1;
  var y = 2;
  console.log(x + y);
</script>') script FROM DUAL) s
ON (t.code = s.code)
WHEN MATCHED THEN UPDATE SET t.script = s.script
WHEN NOT MATCHED THEN INSERT (code, script) VALUES (s.code, s.script);`;

      const result = MergeSqlService.parseFile(content, "test.sql");

      expect(result.dmlStatements).toHaveLength(1);
      expect(result.dmlStatements[0]).toContain("var x = 1;");
      expect(result.dmlStatements[0]).toContain("console.log(x + y);");
    });

    it("handles multiple statements where one has multiline string", () => {
      const content = `INSERT INTO T1 (col) VALUES ('simple');

UPDATE T2 SET content = 'multi;
line;
content;'
WHERE id = 1;

INSERT INTO T3 (col) VALUES ('after multiline');`;

      const result = MergeSqlService.parseFile(content, "test.sql");

      expect(result.dmlStatements).toHaveLength(3);
      expect(result.dmlStatements[0]).toContain("simple");
      expect(result.dmlStatements[1]).toContain("multi;");
      expect(result.dmlStatements[1]).toContain("line;");
      expect(result.dmlStatements[2]).toContain("after multiline");
    });

    it("handles deeply nested HTML structure with semicolons at various levels", () => {
      const content = `MERGE INTO SCHEMA.PAGE t
USING (SELECT 1 id, to_clob('<div>
  <ul>
    <li style="color: red;">Item 1;</li>
    <li style="color: blue;">Item 2;</li>
    <li>
      <span>Nested; content;</span>
    </li>
  </ul>
</div>') html FROM DUAL) s
ON (t.id = s.id)
WHEN MATCHED THEN UPDATE SET t.html = s.html
WHEN NOT MATCHED THEN INSERT (id, html) VALUES (s.id, s.html);`;

      const result = MergeSqlService.parseFile(content, "test.sql");

      expect(result.dmlStatements).toHaveLength(1);
      expect(result.dmlStatements[0]).toContain("Item 1;</li>");
      expect(result.dmlStatements[0]).toContain("Nested; content;");
    });

    it("handles string ending with semicolon on its own line", () => {
      const content = `INSERT INTO SCHEMA.CONFIG (id, val)
VALUES (1, 'value ending with semicolon on next line
;');

SELECT * FROM SCHEMA.CONFIG;`;

      const result = MergeSqlService.parseFile(content, "test.sql");

      expect(result.dmlStatements).toHaveLength(1);
      expect(result.selectStatements).toHaveLength(1);
    });

    it("handles consecutive escaped quotes with semicolons", () => {
      const content = `INSERT INTO SCHEMA.TABLE (col)
VALUES ('It''s here; and there''s more;');`;

      const result = MergeSqlService.parseFile(content, "test.sql");

      expect(result.dmlStatements).toHaveLength(1);
      expect(result.dmlStatements[0]).toContain("It''s here; and there''s more;");
    });

    it("handles empty string followed by semicolon-containing string", () => {
      const content = `INSERT INTO SCHEMA.TABLE (col1, col2)
VALUES ('', 'has; semicolons;');`;

      const result = MergeSqlService.parseFile(content, "test.sql");

      expect(result.dmlStatements).toHaveLength(1);
      expect(result.dmlStatements[0]).toContain("has; semicolons;");
    });

    it("handles line that is just a closing quote and semicolon", () => {
      const content = `UPDATE SCHEMA.CONFIG
SET content = 'multiline
content
here
';

SELECT * FROM SCHEMA.CONFIG;`;

      const result = MergeSqlService.parseFile(content, "test.sql");

      expect(result.dmlStatements).toHaveLength(1);
      expect(result.selectStatements).toHaveLength(1);
    });
  });

  describe("updateQuoteState", () => {
    it("detects entering a string literal", () => {
      expect(MergeSqlService.updateQuoteState("text 'start of string", false)).toBe(true);
    });

    it("detects exiting a string literal", () => {
      expect(MergeSqlService.updateQuoteState("end of string'", true)).toBe(false);
    });

    it("handles escaped quotes", () => {
      expect(MergeSqlService.updateQuoteState("It''s fine", true)).toBe(true);
    });

    it("handles line with no quotes", () => {
      expect(MergeSqlService.updateQuoteState("no quotes here", false)).toBe(false);
      expect(MergeSqlService.updateQuoteState("still inside string", true)).toBe(true);
    });

    it("handles multiple quotes on same line", () => {
      expect(MergeSqlService.updateQuoteState("'open' and 'close'", false)).toBe(false);
      expect(MergeSqlService.updateQuoteState("'open' then 'still open", false)).toBe(true);
    });

    it("handles triple escaped quotes", () => {
      expect(MergeSqlService.updateQuoteState("'''", false)).toBe(true);
      expect(MergeSqlService.updateQuoteState("text'''more", false)).toBe(true);
    });

    it("handles quadruple escaped quotes (two escaped quotes)", () => {
      expect(MergeSqlService.updateQuoteState("''''", false)).toBe(false);
    });

    it("handles empty string literal", () => {
      expect(MergeSqlService.updateQuoteState("''", false)).toBe(false);
    });

    it("handles line with only whitespace inside string", () => {
      expect(MergeSqlService.updateQuoteState("   ", true)).toBe(true);
    });

    it("handles quote at start of line", () => {
      expect(MergeSqlService.updateQuoteState("'starts here", false)).toBe(true);
    });

    it("handles quote at end of line", () => {
      expect(MergeSqlService.updateQuoteState("ends here'", false)).toBe(true);
      expect(MergeSqlService.updateQuoteState("ends here'", true)).toBe(false);
    });

    it("handles alternating quotes and escaped quotes", () => {
      // 'val''ue' = open quote, val, escaped quote, ue, close quote -> ends outside
      expect(MergeSqlService.updateQuoteState("'val''ue'", false)).toBe(false);
      // 'it''s a ''test''' = open, it, escaped, s a, escaped, test, escaped, close -> ends outside
      expect(MergeSqlService.updateQuoteState("'it''s a ''test'''", false)).toBe(false);
    });
  });

  describe("isValidSelectStatement", () => {
    it("returns true for valid SELECT statements", () => {
      expect(MergeSqlService.isValidSelectStatement("SELECT * FROM TABLE")).toBe(true);
      expect(MergeSqlService.isValidSelectStatement("SELECT COL1, COL2 FROM TABLE")).toBe(true);
      expect(MergeSqlService.isValidSelectStatement("SELECT COUNT(*) FROM TABLE")).toBe(true);
    });

    it("returns false for SELECT with +1", () => {
      expect(MergeSqlService.isValidSelectStatement("SELECT NVL(MAX(ID)+1, 1) FROM TABLE")).toBe(false);
      expect(MergeSqlService.isValidSelectStatement("SELECT MAX(SEQ)+1 FROM TABLE")).toBe(false);
    });

    it("returns false for subquery patterns", () => {
      expect(MergeSqlService.isValidSelectStatement("(SELECT ID FROM OTHER_TABLE)")).toBe(false);
    });

    it("returns false for non-SELECT statements", () => {
      expect(MergeSqlService.isValidSelectStatement("INSERT INTO TABLE")).toBe(false);
      expect(MergeSqlService.isValidSelectStatement("UPDATE TABLE SET")).toBe(false);
    });
  });

  describe("mergeFiles", () => {
    it("combines DML statements from multiple files", () => {
      const parsedFiles = [
        {
          dmlStatements: ["INSERT INTO T1 (c) VALUES (1);"],
          selectStatements: ["SELECT * FROM T1;"],
          fileName: "file1.sql",
        },
        {
          dmlStatements: ["INSERT INTO T2 (c) VALUES (2);"],
          selectStatements: ["SELECT * FROM T2;"],
          fileName: "file2.sql",
        },
      ];

      const result = MergeSqlService.mergeFiles(parsedFiles);

      expect(result.mergedSql).toContain("SET DEFINE OFF;");
      expect(result.mergedSql).toContain("INSERT INTO T1");
      expect(result.mergedSql).toContain("INSERT INTO T2");
      expect(result.mergedSql).toContain("-- file1.sql");
      expect(result.mergedSql).toContain("-- file2.sql");
    });

    it("combines SELECT statements from multiple files", () => {
      const parsedFiles = [
        {
          dmlStatements: [],
          selectStatements: ["SELECT * FROM T1;"],
          fileName: "file1.sql",
        },
        {
          dmlStatements: [],
          selectStatements: ["SELECT * FROM T2;"],
          fileName: "file2.sql",
        },
      ];

      const result = MergeSqlService.mergeFiles(parsedFiles);

      expect(result.selectSql).toContain("SELECT * FROM T1");
      expect(result.selectSql).toContain("SELECT * FROM T2");
    });

    it("detects duplicate DML statements", () => {
      const parsedFiles = [
        {
          dmlStatements: ["INSERT INTO T1 (c) VALUES (1);"],
          selectStatements: [],
          fileName: "file1.sql",
        },
        {
          dmlStatements: ["INSERT INTO T1 (c) VALUES (1);"],
          selectStatements: [],
          fileName: "file2.sql",
        },
      ];

      const result = MergeSqlService.mergeFiles(parsedFiles);

      expect(result.duplicates).toHaveLength(1);
      expect(result.duplicates[0].files).toContain("file1.sql");
      expect(result.duplicates[0].files).toContain("file2.sql");
    });

    it("does not detect duplicates for SELECT statements", () => {
      const parsedFiles = [
        {
          dmlStatements: [],
          selectStatements: ["SELECT * FROM T1;"],
          fileName: "file1.sql",
        },
        {
          dmlStatements: [],
          selectStatements: ["SELECT * FROM T1;"],
          fileName: "file2.sql",
        },
      ];

      const result = MergeSqlService.mergeFiles(parsedFiles);

      expect(result.duplicates).toHaveLength(0);
      expect(result.selectSql).toContain("SELECT * FROM T1");
    });

    it("handles empty input", () => {
      const result = MergeSqlService.mergeFiles([]);

      expect(result.mergedSql).toBe("SET DEFINE OFF;");
      expect(result.selectSql).toBe("");
      expect(result.duplicates).toHaveLength(0);
    });
  });

  describe("normalizeStatement", () => {
    it("removes extra whitespace", () => {
      const stmt = "SELECT   *    FROM   TABLE";
      expect(MergeSqlService.normalizeStatement(stmt)).toBe("select * from table");
    });

    it("converts to lowercase", () => {
      const stmt = "INSERT INTO TABLE (COL) VALUES ('TEST')";
      expect(MergeSqlService.normalizeStatement(stmt)).toBe("insert into table (col) values ('test')");
    });

    it("trims leading and trailing whitespace", () => {
      const stmt = "   SELECT * FROM TABLE   ";
      expect(MergeSqlService.normalizeStatement(stmt)).toBe("select * from table");
    });
  });

  describe("parseFileName", () => {
    it("parses standard file name format", () => {
      const result = MergeSqlService.parseFileName("LIVIN_CARE.MILESTONE_CONFIG_CIS (ANTARES)[LIVIN_CARE_REVAMP].sql");

      expect(result).not.toBeNull();
      expect(result.schemaName).toBe("LIVIN_CARE");
      expect(result.tableName).toBe("MILESTONE_CONFIG_CIS");
      expect(result.squadName).toBe("ANTARES");
      expect(result.featureName).toBe("LIVIN_CARE_REVAMP");
    });

    it("returns null for non-standard format", () => {
      const result = MergeSqlService.parseFileName("simple_file.sql");
      expect(result).toBeNull();
    });

    it("handles spaces in names", () => {
      const result = MergeSqlService.parseFileName("SCHEMA.TABLE (SQUAD NAME)[FEATURE NAME].sql");

      expect(result).not.toBeNull();
      expect(result.squadName).toBe("SQUAD NAME");
      expect(result.featureName).toBe("FEATURE NAME");
    });
  });

  describe("sortFiles", () => {
    const files = [
      { id: "1", file: {}, name: "c_file.sql" },
      { id: "2", file: {}, name: "a_file.sql" },
      { id: "3", file: {}, name: "b_file.sql" },
    ];

    it("sorts ascending", () => {
      const result = MergeSqlService.sortFiles(files, "asc");

      expect(result[0].name).toBe("a_file.sql");
      expect(result[1].name).toBe("b_file.sql");
      expect(result[2].name).toBe("c_file.sql");
    });

    it("sorts descending", () => {
      const result = MergeSqlService.sortFiles(files, "desc");

      expect(result[0].name).toBe("c_file.sql");
      expect(result[1].name).toBe("b_file.sql");
      expect(result[2].name).toBe("a_file.sql");
    });

    it("returns original order for manual", () => {
      const result = MergeSqlService.sortFiles(files, "manual");

      expect(result[0].name).toBe("c_file.sql");
      expect(result[1].name).toBe("a_file.sql");
      expect(result[2].name).toBe("b_file.sql");
    });

    it("does not mutate original array", () => {
      const original = [...files];
      MergeSqlService.sortFiles(files, "asc");

      expect(files[0].name).toBe(original[0].name);
    });
  });

  describe("buildAdjacentGroups", () => {
    it("returns empty array for empty input", () => {
      const result = MergeSqlService.buildAdjacentGroups([]);
      expect(result).toEqual([]);
    });

    it("groups consecutive standard files by SCHEMA.TABLE", () => {
      const parsedFiles = [
        {
          dmlStatements: ["INSERT INTO CONFIG.APP_CONFIG (c) VALUES (1);"],
          selectStatements: ["SELECT * FROM CONFIG.APP_CONFIG;"],
          fileName: "CONFIG.APP_CONFIG (SQUAD1)[FEATURE1].sql",
        },
        {
          dmlStatements: ["INSERT INTO CONFIG.APP_CONFIG (c) VALUES (2);"],
          selectStatements: ["SELECT * FROM CONFIG.APP_CONFIG;"],
          fileName: "CONFIG.APP_CONFIG (SQUAD2)[FEATURE2].sql",
        },
      ];

      const result = MergeSqlService.buildAdjacentGroups(parsedFiles);

      expect(result).toHaveLength(1);
      expect(result[0].groupKey).toBe("CONFIG.APP_CONFIG");
      expect(result[0].isStandard).toBe(true);
      expect(result[0].entries).toHaveLength(2);
      expect(result[0].entries[0].subHeader).toBe("SQUAD1 - FEATURE1");
      expect(result[0].entries[1].subHeader).toBe("SQUAD2 - FEATURE2");
    });

    it("does NOT merge non-adjacent files with same SCHEMA.TABLE", () => {
      const parsedFiles = [
        {
          dmlStatements: ["INSERT INTO CONFIG.APP_CONFIG (c) VALUES (1);"],
          selectStatements: [],
          fileName: "CONFIG.APP_CONFIG (SQUAD1)[FEATURE1].sql",
        },
        {
          dmlStatements: ["INSERT INTO OTHER.TABLE (c) VALUES (1);"],
          selectStatements: [],
          fileName: "OTHER.TABLE (SQUADX)[FEATUREX].sql",
        },
        {
          dmlStatements: ["INSERT INTO CONFIG.APP_CONFIG (c) VALUES (2);"],
          selectStatements: [],
          fileName: "CONFIG.APP_CONFIG (SQUAD2)[FEATURE2].sql",
        },
      ];

      const result = MergeSqlService.buildAdjacentGroups(parsedFiles);

      expect(result).toHaveLength(3);
      expect(result[0].groupKey).toBe("CONFIG.APP_CONFIG");
      expect(result[1].groupKey).toBe("OTHER.TABLE");
      expect(result[2].groupKey).toBe("CONFIG.APP_CONFIG");
    });

    it("non-standard filenames form individual groups", () => {
      const parsedFiles = [
        {
          dmlStatements: ["INSERT INTO T1 (c) VALUES (1);"],
          selectStatements: [],
          fileName: "custom_file.sql",
        },
        {
          dmlStatements: ["INSERT INTO T1 (c) VALUES (2);"],
          selectStatements: [],
          fileName: "custom_file.sql",
        },
      ];

      const result = MergeSqlService.buildAdjacentGroups(parsedFiles);

      // Same non-standard filename still groups adjacently
      expect(result).toHaveLength(1);
      expect(result[0].groupKey).toBe("custom_file.sql");
      expect(result[0].isStandard).toBe(false);
      expect(result[0].entries[0].subHeader).toBeNull();
    });
  });

  describe("mergeFiles grouped output", () => {
    it("consecutive same-table files produce single group header in DML", () => {
      const parsedFiles = [
        {
          dmlStatements: ["INSERT INTO CONFIG.APP_CONFIG (c) VALUES (1);"],
          selectStatements: [],
          fileName: "CONFIG.APP_CONFIG (SQUAD1)[FEATURE1].sql",
        },
        {
          dmlStatements: ["INSERT INTO CONFIG.APP_CONFIG (c) VALUES (2);"],
          selectStatements: [],
          fileName: "CONFIG.APP_CONFIG (SQUAD2)[FEATURE2].sql",
        },
      ];

      const result = MergeSqlService.mergeFiles(parsedFiles);

      // Should have exactly one group header
      const headerMatches = result.mergedSql.match(/-- CONFIG\.APP_CONFIG\n/g);
      expect(headerMatches).toHaveLength(1);
      expect(result.mergedSql).toContain("-- SQUAD1 - FEATURE1");
      expect(result.mergedSql).toContain("-- SQUAD2 - FEATURE2");
      expect(result.mergedSql).toContain("SET DEFINE OFF;");
    });

    it("non-adjacent same-table files produce separate group headers", () => {
      const parsedFiles = [
        {
          dmlStatements: ["INSERT INTO CONFIG.APP_CONFIG (c) VALUES (1);"],
          selectStatements: [],
          fileName: "CONFIG.APP_CONFIG (SQUAD1)[FEATURE1].sql",
        },
        {
          dmlStatements: ["INSERT INTO OTHER.TABLE_NAME (c) VALUES (1);"],
          selectStatements: [],
          fileName: "OTHER.TABLE_NAME (SQUADX)[FEATUREX].sql",
        },
        {
          dmlStatements: ["INSERT INTO CONFIG.APP_CONFIG (c) VALUES (2);"],
          selectStatements: [],
          fileName: "CONFIG.APP_CONFIG (SQUAD2)[FEATURE2].sql",
        },
      ];

      const result = MergeSqlService.mergeFiles(parsedFiles);

      const headerMatches = result.mergedSql.match(/-- CONFIG\.APP_CONFIG\n/g);
      expect(headerMatches).toHaveLength(2);
      expect(result.mergedSql).toContain("-- OTHER.TABLE_NAME");
    });

    it("SELECT output includes SELECT * FROM SCHEMA.TABLE with concatenated WHERE for standard filenames with multiple squads", () => {
      const parsedFiles = [
        {
          dmlStatements: [],
          selectStatements: ["SELECT col1 FROM CONFIG.APP_CONFIG WHERE id = 1;"],
          fileName: "CONFIG.APP_CONFIG (SQUAD1)[FEATURE1].sql",
        },
        {
          dmlStatements: [],
          selectStatements: ["SELECT col2 FROM CONFIG.APP_CONFIG WHERE id = 2;"],
          fileName: "CONFIG.APP_CONFIG (SQUAD2)[FEATURE2].sql",
        },
      ];

      const result = MergeSqlService.mergeFiles(parsedFiles);

      expect(result.selectSql).toContain(
        "--====================================================================================================",
      );
      expect(result.selectSql).toContain("-- CONFIG.APP_CONFIG");
      expect(result.selectSql).toContain("SELECT * FROM CONFIG.APP_CONFIG WHERE (id = 1) OR (id = 2);");
      expect(result.selectSql).toContain("-- SQUAD1 - FEATURE1");
      expect(result.selectSql).toContain("-- SQUAD2 - FEATURE2");
    });

    it("SELECT output does NOT include merged SELECT when only one squad for a table", () => {
      const parsedFiles = [
        {
          dmlStatements: [],
          selectStatements: ["SELECT col1 FROM CONFIG.APP_CONFIG WHERE id = 1;"],
          fileName: "CONFIG.APP_CONFIG (SQUAD1)[FEATURE1].sql",
        },
      ];

      const result = MergeSqlService.mergeFiles(parsedFiles);

      expect(result.selectSql).toContain(
        "--====================================================================================================",
      );
      expect(result.selectSql).toContain("-- CONFIG.APP_CONFIG");
      expect(result.selectSql).toContain("-- SQUAD1 - FEATURE1");
      expect(result.selectSql).not.toContain("SELECT * FROM CONFIG.APP_CONFIG WHERE (id = 1);");
    });

    it("SELECT output does NOT include auto-generated SELECT for non-standard filenames", () => {
      const parsedFiles = [
        {
          dmlStatements: [],
          selectStatements: ["SELECT * FROM T1;"],
          fileName: "custom_file.sql",
        },
      ];

      const result = MergeSqlService.mergeFiles(parsedFiles);

      expect(result.selectSql).toContain("-- custom_file.sql");
      // Should not have a second SELECT * FROM line (only the original statement)
      const selectFromMatches = result.selectSql.match(/SELECT \* FROM/g);
      expect(selectFromMatches).toHaveLength(1);
    });

    it("handles mixed standard and non-standard filenames", () => {
      const parsedFiles = [
        {
          dmlStatements: ["INSERT INTO CONFIG.APP_CONFIG (c) VALUES (1);"],
          selectStatements: ["SELECT col1 FROM CONFIG.APP_CONFIG;"],
          fileName: "CONFIG.APP_CONFIG (SQUAD1)[FEATURE1].sql",
        },
        {
          dmlStatements: ["INSERT INTO T2 (c) VALUES (2);"],
          selectStatements: ["SELECT * FROM T2;"],
          fileName: "custom_file.sql",
        },
      ];

      const result = MergeSqlService.mergeFiles(parsedFiles);

      // DML: standard group has schema.table header + sub-header with box format
      expect(result.mergedSql).toContain(
        "--====================================================================================================",
      );
      expect(result.mergedSql).toContain("-- CONFIG.APP_CONFIG");
      expect(result.mergedSql).toContain("-- SQUAD1 - FEATURE1");
      // DML: non-standard group has filename header, no sub-header
      expect(result.mergedSql).toContain("-- custom_file.sql");

      // SELECT: standard group with only one squad does NOT have auto-generated SELECT * FROM
      expect(result.selectSql).not.toContain("SELECT * FROM CONFIG.APP_CONFIG;");
      expect(result.selectSql).toContain("SELECT col1 FROM CONFIG.APP_CONFIG;");
      // SELECT: non-standard group does NOT have auto-generated SELECT
      expect(result.selectSql).toContain("-- custom_file.sql");
    });

    it("skips groups with no DML statements in merged output", () => {
      const parsedFiles = [
        {
          dmlStatements: [],
          selectStatements: ["SELECT * FROM T1;"],
          fileName: "CONFIG.APP_CONFIG (SQUAD1)[FEATURE1].sql",
        },
      ];

      const result = MergeSqlService.mergeFiles(parsedFiles);

      // mergedSql should only have SET DEFINE OFF since there are no DML statements
      expect(result.mergedSql).toBe("SET DEFINE OFF;");
      // selectSql should still have content
      expect(result.selectSql).toContain("SELECT * FROM T1;");
    });

    it("skips groups with no SELECT statements in select output", () => {
      const parsedFiles = [
        {
          dmlStatements: ["INSERT INTO T1 (c) VALUES (1);"],
          selectStatements: [],
          fileName: "CONFIG.APP_CONFIG (SQUAD1)[FEATURE1].sql",
        },
      ];

      const result = MergeSqlService.mergeFiles(parsedFiles);

      expect(result.mergedSql).toContain("INSERT INTO T1");
      expect(result.selectSql).toBe("");
    });

    it("returns report with statementCounts, squadCounts, featureCounts, tableSquadCounts, nonSystemAuthors, and dangerousStatements", () => {
      const parsedFiles = [
        {
          dmlStatements: ["INSERT INTO CONFIG.APP_CONFIG (c) VALUES (1);"],
          selectStatements: [],
          fileName: "CONFIG.APP_CONFIG (SQUAD1)[FEATURE1].sql",
        },
      ];

      const result = MergeSqlService.mergeFiles(parsedFiles);

      expect(result.report).toBeDefined();
      expect(result.report.statementCounts).toBeInstanceOf(Array);
      expect(result.report.squadCounts).toBeInstanceOf(Array);
      expect(result.report.featureCounts).toBeInstanceOf(Array);
      expect(result.report.tableSquadCounts).toBeInstanceOf(Array);
      expect(result.report.nonSystemAuthors).toBeInstanceOf(Array);
      expect(result.report.dangerousStatements).toBeInstanceOf(Array);

      // Verify featureCounts entries have squad field
      expect(result.report.featureCounts[0].squad).toBe("SQUAD1");

      // Verify tableSquadCounts has correct data
      expect(result.report.tableSquadCounts).toHaveLength(1);
      expect(result.report.tableSquadCounts[0].table.toUpperCase()).toBe("CONFIG.APP_CONFIG");
      expect(result.report.tableSquadCounts[0].squad).toBe("SQUAD1");
    });
  });

  describe("analyzeStatements", () => {
    it("counts INSERT/MERGE/UPDATE correctly across multiple files", () => {
      const parsedFiles = [
        {
          dmlStatements: [
            "INSERT INTO SCHEMA.TABLE_A (c) VALUES (1);",
            "MERGE INTO SCHEMA.TABLE_A t USING DUAL ON (1=0) WHEN NOT MATCHED THEN INSERT (c) VALUES ('a');",
          ],
          selectStatements: [],
          fileName: "file1.sql",
        },
        {
          dmlStatements: ["UPDATE SCHEMA.TABLE_A SET c = 2 WHERE id = 1;", "INSERT INTO SCHEMA.TABLE_B (c) VALUES (3);"],
          selectStatements: [],
          fileName: "file2.sql",
        },
      ];

      const { tableCounts } = MergeSqlService.analyzeStatements(parsedFiles);

      expect(tableCounts).toHaveLength(2);

      const tableA = tableCounts.find((r) => r.table.toUpperCase() === "SCHEMA.TABLE_A");
      expect(tableA.insert).toBe(1);
      expect(tableA.merge).toBe(1);
      expect(tableA.update).toBe(1);
      expect(tableA.total).toBe(3);

      const tableB = tableCounts.find((r) => r.table.toUpperCase() === "SCHEMA.TABLE_B");
      expect(tableB.insert).toBe(1);
      expect(tableB.merge).toBe(0);
      expect(tableB.update).toBe(0);
      expect(tableB.total).toBe(1);
    });

    it("groups by table name case-insensitively", () => {
      const parsedFiles = [
        {
          dmlStatements: ["INSERT INTO Schema.Table_A (c) VALUES (1);", "INSERT INTO SCHEMA.TABLE_A (c) VALUES (2);"],
          selectStatements: [],
          fileName: "file1.sql",
        },
      ];

      const { tableCounts } = MergeSqlService.analyzeStatements(parsedFiles);

      expect(tableCounts).toHaveLength(1);
      expect(tableCounts[0].insert).toBe(2);
    });

    it("handles empty input", () => {
      const result = MergeSqlService.analyzeStatements([]);
      expect(result.tableCounts).toEqual([]);
      expect(result.squadCounts).toEqual([]);
      expect(result.featureCounts).toEqual([]);
    });

    it("handles mixed statement types for same table", () => {
      const parsedFiles = [
        {
          dmlStatements: [
            "INSERT INTO T1 (c) VALUES (1);",
            "MERGE INTO T1 t USING DUAL ON (1=0) WHEN NOT MATCHED THEN INSERT (c) VALUES ('a');",
            "UPDATE T1 SET c = 2 WHERE id = 1;",
          ],
          selectStatements: [],
          fileName: "file1.sql",
        },
      ];

      const { tableCounts } = MergeSqlService.analyzeStatements(parsedFiles);

      expect(tableCounts).toHaveLength(1);
      expect(tableCounts[0].insert).toBe(1);
      expect(tableCounts[0].merge).toBe(1);
      expect(tableCounts[0].update).toBe(1);
      expect(tableCounts[0].total).toBe(3);
    });

    it("strips column list parentheses from table name", () => {
      const parsedFiles = [
        {
          dmlStatements: ["INSERT INTO SCHEMA.TABLE_A(col1, col2) VALUES (1, 2);"],
          selectStatements: [],
          fileName: "file1.sql",
        },
      ];

      const { tableCounts } = MergeSqlService.analyzeStatements(parsedFiles);

      expect(tableCounts).toHaveLength(1);
      expect(tableCounts[0].table).toBe("SCHEMA.TABLE_A");
    });

    it("sorts output alphabetically by table name", () => {
      const parsedFiles = [
        {
          dmlStatements: [
            "INSERT INTO Z_TABLE (c) VALUES (1);",
            "INSERT INTO A_TABLE (c) VALUES (2);",
            "INSERT INTO M_TABLE (c) VALUES (3);",
          ],
          selectStatements: [],
          fileName: "file1.sql",
        },
      ];

      const { tableCounts } = MergeSqlService.analyzeStatements(parsedFiles);

      expect(tableCounts[0].table).toBe("A_TABLE");
      expect(tableCounts[1].table).toBe("M_TABLE");
      expect(tableCounts[2].table).toBe("Z_TABLE");
    });

    it("counts DELETE statements in per-table breakdown", () => {
      const parsedFiles = [
        {
          dmlStatements: ["DELETE FROM SCHEMA.TABLE_A WHERE id = 1;", "INSERT INTO SCHEMA.TABLE_A (c) VALUES (1);"],
          selectStatements: [],
          fileName: "file1.sql",
        },
      ];

      const { tableCounts } = MergeSqlService.analyzeStatements(parsedFiles);

      expect(tableCounts).toHaveLength(1);
      expect(tableCounts[0].delete).toBe(1);
      expect(tableCounts[0].insert).toBe(1);
      expect(tableCounts[0].total).toBe(2);
    });

    it("returns squadCounts grouped by squad from file names", () => {
      const parsedFiles = [
        {
          dmlStatements: ["INSERT INTO SCHEMA.TABLE_A (c) VALUES (1);"],
          selectStatements: [],
          fileName: "SCHEMA.TABLE_A (ALPHA)[FEATURE1].sql",
        },
        {
          dmlStatements: ["UPDATE SCHEMA.TABLE_B SET c = 2 WHERE id = 1;"],
          selectStatements: [],
          fileName: "SCHEMA.TABLE_B (ALPHA)[FEATURE2].sql",
        },
        {
          dmlStatements: ["INSERT INTO SCHEMA.TABLE_C (c) VALUES (3);"],
          selectStatements: [],
          fileName: "SCHEMA.TABLE_C (BETA)[FEATURE3].sql",
        },
      ];

      const { squadCounts } = MergeSqlService.analyzeStatements(parsedFiles);

      expect(squadCounts).toHaveLength(2);
      const alpha = squadCounts.find((s) => s.squad === "ALPHA");
      expect(alpha.insert).toBe(1);
      expect(alpha.update).toBe(1);
      expect(alpha.total).toBe(2);

      const beta = squadCounts.find((s) => s.squad === "BETA");
      expect(beta.insert).toBe(1);
      expect(beta.total).toBe(1);
    });

    it("returns featureCounts grouped by feature from file names", () => {
      const parsedFiles = [
        {
          dmlStatements: [
            "INSERT INTO SCHEMA.TABLE_A (c) VALUES (1);",
            "MERGE INTO SCHEMA.TABLE_A t USING DUAL ON (1=0) WHEN NOT MATCHED THEN INSERT (c) VALUES ('a');",
          ],
          selectStatements: [],
          fileName: "SCHEMA.TABLE_A (SQUAD1)[MY_FEATURE].sql",
        },
        {
          dmlStatements: ["INSERT INTO SCHEMA.TABLE_B (c) VALUES (2);"],
          selectStatements: [],
          fileName: "SCHEMA.TABLE_B (SQUAD2)[OTHER_FEATURE].sql",
        },
      ];

      const { featureCounts } = MergeSqlService.analyzeStatements(parsedFiles);

      expect(featureCounts).toHaveLength(2);
      const myFeature = featureCounts.find((f) => f.feature === "MY_FEATURE");
      expect(myFeature.insert).toBe(1);
      expect(myFeature.merge).toBe(1);
      expect(myFeature.total).toBe(2);

      const otherFeature = featureCounts.find((f) => f.feature === "OTHER_FEATURE");
      expect(otherFeature.insert).toBe(1);
      expect(otherFeature.total).toBe(1);
    });

    it("excludes non-standard file names from squad/feature counts", () => {
      const parsedFiles = [
        {
          dmlStatements: ["INSERT INTO T1 (c) VALUES (1);"],
          selectStatements: [],
          fileName: "custom_file.sql",
        },
      ];

      const { squadCounts, featureCounts } = MergeSqlService.analyzeStatements(parsedFiles);

      expect(squadCounts).toHaveLength(0);
      expect(featureCounts).toHaveLength(0);
    });

    it("returns tableSquadCounts with per-table per-squad breakdown", () => {
      const parsedFiles = [
        {
          dmlStatements: ["INSERT INTO SCHEMA.TABLE_A (c) VALUES (1);"],
          selectStatements: [],
          fileName: "SCHEMA.TABLE_A (ALPHA)[FEATURE1].sql",
        },
        {
          dmlStatements: ["INSERT INTO SCHEMA.TABLE_A (c) VALUES (2);", "UPDATE SCHEMA.TABLE_A SET c = 3 WHERE id = 1;"],
          selectStatements: [],
          fileName: "SCHEMA.TABLE_A (BETA)[FEATURE2].sql",
        },
        {
          dmlStatements: ["MERGE INTO SCHEMA.TABLE_B t USING DUAL ON (1=0) WHEN NOT MATCHED THEN INSERT (c) VALUES ('x');"],
          selectStatements: [],
          fileName: "SCHEMA.TABLE_B (ALPHA)[FEATURE3].sql",
        },
      ];

      const { tableSquadCounts } = MergeSqlService.analyzeStatements(parsedFiles);

      expect(tableSquadCounts).toHaveLength(3);

      const tableAAlpha = tableSquadCounts.find((r) => r.table.toUpperCase() === "SCHEMA.TABLE_A" && r.squad.toUpperCase() === "ALPHA");
      expect(tableAAlpha).toBeDefined();
      expect(tableAAlpha.insert).toBe(1);
      expect(tableAAlpha.total).toBe(1);

      const tableABeta = tableSquadCounts.find((r) => r.table.toUpperCase() === "SCHEMA.TABLE_A" && r.squad.toUpperCase() === "BETA");
      expect(tableABeta).toBeDefined();
      expect(tableABeta.insert).toBe(1);
      expect(tableABeta.update).toBe(1);
      expect(tableABeta.total).toBe(2);

      const tableBAlpha = tableSquadCounts.find((r) => r.table.toUpperCase() === "SCHEMA.TABLE_B" && r.squad.toUpperCase() === "ALPHA");
      expect(tableBAlpha).toBeDefined();
      expect(tableBAlpha.merge).toBe(1);
      expect(tableBAlpha.total).toBe(1);
    });

    it("returns empty tableSquadCounts for non-standard file names", () => {
      const parsedFiles = [
        {
          dmlStatements: ["INSERT INTO T1 (c) VALUES (1);"],
          selectStatements: [],
          fileName: "custom_file.sql",
        },
      ];

      const { tableSquadCounts } = MergeSqlService.analyzeStatements(parsedFiles);

      expect(tableSquadCounts).toHaveLength(0);
    });

    it("sorts tableSquadCounts by table then squad", () => {
      const parsedFiles = [
        {
          dmlStatements: ["INSERT INTO Z_TABLE (c) VALUES (1);"],
          selectStatements: [],
          fileName: "SCHEMA.Z_TABLE (BETA)[F1].sql",
        },
        {
          dmlStatements: ["INSERT INTO A_TABLE (c) VALUES (2);"],
          selectStatements: [],
          fileName: "SCHEMA.A_TABLE (BETA)[F2].sql",
        },
        {
          dmlStatements: ["INSERT INTO A_TABLE (c) VALUES (3);"],
          selectStatements: [],
          fileName: "SCHEMA.A_TABLE (ALPHA)[F3].sql",
        },
      ];

      const { tableSquadCounts } = MergeSqlService.analyzeStatements(parsedFiles);

      expect(tableSquadCounts[0].table.toUpperCase()).toContain("A_TABLE");
      expect(tableSquadCounts[0].squad.toUpperCase()).toBe("ALPHA");
      expect(tableSquadCounts[1].table.toUpperCase()).toContain("A_TABLE");
      expect(tableSquadCounts[1].squad.toUpperCase()).toBe("BETA");
      expect(tableSquadCounts[2].table.toUpperCase()).toContain("Z_TABLE");
    });

    it("includes squad field in featureCounts entries", () => {
      const parsedFiles = [
        {
          dmlStatements: ["INSERT INTO SCHEMA.TABLE_A (c) VALUES (1);"],
          selectStatements: [],
          fileName: "SCHEMA.TABLE_A (ALPHA)[MY_FEATURE].sql",
        },
        {
          dmlStatements: ["INSERT INTO SCHEMA.TABLE_B (c) VALUES (2);"],
          selectStatements: [],
          fileName: "SCHEMA.TABLE_B (BETA)[OTHER_FEATURE].sql",
        },
      ];

      const { featureCounts } = MergeSqlService.analyzeStatements(parsedFiles);

      expect(featureCounts).toHaveLength(2);
      const myFeature = featureCounts.find((f) => f.feature === "MY_FEATURE");
      expect(myFeature.squad).toBe("ALPHA");

      const otherFeature = featureCounts.find((f) => f.feature === "OTHER_FEATURE");
      expect(otherFeature.squad).toBe("BETA");
    });

    it("returns tableSquadFeatureCounts with table+squad+feature breakdown", () => {
      const parsedFiles = [
        {
          dmlStatements: ["INSERT INTO SCHEMA.TABLE_A (c) VALUES (1);"],
          selectStatements: [],
          fileName: "SCHEMA.TABLE_A (ALPHA)[FEATURE1].sql",
        },
        {
          dmlStatements: ["INSERT INTO SCHEMA.TABLE_A (c) VALUES (2);"],
          selectStatements: [],
          fileName: "SCHEMA.TABLE_A (ALPHA)[FEATURE2].sql",
        },
        {
          dmlStatements: ["UPDATE SCHEMA.TABLE_A SET c = 3 WHERE id = 1;"],
          selectStatements: [],
          fileName: "SCHEMA.TABLE_A (BETA)[FEATURE3].sql",
        },
      ];

      const { tableSquadFeatureCounts } = MergeSqlService.analyzeStatements(parsedFiles);

      expect(tableSquadFeatureCounts.length).toBeGreaterThanOrEqual(3);

      const alphaFeature1 = tableSquadFeatureCounts.find(
        (r) => r.table.toUpperCase() === "SCHEMA.TABLE_A" && r.squad.toUpperCase() === "ALPHA" && r.feature === "FEATURE1",
      );
      expect(alphaFeature1).toBeDefined();
      expect(alphaFeature1.insert).toBe(1);
      expect(alphaFeature1.total).toBe(1);

      const alphaFeature2 = tableSquadFeatureCounts.find(
        (r) => r.table.toUpperCase() === "SCHEMA.TABLE_A" && r.squad.toUpperCase() === "ALPHA" && r.feature === "FEATURE2",
      );
      expect(alphaFeature2).toBeDefined();
      expect(alphaFeature2.insert).toBe(1);

      const betaFeature3 = tableSquadFeatureCounts.find(
        (r) => r.table.toUpperCase() === "SCHEMA.TABLE_A" && r.squad.toUpperCase() === "BETA" && r.feature === "FEATURE3",
      );
      expect(betaFeature3).toBeDefined();
      expect(betaFeature3.update).toBe(1);
    });

    it("returns squadTableCounts with squad+table breakdown", () => {
      const parsedFiles = [
        {
          dmlStatements: ["INSERT INTO SCHEMA.TABLE_A (c) VALUES (1);"],
          selectStatements: [],
          fileName: "SCHEMA.TABLE_A (ALPHA)[F1].sql",
        },
        {
          dmlStatements: ["INSERT INTO SCHEMA.TABLE_B (c) VALUES (2);"],
          selectStatements: [],
          fileName: "SCHEMA.TABLE_B (ALPHA)[F2].sql",
        },
        {
          dmlStatements: ["UPDATE SCHEMA.TABLE_C SET c = 3 WHERE id = 1;"],
          selectStatements: [],
          fileName: "SCHEMA.TABLE_C (BETA)[F3].sql",
        },
      ];

      const { squadTableCounts } = MergeSqlService.analyzeStatements(parsedFiles);

      expect(squadTableCounts.length).toBe(3);

      const alphaTableA = squadTableCounts.find((r) => r.squad.toUpperCase() === "ALPHA" && r.table.toUpperCase() === "SCHEMA.TABLE_A");
      expect(alphaTableA).toBeDefined();
      expect(alphaTableA.insert).toBe(1);

      const alphaTableB = squadTableCounts.find((r) => r.squad.toUpperCase() === "ALPHA" && r.table.toUpperCase() === "SCHEMA.TABLE_B");
      expect(alphaTableB).toBeDefined();
      expect(alphaTableB.insert).toBe(1);

      const betaTableC = squadTableCounts.find((r) => r.squad.toUpperCase() === "BETA" && r.table.toUpperCase() === "SCHEMA.TABLE_C");
      expect(betaTableC).toBeDefined();
      expect(betaTableC.update).toBe(1);
    });
  });

  describe("detectNonSystemAuthors", () => {
    it("detects non-SYSTEM value in UPDATE SET clause", () => {
      const parsedFiles = [
        {
          dmlStatements: ["UPDATE SCHEMA.TABLE SET CREATED_BY = 'ADMIN', col1 = 'x' WHERE id = 1;"],
          selectStatements: [],
          fileName: "file1.sql",
        },
      ];

      const result = MergeSqlService.detectNonSystemAuthors(parsedFiles);

      expect(result).toHaveLength(1);
      expect(result[0].fileName).toBe("file1.sql");
      expect(result[0].field).toBe("CREATED_BY");
      expect(result[0].value).toBe("ADMIN");
    });

    it("detects non-SYSTEM value in MERGE SET clause", () => {
      const parsedFiles = [
        {
          dmlStatements: [
            "MERGE INTO SCHEMA.TABLE t USING DUAL ON (1=0) WHEN MATCHED THEN UPDATE SET UPDATED_BY = 'john' WHEN NOT MATCHED THEN INSERT (c) VALUES ('a');",
          ],
          selectStatements: [],
          fileName: "file1.sql",
        },
      ];

      const result = MergeSqlService.detectNonSystemAuthors(parsedFiles);

      expect(result).toHaveLength(1);
      expect(result[0].field).toBe("UPDATED_BY");
      expect(result[0].value).toBe("john");
    });

    it("detects non-SYSTEM value in INSERT VALUES (positional)", () => {
      const parsedFiles = [
        {
          dmlStatements: ["INSERT INTO SCHEMA.TABLE (col1, CREATED_BY, col2) VALUES ('x', 'ADMIN', 'y');"],
          selectStatements: [],
          fileName: "file1.sql",
        },
      ];

      const result = MergeSqlService.detectNonSystemAuthors(parsedFiles);

      expect(result).toHaveLength(1);
      expect(result[0].fileName).toBe("file1.sql");
      expect(result[0].field).toBe("CREATED_BY");
      expect(result[0].value).toBe("ADMIN");
    });

    it("ignores SYSTEM values (case-insensitive)", () => {
      const parsedFiles = [
        {
          dmlStatements: [
            "UPDATE SCHEMA.TABLE SET CREATED_BY = 'SYSTEM' WHERE id = 1;",
            "UPDATE SCHEMA.TABLE SET UPDATED_BY = 'system' WHERE id = 2;",
            "INSERT INTO SCHEMA.TABLE (CREATED_BY) VALUES ('System');",
          ],
          selectStatements: [],
          fileName: "file1.sql",
        },
      ];

      const result = MergeSqlService.detectNonSystemAuthors(parsedFiles);

      expect(result).toHaveLength(0);
    });

    it("returns empty array when all values are SYSTEM", () => {
      const parsedFiles = [
        {
          dmlStatements: ["INSERT INTO T1 (CREATED_BY, UPDATED_BY) VALUES ('SYSTEM', 'SYSTEM');"],
          selectStatements: [],
          fileName: "file1.sql",
        },
      ];

      const result = MergeSqlService.detectNonSystemAuthors(parsedFiles);

      expect(result).toEqual([]);
    });

    it("handles files without CREATED_BY/UPDATED_BY", () => {
      const parsedFiles = [
        {
          dmlStatements: ["INSERT INTO T1 (col1, col2) VALUES ('a', 'b');"],
          selectStatements: [],
          fileName: "file1.sql",
        },
      ];

      const result = MergeSqlService.detectNonSystemAuthors(parsedFiles);

      expect(result).toEqual([]);
    });
  });

  describe("extractWhereClause", () => {
    it("extracts simple WHERE clause", () => {
      const result = MergeSqlService.extractWhereClause("SELECT col1 FROM TABLE WHERE id = 1 AND status = 'ACTIVE';");

      expect(result).toBe("id = 1 AND status = 'ACTIVE'");
    });

    it("extracts multiline WHERE clause", () => {
      const result = MergeSqlService.extractWhereClause("SELECT col1\nFROM TABLE\nWHERE id = 1\nAND status = 'ACTIVE';");

      expect(result).toBe("id = 1\nAND status = 'ACTIVE'");
    });

    it("returns null for SELECT without WHERE", () => {
      const result = MergeSqlService.extractWhereClause("SELECT * FROM TABLE;");

      expect(result).toBeNull();
    });

    it("strips trailing semicolon", () => {
      const result = MergeSqlService.extractWhereClause("SELECT * FROM TABLE WHERE id = 1;");

      expect(result).toBe("id = 1");
    });

    it("returns null for timestamp verification clauses with SYSDATE - INTERVAL", () => {
      const result = MergeSqlService.extractWhereClause(
        "SELECT field_name FROM schema_name.table_name WHERE updated_time >= SYSDATE - INTERVAL '5' MINUTE;",
      );

      expect(result).toBeNull();
    });

    it("returns null for UPDATED_TIME >= SYSDATE patterns", () => {
      const result = MergeSqlService.extractWhereClause("SELECT * FROM TABLE WHERE UPDATED_TIME >= SYSDATE - INTERVAL '10' MINUTE;");

      expect(result).toBeNull();
    });

    it("returns null for CREATED_TIME >= SYSDATE patterns", () => {
      const result = MergeSqlService.extractWhereClause("SELECT * FROM TABLE WHERE CREATED_TIME >= SYSDATE - INTERVAL '1' HOUR;");

      expect(result).toBeNull();
    });

    it("strips trailing ORDER BY from WHERE clause", () => {
      const result = MergeSqlService.extractWhereClause("SELECT * FROM TABLE WHERE id IN ('a', 'b') ORDER BY updated_time ASC;");

      expect(result).toBe("id IN ('a', 'b')");
    });

    it("strips trailing GROUP BY from WHERE clause", () => {
      const result = MergeSqlService.extractWhereClause("SELECT col, COUNT(*) FROM TABLE WHERE status = 'ACTIVE' GROUP BY col;");

      expect(result).toBe("status = 'ACTIVE'");
    });

    it("strips trailing FETCH FIRST from WHERE clause", () => {
      const result = MergeSqlService.extractWhereClause("SELECT * FROM TABLE WHERE id = 1 FETCH FIRST 10 ROWS ONLY;");

      expect(result).toBe("id = 1");
    });

    it("strips ORDER BY + FETCH FIRST combined", () => {
      const result = MergeSqlService.extractWhereClause("SELECT * FROM TABLE WHERE id = 1 ORDER BY name ASC FETCH FIRST 5 ROWS ONLY;");

      expect(result).toBe("id = 1");
    });
  });

  describe("isTimestampVerificationClause", () => {
    it("returns true for SYSDATE - INTERVAL pattern", () => {
      expect(MergeSqlService.isTimestampVerificationClause("updated_time >= SYSDATE - INTERVAL '5' MINUTE")).toBe(true);
    });

    it("returns true for various timestamp field names", () => {
      expect(MergeSqlService.isTimestampVerificationClause("UPDATED_TIME >= SYSDATE - INTERVAL '5' MINUTE")).toBe(true);
      expect(MergeSqlService.isTimestampVerificationClause("CREATED_TIME >= SYSDATE - INTERVAL '5' MINUTE")).toBe(true);
      expect(MergeSqlService.isTimestampVerificationClause("UPDATE_TIME >= SYSDATE - INTERVAL '5' MINUTE")).toBe(true);
      expect(MergeSqlService.isTimestampVerificationClause("UPDATED_AT >= SYSDATE - INTERVAL '5' MINUTE")).toBe(true);
    });

    it("returns false for non-timestamp WHERE clauses", () => {
      expect(MergeSqlService.isTimestampVerificationClause("id = 1")).toBe(false);
      expect(MergeSqlService.isTimestampVerificationClause("name = 'test'")).toBe(false);
      expect(MergeSqlService.isTimestampVerificationClause("status = 'ACTIVE'")).toBe(false);
    });
  });

  describe("modified SELECT output with WHERE concatenation", () => {
    it("SELECT * includes concatenated WHERE clauses from grouped selects", () => {
      const parsedFiles = [
        {
          dmlStatements: [],
          selectStatements: ["SELECT col1 FROM CONFIG.APP_CONFIG WHERE id = 1;"],
          fileName: "CONFIG.APP_CONFIG (SQUAD1)[FEATURE1].sql",
        },
        {
          dmlStatements: [],
          selectStatements: ["SELECT col2 FROM CONFIG.APP_CONFIG WHERE name = 'test';"],
          fileName: "CONFIG.APP_CONFIG (SQUAD2)[FEATURE2].sql",
        },
      ];

      const result = MergeSqlService.mergeFiles(parsedFiles);

      expect(result.selectSql).toContain("SELECT * FROM CONFIG.APP_CONFIG WHERE (id = 1) OR (name = 'test');");
    });

    it("falls back to SELECT * FROM TABLE when no WHERE clauses exist", () => {
      const parsedFiles = [
        {
          dmlStatements: [],
          selectStatements: ["SELECT * FROM CONFIG.APP_CONFIG;"],
          fileName: "CONFIG.APP_CONFIG (SQUAD1)[FEATURE1].sql",
        },
      ];

      const result = MergeSqlService.mergeFiles(parsedFiles);

      expect(result.selectSql).toContain("SELECT * FROM CONFIG.APP_CONFIG;");
    });

    it("handles mix of SELECTs with and without WHERE", () => {
      const parsedFiles = [
        {
          dmlStatements: [],
          selectStatements: ["SELECT * FROM CONFIG.APP_CONFIG;"],
          fileName: "CONFIG.APP_CONFIG (SQUAD1)[FEATURE1].sql",
        },
        {
          dmlStatements: [],
          selectStatements: ["SELECT col1 FROM CONFIG.APP_CONFIG WHERE id = 5;"],
          fileName: "CONFIG.APP_CONFIG (SQUAD2)[FEATURE2].sql",
        },
      ];

      const result = MergeSqlService.mergeFiles(parsedFiles);

      // Should have WHERE because at least one select has a WHERE clause
      expect(result.selectSql).toContain("SELECT * FROM CONFIG.APP_CONFIG WHERE (id = 5);");
    });

    it("outputs summary SELECT * plus original statements for standard files", () => {
      const parsedFiles = [
        {
          dmlStatements: [],
          selectStatements: ["SELECT col1 FROM CONFIG.APP_CONFIG WHERE id = 1;"],
          fileName: "CONFIG.APP_CONFIG (SQUAD1)[FEATURE1].sql",
        },
        {
          dmlStatements: [],
          selectStatements: ["SELECT col2 FROM CONFIG.APP_CONFIG WHERE name = 'test';"],
          fileName: "CONFIG.APP_CONFIG (SQUAD2)[FEATURE2].sql",
        },
      ];

      const result = MergeSqlService.mergeFiles(parsedFiles);

      // Should have the summary SELECT * statement
      expect(result.selectSql).toContain("SELECT * FROM CONFIG.APP_CONFIG WHERE (id = 1) OR (name = 'test');");
      // Should ALSO contain the original individual SELECT statements
      expect(result.selectSql).toContain("SELECT col1 FROM CONFIG.APP_CONFIG WHERE id = 1;");
      expect(result.selectSql).toContain("SELECT col2 FROM CONFIG.APP_CONFIG WHERE name = 'test';");
      // Should contain subheaders for individual entries
      expect(result.selectSql).toContain("SQUAD1 - FEATURE1");
      expect(result.selectSql).toContain("SQUAD2 - FEATURE2");
    });

    it("strips ORDER BY from WHERE clauses before concatenation", () => {
      const parsedFiles = [
        {
          dmlStatements: [],
          selectStatements: ["SELECT * FROM SYSTEM_SUPPORT.SERVICE WHERE id IN ('a', 'b') ORDER BY updated_time ASC;"],
          fileName: "SYSTEM_SUPPORT.SERVICE (SQUAD1)[FEATURE1].sql",
        },
        {
          dmlStatements: [],
          selectStatements: ["SELECT * FROM SYSTEM_SUPPORT.SERVICE WHERE service_code IN ('x', 'y') ORDER BY updated_time ASC;"],
          fileName: "SYSTEM_SUPPORT.SERVICE (SQUAD2)[FEATURE2].sql",
        },
      ];

      const result = MergeSqlService.mergeFiles(parsedFiles);

      // WHERE clauses should NOT contain ORDER BY
      expect(result.selectSql).toContain("SELECT * FROM SYSTEM_SUPPORT.SERVICE WHERE (id IN ('a', 'b')) OR (service_code IN ('x', 'y'));");
      expect(result.selectSql).not.toMatch(/WHERE\s*\([^)]*ORDER BY/i);
    });

    it("excludes timestamp verification SELECT statements from output", () => {
      const parsedFiles = [
        {
          dmlStatements: [],
          selectStatements: [
            "SELECT col1 FROM CONFIG.APP_CONFIG WHERE id = 1;",
            "SELECT field_name FROM CONFIG.APP_CONFIG WHERE updated_time >= SYSDATE - INTERVAL '5' MINUTE;",
          ],
          fileName: "CONFIG.APP_CONFIG (SQUAD1)[FEATURE1].sql",
        },
        {
          dmlStatements: [],
          selectStatements: ["SELECT col2 FROM CONFIG.APP_CONFIG WHERE id = 2;"],
          fileName: "CONFIG.APP_CONFIG (SQUAD2)[FEATURE2].sql",
        },
      ];

      const result = MergeSqlService.mergeFiles(parsedFiles);

      // Should have the summary SELECT * without the timestamp clause (multiple squads)
      expect(result.selectSql).toContain("SELECT * FROM CONFIG.APP_CONFIG WHERE (id = 1) OR (id = 2);");
      // Should contain the valid SELECT statement
      expect(result.selectSql).toContain("SELECT col1 FROM CONFIG.APP_CONFIG WHERE id = 1;");
      // Should NOT contain the timestamp verification SELECT statement
      expect(result.selectSql).not.toContain("updated_time >= SYSDATE - INTERVAL");
    });

    it("outputs original SELECT statements for non-standard files", () => {
      const parsedFiles = [
        {
          dmlStatements: [],
          selectStatements: ["SELECT * FROM SOME_TABLE WHERE id = 1;"],
          fileName: "custom-file.sql",
        },
      ];

      const result = MergeSqlService.mergeFiles(parsedFiles);

      // Non-standard files should keep their original SELECT statements
      expect(result.selectSql).toContain("SELECT * FROM SOME_TABLE WHERE id = 1;");
    });
  });

  describe("parseFile DELETE extraction", () => {
    it("extracts DELETE FROM statements as DML", () => {
      const content = `SET DEFINE OFF;

DELETE FROM SCHEMA.TABLE_NAME WHERE id = 1;

SELECT * FROM SCHEMA.TABLE_NAME;`;

      const result = MergeSqlService.parseFile(content, "test.sql");

      expect(result.dmlStatements).toHaveLength(1);
      expect(result.dmlStatements[0]).toContain("DELETE FROM");
      expect(result.selectStatements).toHaveLength(1);
    });

    it("extracts DELETE (without FROM) statements as DML", () => {
      const content = `DELETE SCHEMA.TABLE_NAME WHERE id = 1;`;

      const result = MergeSqlService.parseFile(content, "test.sql");

      expect(result.dmlStatements).toHaveLength(1);
      expect(result.dmlStatements[0]).toContain("DELETE");
    });

    it("handles multiple DELETE statements in one file", () => {
      const content = `DELETE FROM T1 WHERE id = 1;

DELETE FROM T2 WHERE id = 2;`;

      const result = MergeSqlService.parseFile(content, "test.sql");

      expect(result.dmlStatements).toHaveLength(2);
    });
  });

  describe("detectDangerousStatements", () => {
    it("flags DELETE statements", () => {
      const parsedFiles = [
        {
          dmlStatements: ["DELETE FROM SCHEMA.TABLE_A WHERE id = 1;"],
          selectStatements: [],
          fileName: "file1.sql",
        },
      ];

      const result = MergeSqlService.detectDangerousStatements(parsedFiles);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("DELETE");
      expect(result[0].fileName).toBe("file1.sql");
      expect(result[0].statement).toContain("DELETE FROM");
    });

    it("flags UPDATE without WHERE", () => {
      const parsedFiles = [
        {
          dmlStatements: ["UPDATE SCHEMA.TABLE_A SET col1 = 'value';"],
          selectStatements: [],
          fileName: "file1.sql",
        },
      ];

      const result = MergeSqlService.detectDangerousStatements(parsedFiles);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("UPDATE_NO_WHERE");
      expect(result[0].fileName).toBe("file1.sql");
    });

    it("does not flag UPDATE with WHERE", () => {
      const parsedFiles = [
        {
          dmlStatements: ["UPDATE SCHEMA.TABLE_A SET col1 = 'value' WHERE id = 1;"],
          selectStatements: [],
          fileName: "file1.sql",
        },
      ];

      const result = MergeSqlService.detectDangerousStatements(parsedFiles);

      expect(result).toHaveLength(0);
    });

    it("does not flag INSERT or MERGE statements", () => {
      const parsedFiles = [
        {
          dmlStatements: [
            "INSERT INTO T1 (c) VALUES (1);",
            "MERGE INTO T1 t USING DUAL ON (1=0) WHEN NOT MATCHED THEN INSERT (c) VALUES ('a');",
          ],
          selectStatements: [],
          fileName: "file1.sql",
        },
      ];

      const result = MergeSqlService.detectDangerousStatements(parsedFiles);

      expect(result).toHaveLength(0);
    });

    it("detects multiple dangerous statements across files", () => {
      const parsedFiles = [
        {
          dmlStatements: ["DELETE FROM T1 WHERE id = 1;"],
          selectStatements: [],
          fileName: "file1.sql",
        },
        {
          dmlStatements: ["UPDATE T2 SET col = 'x';"],
          selectStatements: [],
          fileName: "file2.sql",
        },
      ];

      const result = MergeSqlService.detectDangerousStatements(parsedFiles);

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe("DELETE");
      expect(result[1].type).toBe("UPDATE_NO_WHERE");
    });
  });

  describe("isFetchFirstStatement", () => {
    it("returns true for FETCH FIRST N ROWS ONLY", () => {
      expect(MergeSqlService.isFetchFirstStatement("SELECT * FROM T1 ORDER BY id FETCH FIRST 10 ROWS ONLY;")).toBe(true);
    });

    it("returns true for fetch first (case insensitive)", () => {
      expect(MergeSqlService.isFetchFirstStatement("SELECT * FROM T1 fetch first 5 rows only;")).toBe(true);
    });

    it("returns false for normal SELECT statements", () => {
      expect(MergeSqlService.isFetchFirstStatement("SELECT * FROM T1 WHERE id = 1;")).toBe(false);
    });

    it("returns false for SELECT without FETCH FIRST", () => {
      expect(MergeSqlService.isFetchFirstStatement("SELECT col1, col2 FROM T1;")).toBe(false);
    });
  });

  describe("FETCH FIRST filtering in mergeFiles", () => {
    it("excludes FETCH FIRST SELECT from WHERE clause concatenation", () => {
      const parsedFiles = [
        {
          dmlStatements: [],
          selectStatements: [
            "SELECT col1 FROM CONFIG.APP_CONFIG WHERE id = 1;",
            "SELECT * FROM CONFIG.APP_CONFIG WHERE status = 'A' FETCH FIRST 10 ROWS ONLY;",
          ],
          fileName: "CONFIG.APP_CONFIG (SQUAD1)[FEATURE1].sql",
        },
        {
          dmlStatements: [],
          selectStatements: ["SELECT col2 FROM CONFIG.APP_CONFIG WHERE id = 2;"],
          fileName: "CONFIG.APP_CONFIG (SQUAD2)[FEATURE2].sql",
        },
      ];

      const result = MergeSqlService.mergeFiles(parsedFiles);

      // Summary should only include WHERE from the non-FETCH FIRST statements (multiple squads)
      expect(result.selectSql).toContain("SELECT * FROM CONFIG.APP_CONFIG WHERE (id = 1) OR (id = 2);");
      expect(result.selectSql).not.toContain("FETCH FIRST");
    });

    it("excludes FETCH FIRST SELECT from individual SELECT output", () => {
      const parsedFiles = [
        {
          dmlStatements: [],
          selectStatements: [
            "SELECT col1 FROM CONFIG.APP_CONFIG WHERE id = 1;",
            "SELECT * FROM CONFIG.APP_CONFIG FETCH FIRST 5 ROWS ONLY;",
          ],
          fileName: "CONFIG.APP_CONFIG (SQUAD1)[FEATURE1].sql",
        },
      ];

      const result = MergeSqlService.mergeFiles(parsedFiles);

      expect(result.selectSql).toContain("SELECT col1 FROM CONFIG.APP_CONFIG WHERE id = 1;");
      expect(result.selectSql).not.toContain("FETCH FIRST");
    });

    it("excludes FETCH FIRST SELECT from non-standard file output", () => {
      const parsedFiles = [
        {
          dmlStatements: [],
          selectStatements: ["SELECT * FROM T1;", "SELECT * FROM T1 FETCH FIRST 10 ROWS ONLY;"],
          fileName: "custom_file.sql",
        },
      ];

      const result = MergeSqlService.mergeFiles(parsedFiles);

      expect(result.selectSql).toContain("SELECT * FROM T1;");
      expect(result.selectSql).not.toContain("FETCH FIRST");
    });

    it("dangerousStatements are included in mergeFiles report", () => {
      const parsedFiles = [
        {
          dmlStatements: ["DELETE FROM T1 WHERE id = 1;", "UPDATE T2 SET col = 'x';"],
          selectStatements: [],
          fileName: "file1.sql",
        },
      ];

      const result = MergeSqlService.mergeFiles(parsedFiles);

      expect(result.report.dangerousStatements).toHaveLength(2);
      expect(result.report.dangerousStatements[0].type).toBe("DELETE");
      expect(result.report.dangerousStatements[1].type).toBe("UPDATE_NO_WHERE");
    });
  });
});
