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
        } else if (upperLine.startsWith("DELETE FROM") || upperLine.startsWith("DELETE ")) {
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
   * Detect dangerous DML statements: DELETE statements and UPDATE without WHERE
   * @param {Array<{ dmlStatements: string[], selectStatements: string[], fileName: string }>} parsedFiles
   * @returns {Array<{ fileName: string, type: 'DELETE' | 'UPDATE_NO_WHERE', statement: string }>}
   */
  static detectDangerousStatements(parsedFiles) {
    const results = [];

    for (const file of parsedFiles) {
      for (const stmt of file.dmlStatements) {
        const upperStmt = stmt.trimStart().toUpperCase();

        if (upperStmt.startsWith("DELETE")) {
          results.push({
            fileName: file.fileName,
            type: "DELETE",
            statement: stmt,
          });
        } else if (upperStmt.startsWith("UPDATE")) {
          if (!/\bWHERE\b/i.test(stmt)) {
            results.push({
              fileName: file.fileName,
              type: "UPDATE_NO_WHERE",
              statement: stmt,
            });
          }
        }
      }
    }

    return results;
  }

  /**
   * Analyze DML statements and count by type and target table, squad, and feature
   * @param {Array<{ dmlStatements: string[], selectStatements: string[], fileName: string }>} parsedFiles
   * @returns {{ tableCounts: Array<{ table: string, insert: number, merge: number, update: number, delete: number, total: number }>, squadCounts: Array<{ squad: string, insert: number, merge: number, update: number, delete: number, total: number }>, featureCounts: Array<{ feature: string, insert: number, merge: number, update: number, delete: number, total: number }> }}
   */
  static analyzeStatements(parsedFiles) {
    const tableMap = new Map();
    const squadMap = new Map();
    const featureMap = new Map();

    for (const file of parsedFiles) {
      const parsed = this.parseFileName(file.fileName);
      const squad = parsed ? parsed.squadName : null;
      const feature = parsed ? parsed.featureName : null;

      for (const stmt of file.dmlStatements) {
        const upperStmt = stmt.trimStart().toUpperCase();
        let type = null;
        let table = null;

        if (upperStmt.startsWith("INSERT")) {
          type = "insert";
          const match = stmt.match(/INSERT\s+INTO\s+(\S+)/i);
          if (match) table = match[1];
        } else if (upperStmt.startsWith("MERGE")) {
          type = "merge";
          const match = stmt.match(/MERGE\s+INTO\s+(\S+)/i) || stmt.match(/MERGE\s+(\S+)/i);
          if (match) table = match[1];
        } else if (upperStmt.startsWith("UPDATE")) {
          type = "update";
          const match = stmt.match(/UPDATE\s+(\S+)/i);
          if (match) table = match[1];
        } else if (upperStmt.startsWith("DELETE")) {
          type = "delete";
          const match = stmt.match(/DELETE\s+FROM\s+(\S+)/i) || stmt.match(/DELETE\s+(\S+)/i);
          if (match) table = match[1];
        }

        if (!type || !table) continue;

        // Strip column list parentheses from table name
        const parenIdx = table.indexOf("(");
        if (parenIdx !== -1) table = table.substring(0, parenIdx);

        // Per-table counts
        const key = table.toUpperCase();
        if (!tableMap.has(key)) {
          tableMap.set(key, { displayName: table, insert: 0, merge: 0, update: 0, delete: 0 });
        }
        tableMap.get(key)[type]++;

        // Per-squad counts
        if (squad) {
          const squadKey = squad.toUpperCase();
          if (!squadMap.has(squadKey)) {
            squadMap.set(squadKey, { displayName: squad, insert: 0, merge: 0, update: 0, delete: 0 });
          }
          squadMap.get(squadKey)[type]++;
        }

        // Per-feature counts
        if (feature) {
          const featureKey = feature.toUpperCase();
          if (!featureMap.has(featureKey)) {
            featureMap.set(featureKey, { displayName: feature, insert: 0, merge: 0, update: 0, delete: 0 });
          }
          featureMap.get(featureKey)[type]++;
        }
      }
    }

    const tableCounts = Array.from(tableMap.values())
      .map((entry) => ({
        table: entry.displayName,
        insert: entry.insert,
        merge: entry.merge,
        update: entry.update,
        delete: entry.delete,
        total: entry.insert + entry.merge + entry.update + entry.delete,
      }))
      .sort((a, b) => a.table.toUpperCase().localeCompare(b.table.toUpperCase()));

    const squadCounts = Array.from(squadMap.values())
      .map((entry) => ({
        squad: entry.displayName,
        insert: entry.insert,
        merge: entry.merge,
        update: entry.update,
        delete: entry.delete,
        total: entry.insert + entry.merge + entry.update + entry.delete,
      }))
      .sort((a, b) => a.squad.toUpperCase().localeCompare(b.squad.toUpperCase()));

    const featureCounts = Array.from(featureMap.values())
      .map((entry) => ({
        feature: entry.displayName,
        insert: entry.insert,
        merge: entry.merge,
        update: entry.update,
        delete: entry.delete,
        total: entry.insert + entry.merge + entry.update + entry.delete,
      }))
      .sort((a, b) => a.feature.toUpperCase().localeCompare(b.feature.toUpperCase()));

    return { tableCounts, squadCounts, featureCounts };
  }

  /**
   * Detect non-SYSTEM values in CREATED_BY/UPDATED_BY fields
   * @param {Array<{ dmlStatements: string[], selectStatements: string[], fileName: string }>} parsedFiles
   * @returns {Array<{ fileName: string, field: string, value: string }>}
   */
  static detectNonSystemAuthors(parsedFiles) {
    const results = [];

    for (const file of parsedFiles) {
      for (const stmt of file.dmlStatements) {
        const upperStmt = stmt.trimStart().toUpperCase();

        if (upperStmt.startsWith("UPDATE") || upperStmt.startsWith("MERGE")) {
          // Check SET clauses for CREATED_BY/UPDATED_BY = 'value'
          const setRegex = /(?:CREATED_BY|UPDATED_BY)\s*=\s*'([^']*)'/gi;
          let match;
          while ((match = setRegex.exec(stmt)) !== null) {
            const value = match[1];
            if (value.toUpperCase() !== "SYSTEM") {
              const fieldMatch = match[0].match(/^(CREATED_BY|UPDATED_BY)/i);
              results.push({
                fileName: file.fileName,
                field: fieldMatch[1].toUpperCase(),
                value,
              });
            }
          }
        }

        if (upperStmt.startsWith("INSERT")) {
          // Extract column list and values list
          const colMatch = stmt.match(/INSERT\s+INTO\s+\S+\s*\(([^)]+)\)/i);
          const valMatch = stmt.match(/VALUES\s*\(([\s\S]+)\)\s*;?\s*$/i);

          if (colMatch && valMatch) {
            const columns = this.splitParenAware(colMatch[1]);
            const values = this.splitParenAware(valMatch[1]);

            for (let i = 0; i < columns.length; i++) {
              const colName = columns[i].trim().toUpperCase();
              if (colName === "CREATED_BY" || colName === "UPDATED_BY") {
                const val = (values[i] || "").trim();
                // Extract string value from quotes
                const strMatch = val.match(/^'([^']*)'$/);
                if (strMatch && strMatch[1].toUpperCase() !== "SYSTEM") {
                  results.push({
                    fileName: file.fileName,
                    field: colName,
                    value: strMatch[1],
                  });
                }
              }
            }
          }
        }
      }
    }

    return results;
  }

  /**
   * Split a comma-separated string while respecting parentheses nesting
   * @param {string} str
   * @returns {string[]}
   */
  static splitParenAware(str) {
    const parts = [];
    let depth = 0;
    let current = "";

    for (const ch of str) {
      if (ch === "(") {
        depth++;
        current += ch;
      } else if (ch === ")") {
        depth--;
        current += ch;
      } else if (ch === "," && depth === 0) {
        parts.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    if (current) parts.push(current);
    return parts;
  }

  /**
   * Extract the WHERE clause from a SELECT statement
   * @param {string} selectStatement
   * @returns {string|null}
   */
  static extractWhereClause(selectStatement) {
    const match = selectStatement.match(/\bWHERE\b\s+([\s\S]+?)\s*;?\s*$/i);
    if (!match) return null;

    const whereClause = match[1].trim();

    // Skip timestamp-based verification patterns (e.g., updated_time >= SYSDATE - INTERVAL '5' MINUTE)
    if (this.isTimestampVerificationClause(whereClause)) {
      return null;
    }

    return whereClause;
  }

  /**
   * Check if a WHERE clause is a timestamp verification pattern that should be excluded
   * @param {string} whereClause
   * @returns {boolean}
   */
  static isTimestampVerificationClause(whereClause) {
    const upperClause = whereClause.toUpperCase();

    // Patterns to detect timestamp verification clauses
    const timestampPatterns = [
      /SYSDATE\s*-\s*INTERVAL/i,
      /UPDATED_TIME\s*>=?\s*SYSDATE/i,
      /CREATED_TIME\s*>=?\s*SYSDATE/i,
      /UPDATE_TIME\s*>=?\s*SYSDATE/i,
      /CREATE_TIME\s*>=?\s*SYSDATE/i,
      /UPDATED_AT\s*>=?\s*SYSDATE/i,
      /CREATED_AT\s*>=?\s*SYSDATE/i,
    ];

    return timestampPatterns.some((pattern) => pattern.test(whereClause));
  }

  /**
   * Check if a SELECT statement contains a FETCH FIRST clause
   * @param {string} selectStatement
   * @returns {boolean}
   */
  static isFetchFirstStatement(selectStatement) {
    return /\bFETCH\s+FIRST\b/i.test(selectStatement);
  }

  /**
   * Merge multiple parsed files into combined output
   * @param {Array<{ dmlStatements: string[], selectStatements: string[], fileName: string }>} parsedFiles
   * @returns {{ mergedSql: string, selectSql: string, duplicates: Array<{ statement: string, files: string[] }>, report: { statementCounts: Array, nonSystemAuthors: Array } }}
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

    // Build select SQL - summary SELECT * statement + original statements (excluding timestamp verification ones)
    const selectLines = [];
    let selectGroupCount = 0;

    for (const group of groups) {
      const groupHasSelect = group.entries.some((e) => e.selectStatements.length > 0);
      if (!groupHasSelect) continue;

      if (selectGroupCount > 0) selectLines.push("");
      selectGroupCount++;

      if (group.isStandard) {
        selectLines.push(`-- ${group.groupKey}`);

        // Collect WHERE clauses from all SELECT statements in this group (excluding timestamp verification and FETCH FIRST)
        const whereClauses = [];
        for (const entry of group.entries) {
          for (const stmt of entry.selectStatements) {
            if (this.isFetchFirstStatement(stmt)) continue;
            const where = this.extractWhereClause(stmt);
            if (where) whereClauses.push(where);
          }
        }

        // Output the summary SELECT statement first
        if (whereClauses.length > 0) {
          const combined = whereClauses.map((w) => `(${w})`).join(" OR ");
          selectLines.push(`SELECT * FROM ${group.groupKey} WHERE ${combined};`);
        } else {
          selectLines.push(`SELECT * FROM ${group.groupKey};`);
        }

        // Output original SELECT statements (excluding timestamp verification and FETCH FIRST)
        for (const entry of group.entries) {
          const validStatements = entry.selectStatements.filter((stmt) => {
            if (this.isFetchFirstStatement(stmt)) return false;
            const whereClause = stmt.match(/\bWHERE\b\s+([\s\S]+?)\s*;?\s*$/i);
            if (!whereClause) return true; // Keep statements without WHERE
            return !this.isTimestampVerificationClause(whereClause[1].trim());
          });

          if (validStatements.length === 0) continue;

          selectLines.push(`-- ${entry.subHeader}`);
          for (const stmt of validStatements) {
            selectLines.push(stmt);
            selectLines.push("");
          }
        }
      } else {
        // Non-standard files: output the original SELECT statements (excluding timestamp verification and FETCH FIRST)
        selectLines.push(`-- ${group.groupKey}`);
        for (const entry of group.entries) {
          for (const stmt of entry.selectStatements) {
            if (this.isFetchFirstStatement(stmt)) continue;
            const whereClause = stmt.match(/\bWHERE\b\s+([\s\S]+?)\s*;?\s*$/i);
            if (whereClause && this.isTimestampVerificationClause(whereClause[1].trim())) {
              continue; // Skip timestamp verification statements
            }
            selectLines.push(stmt);
            selectLines.push("");
          }
        }
      }
    }

    const analysis = this.analyzeStatements(parsedFiles);

    return {
      mergedSql: dmlLines.join("\n").trim(),
      selectSql: selectLines.join("\n").trim(),
      duplicates,
      report: {
        statementCounts: analysis.tableCounts,
        squadCounts: analysis.squadCounts,
        featureCounts: analysis.featureCounts,
        nonSystemAuthors: this.detectNonSystemAuthors(parsedFiles),
        dangerousStatements: this.detectDangerousStatements(parsedFiles),
      },
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
