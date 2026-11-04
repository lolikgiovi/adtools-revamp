import { ValueProcessorService } from "./ValueProcessorService.js";

const processor = new ValueProcessorService();

// Read-only preflight shares cell constraints with generation; attachment content
// is validated after expansion by the generator.
export function collectInputIssues({ schemaData, inputData, queryType, tableName = "", options = {}, attachments = [], limit = 100 }) {
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
  const filenames = new Set(attachments.map((file) => file.name.toLowerCase()));
  for (let row = 1; row < inputData.length; row++) {
    const values = inputData[row];
    if (!values.some((value) => value != null && value !== "")) continue;
    for (const [col, { field, dataType, nullable, parsed }] of columns.entries()) {
      const value = values[col];
      if (matchKeys.has(field) && (value == null || value === "" || String(value).toLowerCase() === "null")) {
        issues.push({ row, col, type: "missing_primary_key", message: `Field "${field}" is required to match this row` });
        if (issues.length >= limit) return result();
        continue;
      }
      if (!dataType || (typeof value === "string" && filenames.has(value.toLowerCase()))) continue;
      const issue = processor.getConstraintIssue(value, dataType, nullable, field, queryType, options, parsed);
      if (issue) issues.push({ row, col, ...issue });
      if (issues.length >= limit) return result();
    }
  }
  return result();
}
