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
    const statement = String(sql || "")
      .trim()
      .replace(/;\s*$/, "");
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
    if (
      sources.length !== 1 + (masked.match(/\bJOIN\b/gi)?.length || 0) ||
      (!hasJoin &&
        singleTableRemainder &&
        !CLAUSE_PATTERN.test(singleTableRemainder) &&
        !new RegExp(`^${IDENTIFIER}(?:\\s+(?:WHERE|ORDER\\s+BY|FETCH|OFFSET)\\b|\\s*$)`, "i").test(singleTableRemainder))
    ) {
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
    // Oracle reports unquoted names in uppercase; keep the schema's spelling so the grid header matches it.
    const schemaByKey = new Map(schemaFields.map((field) => [String(field).toUpperCase(), field]));
    const selected = star ? [...schemaFields] : selections.map((selection) => (selection[3] || selection[2]).toUpperCase());
    if (validateFields && !star && selected.some((field) => !schemaByKey.has(field))) {
      throw new Error(`Selected fields must exactly match the schema: ${selected.filter((field) => !schemaByKey.has(field)).join(", ")}.`);
    }
    if (new Set(selected.map((field) => String(field).toUpperCase())).size !== selected.length) {
      throw new Error("Each selected field may appear only once.");
    }
    const fields = star ? selected : selected.map((field) => schemaByKey.get(field) ?? field);
    return {
      sql: statement,
      tableName: `${table[1]}.${table[2]}`.toUpperCase(),
      hasJoin,
      star,
      fields,
      sourceTables: [...new Set(sources.map((source) => source.tableName))],
    };
  }

  /**
   * Fetch rows in query.fields order. SELECT * tolerates schema drift: schema fields the
   * live table lacks come back empty and extra live columns are ignored, both reported.
   * @returns {Promise<{ rows: unknown[][], missingFields: string[], extraColumns: string[] }>}
   */
  static async fetch(connection, query, blobFields = new Set()) {
    const result = await OracleConnectionService.queryViaSidecar(connection.name, connection, query.sql, ORACLE_IMPORT_MAX_ROWS);
    if (!Array.isArray(result?.columns) || !Array.isArray(result?.rows)) {
      throw new Error("Oracle returned an unexpected row shape.");
    }
    const columns = result.columns.map((column) => String(column).toUpperCase());
    if (new Set(columns).size !== columns.length) {
      throw new Error("Oracle returned duplicate column names. Alias each column once.");
    }
    const fieldKeys = query.fields.map((field) => String(field).toUpperCase());
    const blobKeys = new Set([...blobFields].map((field) => String(field).toUpperCase()));
    const missingFields = query.fields.filter((field, index) => !columns.includes(fieldKeys[index]));
    const extraColumns = columns.filter((column) => !fieldKeys.includes(column));
    if (missingFields.length === query.fields.length) {
      throw new Error(`None of the returned columns match the schema. Oracle returned: ${columns.join(", ") || "no columns"}.`);
    }
    if (!query.star && (missingFields.length || extraColumns.length)) {
      throw new Error(
        `Oracle returned columns that do not match the selected fields. Missing: ${missingFields.join(", ") || "none"}. ` +
          `Unexpected: ${extraColumns.join(", ") || "none"}.`,
      );
    }
    if (result.rows.some((row) => !Array.isArray(row) || row.length !== columns.length)) {
      throw new Error("Oracle returned an unexpected row shape.");
    }
    const columnIndexes = fieldKeys.map((field) => columns.indexOf(field));
    const rows = result.rows.map((row) =>
      columnIndexes.map((index) => {
        if (index < 0) return null;
        const value = row[index];
        const field = columns[index];
        if (!blobKeys.has(field) || value == null) return value;
        if (value.__adtools_type !== "oracle_blob" || value.encoding !== "base64" || typeof value.data !== "string") {
          throw new Error(`Oracle returned an unsupported BLOB value for ${field}.`);
        }
        // Keep the encoding marker in the cell so generation can distinguish bytes from ordinary BLOB text.
        return `data:application/octet-stream;base64,${value.data}`;
      }),
    );
    return { rows, missingFields, extraColumns };
  }

  /** Short, stable failure label for analytics: an Oracle code when present, else a cause. */
  static classifyError(error) {
    const text = typeof error === "string" ? error : `${error?.rawMessage || ""} ${error?.message || ""}`;
    const code = /\b(ORA|DPY|NJS|PLS)-(\d{1,5})\b/i.exec(text);
    if (code) return code[1].toUpperCase() === "ORA" ? `ORA-${code[2].padStart(5, "0")}` : `${code[1].toUpperCase()}-${code[2]}`;
    if (/do not match|None of the returned columns|duplicate column/i.test(text)) return "column_mismatch";
    if (/unexpected row shape/i.test(text)) return "row_shape";
    if (/BLOB/.test(text)) return "blob";
    if (/selected table changed/i.test(text)) return "table_changed";
    return "other";
  }
}
