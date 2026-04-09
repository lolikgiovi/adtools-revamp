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
  static SELECT_FILTERED_NOTE = "-- No select statement get since the where clause is not by specific key";

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
    let inQuote = false;
    let current = "";

    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === "'") {
        current += ch;
        if (i + 1 < str.length && str[i + 1] === "'") {
          current += str[i + 1];
          i++;
          continue;
        }
        inQuote = !inQuote;
        continue;
      }

      if (inQuote) {
        current += ch;
        continue;
      }

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
   * Remove a trailing semicolon from a statement.
   * @param {string} statement
   * @returns {string}
   */
  static stripTrailingSemicolon(statement) {
    return String(statement || "").replace(/;\s*$/, "").trim();
  }

  /**
   * Extract target table name from a DML statement.
   * @param {string} statement
   * @returns {string|null}
   */
  static extractTargetTableName(statement) {
    const trimmed = String(statement || "").trimStart();
    let table = null;

    if (/^INSERT\b/i.test(trimmed)) {
      table = trimmed.match(/INSERT\s+INTO\s+(\S+)/i)?.[1] || null;
    } else if (/^MERGE\b/i.test(trimmed)) {
      table = trimmed.match(/MERGE\s+INTO\s+(\S+)/i)?.[1] || trimmed.match(/MERGE\s+(\S+)/i)?.[1] || null;
    } else if (/^UPDATE\b/i.test(trimmed)) {
      table = trimmed.match(/UPDATE\s+(\S+)/i)?.[1] || null;
    } else if (/^DELETE\b/i.test(trimmed)) {
      table = trimmed.match(/DELETE\s+FROM\s+(\S+)/i)?.[1] || trimmed.match(/DELETE\s+(\S+)/i)?.[1] || null;
    }

    if (!table) return null;

    const parenIdx = table.indexOf("(");
    return parenIdx === -1 ? table : table.slice(0, parenIdx);
  }

  /**
   * Find the matching closing parenthesis starting at the given open index.
   * @param {string} text
   * @param {number} openIndex
   * @returns {number}
   */
  static findMatchingParen(text, openIndex) {
    let depth = 0;
    let inQuote = false;

    for (let i = openIndex; i < text.length; i++) {
      const ch = text[i];
      if (ch === "'") {
        if (i + 1 < text.length && text[i + 1] === "'") {
          i++;
          continue;
        }
        inQuote = !inQuote;
        continue;
      }

      if (inQuote) continue;

      if (ch === "(") {
        depth++;
      } else if (ch === ")") {
        depth--;
        if (depth === 0) {
          return i;
        }
      }
    }

    return -1;
  }

  /**
   * Trim outer parentheses that wrap the full expression.
   * @param {string} value
   * @returns {string}
   */
  static trimOuterParentheses(value) {
    let current = String(value || "").trim();

    while (current.startsWith("(") && current.endsWith(")")) {
      const closingIndex = this.findMatchingParen(current, 0);
      if (closingIndex !== current.length - 1) break;
      current = current.slice(1, -1).trim();
    }

    return current;
  }

  /**
   * Check if a character is a keyword boundary.
   * @param {string} ch
   * @returns {boolean}
   */
  static isKeywordBoundaryChar(ch) {
    return !ch || !/[A-Za-z0-9_$#]/.test(ch);
  }

  /**
   * Match a sequence of SQL keywords with flexible whitespace.
   * @param {string} upperText
   * @param {number} start
   * @param {string[]} words
   * @returns {number|null}
   */
  static matchKeywordSequenceAt(upperText, start, words) {
    const before = start === 0 ? "" : upperText[start - 1];
    if (!this.isKeywordBoundaryChar(before)) {
      return null;
    }

    let index = start;
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (!upperText.startsWith(word, index)) {
        return null;
      }
      index += word.length;

      if (i < words.length - 1) {
        const whitespaceMatch = upperText.slice(index).match(/^\s+/);
        if (!whitespaceMatch) {
          return null;
        }
        index += whitespaceMatch[0].length;
      }
    }

    const after = upperText[index] || "";
    return this.isKeywordBoundaryChar(after) ? index - start : null;
  }

  /**
   * Split SQL text by a top-level keyword sequence.
   * @param {string} text
   * @param {string[]} words
   * @returns {string[]}
   */
  static splitTopLevelByKeywordSequence(text, words) {
    const parts = [];
    const upperText = text.toUpperCase();
    let start = 0;
    let depth = 0;
    let inQuote = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === "'") {
        if (i + 1 < text.length && text[i + 1] === "'") {
          i++;
          continue;
        }
        inQuote = !inQuote;
        continue;
      }

      if (inQuote) continue;

      if (ch === "(") {
        depth++;
        continue;
      }
      if (ch === ")") {
        depth = Math.max(0, depth - 1);
        continue;
      }

      if (depth === 0) {
        const matchLength = this.matchKeywordSequenceAt(upperText, i, words);
        if (matchLength) {
          parts.push(text.slice(start, i).trim());
          i += matchLength - 1;
          start = i + 1;
        }
      }
    }

    const tail = text.slice(start).trim();
    if (tail) parts.push(tail);
    return parts;
  }

  /**
   * Parse a simple column reference such as alias.column or column.
   * @param {string} value
   * @returns {{ alias: string|null, column: string }|null}
   */
  static parseSimpleColumnReference(value) {
    const trimmed = this.trimOuterParentheses(value);
    const match = trimmed.match(/^(?:(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$#]*)\.)?(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$#]*)$/);
    if (!match) return null;

    const dotIndex = trimmed.lastIndexOf(".");
    if (dotIndex === -1) {
      return { alias: null, column: trimmed };
    }

    return {
      alias: trimmed.slice(0, dotIndex).trim(),
      column: trimmed.slice(dotIndex + 1).trim(),
    };
  }

  /**
   * Parse a supported literal value.
   * @param {string} value
   * @returns {{ sql: string, isNull: boolean }|null}
   */
  static parseLiteralValue(value) {
    const trimmed = this.trimOuterParentheses(String(value || "").trim());
    if (!trimmed) return null;

    if (/^NULL$/i.test(trimmed)) {
      return { sql: "NULL", isNull: true };
    }

    if (/^[+-]?\d+(?:\.\d+)?$/i.test(trimmed)) {
      return { sql: trimmed, isNull: false };
    }

    if (/^'(?:''|[\s\S])*'$/.test(trimmed)) {
      return { sql: trimmed, isNull: false };
    }

    return null;
  }

  /**
   * Parse an aliased SELECT field expression.
   * @param {string} fieldText
   * @returns {{ expression: string, alias: string }|null}
   */
  static parseSelectField(fieldText) {
    const trimmed = String(fieldText || "").trim();
    if (!trimmed) return null;

    const asMatch = trimmed.match(/^([\s\S]+?)\s+AS\s+("[^"]+"|[A-Za-z_][A-Za-z0-9_$#]*)$/i);
    if (asMatch) {
      return {
        expression: asMatch[1].trim(),
        alias: asMatch[2].trim(),
      };
    }

    const plainMatch = trimmed.match(/^([\s\S]+?)\s+("[^"]+"|[A-Za-z_][A-Za-z0-9_$#]*)$/);
    if (plainMatch) {
      return {
        expression: plainMatch[1].trim(),
        alias: plainMatch[2].trim(),
      };
    }

    return null;
  }

  /**
   * Parse inline SELECT ... FROM DUAL [UNION ALL ...] rows.
   * @param {string} sql
   * @returns {Array<Record<string, string>>|null}
   */
  static parseInlineDualSelectRows(sql) {
    const segments = this.splitTopLevelByKeywordSequence(String(sql || "").trim(), ["UNION", "ALL"]);
    if (segments.length === 0) return null;

    const rows = [];
    for (const segment of segments) {
      const trimmed = this.stripTrailingSemicolon(segment);
      const match = trimmed.match(/^SELECT\s+([\s\S]+?)\s+FROM\s+DUAL\s*$/i);
      if (!match) return null;

      const fields = this.splitParenAware(match[1]);
      if (fields.length === 0) return null;

      const row = {};
      for (const field of fields) {
        const parsedField = this.parseSelectField(field);
        if (!parsedField) return null;
        row[parsedField.alias.toUpperCase()] = parsedField.expression;
      }
      rows.push(row);
    }

    return rows;
  }

  /**
   * Convert literal column/value pairs into predicate rows.
   * @param {string[]} columns
   * @param {string[]} values
   * @returns {{ rows: Array<Array<{ column: string, valueSql: string|null }>>, rowCount: number, reason?: string }|null}
   */
  static buildPredicateRowsFromColumnsAndValues(columns, values) {
    if (!Array.isArray(columns) || columns.length === 0 || columns.length !== values.length) {
      return null;
    }

    const row = [];
    for (let i = 0; i < columns.length; i++) {
      const column = columns[i].trim();
      const literal = this.parseLiteralValue(values[i]);
      if (!column || !literal) {
        return {
          rows: [],
          rowCount: 0,
          reason: "contains non-literal source values",
        };
      }

      row.push({
        column,
        valueSql: literal.isNull ? null : literal.sql,
      });
    }

    return {
      rows: this.dedupePredicateRows([row]),
      rowCount: 1,
    };
  }

  /**
   * Deduplicate predicate rows without changing row_in_query semantics.
   * @param {Array<Array<{ column: string, valueSql: string|null }>>} rows
   * @returns {Array<Array<{ column: string, valueSql: string|null }>>}
   */
  static dedupePredicateRows(rows) {
    const seen = new Set();
    const deduped = [];

    for (const row of rows) {
      const key = row
        .map((condition) => `${condition.column.toUpperCase()}=${condition.valueSql === null ? "NULL" : condition.valueSql}`)
        .sort()
        .join("|");

      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(row);
    }

    return deduped;
  }

  /**
   * Render a single predicate condition.
   * @param {{ column: string, valueSql: string|null }} condition
   * @returns {string}
   */
  static renderPredicateCondition(condition) {
    return condition.valueSql === null ? `${condition.column} IS NULL` : `${condition.column} = ${condition.valueSql}`;
  }

  /**
   * Render predicate rows into a WHERE clause body.
   * @param {Array<Array<{ column: string, valueSql: string|null }>>} rows
   * @returns {string|null}
   */
  static renderPredicateRows(rows) {
    if (!rows || rows.length === 0) return null;

    const singleColumnRows = rows.every((row) => row.length === 1 && row[0].valueSql !== null);
    const singleColumnName = singleColumnRows ? rows[0][0].column : null;
    const sameColumn = singleColumnRows && rows.every((row) => row[0].column.toUpperCase() === singleColumnName.toUpperCase());

    if (sameColumn) {
      if (rows.length === 1) {
        return this.renderPredicateCondition(rows[0][0]);
      }
      const values = rows.map((row) => row[0].valueSql);
      return `${singleColumnName} IN (${values.join(", ")})`;
    }

    const singleConditionGroups = new Map();
    const renderedParts = [];

    for (const row of rows) {
      if (row.length !== 1) {
        const body = row.map((condition) => this.renderPredicateCondition(condition)).join(" AND ");
        renderedParts.push(`(${body})`);
        continue;
      }

      const condition = row[0];
      const key = condition.column.toUpperCase();
      if (!singleConditionGroups.has(key)) {
        singleConditionGroups.set(key, {
          column: condition.column,
          values: [],
        });
      }

      singleConditionGroups.get(key).values.push(condition.valueSql);
    }

    for (const group of singleConditionGroups.values()) {
      const nonNullValues = group.values.filter((value) => value !== null);
      const hasNull = group.values.some((value) => value === null);
      const groupParts = [];

      if (nonNullValues.length === 1) {
        groupParts.push(`${group.column} = ${nonNullValues[0]}`);
      } else if (nonNullValues.length > 1) {
        groupParts.push(`${group.column} IN (${nonNullValues.join(", ")})`);
      }

      if (hasNull) {
        groupParts.push(`${group.column} IS NULL`);
      }

      if (groupParts.length === 1) {
        renderedParts.push(groupParts[0]);
      } else if (groupParts.length > 1) {
        renderedParts.push(`(${groupParts.join(" OR ")})`);
      }
    }

    return renderedParts.join(" OR ");
  }

  /**
   * Parse an atomic exact predicate condition.
   * @param {string} conditionText
   * @returns {{ column: string, values: Array<string|null> }|null}
   */
  static parseAtomicPredicateCondition(conditionText) {
    const trimmed = this.trimOuterParentheses(conditionText);
    if (!trimmed) return null;

    const isNullMatch = trimmed.match(/^(.+?)\s+IS\s+NULL$/i);
    if (isNullMatch) {
      const columnRef = this.parseSimpleColumnReference(isNullMatch[1]);
      if (!columnRef) return null;
      return { column: columnRef.column, values: [null] };
    }

    const inMatch = trimmed.match(/^(.+?)\s+IN\s*\(([\s\S]+)\)$/i);
    if (inMatch) {
      const columnRef = this.parseSimpleColumnReference(inMatch[1]);
      if (!columnRef) return null;

      const rawValues = this.splitParenAware(inMatch[2]).map((value) => value.trim()).filter(Boolean);
      if (rawValues.length === 0) return null;

      const parsedValues = [];
      for (const rawValue of rawValues) {
        const literal = this.parseLiteralValue(rawValue);
        if (!literal) return null;
        parsedValues.push(literal.isNull ? null : literal.sql);
      }

      return { column: columnRef.column, values: parsedValues };
    }

    const equalsMatch = trimmed.match(/^(.+?)\s*=\s*([\s\S]+)$/);
    if (!equalsMatch) return null;

    const leftRef = this.parseSimpleColumnReference(equalsMatch[1]);
    const rightRef = this.parseSimpleColumnReference(equalsMatch[2]);
    const leftLiteral = this.parseLiteralValue(equalsMatch[1]);
    const rightLiteral = this.parseLiteralValue(equalsMatch[2]);

    if (leftRef && rightLiteral) {
      return { column: leftRef.column, values: [rightLiteral.isNull ? null : rightLiteral.sql] };
    }
    if (rightRef && leftLiteral) {
      return { column: rightRef.column, values: [leftLiteral.isNull ? null : leftLiteral.sql] };
    }

    return null;
  }

  /**
   * Parse a WHERE clause into exact predicate rows.
   * @param {string} whereClause
   * @returns {{ rows: Array<Array<{ column: string, valueSql: string|null }>>, rowCount: number, reason?: string }|null}
   */
  static parseExactPredicateRows(whereClause) {
    const normalized = this.trimOuterParentheses(this.stripTrailingSemicolon(whereClause));
    if (!normalized) {
      return { rows: [], rowCount: 0, reason: "missing WHERE clause" };
    }

    const orGroups = this.splitTopLevelByKeywordSequence(normalized, ["OR"]);
    if (orGroups.length === 0) {
      return { rows: [], rowCount: 0, reason: "unsupported WHERE shape" };
    }

    const rows = [];
    for (const group of orGroups) {
      const andConditions = this.splitTopLevelByKeywordSequence(this.trimOuterParentheses(group), ["AND"]);
      if (andConditions.length === 0) {
        return { rows: [], rowCount: 0, reason: "unsupported WHERE shape" };
      }

      let rowVariants = [[]];
      for (const conditionText of andConditions) {
        const parsedCondition = this.parseAtomicPredicateCondition(conditionText);
        if (!parsedCondition) {
          return { rows: [], rowCount: 0, reason: "unsupported WHERE shape" };
        }

        const nextVariants = [];
        for (const variant of rowVariants) {
          for (const valueSql of parsedCondition.values) {
            nextVariants.push([
              ...variant,
              {
                column: parsedCondition.column,
                valueSql,
              },
            ]);
          }
        }
        rowVariants = nextVariants;
      }

      rows.push(...rowVariants);
    }

    const dedupedRows = this.dedupePredicateRows(rows);
    return {
      rows: dedupedRows,
      rowCount: dedupedRows.length,
    };
  }

  /**
   * Extract the inline USING subquery content from a MERGE statement.
   * @param {string} statement
   * @returns {{ targetAlias: string|null, sourceAlias: string|null, usingContent: string, onClause: string }|null}
   */
  static extractMergeUsingContent(statement) {
    const mergeMatch = String(statement || "").match(/MERGE\s+INTO\s+\S+(?:\s+("[^"]+"|[A-Za-z_][A-Za-z0-9_$#]*))?\s+USING\b/i);
    if (!mergeMatch) return null;

    const usingMatch = /\bUSING\b/i.exec(statement);
    if (!usingMatch) return null;

    const openParenIndex = statement.indexOf("(", usingMatch.index);
    if (openParenIndex === -1) return null;

    const closeParenIndex = this.findMatchingParen(statement, openParenIndex);
    if (closeParenIndex === -1) return null;

    const afterUsing = statement.slice(closeParenIndex + 1);
    const afterUsingMatch = afterUsing.match(/^\s*("[^"]+"|[A-Za-z_][A-Za-z0-9_$#]*)?\s*ON\s*\(/i);
    if (!afterUsingMatch) return null;

    const onKeywordMatch = /\bON\s*\(/i.exec(afterUsing);
    if (!onKeywordMatch) return null;
    const onOpenParenIndex = closeParenIndex + 1 + onKeywordMatch.index + onKeywordMatch[0].lastIndexOf("(");
    const onCloseParenIndex = this.findMatchingParen(statement, onOpenParenIndex);
    if (onCloseParenIndex === -1) return null;

    return {
      targetAlias: mergeMatch[1] ? mergeMatch[1].trim() : null,
      sourceAlias: afterUsingMatch[1] ? afterUsingMatch[1].trim() : null,
      usingContent: statement.slice(openParenIndex + 1, closeParenIndex).trim(),
      onClause: statement.slice(onOpenParenIndex + 1, onCloseParenIndex).trim(),
    };
  }

  /**
   * Build validation data for a MERGE statement.
   * @param {string} statement
   * @param {string} tableName
   * @returns {{ tableName: string, rowInQuery: number, whereClause: string, predicateRows: Array<Array<{ column: string, valueSql: string|null }>> }|{ reason: string }}
   */
  static buildMergeValidationEntry(statement, tableName) {
    const mergeInfo = this.extractMergeUsingContent(statement);
    if (!mergeInfo) {
      return { reason: "unsupported USING clause" };
    }

    const sourceRows = this.parseInlineDualSelectRows(mergeInfo.usingContent);
    if (!sourceRows || sourceRows.length === 0) {
      return { reason: "unsupported USING source rows" };
    }

    const onConditions = this.splitTopLevelByKeywordSequence(mergeInfo.onClause, ["AND"]);
    if (onConditions.length === 0) {
      return { reason: "unsupported ON clause" };
    }

    const mappings = [];
    for (const conditionText of onConditions) {
      const equalityMatch = this.trimOuterParentheses(conditionText).match(/^(.+?)\s*=\s*([\s\S]+)$/);
      if (!equalityMatch) {
        return { reason: "unsupported ON clause" };
      }

      const leftRef = this.parseSimpleColumnReference(equalityMatch[1]);
      const rightRef = this.parseSimpleColumnReference(equalityMatch[2]);
      if (!leftRef || !rightRef) {
        return { reason: "unsupported ON clause" };
      }

      let targetRef = null;
      let sourceRef = null;
      const leftAlias = leftRef.alias ? leftRef.alias.toUpperCase() : null;
      const rightAlias = rightRef.alias ? rightRef.alias.toUpperCase() : null;
      const targetAlias = mergeInfo.targetAlias ? mergeInfo.targetAlias.toUpperCase() : null;
      const sourceAlias = mergeInfo.sourceAlias ? mergeInfo.sourceAlias.toUpperCase() : null;

      if (targetAlias && leftAlias === targetAlias) {
        targetRef = leftRef;
        sourceRef = rightRef;
      } else if (targetAlias && rightAlias === targetAlias) {
        targetRef = rightRef;
        sourceRef = leftRef;
      } else if (sourceAlias && leftAlias === sourceAlias) {
        targetRef = rightRef;
        sourceRef = leftRef;
      } else if (sourceAlias && rightAlias === sourceAlias) {
        targetRef = leftRef;
        sourceRef = rightRef;
      } else if (leftRef.alias === null && sourceAlias && rightAlias === sourceAlias) {
        targetRef = leftRef;
        sourceRef = rightRef;
      } else if (rightRef.alias === null && sourceAlias && leftAlias === sourceAlias) {
        targetRef = rightRef;
        sourceRef = leftRef;
      } else if (leftRef.alias === null && targetAlias && rightRef.alias === null) {
        return { reason: "ambiguous ON clause aliases" };
      } else {
        return { reason: "unsupported ON clause" };
      }

      mappings.push({
        targetColumn: targetRef.column,
        sourceColumn: sourceRef.column,
      });
    }

    const predicateRows = [];
    for (const sourceRow of sourceRows) {
      const rowConditions = [];
      for (const mapping of mappings) {
        const sourceExpression = sourceRow[mapping.sourceColumn.toUpperCase()];
        const literal = this.parseLiteralValue(sourceExpression);
        if (!literal) {
          return { reason: "contains non-literal source values" };
        }

        rowConditions.push({
          column: mapping.targetColumn,
          valueSql: literal.isNull ? null : literal.sql,
        });
      }
      predicateRows.push(rowConditions);
    }

    const dedupedPredicateRows = this.dedupePredicateRows(predicateRows);
    const whereClause = this.renderPredicateRows(dedupedPredicateRows);
    if (!whereClause) {
      return { reason: "unable to infer exact predicate" };
    }

    return {
      tableName,
      rowInQuery: sourceRows.length,
      whereClause,
      predicateRows: dedupedPredicateRows,
    };
  }

  /**
   * Build validation data for an INSERT statement.
   * @param {string} statement
   * @param {string} tableName
   * @returns {{ tableName: string, rowInQuery: number, whereClause: string, predicateRows: Array<Array<{ column: string, valueSql: string|null }>> }|{ reason: string }}
   */
  static buildInsertValidationEntry(statement, tableName) {
    const insertMatch = this.stripTrailingSemicolon(statement).match(/INSERT\s+INTO\s+\S+\s*\(([\s\S]+?)\)\s*([\s\S]+)$/i);
    if (!insertMatch) {
      return { reason: "unsupported INSERT shape" };
    }

    const columns = this.splitParenAware(insertMatch[1]).map((column) => column.trim()).filter(Boolean);
    if (columns.length === 0) {
      return { reason: "missing INSERT columns" };
    }

    const sourceSql = insertMatch[2].trim();
    let rowsResult = null;
    let rowInQuery = 0;

    if (/^VALUES\s*\(/i.test(sourceSql)) {
      const openParenIndex = sourceSql.indexOf("(");
      const closeParenIndex = this.findMatchingParen(sourceSql, openParenIndex);
      if (openParenIndex === -1 || closeParenIndex === -1) {
        return { reason: "unsupported VALUES clause" };
      }

      const values = this.splitParenAware(sourceSql.slice(openParenIndex + 1, closeParenIndex)).map((value) => value.trim());
      rowsResult = this.buildPredicateRowsFromColumnsAndValues(columns, values);
      rowInQuery = 1;
    } else if (/^SELECT\b/i.test(sourceSql)) {
      const sourceRows = this.parseInlineDualSelectRows(sourceSql);
      if (!sourceRows || sourceRows.length === 0) {
        return { reason: "unsupported INSERT source rows" };
      }

      const predicateRows = [];
      for (const sourceRow of sourceRows) {
        const values = [];
        for (const column of columns) {
          const expression = sourceRow[column.toUpperCase()];
          if (typeof expression === "undefined") {
            return { reason: "INSERT source columns do not align" };
          }
          values.push(expression);
        }

        const rowResult = this.buildPredicateRowsFromColumnsAndValues(columns, values);
        if (!rowResult || rowResult.reason) {
          return { reason: rowResult?.reason || "contains non-literal source values" };
        }
        predicateRows.push(...rowResult.rows);
      }

      rowsResult = {
        rows: this.dedupePredicateRows(predicateRows),
        rowCount: sourceRows.length,
      };
      rowInQuery = sourceRows.length;
    } else {
      return { reason: "unsupported INSERT source" };
    }

    if (!rowsResult || rowsResult.reason) {
      return { reason: rowsResult?.reason || "unable to infer exact predicate" };
    }

    const whereClause = this.renderPredicateRows(rowsResult.rows);
    if (!whereClause) {
      return { reason: "unable to infer exact predicate" };
    }

    return {
      tableName,
      rowInQuery,
      whereClause,
      predicateRows: rowsResult.rows,
    };
  }

  /**
   * Build validation data for an UPDATE or DELETE statement.
   * @param {string} statement
   * @param {string} tableName
   * @returns {{ tableName: string, rowInQuery: number, whereClause: string, predicateRows: Array<Array<{ column: string, valueSql: string|null }>> }|{ reason: string }}
   */
  static buildUpdateDeleteValidationEntry(statement, tableName) {
    const whereMatch = this.stripTrailingSemicolon(statement).match(/\bWHERE\b\s+([\s\S]+)$/i);
    if (!whereMatch) {
      return { reason: "missing WHERE clause" };
    }

    const parsedRows = this.parseExactPredicateRows(whereMatch[1]);
    if (!parsedRows || parsedRows.reason || parsedRows.rows.length === 0) {
      return { reason: parsedRows?.reason || "unsupported WHERE shape" };
    }

    const whereClause = this.renderPredicateRows(parsedRows.rows);
    if (!whereClause) {
      return { reason: "unable to infer exact predicate" };
    }

    return {
      tableName,
      rowInQuery: parsedRows.rowCount,
      whereClause,
      predicateRows: parsedRows.rows,
    };
  }

  /**
   * Render a validation SELECT block.
   * @param {{ tableName: string, rowInQuery: number, whereClause: string }} entry
   * @returns {string}
   */
  static renderValidationSelect(entry) {
    const rowInQuery = entry.rowInQuery;
    return [
      "SELECT",
      `  '${entry.tableName}' AS table_name,`,
      `  ${rowInQuery} AS expectation,`,
      "  COUNT(*) AS row_in_table,",
      `  CASE`,
      `    WHEN COUNT(*) = ${rowInQuery} THEN 'MATCH'`,
      `    WHEN COUNT(*) > ${rowInQuery} THEN '+' || TO_CHAR(COUNT(*) - ${rowInQuery})`,
      `    ELSE '-' || TO_CHAR(${rowInQuery} - COUNT(*))`,
      `  END AS result`,
      `FROM ${entry.tableName}`,
      `WHERE ${entry.whereClause}`,
    ].join("\n");
  }

  /**
   * Group validation entries by table for a higher-level summary.
   * @param {Array<{ tableName: string, rowInQuery: number, whereClause: string, predicateRows: Array<Array<{ column: string, valueSql: string|null }>> }>} entries
   * @returns {Array<{ tableName: string, rowInQuery: number, whereClause: string, predicateRows: Array<Array<{ column: string, valueSql: string|null }>> }>}
   */
  static groupValidationEntries(entries) {
    const grouped = new Map();

    for (const entry of entries) {
      const key = entry.tableName.toUpperCase();
      if (!grouped.has(key)) {
        grouped.set(key, {
          tableName: entry.tableName,
          rowInQuery: 0,
          predicateRows: [],
        });
      }

      const current = grouped.get(key);
      current.rowInQuery += entry.rowInQuery;
      current.predicateRows.push(...(entry.predicateRows || []));
    }

    return Array.from(grouped.values()).map((entry) => {
      const predicateRows = this.dedupePredicateRows(entry.predicateRows);
      return {
        tableName: entry.tableName,
        rowInQuery: entry.rowInQuery,
        predicateRows,
        whereClause: this.renderPredicateRows(predicateRows),
      };
    });
  }

  /**
   * Build a validation result or skip reason for a DML statement.
   * @param {string} statement
   * @param {string} fileName
   * @returns {{ entry: { tableName: string, rowInQuery: number, whereClause: string } | null, comment: string | null }}
   */
  static buildValidationEntry(statement, fileName) {
    const trimmed = String(statement || "").trimStart();
    const statementType = trimmed.match(/^(MERGE|INSERT|UPDATE|DELETE)\b/i)?.[1]?.toUpperCase() || "DML";
    const tableName = this.extractTargetTableName(trimmed);

    if (!tableName) {
      return {
        entry: null,
        comment: `-- Skipped ${statementType} in ${fileName}: unable to determine target table`,
      };
    }

    let result = null;
    if (statementType === "MERGE") {
      result = this.buildMergeValidationEntry(trimmed, tableName);
    } else if (statementType === "INSERT") {
      result = this.buildInsertValidationEntry(trimmed, tableName);
    } else if (statementType === "UPDATE" || statementType === "DELETE") {
      result = this.buildUpdateDeleteValidationEntry(trimmed, tableName);
    }

    if (!result || result.reason) {
      return {
        entry: null,
        comment: `-- Skipped ${statementType} on ${tableName} in ${fileName}: ${result?.reason || "unsupported statement shape"}`,
      };
    }

    return {
      entry: result,
      comment: null,
    };
  }

  /**
   * Build the Validation SQL output from parsed files.
   * @param {Array<{ dmlStatements: string[], selectStatements: string[], fileName: string }>} parsedFiles
   * @returns {string}
   */
  static buildValidationSql(parsedFiles) {
    const comments = [];
    const entries = [];

    for (const file of parsedFiles) {
      for (const statement of file.dmlStatements) {
        const result = this.buildValidationEntry(statement, file.fileName);
        if (result.comment) {
          comments.push(result.comment);
        }
        if (result.entry) {
          entries.push(result.entry);
        }
      }
    }

    const lines = [];
    if (comments.length > 0) {
      lines.push(...comments);
    }

    if (entries.length > 0) {
      if (lines.length > 0) lines.push("");
      const groupedEntries = this.groupValidationEntries(entries).filter((entry) => entry.whereClause);
      lines.push(`${groupedEntries.map((entry) => this.renderValidationSelect(entry)).join("\nUNION ALL\n")};`);
    } else if (lines.length === 0) {
      return "";
    }

    return lines.join("\n").trim();
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
   * @returns {{ mergedSql: string, selectSql: string, validationSql: string, duplicates: Array<{ statement: string, files: string[] }>, report: { statementCounts: Array, nonSystemAuthors: Array } }}
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
        let hasRenderedSelectContent = false;

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
            hasRenderedSelectContent = true;
          } else {
            selectLines.push(`SELECT * FROM ${group.groupKey};`);
            hasRenderedSelectContent = true;
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
            hasRenderedSelectContent = true;
          }
        }

        if (!hasRenderedSelectContent) {
          selectLines.push(this.SELECT_FILTERED_NOTE);
        }
      } else {
        // Non-standard files: output the original SELECT statements (excluding timestamp verification and FETCH FIRST)
        selectLines.push(`--====================================================================================================`);
        selectLines.push(`-- ${group.groupKey}`);
        selectLines.push(`--====================================================================================================`);
        selectLines.push("");
        let hasRenderedSelectContent = false;
        for (const entry of group.entries) {
          for (const stmt of entry.selectStatements) {
            if (this.isFetchFirstStatement(stmt)) continue;
            const whereClause = stmt.match(/\bWHERE\b\s+([\s\S]+?)\s*;?\s*$/i);
            if (whereClause && this.isTimestampVerificationClause(whereClause[1].trim())) {
              continue; // Skip timestamp verification statements
            }
            selectLines.push(stmt);
            selectLines.push("");
            hasRenderedSelectContent = true;
          }
        }

        if (!hasRenderedSelectContent) {
          selectLines.push(this.SELECT_FILTERED_NOTE);
        }
      }
    }

    const validationSql = this.buildValidationSql(parsedFiles);
    const analysis = this.analyzeStatements(parsedFiles);

    return {
      mergedSql: dmlLines.join("\n").trim(),
      selectSql: selectLines.join("\n").trim(),
      validationSql,
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
