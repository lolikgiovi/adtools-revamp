export class AttachmentValidationService {
  validateAttachment(value, dataType, maxLength, attachments) {
    if (!value || !attachments?.length) return null;

    // Find matching file (case-insensitive)
    const matchingFile = attachments.find((file) => file.name.toLowerCase() === value.toLowerCase());
    if (!matchingFile) return null;

    const fieldDataType = dataType.toUpperCase();

    if (!["BLOB", "CLOB", "VARCHAR", "VARCHAR2", "CHAR"].includes(fieldDataType)) {
      return null;
    } else if (["VARCHAR", "VARCHAR2", "CHAR"].includes(fieldDataType)) {
      return this.handleVarcharType(matchingFile, maxLength);
    } else if (["CLOB"].includes(fieldDataType)) {
      return this.handleClobType(matchingFile);
    }
  }

  handleVarcharType(file, maxLength) {
    if (file.type.includes("text")) {
      // For text files, use original content
      const content = file.processedFormats.original;
      if (content.length <= maxLength) {
        return content;
      }
    } else {
      // For base64/image/pdf, use base64 content
      const content = file.processedFormats.base64;
      if (content.length <= maxLength) {
        return content;
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
