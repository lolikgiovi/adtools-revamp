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

    it("SELECT output includes SELECT * FROM SCHEMA.TABLE with concatenated WHERE for standard filenames", () => {
      const parsedFiles = [
        {
          dmlStatements: [],
          selectStatements: ["SELECT col1 FROM CONFIG.APP_CONFIG WHERE id = 1;"],
          fileName: "CONFIG.APP_CONFIG (SQUAD1)[FEATURE1].sql",
        },
      ];

      const result = MergeSqlService.mergeFiles(parsedFiles);

      expect(result.selectSql).toContain("-- CONFIG.APP_CONFIG");
      expect(result.selectSql).toContain("SELECT * FROM CONFIG.APP_CONFIG WHERE (id = 1);");
      expect(result.selectSql).toContain("-- SQUAD1 - FEATURE1");
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

      // DML: standard group has schema.table header + sub-header
      expect(result.mergedSql).toContain("-- CONFIG.APP_CONFIG");
      expect(result.mergedSql).toContain("-- SQUAD1 - FEATURE1");
      // DML: non-standard group has filename header, no sub-header
      expect(result.mergedSql).toContain("-- custom_file.sql");

      // SELECT: standard group has auto-generated SELECT * FROM (no WHERE since original has no WHERE)
      expect(result.selectSql).toContain("SELECT * FROM CONFIG.APP_CONFIG;");
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

    it("returns report with statementCounts and nonSystemAuthors", () => {
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
      expect(result.report.nonSystemAuthors).toBeInstanceOf(Array);
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
          dmlStatements: [
            "UPDATE SCHEMA.TABLE_A SET c = 2 WHERE id = 1;",
            "INSERT INTO SCHEMA.TABLE_B (c) VALUES (3);",
          ],
          selectStatements: [],
          fileName: "file2.sql",
        },
      ];

      const result = MergeSqlService.analyzeStatements(parsedFiles);

      expect(result).toHaveLength(2);

      const tableA = result.find((r) => r.table.toUpperCase() === "SCHEMA.TABLE_A");
      expect(tableA.insert).toBe(1);
      expect(tableA.merge).toBe(1);
      expect(tableA.update).toBe(1);
      expect(tableA.total).toBe(3);

      const tableB = result.find((r) => r.table.toUpperCase() === "SCHEMA.TABLE_B");
      expect(tableB.insert).toBe(1);
      expect(tableB.merge).toBe(0);
      expect(tableB.update).toBe(0);
      expect(tableB.total).toBe(1);
    });

    it("groups by table name case-insensitively", () => {
      const parsedFiles = [
        {
          dmlStatements: [
            "INSERT INTO Schema.Table_A (c) VALUES (1);",
            "INSERT INTO SCHEMA.TABLE_A (c) VALUES (2);",
          ],
          selectStatements: [],
          fileName: "file1.sql",
        },
      ];

      const result = MergeSqlService.analyzeStatements(parsedFiles);

      expect(result).toHaveLength(1);
      expect(result[0].insert).toBe(2);
    });

    it("handles empty input", () => {
      const result = MergeSqlService.analyzeStatements([]);
      expect(result).toEqual([]);
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

      const result = MergeSqlService.analyzeStatements(parsedFiles);

      expect(result).toHaveLength(1);
      expect(result[0].insert).toBe(1);
      expect(result[0].merge).toBe(1);
      expect(result[0].update).toBe(1);
      expect(result[0].total).toBe(3);
    });

    it("strips column list parentheses from table name", () => {
      const parsedFiles = [
        {
          dmlStatements: ["INSERT INTO SCHEMA.TABLE_A(col1, col2) VALUES (1, 2);"],
          selectStatements: [],
          fileName: "file1.sql",
        },
      ];

      const result = MergeSqlService.analyzeStatements(parsedFiles);

      expect(result).toHaveLength(1);
      expect(result[0].table).toBe("SCHEMA.TABLE_A");
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

      const result = MergeSqlService.analyzeStatements(parsedFiles);

      expect(result[0].table).toBe("A_TABLE");
      expect(result[1].table).toBe("M_TABLE");
      expect(result[2].table).toBe("Z_TABLE");
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
          dmlStatements: [
            "INSERT INTO T1 (CREATED_BY, UPDATED_BY) VALUES ('SYSTEM', 'SYSTEM');",
          ],
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
      const result = MergeSqlService.extractWhereClause(
        "SELECT col1 FROM TABLE WHERE id = 1 AND status = 'ACTIVE';"
      );

      expect(result).toBe("id = 1 AND status = 'ACTIVE'");
    });

    it("extracts multiline WHERE clause", () => {
      const result = MergeSqlService.extractWhereClause(
        "SELECT col1\nFROM TABLE\nWHERE id = 1\nAND status = 'ACTIVE';"
      );

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

      expect(result.selectSql).toContain(
        "SELECT * FROM CONFIG.APP_CONFIG WHERE (id = 1) OR (name = 'test');"
      );
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
  });
});
