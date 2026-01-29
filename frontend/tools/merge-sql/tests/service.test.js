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
      expect(result.mergedSql).toContain("-- Source: file1.sql");
      expect(result.mergedSql).toContain("-- Source: file2.sql");
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

    it("detects duplicate statements", () => {
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
});
