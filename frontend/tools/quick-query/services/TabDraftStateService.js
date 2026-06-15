function hasCellValue(row) {
  return Array.isArray(row) && row.some((cell) => cell !== null && cell !== "");
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
