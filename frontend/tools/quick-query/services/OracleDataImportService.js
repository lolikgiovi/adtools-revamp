import { OracleConnectionService } from "../../../core/OracleConnectionService.js";

const IDENTIFIER = "[A-Za-z][A-Za-z0-9_$#]*";
const TABLE_PATTERN = new RegExp(`^(${IDENTIFIER})\\.(${IDENTIFIER})(?=\\s|$)`, "i");
const FIELD_PATTERN = new RegExp(`^(?:(${IDENTIFIER})\\.)?(${IDENTIFIER})(?:\\s+(?:AS\\s+)?(${IDENTIFIER}))?$`, "i");
const TABLE_ALIAS_PATTERN = new RegExp(`^(${IDENTIFIER})(?=\\s|$)`, "i");
const CLAUSE_PATTERN = /^(WHERE|ORDER\s+BY|FETCH|OFFSET)\b/i;
export const ORACLE_IMPORT_MAX_ROWS = 1000;

// Mask quoted text and comments so keywords inside filters cannot be mistaken for SQL structure.
function maskSql(sql) {
  let masked = "";
  let state = "code";
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const next = sql[i + 1];
    if (state === "code") {
      if (char === "'" || char === '"') {
        state = char;
        masked += " ";
      } else if (char === "-" && next === "-") {
        state = "line";
        masked += "  ";
        i++;
      } else if (char === "/" && next === "*") {
        state = "block";
        masked += "  ";
        i++;
      } else {
        masked += char;
      }
    } else if (state === "line") {
      masked += char === "\n" ? "\n" : " ";
      if (char === "\n") state = "code";
    } else if (state === "block") {
      masked += " ";
      if (char === "*" && next === "/") {
        masked += " ";
        i++;
        state = "code";
      }
    } else {
      masked += " ";
      if (char === state) {
        if (next === state) {
          masked += " ";
          i++;
        } else {
          state = "code";
        }
      }
    }
  }
  if (state === "block" || state === "'" || state === '"') throw new Error("The SQL contains an unfinished quote or comment.");
  return masked;
}

export class OracleDataImportService {
  static parseQuery(sql, schemaFields, { validateFields = true } = {}) {
    const statement = String(sql || "").trim().replace(/;\s*$/, "");
    const masked = maskSql(statement);
    if (!/^SELECT\s+/i.test(masked) || /;/.test(masked)) {
      throw new Error("Enter one SELECT statement. Other statements are not supported for import.");
    }
    const selectCount = masked.match(/\bSELECT\b/gi)?.length || 0;
    const fromCount = masked.match(/\bFROM\b/gi)?.length || 0;
    if (selectCount !== 1 || fromCount !== 1 || /\b(JOIN|UNION|INTERSECT|MINUS|INTO|FOR\s+UPDATE)\b/i.test(masked)) {
      throw new Error("Import supports one table only, without joins, subqueries, set operations, or FOR UPDATE.");
    }
    const from = /\bFROM\b/i.exec(masked);
    if (!from) throw new Error("The SELECT must include FROM SCHEMA.TABLE.");
    const projection = masked.slice(6, from.index).trim();
    const tablePart = masked.slice(from.index + 4).trimStart();
    const table = TABLE_PATTERN.exec(tablePart);
    if (!table) throw new Error("Use an exact SCHEMA.TABLE name after FROM.");
    let remainder = tablePart.slice(table[0].length).trim();
    let tableAlias = null;
    if (remainder && !CLAUSE_PATTERN.test(remainder)) {
      const alias = TABLE_ALIAS_PATTERN.exec(remainder);
      if (!alias) throw new Error("Import supports one table only.");
      tableAlias = alias[1].toUpperCase();
      remainder = remainder.slice(alias[0].length).trim();
      if (remainder && !CLAUSE_PATTERN.test(remainder)) throw new Error("Import supports one table only.");
    }
    const star = projection === "*" || (tableAlias && projection.toUpperCase() === `${tableAlias}.*`);
    const selections = star ? [] : projection.split(",").map((field) => FIELD_PATTERN.exec(field.trim()));
    if (!star && (!selections.length || selections.some((selection) => !selection))) {
      throw new Error("Select * or field names with optional table qualifiers and aliases, without expressions.");
    }
    if (selections.some((selection) => selection[1] && selection[1].toUpperCase() !== (tableAlias || table[2].toUpperCase()))) {
      throw new Error("Selected field qualifiers must match the queried table or its alias.");
    }
    const fields = star ? [...schemaFields] : selections.map((selection) => (selection[3] || selection[2]).toUpperCase());
    const schemaSet = new Set(schemaFields);
    if (validateFields && fields.some((field) => !schemaSet.has(field))) {
      throw new Error(`Selected fields must exactly match the schema: ${fields.filter((field) => !schemaSet.has(field)).join(", ")}.`);
    }
    if (new Set(fields).size !== fields.length) throw new Error("Each selected field may appear only once.");
    return { sql: statement, tableName: `${table[1]}.${table[2]}`.toUpperCase(), fields };
  }

  static async fetch(connection, query) {
    const result = await OracleConnectionService.queryViaSidecar(
      connection.name, connection, query.sql, ORACLE_IMPORT_MAX_ROWS,
    );
    if (!Array.isArray(result?.columns) || !Array.isArray(result?.rows) ||
      result.columns.length !== query.fields.length ||
      result.columns.some((column, index) => column !== query.fields[index])) {
      throw new Error("Oracle returned columns that do not match the selected schema fields.");
    }
    if (result.rows.some((row) => !Array.isArray(row) || row.length !== query.fields.length)) {
      throw new Error("Oracle returned an unexpected row shape.");
    }
    return result.rows;
  }
}
