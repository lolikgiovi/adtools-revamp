/**
 * Merge SQL Service
 * Handles SQL file parsing, merging, and deduplication logic
 */

export class MergeSqlService {
  /**
   * Parse SQL file content and extract DML statements and SELECT statements
   * @param {string} content - SQL file content
   * @param {string} fileName - Original file name for tracking
   * @returns {{ dmlStatements: string[], selectStatements: string[], fileName: string }}
   */
  static parseFile(content, fileName) {
    const result = {
      dmlStatements: [],
      selectStatements: [],
      fileName,
    };

    if (!content || typeof content !== "string") {
      return result;
    }

    const lines = content.split("\n");
    let currentStatement = [];
    let inStatement = false;
    let statementType = null; // 'dml' or 'select'

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();
      const upperLine = trimmedLine.toUpperCase();

      // Skip SET DEFINE OFF - we'll add this once at the beginning
      if (upperLine === "SET DEFINE OFF;" || upperLine === "SET DEFINE OFF") {
        continue;
      }

      // Skip empty lines if not in a statement
      if (!trimmedLine && !inStatement) {
        continue;
      }

      // Detect statement start
      if (!inStatement) {
        if (upperLine.startsWith("MERGE INTO") || upperLine.startsWith("MERGE ")) {
          inStatement = true;
          statementType = "dml";
          currentStatement = [line];
        } else if (upperLine.startsWith("INSERT INTO") || upperLine.startsWith("INSERT ")) {
          inStatement = true;
          statementType = "dml";
          currentStatement = [line];
        } else if (upperLine.startsWith("UPDATE ")) {
          inStatement = true;
          statementType = "dml";
          currentStatement = [line];
        } else if (this.isValidSelectStatement(upperLine)) {
          inStatement = true;
          statementType = "select";
          currentStatement = [line];
        }
      } else {
        currentStatement.push(line);
      }

      // Detect statement end (semicolon at end of line)
      if (inStatement && trimmedLine.endsWith(";")) {
        const statement = currentStatement.join("\n").trim();

        if (statementType === "dml") {
          result.dmlStatements.push(statement);
        } else if (statementType === "select") {
          result.selectStatements.push(statement);
        }

        currentStatement = [];
        inStatement = false;
        statementType = null;
      }
    }

    // Handle statement without ending semicolon
    if (currentStatement.length > 0 && inStatement) {
      const statement = currentStatement.join("\n").trim();
      if (statement) {
        if (statementType === "dml") {
          result.dmlStatements.push(statement);
        } else if (statementType === "select") {
          result.selectStatements.push(statement);
        }
      }
    }

    return result;
  }

  /**
   * Check if a line is a valid SELECT statement (not a subquery with +1)
   * @param {string} upperLine - Uppercase trimmed line
   * @returns {boolean}
   */
  static isValidSelectStatement(upperLine) {
    // Must start with SELECT
    if (!upperLine.startsWith("SELECT ") && upperLine !== "SELECT") {
      return false;
    }

    // Skip SELECT with +1 (typically subqueries like SELECT NVL(MAX(ID)+1, 1))
    if (upperLine.includes("+1")) {
      return false;
    }

    // Skip if it looks like a subquery pattern
    if (upperLine.includes("(SELECT")) {
      return false;
    }

    return true;
  }

  /**
   * Merge multiple parsed files into combined output
   * @param {Array<{ dmlStatements: string[], selectStatements: string[], fileName: string }>} parsedFiles
   * @returns {{ mergedSql: string, selectSql: string, duplicates: Array<{ statement: string, files: string[] }> }}
   */
  static mergeFiles(parsedFiles) {
    // Duplicate detection (runs before grouping, unchanged logic)
    const dmlStatementFileMap = new Map();
    for (const file of parsedFiles) {
      for (const stmt of file.dmlStatements) {
        const normalized = this.normalizeStatement(stmt);
        if (!dmlStatementFileMap.has(normalized)) {
          dmlStatementFileMap.set(normalized, { statement: stmt, files: [] });
        }
        dmlStatementFileMap.get(normalized).files.push(file.fileName);
      }
    }

    const duplicates = [];
    for (const [_, info] of dmlStatementFileMap) {
      if (info.files.length > 1) {
        duplicates.push({ statement: info.statement, files: info.files });
      }
    }

    // Build adjacent groups
    const groups = this.buildAdjacentGroups(parsedFiles);

    // Build merged SQL (DML)
    const dmlLines = ["SET DEFINE OFF;", ""];
    let dmlGroupCount = 0;

    for (const group of groups) {
      const groupHasDml = group.entries.some((e) => e.dmlStatements.length > 0);
      if (!groupHasDml) continue;

      if (dmlGroupCount > 0) dmlLines.push("");
      dmlGroupCount++;

      if (group.isStandard) {
        dmlLines.push(`-- ${group.groupKey}`);
        for (const entry of group.entries) {
          if (entry.dmlStatements.length === 0) continue;
          dmlLines.push(`-- ${entry.subHeader}`);
          for (const stmt of entry.dmlStatements) {
            dmlLines.push(stmt);
            dmlLines.push("");
          }
        }
      } else {
        dmlLines.push(`-- ${group.groupKey}`);
        for (const entry of group.entries) {
          for (const stmt of entry.dmlStatements) {
            dmlLines.push(stmt);
            dmlLines.push("");
          }
        }
      }
    }

    // Build select SQL
    const selectLines = [];
    let selectGroupCount = 0;

    for (const group of groups) {
      const groupHasSelect = group.entries.some((e) => e.selectStatements.length > 0);
      if (!groupHasSelect) continue;

      if (selectGroupCount > 0) selectLines.push("");
      selectGroupCount++;

      if (group.isStandard) {
        selectLines.push(`-- ${group.groupKey}`);
        selectLines.push(`SELECT * FROM ${group.groupKey};`);
        for (const entry of group.entries) {
          if (entry.selectStatements.length === 0) continue;
          selectLines.push(`-- ${entry.subHeader}`);
          for (const stmt of entry.selectStatements) {
            selectLines.push(stmt);
            selectLines.push("");
          }
        }
      } else {
        selectLines.push(`-- ${group.groupKey}`);
        for (const entry of group.entries) {
          for (const stmt of entry.selectStatements) {
            selectLines.push(stmt);
            selectLines.push("");
          }
        }
      }
    }

    return {
      mergedSql: dmlLines.join("\n").trim(),
      selectSql: selectLines.join("\n").trim(),
      duplicates,
    };
  }

  /**
   * Normalize a statement for comparison (remove extra whitespace, lowercase)
   * @param {string} statement
   * @returns {string}
   */
  static normalizeStatement(statement) {
    return statement.replace(/\s+/g, " ").trim().toLowerCase();
  }

  /**
   * Parse file name to extract metadata
   * Format: SCHEMA_NAME.TABLE_NAME (SQUAD_NAME)[FEATURE_NAME]
   * @param {string} fileName
   * @returns {{ schemaName: string, tableName: string, squadName: string, featureName: string } | null}
   */
  static parseFileName(fileName) {
    // Remove .sql extension
    const baseName = fileName.replace(/\.sql$/i, "");

    // Try to match pattern: SCHEMA.TABLE (SQUAD)[FEATURE]
    const regex = /^([^.]+)\.([^(]+)\s*\(([^)]+)\)\s*\[([^\]]+)\]$/;
    const match = baseName.match(regex);

    if (match) {
      return {
        schemaName: match[1].trim(),
        tableName: match[2].trim(),
        squadName: match[3].trim(),
        featureName: match[4].trim(),
      };
    }

    // Fallback: just return the base name
    return null;
  }

  /**
   * Build adjacent groups from parsed files, grouping consecutive files by SCHEMA.TABLE.
   * Non-adjacent files with the same SCHEMA.TABLE are NOT merged into the same group.
   * @param {Array<{ dmlStatements: string[], selectStatements: string[], fileName: string }>} parsedFiles
   * @returns {Array<{ groupKey: string, isStandard: boolean, entries: Array<{ subHeader: string|null, dmlStatements: string[], selectStatements: string[] }> }>}
   */
  static buildAdjacentGroups(parsedFiles) {
    const groups = [];

    for (const file of parsedFiles) {
      const parsed = this.parseFileName(file.fileName);
      let groupKey;
      let subHeader;
      let isStandard;

      if (parsed) {
        groupKey = `${parsed.schemaName}.${parsed.tableName}`;
        subHeader = `${parsed.squadName} - ${parsed.featureName}`;
        isStandard = true;
      } else {
        groupKey = file.fileName;
        subHeader = null;
        isStandard = false;
      }

      const lastGroup = groups.length > 0 ? groups[groups.length - 1] : null;

      if (lastGroup && lastGroup.groupKey === groupKey) {
        lastGroup.entries.push({
          subHeader,
          dmlStatements: file.dmlStatements,
          selectStatements: file.selectStatements,
        });
      } else {
        groups.push({
          groupKey,
          isStandard,
          entries: [
            {
              subHeader,
              dmlStatements: file.dmlStatements,
              selectStatements: file.selectStatements,
            },
          ],
        });
      }
    }

    return groups;
  }

  /**
   * Sort files by name
   * @param {Array<{ id: string, file: File, name: string }>} files
   * @param {'asc' | 'desc' | 'manual'} order
   * @returns {Array<{ id: string, file: File, name: string }>}
   */
  static sortFiles(files, order) {
    if (order === "manual") {
      return files;
    }

    const sorted = [...files].sort((a, b) => {
      const nameA = a.name.toLowerCase();
      const nameB = b.name.toLowerCase();
      return order === "asc" ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
    });

    return sorted;
  }

  /**
   * Read file content as text
   * @param {File} file
   * @returns {Promise<string>}
   */
  static async readFileContent(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(e);
      reader.readAsText(file);
    });
  }
}
