import { schemaFieldKey, validateFieldNames } from "./SchemaValidationService.js";

// Schema import helpers for DBeaver clipboard rows and canonical AD Tools schema JSON.
// JSON shape: { schemaName: { tables: { tableName: { columns, pk?, unique? } } } }
export const DBEAVER_SCHEMA_HEADERS = ["Column Name", "#", "Type", "Type Mod", "Not Null", "Default", "Comment"];

const headerKey = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, " ");

export function isDbeaverSchemaRows(rows) {
  return Array.isArray(rows?.[0]) && rows[0].some((cell) => headerKey(cell) === "column name");
}

export function normalizeDbeaverSchemaRows(rows) {
  if (!isDbeaverSchemaRows(rows)) {
    throw new Error("Clipboard does not look like a DBeaver column export. Use Copy Advanced Info in DBeaver’s Columns view.");
  }
  const headers = rows[0].map(headerKey);
  const indexOf = (...names) => names.map((name) => headers.indexOf(name)).find((index) => index >= 0) ?? -1;
  const indexes = [
    indexOf("column name"),
    indexOf("#", "ordinal position", "order"),
    indexOf("type name", "type", "data type", "column type"),
    indexOf("type mod", "type modifier"),
    indexOf("not null"),
    indexOf("default", "default value"),
    indexOf("comment", "comments"),
  ];
  if (indexes[2] < 0 || indexes[4] < 0) {
    throw new Error("Include the Type and Not Null columns when copying from DBeaver.");
  }
  return rows
    .slice(1)
    .filter((row) => row.some((cell) => String(cell ?? "").trim()))
    .map((row, rowIndex) =>
      indexes.map((column, index) => (index === 1 && column < 0 ? String(rowIndex + 1) : String(row[column] ?? "").trim())),
    );
}

export function parseClipboardRows(text) {
  if (!text || !text.trim()) {
    throw new Error("Clipboard is empty. Copy columns from DBeaver first.");
  }

  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => line.split("\t").map((cell) => cell.trim()));
}

export function convertDbeaverSchemaRows(rows) {
  const dataRows = normalizeDbeaverSchemaRows(rows);

  if (dataRows.length === 0) {
    throw new Error("No DBeaver columns found in clipboard.");
  }

  const fields = new Set();
  return dataRows.map((row, idx) => {
    if (!row[0] || !row[2]) throw new Error(`Row ${idx + 1}: Column Name and Type are required.`);
    if (row[1] && !/^[1-9]\d*$/.test(row[1])) throw new Error(`Row ${idx + 1}: # must be a positive whole number.`);
    const field = schemaFieldKey(row[0]);
    if (fields.has(field)) throw new Error(`Row ${idx + 1}: duplicate column name “${row[0]}”.`);
    fields.add(field);
    const notNull = row[4].toLowerCase();
    const checked = ["true", "yes", "y", "1", "[v]", "[x]", "☑", "✓"];
    const unchecked = ["false", "no", "n", "0", "", "[ ]", "[]", "☐"];
    if (!checked.includes(notNull) && !unchecked.includes(notNull)) {
      throw new Error(`Row ${idx + 1}: Not Null must be true or false.`);
    }
    const nullable = checked.includes(notNull) ? "No" : "Yes";
    const defaultValue = row[5] === "[NULL]" ? "" : row[5];

    return [
      row[0], // Field Name
      row[2], // Data Type
      nullable,
      defaultValue,
      row[1] || String(idx + 1),
      "No", // DBeaver export does not include PK info
    ];
  });
}

export function parseDbeaverSchemaClipboard(text) {
  return convertDbeaverSchemaRows(parseClipboardRows(text));
}

export async function importSchemasPayload(payload, storageService, { resolveFullName, onImported } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Unsupported KV schema format");
  }

  const convertJsonSchemaToRows = (schemaJson) => {
    try {
      const rows = [];
      const columns = schemaJson?.columns || {};
      const pkSet = new Set(Array.isArray(schemaJson?.pk) ? schemaJson.pk : []);
      Object.entries(columns).forEach(([fieldName, def]) => {
        const dataType = def?.type || "";
        const nullable = def?.nullable || "Yes";
        const defVal = typeof def?.default !== "undefined" ? def.default : null;
        const pkFlag = pkSet.has(fieldName) ? "Yes" : "No";
        rows.push([fieldName, dataType, nullable, defVal, null, pkFlag]);
      });
      return rows;
    } catch (_) {
      return null;
    }
  };

  let importCount = 0;
  for (const [schemaName, schemaObj] of Object.entries(payload)) {
    const tables = schemaObj?.tables || {};
    for (const [tableName, tableSchema] of Object.entries(tables)) {
      const rows = convertJsonSchemaToRows(tableSchema);
      const fullName = `${schemaName}.${tableName}`;
      const savedName = resolveFullName?.(fullName) || fullName;
      if (rows && (await storageService.saveSchema(savedName, rows))) {
        importCount += 1;
        onImported?.(savedName);
      }
    }
  }

  return importCount;
}

export function validateExcelHeaders(header, schemaRows) {
  const schemaFields = validateFieldNames(
    schemaRows.map((row) => row[0]),
    "schema",
  );
  validateFieldNames(header);
  const unknownFields = header.filter((field) => !schemaFields.has(schemaFieldKey(field)));
  if (unknownFields.length) {
    throw new Error(`Field Mismatch Error:<br>Fields in data but not in schema: ${unknownFields.join(", ")}`);
  }
}

export function prepareExcelDataForSchema(data, schemaRows) {
  validateExcelHeaders(data[0] || [], schemaRows);
  // Missing Excel columns become empty data-sheet cells. The existing query
  // pipeline remains responsible for required values, audit fields and NULLs.
  return alignDataToImportedSchema(data, schemaRows);
}

export function alignDataToImportedSchema(data, schemaRows) {
  const fields = schemaRows.map((row) => row[0]);
  const rows = Array.isArray(data) ? data : [];
  const oldFields = Array.isArray(rows[0]) ? rows[0] : [];
  const oldIndexes = new Map(oldFields.map((field, index) => [schemaFieldKey(field), index]));
  const values = rows.slice(1).map((row) =>
    fields.map((field) => {
      const index = oldIndexes.get(schemaFieldKey(field));
      return index === undefined ? null : (row?.[index] ?? null);
    }),
  );
  return [fields, ...(values.length ? values : [Array(fields.length).fill(null)])];
}
