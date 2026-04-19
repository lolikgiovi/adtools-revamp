function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeQueryMode(value, sourceType = "") {
  const normalized = normalizeText(value).toLowerCase().replace(/-/g, "_");
  if (sourceType === "excel") return "excel";
  if (normalized === "raw_sql" || normalized === "rawsql") return "raw_sql";
  if (normalized === "sql") return "sql";
  if (normalized === "table") return "table";
  return normalized || "unknown";
}

function countItems(value) {
  return Array.isArray(value) ? value.length : Number(value || 0) || 0;
}

export function buildQualifiedTable(schema, table) {
  const cleanSchema = normalizeText(schema);
  const cleanTable = normalizeText(table);
  if (cleanSchema && cleanTable) return `${cleanSchema}.${cleanTable}`;
  return cleanTable || "";
}

function buildSourceMeta(prefix, source = {}) {
  const sourceType = source.type === "excel" ? "excel" : source.type === "oracle" ? "oracle" : normalizeText(source.type) || "unknown";
  const queryMode = normalizeQueryMode(source.queryMode, sourceType);
  const connectionName = normalizeText(source.connectionName || source.connection?.name);
  const schema = normalizeText(source.schema);
  const tableName = normalizeText(source.tableName || source.table);
  const qualifiedTable = buildQualifiedTable(schema, tableName);
  const rowCount = Number(source.rowCount);
  const maxRows = Number(source.maxRows);

  const meta = {
    [`${prefix}_type`]: sourceType,
    [`${prefix}_query_mode`]: queryMode,
  };

  if (sourceType === "oracle") {
    meta[`${prefix}_env`] = connectionName;
    meta[`${prefix}_schema`] = schema;
    meta[`${prefix}_table_name`] = tableName;
    meta[`${prefix}_table`] = queryMode === "table" ? qualifiedTable : "raw_sql";
    meta[`${prefix}_has_where_clause`] = Boolean(normalizeText(source.whereClause));
    if (Number.isFinite(maxRows) && maxRows > 0) meta[`${prefix}_max_rows`] = maxRows;
  } else if (sourceType === "excel") {
    meta[`${prefix}_table`] = "excel_file";
    meta[`${prefix}_file_count`] = countItems(source.excelFiles);
  }

  if (Number.isFinite(rowCount)) meta[`${prefix}_rows`] = rowCount;

  return meta;
}

export function buildUnifiedSourceAnalytics(source = {}, loadedData = null) {
  const metadata = loadedData?.metadata || source.data?.metadata || {};
  return {
    type: source.type,
    queryMode: source.queryMode,
    connection: source.connection,
    connectionName: metadata.connectionName,
    schema: source.schema || metadata.schema,
    table: source.table || metadata.table,
    whereClause: source.whereClause,
    maxRows: source.maxRows,
    rowCount: metadata.rowCount,
    excelFiles: source.excelFiles,
  };
}

export function summarizeCompareConfigResult(result = {}) {
  return {
    rows_compared: result?.rows?.length || 0,
    rows_match: result?.summary?.matches || 0,
    rows_differ: result?.summary?.differs || 0,
    rows_only_a: result?.summary?.only_in_env1 || 0,
    rows_only_b: result?.summary?.only_in_env2 || 0,
  };
}

export function buildCompareConfigSuccessMeta({
  mode,
  sourceA,
  sourceB,
  result,
  pkFields = [],
  compareFields = [],
  rowMatching = "key",
  dataComparison = "strict",
  normalizeFields = false,
  queryMode = "",
} = {}) {
  const sourceAMeta = buildSourceMeta("source_a", sourceA);
  const sourceBMeta = buildSourceMeta("source_b", sourceB);
  const sourceATable = sourceAMeta.source_a_table || "";
  const sourceBTable = sourceBMeta.source_b_table || "";
  const sourceAEnv = sourceAMeta.source_a_env || "";
  const sourceBEnv = sourceBMeta.source_b_env || "";

  return cleanCompareConfigAnalyticsMeta({
    mode: normalizeText(mode),
    query_mode: normalizeQueryMode(queryMode || sourceA?.queryMode || sourceB?.queryMode),
    ...sourceAMeta,
    ...sourceBMeta,
    compare_pair: `${sourceAEnv || "-"}:${sourceATable || "-"} -> ${sourceBEnv || "-"}:${sourceBTable || "-"}`,
    ...summarizeCompareConfigResult(result),
    pk_fields: countItems(pkFields),
    compare_fields: countItems(compareFields),
    row_matching: normalizeText(rowMatching),
    data_comparison: normalizeText(dataComparison),
    normalize_fields: Boolean(normalizeFields),
  });
}

export function cleanCompareConfigAnalyticsMeta(meta = {}) {
  const cleaned = {};
  Object.entries(meta || {}).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      cleaned[key] = value;
    }
  });
  return cleaned;
}
