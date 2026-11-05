import { resolveAttachmentValue } from "./AttachmentValidationService.js";
import { ValueProcessorService } from "./ValueProcessorService.js";

const processor = new ValueProcessorService();

// Read-only preflight shares cell constraints with generation; attachment content
// is validated after expansion by the generator.
export function collectInputIssues({
  schemaData,
  inputData,
  queryType,
  tableName = "",
  options = {},
  attachments = [],
  limit = 100,
  reportMissing = () => true,
}) {
  const issues = [];
  const result = () => ({ issues, truncated: issues.length >= limit });
  const headers = (inputData?.[0] || []).map((value) => String(value ?? "").trim());
  if (!schemaData.length || !inputData?.slice(1).some((row) => row.some((cell) => cell != null && cell !== ""))) return result();
  const schema = new Map(schemaData.map((row) => [row[0], row]));
  const matchKeys = new Set(queryType === "update" ? processor.findPrimaryKeys(schemaData, tableName) : []);
  const seen = new Set();
  for (const [col, field] of headers.entries()) {
    let message;
    if (!field) message = "Missing field name";
    else if (seen.has(field)) message = `Duplicate field: ${field}`;
    else if (!schema.has(field)) message = `Field not in schema: ${field}`;
    seen.add(field);
    if (message) issues.push({ row: 0, col, type: "header", message });
    if (issues.length >= limit) return result();
  }
  if (queryType !== "update") {
    for (const field of schema.keys()) {
      if (!seen.has(field)) issues.push({ row: 0, col: null, type: "header", message: `Missing field: ${field}` });
      if (issues.length >= limit) return result();
    }
  } else {
    for (const field of matchKeys) {
      if (!seen.has(field)) issues.push({ row: 0, col: null, type: "header", message: `Missing key field: ${field}` });
      if (issues.length >= limit) return result();
    }
  }
  if (issues.length) return result();

  const columns = headers.map((field) => {
    const [, dataType, nullable] = schema.get(field);
    return { field, dataType, nullable, parsed: processor.parseDataType(String(dataType || "")) };
  });
  const auditOverride = ["custom", "system"].includes(options.auditUserMode);
  const auditFields = new Set();
  if (auditOverride) {
    for (const [field, dataType, nullable] of schemaData) {
      const lower = field.toLowerCase();
      if (!["created_by", "updated_by"].includes(lower)) continue;
      const appendedToUpdate = queryType === "update" && lower === "updated_by" && !matchKeys.has(field);
      if (!headers.includes(field) && !appendedToUpdate) continue;
      auditFields.add(field);
      if (!dataType) continue;
      const issue = processor.getConstraintIssue(null, dataType, nullable, field, queryType, options);
      if (issue) issues.push({ row: null, col: null, target: "audit_user", field, ...issue });
      if (issues.length >= limit) return result();
    }
  }
  for (let row = 1; row < inputData.length; row++) {
    const values = inputData[row];
    if (!values.some((value) => value != null && value !== "")) continue;
    for (const [col, { field, dataType, nullable, parsed }] of columns.entries()) {
      const value = values[col];
      const empty = value == null || value === "";
      if (empty && !reportMissing(row, col)) continue;
      if (matchKeys.has(field) && (value == null || value === "" || String(value).toLowerCase() === "null")) {
        issues.push({ row, col, type: "missing_primary_key", message: `Field "${field}" is required to match this row` });
        if (issues.length >= limit) return result();
        continue;
      }
      if (!dataType || auditFields.has(field)) continue;
      try {
        const effectiveValue = resolveAttachmentValue(value, dataType, attachments);
        const issue = processor.getConstraintIssue(effectiveValue, dataType, nullable, field, queryType, options, parsed);
        if (issue?.type === "null_not_allowed" && empty) issue.message = `${field} is required`;
        if (issue) issues.push({ row, col, ...issue });
      } catch (error) {
        issues.push({ row, col, type: "attachment", message: error.message });
      }
      if (issues.length >= limit) return result();
    }
  }
  return result();
}
