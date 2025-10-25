import { UsageTracker } from "../../../core/UsageTracker.js";

export class AttachmentValidationService {
  validateAttachment(value, dataType, maxLength, attachments) {
    if (!value || !attachments?.length) return null;

    // Find matching file (case-insensitive)
    const matchingFile = attachments.find((file) => file.name.toLowerCase() === value.toLowerCase());
    if (!matchingFile) {
      UsageTracker.trackEvent("quick-query", "attachment_error", { type: "file_not_found", value });
      return null;
    }

    const fieldDataType = dataType.toUpperCase();

    if (!["BLOB", "CLOB", "VARCHAR", "VARCHAR2", "CHAR"].includes(fieldDataType)) {
      UsageTracker.trackEvent("quick-query", "attachment_error", { type: "unsupported_type", dataType: fieldDataType });
      return null;
    } else if (["VARCHAR", "VARCHAR2", "CHAR"].includes(fieldDataType)) {
      return this.handleVarcharType(matchingFile, maxLength);
    } else if (["CLOB"].includes(fieldDataType)) {
      return this.handleClobType(matchingFile);
    }
  }

  handleVarcharType(file, maxLength) {
    if (file.type.includes("text") || file.type.includes("json")) {
      // For text files, use original content
      const content = file.processedFormats.original;
      if (content.length <= maxLength) {
        return content;
      } else {
        UsageTracker.trackEvent("quick-query", "attachment_error", { type: "exceeds_max_length", fileType: file.type, length: content.length, maxLength });
      }
    } else {
      // For base64/image/pdf, use base64 content
      const content = file.processedFormats.base64;
      if (content.length <= maxLength) {
        return content;
      } else {
        UsageTracker.trackEvent("quick-query", "attachment_error", { type: "exceeds_max_length", fileType: file.type, length: content.length, maxLength });
      }
    }
    return null;
  }

  handleClobType(file) {
    if (file.type.includes("text")) {
      return file.processedFormats.original;
    }
    return file.processedFormats.base64;
  }
}
