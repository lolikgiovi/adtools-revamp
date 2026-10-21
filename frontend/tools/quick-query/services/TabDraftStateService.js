function hasCellValue(row) {
  return Array.isArray(row) && row.some((cell) => cell !== null && cell !== "");
}

function schemaRowName(row) {
  return String(row?.[0] ?? "").trim();
}

function normalizeSchemaRow(row) {
  return Array.from({ length: 6 }, (_, index) => row?.[index] ?? "");
}

/**
 * Keep the table's full saved schema while applying a partial query draft.
 * Draft rows keep the saved column order and data types; the draft only
 * supplies the primary-key designation used by the generated WHERE clause.
 */
export function mergeDraftSchema(savedSchema, draftSchema) {
  const draftRows = (Array.isArray(draftSchema) ? draftSchema : []).filter((row) => schemaRowName(row)).map(normalizeSchemaRow);
  const savedRows = (Array.isArray(savedSchema) ? savedSchema : []).filter((row) => schemaRowName(row)).map(normalizeSchemaRow);
  if (!savedRows.length) return draftRows;

  const draftByName = new Map(draftRows.map((row) => [row[0].trim().toUpperCase(), row]));
  const savedNames = new Set(savedRows.map((row) => row[0].trim().toUpperCase()));
  const merged = savedRows.map((row) => {
    const draft = draftByName.get(row[0].trim().toUpperCase());
    return [row[0], row[1], row[2], row[3], row[4], draft ? draft[5] || "No" : "No"];
  });
  draftRows.forEach((row) => {
    const name = row[0].trim().toUpperCase();
    if (!savedNames.has(name)) merged.push(row);
  });
  return merged;
}

export function isTabDraftContentEmpty({ tableName = "", schemaData = [], inputData = [], sql = "", attachments = [] } = {}, options = {}) {
  const { ignoreTableName = false } = options;
  const hasTableName = Boolean(String(tableName || "").trim());
  const hasSchema = Array.isArray(schemaData) && schemaData.some(hasCellValue);
  const hasData = Array.isArray(inputData) && inputData.some(hasCellValue);
  const hasSql = Boolean(String(sql || ""));
  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;

  return (ignoreTableName || !hasTableName) && !hasSchema && !hasData && !hasSql && !hasAttachments;
}
