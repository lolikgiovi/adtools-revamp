function normalizeTableName(tableName) {
  return String(tableName || "").trim();
}

function normalizeDataType(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "UNKNOWN";
  const withoutParams = raw.replace(/\(.*/, "").trim();
  return withoutParams.split(/\s+/)[0] || "UNKNOWN";
}

function isTruthySchemaFlag(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["1", "true", "yes", "y", "pk", "primary", "primary key"].includes(normalized);
}

function toCountMapString(counts) {
  return Object.entries(counts || {})
    .filter(([, count]) => Number(count) > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => `${key}:${count}`)
    .join(",");
}

function getAttachmentType(file) {
  const mime = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop() : "";

  if (mime.includes("pdf") || ext === "pdf") return "pdf";
  if (mime.includes("image") || ["jpg", "jpeg", "png"].includes(ext)) return "image";
  if (mime.includes("html") || ["html", "htm"].includes(ext)) return "html";
  if (mime.includes("json") || ext === "json") return "json";
  if (mime.includes("text") || ext === "txt") return "text";
  return "unknown";
}

function getAttachmentSize(file) {
  const directSize = Number(file?.size);
  if (Number.isFinite(directSize) && directSize > 0) return directSize;

  const sizes = file?.processedFormats?.sizes || {};
  const candidates = [Number(sizes.original), Number(sizes.base64)].filter((value) => Number.isFinite(value) && value > 0);
  return candidates.length ? Math.max(...candidates) : 0;
}

export function summarizeQuickQuerySchema(schemaData = []) {
  const rows = Array.isArray(schemaData) ? schemaData.filter((row) => Array.isArray(row) && row[0]) : [];
  const dataTypeCounts = {};

  rows.forEach((row) => {
    const type = normalizeDataType(row[1]);
    dataTypeCounts[type] = (dataTypeCounts[type] || 0) + 1;
  });

  return {
    schema_column_count: rows.length,
    pk_column_count: rows.filter((row) => isTruthySchemaFlag(row[5])).length,
    nullable_column_count: rows.filter((row) => isTruthySchemaFlag(row[2])).length,
    data_type_mix: toCountMapString(dataTypeCounts),
  };
}

export function summarizeQuickQueryAttachments(files = []) {
  const attachments = Array.isArray(files) ? files : [];
  const typeCounts = {};
  let totalSize = 0;

  attachments.forEach((file) => {
    const type = getAttachmentType(file);
    typeCounts[type] = (typeCounts[type] || 0) + 1;
    totalSize += getAttachmentSize(file);
  });

  return {
    has_attachments: attachments.length > 0,
    attachment_count: attachments.length,
    attachment_total_size: totalSize,
    attachment_types: toCountMapString(typeCounts),
  };
}

export function getQuickQueryDataRowCount(inputData = []) {
  if (!Array.isArray(inputData)) return 0;
  return Math.max(inputData.length - 1, 0);
}

export function buildQuickQueryGeneratedMeta({
  tableName,
  queryType,
  schemaData,
  inputData,
  dataSource = "manual",
  attachments = [],
  usedWorker = false,
  uuidSession = {},
} = {}) {
  const uuidCount = Number(uuidSession.generated_count || uuidSession.uuid_count_session || 0) || 0;
  const uuidCopiedCount = Number(uuidSession.copied_count || 0) || 0;

  return {
    table_name: normalizeTableName(tableName),
    query_type: String(queryType || "").trim().toLowerCase(),
    row_count: getQuickQueryDataRowCount(inputData),
    data_source: dataSource === "excel" ? "excel" : "manual",
    ...summarizeQuickQuerySchema(schemaData),
    ...summarizeQuickQueryAttachments(attachments),
    used_worker: Boolean(usedWorker),
    uuid_generated_in_session: uuidCount > 0,
    uuid_copied_in_session: uuidCopiedCount > 0,
    uuid_count_session: uuidCount,
  };
}

export function cleanQuickQueryAnalyticsMeta(meta = {}) {
  const cleaned = {};
  Object.entries(meta || {}).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      cleaned[key] = value;
    }
  });
  return cleaned;
}
