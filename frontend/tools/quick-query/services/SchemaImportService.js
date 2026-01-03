// Import only the canonical AD Tools schema format (new_data_model_schema.json)
// Shape: { schemaName: { tables: { tableName: { columns, pk?, unique? } } } }
export function importSchemasPayload(payload, localStorageService) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Unsupported KV schema format');
  }

  const convertJsonSchemaToRows = (schemaJson) => {
    try {
      const rows = [];
      const columns = schemaJson?.columns || {};
      const pkSet = new Set(Array.isArray(schemaJson?.pk) ? schemaJson.pk : []);
      Object.entries(columns).forEach(([fieldName, def]) => {
        const dataType = def?.type || '';
        const nullable = def?.nullable || 'Yes';
        const defVal = typeof def?.default !== 'undefined' ? def.default : null;
        const pkFlag = pkSet.has(fieldName) ? 'Yes' : 'No';
        rows.push([fieldName, dataType, nullable, defVal, null, pkFlag]);
      });
      return rows;
    } catch (_) {
      return null;
    }
  };

  let importCount = 0;
  Object.entries(payload).forEach(([schemaName, schemaObj]) => {
    const tables = schemaObj?.tables || {};
    Object.entries(tables).forEach(([tableName, tableSchema]) => {
      const rows = convertJsonSchemaToRows(tableSchema);
      if (rows && localStorageService.saveSchema(`${schemaName}.${tableName}`, rows)) {
        importCount += 1;
      }
    });
  });

  return importCount;
}