import JSZip from "jszip";
import { CompareConfigService } from "../compare-config/service.js";

const CONTENT_COLUMN_SUFFIX_REGEX = /_(EN|ID)$/i;
const READONLY_SQL_REGEX = /^\s*(with|select)\b/i;
const BLOCKED_SQL_REGEX = /\b(insert|update|delete|merge|drop|alter|truncate|create|grant|revoke|call|execute|begin)\b/i;
const QUALIFIED_TABLE_REGEX = /\bfrom\s+((?:"[^"]+"|[A-Za-z][\w$#]*)\s*\.\s*(?:"[^"]+"|[A-Za-z][\w$#]*))/gi;
const ORACLE_BLOB_TYPE = "oracle_blob";

export class ExportContentService {
  constructor(options = {}) {
    this.queryService = options.queryService || CompareConfigService;
    this.zipFactory = options.zipFactory || (() => new JSZip());
  }

  isReadonlySelect(sql) {
    const normalized = String(sql || "").trim();
    if (!normalized) return false;
    return READONLY_SQL_REGEX.test(normalized) && !BLOCKED_SQL_REGEX.test(normalized);
  }

  validateSql(sql) {
    if (!this.isReadonlySelect(sql)) {
      throw new Error("Only read-only SELECT or WITH queries are supported.");
    }
  }

  async ensureSidecarStarted() {
    if (typeof this.queryService.ensureSidecarStarted !== "function") {
      return false;
    }
    return this.queryService.ensureSidecarStarted();
  }

  normalizeColumns(columns = []) {
    return (columns || []).map((column) => String(column || "").trim()).filter(Boolean);
  }

  detectContentColumns(headers = []) {
    return this.normalizeColumns(headers).filter((header) => CONTENT_COLUMN_SUFFIX_REGEX.test(header));
  }

  deriveLanguageSuffix(columnName) {
    const match = String(columnName || "").match(CONTENT_COLUMN_SUFFIX_REGEX);
    return match ? match[1].toUpperCase() : this.sanitizeFilenamePart(columnName).toUpperCase();
  }

  detectIdentifierColumns(headers = [], contentColumns = []) {
    const contentSet = new Set(contentColumns);
    const firstIdentifier = this.normalizeColumns(headers).find((header) => !contentSet.has(header));
    return firstIdentifier ? [firstIdentifier] : [];
  }

  sanitizeFilenamePart(value) {
    const cleaned = String(value ?? "")
      .trim()
      .replace(/<[^>]*>/g, "")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");

    return cleaned || "empty";
  }

  formatTimestamp(date = new Date()) {
    const pad = (value) => String(value).padStart(2, "0");
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
    ].join("_") + `-${pad(date.getHours())}_${pad(date.getMinutes())}`;
  }

  deriveSourceNameFromSql(sql) {
    const normalizedSql = String(sql || "")
      .replace(/--.*$/gm, " ")
      .replace(/\/\*[\s\S]*?\*\//g, " ");

    const matches = [...normalizedSql.matchAll(QUALIFIED_TABLE_REGEX)];
    if (matches.length === 0) return "query-result";

    return matches[0][1]
      .split(".")
      .map((part) => part.trim().replace(/^"|"$/g, ""))
      .filter(Boolean)
      .join(".");
  }

  buildZipFilename({ sourceName = "query-result", timestamp = this.formatTimestamp() }) {
    return `${this.sanitizeFilenamePart(sourceName)}-${timestamp}.zip`;
  }

  createSnippet({ id = this.createSnippetId(), name, sql, updatedAt = new Date().toISOString() }) {
    const trimmedName = String(name || "").trim();
    const trimmedSql = String(sql || "").trim();

    if (!trimmedName) {
      throw new Error("Snippet name is required.");
    }
    if (!trimmedSql) {
      throw new Error("SQL query is required.");
    }

    return {
      id,
      name: trimmedName,
      sql: trimmedSql,
      updatedAt,
    };
  }

  createSnippetId() {
    return `snippet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  buildHtmlFilename({ identifierValues = [], language = "HTML", timestamp = this.formatTimestamp(), existingNames = new Set() }) {
    const identifier = identifierValues.map((value) => this.sanitizeFilenamePart(value)).filter(Boolean).join("-");
    const baseName = [identifier || "content", this.sanitizeFilenamePart(language).toUpperCase(), timestamp].join("-");
    let fileName = `${baseName}.html`;
    let counter = 2;

    while (existingNames.has(fileName)) {
      fileName = `${baseName}-${counter}.html`;
      counter += 1;
    }

    existingNames.add(fileName);
    return fileName;
  }

  buildExportItems({ rows = [], identifierColumns = [], contentColumns = [], timestamp = this.formatTimestamp() }) {
    const existingNames = new Set();
    const items = [];
    let skippedEmpty = 0;

    for (const row of rows || []) {
      const identifierValues = identifierColumns.map((column) => row?.[column]);

      for (const column of contentColumns) {
        const content = this.normalizeContentValue(row?.[column]);
        if (content.isEmpty) {
          skippedEmpty += 1;
          continue;
        }

        const language = this.deriveLanguageSuffix(column);
        items.push({
          filename: this.buildHtmlFilename({ identifierValues, language, timestamp, existingNames }),
          content: content.value,
          column,
          contentType: content.type,
          language,
          identifierValues,
        });
      }
    }

    return { items, skippedEmpty };
  }

  normalizeContentValue(value) {
    if (value === null || value === undefined) {
      return { value: "", type: "empty", isEmpty: true };
    }

    if (this.isOracleBlobValue(value)) {
      const bytes = this.decodeBase64ToBytes(value.data || "");
      return {
        value: bytes,
        type: ORACLE_BLOB_TYPE,
        isEmpty: bytes.byteLength === 0,
        byteLength: value.byte_length ?? bytes.byteLength,
      };
    }

    const content = String(value);
    return {
      value: content,
      type: "text",
      isEmpty: content.trim() === "",
      byteLength: new TextEncoder().encode(content).byteLength,
    };
  }

  isOracleBlobValue(value) {
    return Boolean(
      value &&
        typeof value === "object" &&
        value.__adtools_type === ORACLE_BLOB_TYPE &&
        value.encoding === "base64" &&
        typeof value.data === "string",
    );
  }

  contentToPreviewText(content, contentType) {
    if (contentType === ORACLE_BLOB_TYPE) {
      return new TextDecoder("utf-8", { fatal: false }).decode(content);
    }
    return String(content ?? "");
  }

  decodeBase64ToBytes(base64Value) {
    if (globalThis.Buffer) {
      return new Uint8Array(globalThis.Buffer.from(base64Value, "base64"));
    }

    const binary = atob(base64Value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  async previewQuery({ connection, sql, maxRows = 500 }) {
    if (!connection?.name || !connection?.connect_string) {
      throw new Error("Select an Oracle connection first.");
    }
    this.validateSql(sql);

    const result = await this.queryService.queryViaSidecar(connection.name, connection, sql.trim().replace(/;+$/, ""), maxRows);
    const columns = this.normalizeColumns(result.columns);
    const rows = (result.rows || []).map((row) => Object.fromEntries(columns.map((column, index) => [column, row[index]])));

    return {
      columns,
      rows,
      rowCount: result.row_count ?? rows.length,
      executionTimeMs: result.execution_time_ms || 0,
      sourceName: this.deriveSourceNameFromSql(sql),
    };
  }

  async buildZipBlob(items = []) {
    const zip = this.zipFactory();
    items.forEach((item) => {
      zip.file(item.filename, item.content, item.contentType === ORACLE_BLOB_TYPE ? { binary: true } : undefined);
    });
    return zip.generateAsync({ type: "blob" });
  }
}
