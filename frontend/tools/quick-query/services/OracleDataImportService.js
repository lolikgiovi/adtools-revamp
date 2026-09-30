import { OracleConnectionService } from "../../../core/OracleConnectionService.js";

const IDENTIFIER = "[A-Za-z][A-Za-z0-9_$#]*";
const TABLE_PATTERN = new RegExp(`^(${IDENTIFIER})\\.(${IDENTIFIER})(?=\\s|$)`, "i");
const FIELD_PATTERN = new RegExp(`^(?:(${IDENTIFIER})\\.)?(${IDENTIFIER})(?:\\s+(?:AS\\s+)?(${IDENTIFIER}))?$`, "i");
const TABLE_ALIAS_PATTERN = new RegExp(`^(${IDENTIFIER})(?=\\s|$)`, "i");
const CLAUSE_PATTERN = /^(WHERE|ORDER\s+BY|FETCH|OFFSET)\b/i;
const SOURCE_PATTERN = new RegExp(`\\b(FROM|JOIN)\\s+(${IDENTIFIER})\\.(${IDENTIFIER})(?=\\s|$)`, "gi");
const SOURCE_KEYWORDS = /^(ON|USING|JOIN|INNER|LEFT|RIGHT|FULL|OUTER|CROSS|NATURAL|WHERE|ORDER|FETCH|OFFSET)$/i;
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
    if (selectCount !== 1 || fromCount !== 1 || /\b(UNION|INTERSECT|MINUS|INTO|FOR\s+UPDATE)\b/i.test(masked)) {
      throw new Error("Import supports one SELECT without subqueries, set operations, INTO, or FOR UPDATE.");
    }
    const from = /\bFROM\b/i.exec(masked);
    if (!from) throw new Error("The SELECT must include FROM SCHEMA.TABLE.");
    const projection = masked.slice(6, from.index).trim();
    const tablePart = masked.slice(from.index + 4).trimStart();
    const table = TABLE_PATTERN.exec(tablePart);
    if (!table) throw new Error("Use an exact SCHEMA.TABLE name after FROM.");
    const sources = [...masked.matchAll(SOURCE_PATTERN)].map((match) => {
      const remainder = masked.slice(match.index + match[0].length).trimStart();
      const candidate = TABLE_ALIAS_PATTERN.exec(remainder)?.[1];
      return {
        tableName: `${match[2]}.${match[3]}`.toUpperCase(),
        qualifier: candidate && !SOURCE_KEYWORDS.test(candidate) ? candidate.toUpperCase() : match[3].toUpperCase(),
      };
    });
    const hasJoin = /\bJOIN\b/i.test(masked);
    const singleTableRemainder = tablePart.slice(table[0].length).trim();
    if (sources.length !== 1 + (masked.match(/\bJOIN\b/gi)?.length || 0) ||
      (!hasJoin && singleTableRemainder && !CLAUSE_PATTERN.test(singleTableRemainder) &&
        !new RegExp(`^${IDENTIFIER}(?:\\s+(?:WHERE|ORDER\\s+BY|FETCH|OFFSET)\\b|\\s*$)`, "i")
          .test(singleTableRemainder))) {
      throw new Error("Use SCHEMA.TABLE names for each query source.");
    }
    const starQualifier = new RegExp(`^(${IDENTIFIER})\\.\\*$`, "i").exec(projection)?.[1]?.toUpperCase();
    const star = projection === "*" || Boolean(starQualifier);
    if (hasJoin && projection === "*") throw new Error("Select one table's fields with alias.* when joining tables.");
    if (starQualifier && !sources.some((source) => source.qualifier === starQualifier)) {
      throw new Error("Selected field qualifiers must match a queried table or its alias.");
    }
    const selections = star ? [] : projection.split(",").map((field) => FIELD_PATTERN.exec(field.trim()));
    if (!star && (!selections.length || selections.some((selection) => !selection))) {
      throw new Error("Select * or field names with optional table qualifiers and aliases, without expressions.");
    }
    if (selections.some((selection) => selection[1] && !sources.some((source) => source.qualifier === selection[1].toUpperCase()))) {
      throw new Error("Selected field qualifiers must match a queried table or its alias.");
    }
    const fields = star ? [...schemaFields] : selections.map((selection) => (selection[3] || selection[2]).toUpperCase());
    const schemaSet = new Set(schemaFields);
    if (validateFields && fields.some((field) => !schemaSet.has(field))) {
      throw new Error(`Selected fields must exactly match the schema: ${fields.filter((field) => !schemaSet.has(field)).join(", ")}.`);
    }
    if (new Set(fields).size !== fields.length) throw new Error("Each selected field may appear only once.");
    return { sql: statement, tableName: `${table[1]}.${table[2]}`.toUpperCase(), hasJoin, fields };
  }

  static async fetch(connection, query, blobFields = new Set()) {
    const result = await OracleConnectionService.queryViaSidecar(
      connection.name, connection, query.sql, ORACLE_IMPORT_MAX_ROWS,
    );
    if (!Array.isArray(result?.columns) || !Array.isArray(result?.rows) ||
      result.columns.length !== query.fields.length ||
      new Set(result.columns).size !== result.columns.length ||
      result.columns.some((column) => !query.fields.includes(column))) {
      throw new Error("Oracle returned columns that do not match the selected schema fields.");
    }
    if (result.rows.some((row) => !Array.isArray(row) || row.length !== query.fields.length)) {
      throw new Error("Oracle returned an unexpected row shape.");
    }
    const columnIndexes = query.fields.map((field) => result.columns.indexOf(field));
    return result.rows.map((row) => columnIndexes.map((index) => {
      const value = row[index];
      const field = result.columns[index];
      if (!blobFields.has(field) || value == null) return value;
      if (value.__adtools_type !== "oracle_blob" || value.encoding !== "base64" || typeof value.data !== "string") {
        throw new Error(`Oracle returned an unsupported BLOB value for ${field}.`);
      }
      // Keep the encoding marker in the cell so generation can distinguish bytes from ordinary BLOB text.
      return `data:application/octet-stream;base64,${value.data}`;
    }));
  }
}
