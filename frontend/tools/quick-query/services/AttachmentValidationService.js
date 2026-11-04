// Resolve only types that support file-content substitution. Constraint checks run
// on the returned content, using the same BYTE/CHAR rules as ordinary cells.
export function resolveAttachmentValue(value, dataType, attachments = []) {
  if (typeof value !== "string" || !value) return value;
  const type = dataType
    .trim()
    .toUpperCase()
    .replace(/\s*\(.*\)$/, "");
  if (!["CLOB", "VARCHAR", "VARCHAR2", "CHAR"].includes(type)) return value;
  const file = attachments.find((entry) => entry.name.toLowerCase() === value.toLowerCase());
  if (!file) return value;
  const useOriginal = file.type?.includes("text") || (type !== "CLOB" && file.type?.includes("json"));
  const content = file.processedFormats?.[useOriginal ? "original" : "base64"];
  if (typeof content !== "string") throw new Error(`Attachment "${file.name}" has no processed content`);
  return content;
}
