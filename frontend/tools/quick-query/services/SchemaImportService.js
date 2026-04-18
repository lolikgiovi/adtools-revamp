// Schema import helpers for DBeaver clipboard rows and canonical AD Tools schema JSON.
// JSON shape: { schemaName: { tables: { tableName: { columns, pk?, unique? } } } }
export function isDbeaverSchemaRows(rows) {
  return Array.isArray(rows) && rows.length > 0 && String(rows[0]?.[0] || "").trim().toLowerCase() === "column name";
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
  if (!isDbeaverSchemaRows(rows)) {
    throw new Error("Clipboard does not look like a DBeaver column export. Copy the grid including the Column Name header.");
  }

  const dataRows = rows.slice(1).filter((row) => row[0]);

  if (dataRows.length === 0) {
    throw new Error("No DBeaver columns found in clipboard.");
  }

  return dataRows.map((row, idx) => {
    const nullable = String(row[4]).toLowerCase() === "true" ? "No" : "Yes";
    const defaultValue = row[5] === "[NULL]" ? "" : row[5];

    return [
      row[0], // Field Name
      row[2], // Data Type
      nullable,
      defaultValue,
      String(idx + 1),
      "No", // DBeaver export does not include PK info
    ];
  });
}

export function parseDbeaverSchemaClipboard(text) {
  return convertDbeaverSchemaRows(parseClipboardRows(text));
}

export async function importSchemasPayload(payload, storageService) {
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
      if (rows && (await storageService.saveSchema(`${schemaName}.${tableName}`, rows))) {
        importCount += 1;
      }
    }
  }

  return importCount;
}
