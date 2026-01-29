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
    const allDmlStatements = [];
    const allSelectStatements = [];
    const statementFileMap = new Map(); // Track which files contain each statement

    for (const file of parsedFiles) {
      for (const stmt of file.dmlStatements) {
        const normalized = this.normalizeStatement(stmt);
        if (!statementFileMap.has(normalized)) {
          statementFileMap.set(normalized, { statement: stmt, files: [] });
        }
        statementFileMap.get(normalized).files.push(file.fileName);
        allDmlStatements.push({ statement: stmt, fileName: file.fileName });
      }

      for (const stmt of file.selectStatements) {
        const normalized = this.normalizeStatement(stmt);
        if (!statementFileMap.has(normalized)) {
          statementFileMap.set(normalized, { statement: stmt, files: [] });
        }
        statementFileMap.get(normalized).files.push(file.fileName);
        allSelectStatements.push({ statement: stmt, fileName: file.fileName });
      }
    }

    // Find duplicates
    const duplicates = [];
    for (const [_, info] of statementFileMap) {
      if (info.files.length > 1) {
        duplicates.push({
          statement: info.statement,
          files: info.files,
        });
      }
    }

    // Build merged SQL with SET DEFINE OFF at the beginning
    const dmlLines = ["SET DEFINE OFF;", ""];
    for (const item of allDmlStatements) {
      dmlLines.push(`-- Source: ${item.fileName}`);
      dmlLines.push(item.statement);
      dmlLines.push("");
    }

    // Build select SQL
    const selectLines = [];
    for (const item of allSelectStatements) {
      selectLines.push(`-- Source: ${item.fileName}`);
      selectLines.push(item.statement);
      selectLines.push("");
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
