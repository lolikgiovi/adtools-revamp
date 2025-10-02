// Base64 Tools Service: pure logic functions, no DOM dependencies
// Exposed globally as window.Base64ToolsService for use by main.js

(() => {
  function isValidBase64(str) {
    try {
      if (!str || typeof str !== "string" || !str.trim()) {
        return false;
      }
      const cleanStr = str.replace(/\s+/g, "");
      let base64Content = cleanStr;
      if (cleanStr.startsWith("data:")) {
        const dataUriMatch = cleanStr.match(/^data:[^;]*;base64,(.+)$/);
        if (dataUriMatch) {
          base64Content = dataUriMatch[1];
        } else {
          return false;
        }
      }
      const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
      if (!base64Regex.test(base64Content)) {
        return false;
      }
      if (base64Content.length % 4 !== 0) {
        return false;
      }
      atob(base64Content);
      return true;
    } catch (e) {
      return false;
    }
  }

  function normalizeDataUri(input) {
    const trimmed = (input || "").trim();
    if (trimmed.startsWith("data:")) {
      const dataUriMatch = trimmed.match(/^data:([^;]*);base64,(.+)$/);
      if (!dataUriMatch) throw new Error("Invalid data URI format");
      return { mimeType: dataUriMatch[1], base64: dataUriMatch[2] };
    }
    return { mimeType: null, base64: trimmed.replace(/\s+/g, "") };
  }

  function toBase64FromBytes(uint8Array) {
    let binary = "";
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    return btoa(binary);
  }

  function encodeText(text) {
    const bytes = new TextEncoder().encode(text || "");
    return toBase64FromBytes(bytes);
  }

  function decodeToBinaryString(base64) {
    return atob(base64);
  }

  function matchesSignature(bytes, signature) {
    if (signature.length > bytes.length) return false;
    for (let i = 0; i < signature.length; i++) {
      if (bytes[i] !== signature[i]) return false;
    }
    return true;
  }

  function detectContentType(bytes) {
    const signatures = {
      "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      "image/jpeg": [0xff, 0xd8, 0xff],
      "image/gif": [0x47, 0x49, 0x46, 0x38],
      "image/webp": [0x52, 0x49, 0x46, 0x46],
      "image/bmp": [0x42, 0x4d],
      "image/svg+xml": [0x3c, 0x73, 0x76, 0x67],
      "application/pdf": [0x25, 0x50, 0x44, 0x46],
      "application/zip": [0x50, 0x4b, 0x03, 0x04],
      "text/html": [0x3c, 0x68, 0x74, 0x6d, 0x6c],
      "text/xml": [0x3c, 0x3f, 0x78, 0x6d, 0x6c],
    };

    for (const [mimeType, signature] of Object.entries(signatures)) {
      if (matchesSignature(bytes, signature)) {
        return mimeType;
      }
    }
    return "application/octet-stream";
  }

  function getMimeTypeFromBase64(file, uint8Array) {
    const detectedType = detectContentType(uint8Array);
    if (detectedType !== "application/octet-stream") {
      return detectedType;
    }
    const extension = (file?.name || "").toLowerCase().split(".").pop();
    const extensionMimeTypes = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      bmp: "image/bmp",
      svg: "image/svg+xml",
      ico: "image/x-icon",
      tiff: "image/tiff",
      tif: "image/tiff",
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ppt: "application/vnd.ms-powerpoint",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      txt: "text/plain",
      html: "text/html",
      htm: "text/html",
      css: "text/css",
      js: "text/javascript",
      json: "application/json",
      xml: "text/xml",
      csv: "text/csv",
      mp3: "audio/mpeg",
      wav: "audio/wav",
      ogg: "audio/ogg",
      flac: "audio/flac",
      m4a: "audio/mp4",
      mp4: "video/mp4",
      avi: "video/x-msvideo",
      mov: "video/quicktime",
      wmv: "video/x-ms-wmv",
      flv: "video/x-flv",
      webm: "video/webm",
      zip: "application/zip",
      rar: "application/x-rar-compressed",
      "7z": "application/x-7z-compressed",
      tar: "application/x-tar",
      gz: "application/gzip",
      exe: "application/x-msdownload",
      dmg: "application/x-apple-diskimage",
      iso: "application/x-iso9660-image",
    };
    return extensionMimeTypes[extension] || "application/octet-stream";
  }

  function isTextContent(content) {
    const printableRegex = /^[\x20-\x7E\x09\x0A\x0D\u00A0-\u00FF\u0100-\u017F\u0180-\u024F]*$/;
    const binarySignatures = ["\x89PNG", "\xFF\xD8\xFF", "GIF8", "PK\x03\x04", "%PDF", "\x00\x00\x01\x00", "BM", "RIFF"];
    for (const signature of binarySignatures) {
      if (content.startsWith(signature)) return false;
    }
    if (!printableRegex.test(content)) return false;
    const nullBytes = (content.match(/\x00/g) || []).length;
    const controlChars = (content.match(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g) || []).length;
    const threshold = Math.max(1, content.length * 0.01);
    if (nullBytes > threshold || controlChars > threshold) return false;
    return true;
  }

  window.Base64ToolsService = {
    isValidBase64,
    normalizeDataUri,
    toBase64FromBytes,
    encodeText,
    decodeToBinaryString,
    detectContentType,
    getMimeTypeFromBase64,
    isTextContent,
  };
})();
