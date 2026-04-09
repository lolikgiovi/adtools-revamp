/**
 * Merge SQL Service
 * Handles SQL file parsing, merging, and deduplication logic
 */

const MERGE_SQL_SQUAD_NAMES_STORAGE_KEY = "config.mergeSql.squadNames";
const DEFAULT_MERGE_SQL_SQUAD_NAMES = [
  "capella",
  "betelgeuse",
  "sirius",
  "bellatrix",
  "phoebe",
  "regulus",
  "canopus",
  "antares",
];

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
    let inSingleQuote = false; // Track if we're inside a single-quoted string

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
          inSingleQuote = false;
        } else if (upperLine.startsWith("INSERT INTO") || upperLine.startsWith("INSERT ")) {
          inStatement = true;
          statementType = "dml";
          currentStatement = [line];
          inSingleQuote = false;
        } else if (upperLine.startsWith("UPDATE ")) {
          inStatement = true;
          statementType = "dml";
          currentStatement = [line];
          inSingleQuote = false;
        } else if (upperLine.startsWith("DELETE FROM") || upperLine.startsWith("DELETE ")) {
          inStatement = true;
          statementType = "dml";
          currentStatement = [line];
          inSingleQuote = false;
        } else if (this.isValidSelectStatement(upperLine)) {
          inStatement = true;
          statementType = "select";
          currentStatement = [line];
          inSingleQuote = false;
        }
      } else {
        currentStatement.push(line);
      }

      // Update quote state for this line (track whether we're inside a string literal)
      if (inStatement) {
        inSingleQuote = this.updateQuoteState(line, inSingleQuote);
      }

      // Detect statement end (semicolon at end of line, but only if not inside a string)
      if (inStatement && trimmedLine.endsWith(";") && !inSingleQuote) {
        const statement = currentStatement.join("\n").trim();

        if (statementType === "dml") {
          result.dmlStatements.push(statement);
        } else if (statementType === "select") {
          result.selectStatements.push(statement);
        }

        currentStatement = [];
        inStatement = false;
        statementType = null;
        inSingleQuote = false;
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
   * Update quote state based on a line of text
   * Counts single quotes to determine if we end inside a string literal
   * Handles escaped quotes ('') in Oracle SQL
   * @param {string} line - Line of text
   * @param {boolean} currentlyInQuote - Whether we're currently inside a quote
   * @returns {boolean} - Whether we're inside a quote after processing this line
   */
  static updateQuoteState(line, currentlyInQuote) {
    let inQuote = currentlyInQuote;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === "'") {
        // Check for escaped quote ('')
        if (i + 1 < line.length && line[i + 1] === "'") {
          i++; // Skip the escaped quote pair
          continue;
        }
        inQuote = !inQuote;
      }
    }
    return inQuote;
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
    const tableSquadMap = new Map();
    const tableSquadFeatureMap = new Map();
    const squadTableMap = new Map();

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

        // Per-table+squad counts
        if (squad) {
          const tableSquadKey = `${key}|${squad.toUpperCase()}`;
          if (!tableSquadMap.has(tableSquadKey)) {
            tableSquadMap.set(tableSquadKey, { table, squad, insert: 0, merge: 0, update: 0, delete: 0 });
          }
          tableSquadMap.get(tableSquadKey)[type]++;

          // Per-table+squad+feature counts (for expandable Table Detail)
          const featureName = feature || null;
          const tableSquadFeatureKey = `${key}|${squad.toUpperCase()}|${(featureName || "").toUpperCase()}`;
          if (!tableSquadFeatureMap.has(tableSquadFeatureKey)) {
            tableSquadFeatureMap.set(tableSquadFeatureKey, {
              table,
              squad,
              feature: featureName,
              insert: 0,
              merge: 0,
              update: 0,
              delete: 0,
            });
          }
          tableSquadFeatureMap.get(tableSquadFeatureKey)[type]++;

          // Per-squad+table counts (for Squad Detail tab)
          const squadTableKey = `${squad.toUpperCase()}|${key}`;
          if (!squadTableMap.has(squadTableKey)) {
            squadTableMap.set(squadTableKey, { squad, table, insert: 0, merge: 0, update: 0, delete: 0 });
          }
          squadTableMap.get(squadTableKey)[type]++;
        }

        // Per-feature counts
        if (feature) {
          const featureKey = feature.toUpperCase();
          if (!featureMap.has(featureKey)) {
            featureMap.set(featureKey, { displayName: feature, squad, insert: 0, merge: 0, update: 0, delete: 0 });
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
        squad: entry.squad,
        insert: entry.insert,
        merge: entry.merge,
        update: entry.update,
        delete: entry.delete,
        total: entry.insert + entry.merge + entry.update + entry.delete,
      }))
      .sort((a, b) => a.feature.toUpperCase().localeCompare(b.feature.toUpperCase()));

    const tableSquadCounts = Array.from(tableSquadMap.values())
      .map((entry) => ({
        table: entry.table,
        squad: entry.squad,
        insert: entry.insert,
        merge: entry.merge,
        update: entry.update,
        delete: entry.delete,
        total: entry.insert + entry.merge + entry.update + entry.delete,
      }))
      .sort((a, b) => {
        const tableCompare = a.table.toUpperCase().localeCompare(b.table.toUpperCase());
        if (tableCompare !== 0) return tableCompare;
        return a.squad.toUpperCase().localeCompare(b.squad.toUpperCase());
      });

    const tableSquadFeatureCounts = Array.from(tableSquadFeatureMap.values())
      .map((entry) => ({
        table: entry.table,
        squad: entry.squad,
        feature: entry.feature,
        insert: entry.insert,
        merge: entry.merge,
        update: entry.update,
        delete: entry.delete,
        total: entry.insert + entry.merge + entry.update + entry.delete,
      }))
      .sort((a, b) => {
        const tableCompare = a.table.toUpperCase().localeCompare(b.table.toUpperCase());
        if (tableCompare !== 0) return tableCompare;
        const squadCompare = a.squad.toUpperCase().localeCompare(b.squad.toUpperCase());
        if (squadCompare !== 0) return squadCompare;
        return (a.feature || "").toUpperCase().localeCompare((b.feature || "").toUpperCase());
      });

    const squadTableCounts = Array.from(squadTableMap.values())
      .map((entry) => ({
        squad: entry.squad,
        table: entry.table,
        insert: entry.insert,
        merge: entry.merge,
        update: entry.update,
        delete: entry.delete,
        total: entry.insert + entry.merge + entry.update + entry.delete,
      }))
      .sort((a, b) => {
        const squadCompare = a.squad.toUpperCase().localeCompare(b.squad.toUpperCase());
        if (squadCompare !== 0) return squadCompare;
        return a.table.toUpperCase().localeCompare(b.table.toUpperCase());
      });

    return { tableCounts, squadCounts, featureCounts, tableSquadCounts, tableSquadFeatureCounts, squadTableCounts };
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

    // Strip trailing SQL clauses that follow WHERE conditions
    const whereClause = match[1]
      .replace(/\s+ORDER\s+BY\b[\s\S]*$/i, "")
      .replace(/\s+GROUP\s+BY\b[\s\S]*$/i, "")
      .replace(/\s+HAVING\b[\s\S]*$/i, "")
      .replace(/\s+FETCH\s+FIRST\b[\s\S]*$/i, "")
      .trim();

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
        dmlLines.push(`--====================================================================================================`);
        dmlLines.push(`-- ${group.groupKey}`);
        dmlLines.push(`--====================================================================================================`);
        dmlLines.push("");
        for (const entry of group.entries) {
          if (entry.dmlStatements.length === 0) continue;
          dmlLines.push(`-- ${entry.subHeader}`);
          for (const stmt of entry.dmlStatements) {
            dmlLines.push(stmt);
            dmlLines.push("");
          }
        }
      } else {
        dmlLines.push(`--====================================================================================================`);
        dmlLines.push(`-- ${group.groupKey}`);
        dmlLines.push(`--====================================================================================================`);
        dmlLines.push("");
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
        selectLines.push(`--====================================================================================================`);
        selectLines.push(`-- ${group.groupKey}`);
        selectLines.push(`--====================================================================================================`);
        selectLines.push("");

        // Count unique squads in this group
        const uniqueSquads = new Set();
        for (const entry of group.entries) {
          if (entry.squadName) {
            uniqueSquads.add(entry.squadName);
          }
        }
        const hasMultipleSquads = uniqueSquads.size > 1;

        // Collect WHERE clauses from all SELECT statements in this group (excluding timestamp verification and FETCH FIRST)
        const whereClauses = [];
        for (const entry of group.entries) {
          for (const stmt of entry.selectStatements) {
            if (this.isFetchFirstStatement(stmt)) continue;
            const where = this.extractWhereClause(stmt);
            if (where) whereClauses.push(where);
          }
        }

        // Output the summary SELECT statement first (only if multiple squads)
        if (hasMultipleSquads) {
          if (whereClauses.length > 0) {
            const combined = whereClauses.map((w) => `(${w})`).join(" OR ");
            selectLines.push(`SELECT * FROM ${group.groupKey} WHERE ${combined};`);
          } else {
            selectLines.push(`SELECT * FROM ${group.groupKey};`);
          }
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
        selectLines.push(`--====================================================================================================`);
        selectLines.push(`-- ${group.groupKey}`);
        selectLines.push(`--====================================================================================================`);
        selectLines.push("");
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
        tableSquadCounts: analysis.tableSquadCounts,
        tableSquadFeatureCounts: analysis.tableSquadFeatureCounts,
        squadTableCounts: analysis.squadTableCounts,
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
   * Load configured squad names from localStorage or fall back to defaults.
   * @returns {string[]}
   */
  static getConfiguredSquadNames() {
    const defaults = [...DEFAULT_MERGE_SQL_SQUAD_NAMES];

    try {
      if (typeof localStorage === "undefined") {
        return defaults;
      }

      const raw = localStorage.getItem(MERGE_SQL_SQUAD_NAMES_STORAGE_KEY);
      if (!raw) {
        return defaults;
      }

      const parsed = JSON.parse(raw);
      const normalized = this.normalizeSquadNames(parsed);
      return normalized.length > 0 ? normalized : defaults;
    } catch {
      return defaults;
    }
  }

  /**
   * Normalize squad names into a unique trimmed list.
   * @param {unknown} squadNames
   * @returns {string[]}
   */
  static normalizeSquadNames(squadNames) {
    if (!Array.isArray(squadNames)) {
      return [];
    }

    const seen = new Set();
    const normalized = [];

    for (const squadName of squadNames) {
      const cleaned = String(squadName ?? "").trim();
      if (!cleaned) continue;

      const key = cleaned.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push(cleaned);
    }

    return normalized;
  }

  /**
   * Parse file name to extract metadata
   * Format: SCHEMA_NAME.TABLE_NAME (SQUAD_NAME)[FEATURE_NAME]
   * @param {string} fileName
   * @returns {{ schemaName: string, tableName: string, squadName: string, featureName: string } | null}
   */
  static parseFileName(fileName) {
    const strict = this.parseStrictFileName(fileName);
    if (strict) {
      return strict;
    }

    return this.parseRelaxedFileName(fileName);
  }

  /**
   * Strict parser for standard file names.
   * Format: SCHEMA_NAME.TABLE_NAME (SQUAD_NAME)[FEATURE_NAME]
   * @param {string} fileName
   * @returns {{ schemaName: string, tableName: string, squadName: string, featureName: string } | null}
   */
  static parseStrictFileName(fileName) {
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

    return null;
  }

  /**
   * Relaxed parser for filenames that start with SCHEMA.TABLE and contain a known squad token.
   * @param {string} fileName
   * @param {string[]} squadNames
   * @returns {{ schemaName: string, tableName: string, squadName: string, featureName: string | null } | null}
   */
  static parseRelaxedFileName(fileName, squadNames = this.getConfiguredSquadNames()) {
    const baseName = fileName.replace(/\.sql$/i, "").trim();
    const prefixMatch = baseName.match(/^([A-Za-z0-9_$#]+)\.([A-Za-z0-9_$#]+)([\s\S]*)$/);

    if (!prefixMatch) {
      return null;
    }

    const [, schemaName, tableName, remainder] = prefixMatch;
    if (!remainder || !remainder.trim()) {
      return null;
    }

    const squadMatch = this.findKnownSquadInText(remainder, squadNames);
    if (!squadMatch) {
      return null;
    }

    return {
      schemaName: schemaName.trim(),
      tableName: tableName.trim(),
      squadName: squadMatch.squadName,
      featureName: this.extractRelaxedFeatureName(remainder, squadMatch),
    };
  }

  /**
   * Find a known squad token in a string using exact token matching.
   * @param {string} text
   * @param {string[]} squadNames
   * @returns {{ squadName: string, start: number, end: number } | null}
   */
  static findKnownSquadInText(text, squadNames) {
    const candidates = this.normalizeSquadNames(squadNames).sort((a, b) => b.length - a.length);

    for (const squadName of candidates) {
      const escaped = squadName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`(^|[^A-Za-z0-9_-])(${escaped})(?=$|[^A-Za-z0-9_-])`, "i");
      const match = regex.exec(text);

      if (!match) continue;

      const prefixLength = match[1]?.length || 0;
      const start = (match.index ?? 0) + prefixLength;
      const matchedText = match[2] || squadName;

      return {
        squadName: matchedText,
        start,
        end: start + matchedText.length,
      };
    }

    return null;
  }

  /**
   * Extract feature name from the suffix that follows the detected squad token.
   * @param {string} remainder
   * @param {{ start: number, end: number }} squadMatch
   * @returns {string|null}
   */
  static extractRelaxedFeatureName(remainder, squadMatch) {
    const suffix = remainder.slice(squadMatch.end);
    const cleaned = suffix.replace(/^[\s\-_\[\]\(\)]+/, "").replace(/[\s\-_\[\]\(\)]+$/, "").trim();
    return cleaned || null;
  }

  /**
   * Build groups from parsed files.
   * Files that resolve to SCHEMA.TABLE are globally grouped by table regardless of adjacency.
   * Files that do not resolve keep the legacy adjacent grouping by raw filename.
   * @param {Array<{ dmlStatements: string[], selectStatements: string[], fileName: string }>} parsedFiles
   * @returns {Array<{ groupKey: string, isStandard: boolean, entries: Array<{ subHeader: string|null, squadName: string|null, featureName: string|null, dmlStatements: string[], selectStatements: string[] }> }>}
   */
  static buildAdjacentGroups(parsedFiles) {
    const groups = [];
    const standardGroupMap = new Map();

    for (const file of parsedFiles) {
      const parsed = this.parseFileName(file.fileName);
      if (parsed) {
        const groupKey = `${parsed.schemaName}.${parsed.tableName}`;
        const subHeader = parsed.featureName ? `${parsed.squadName} - ${parsed.featureName}` : parsed.squadName;
        let group = standardGroupMap.get(groupKey);

        if (!group) {
          group = {
            groupKey,
            isStandard: true,
            entries: [],
          };
          standardGroupMap.set(groupKey, group);
          groups.push(group);
        }

        group.entries.push({
          subHeader,
          squadName: parsed.squadName,
          featureName: parsed.featureName || null,
          dmlStatements: file.dmlStatements,
          selectStatements: file.selectStatements,
        });
      } else {
        const groupKey = file.fileName;
        const lastGroup = groups.length > 0 ? groups[groups.length - 1] : null;

        if (lastGroup && !lastGroup.isStandard && lastGroup.groupKey === groupKey) {
          lastGroup.entries.push({
            subHeader: null,
            squadName: null,
            featureName: null,
            dmlStatements: file.dmlStatements,
            selectStatements: file.selectStatements,
          });
        } else {
          groups.push({
            groupKey,
            isStandard: false,
            entries: [
              {
                subHeader: null,
                squadName: null,
                featureName: null,
                dmlStatements: file.dmlStatements,
                selectStatements: file.selectStatements,
              },
            ],
          });
        }
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
