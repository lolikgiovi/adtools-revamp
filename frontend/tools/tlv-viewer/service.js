const TAG_CLASS_LABELS = ["Universal", "Application", "Context-specific", "Private"];

function sanitizeHexInput(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";

  const cleaned = raw
    .replace(/0x/gi, "")
    .replace(/[\s,:;|_-]+/g, "")
    .replace(/[^a-fA-F0-9]/g, "");

  if (!cleaned) return "";
  if (cleaned.length % 2 !== 0) {
    throw new Error("Hex input has odd length. Every byte must contain two hex characters.");
  }

  return cleaned.toUpperCase();
}

function bytesToHex(bytes, separator = " ") {
  return Array.from(bytes)
    .map((value) => value.toString(16).toUpperCase().padStart(2, "0"))
    .join(separator);
}

function bytesFromHexInput(input) {
  const normalized = sanitizeHexInput(input);
  if (!normalized) return new Uint8Array();

  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    const chunk = normalized.slice(index, index + 2);
    bytes[index / 2] = parseInt(chunk, 16);
  }
  return bytes;
}

function bytesFromBase64Input(input) {
  const normalized = String(input || "").replace(/\s+/g, "");
  if (!normalized) return new Uint8Array();

  try {
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch (_) {
    throw new Error("Base64 input is invalid.");
  }
}

function bytesFromUtf8Input(input) {
  return new TextEncoder().encode(String(input || ""));
}

function bytesFromInput(input, inputMode = "hex") {
  if (inputMode === "hex") return bytesFromHexInput(input);
  if (inputMode === "base64") return bytesFromBase64Input(input);
  if (inputMode === "utf8") return bytesFromUtf8Input(input);
  throw new Error(`Unsupported input mode: ${inputMode}`);
}

function getPrintablePreview(valueBytes, maxLength = 48) {
  if (!valueBytes || valueBytes.length === 0) return "";

  let decoded = "";
  try {
    decoded = new TextDecoder("utf-8", { fatal: false }).decode(valueBytes);
  } catch (_) {
    return "";
  }

  const compact = decoded.replace(/\s+/g, " ").trim();
  if (!compact) return "";

  const printableChars = compact.split("").filter((char) => {
    const code = char.charCodeAt(0);
    return code >= 32 && code <= 126;
  }).length;

  const ratio = printableChars / compact.length;
  if (ratio < 0.75) return "";

  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

function parseTag(bytes, offset) {
  if (offset >= bytes.length) {
    throw new Error("Unexpected end of input while reading tag.");
  }

  const first = bytes[offset];
  const tagBytes = [first];
  let cursor = offset + 1;

  if ((first & 0x1f) === 0x1f) {
    let continuationFound = false;
    let guard = 0;

    while (cursor < bytes.length) {
      const next = bytes[cursor];
      tagBytes.push(next);
      cursor += 1;
      guard += 1;

      if (guard > 8) {
        throw new Error(`Tag at offset ${offset} exceeds supported high-tag-number length.`);
      }

      if ((next & 0x80) === 0) {
        continuationFound = true;
        break;
      }
    }

    if (!continuationFound) {
      throw new Error(`Tag at offset ${offset} is truncated.`);
    }
  }

  return {
    tagBytes,
    tagHex: bytesToHex(tagBytes, ""),
    tagClass: TAG_CLASS_LABELS[(first >> 6) & 0x03],
    constructed: (first & 0x20) !== 0,
    nextOffset: cursor,
  };
}

function parseLength(bytes, offset) {
  if (offset >= bytes.length) {
    throw new Error("Unexpected end of input while reading length.");
  }

  const first = bytes[offset];
  if ((first & 0x80) === 0) {
    return {
      length: first,
      lengthBytes: [first],
      nextOffset: offset + 1,
    };
  }

  const lengthByteCount = first & 0x7f;
  if (lengthByteCount === 0) {
    throw new Error(`Indefinite length at offset ${offset} is not supported.`);
  }

  if (lengthByteCount > 6) {
    throw new Error(`Length field at offset ${offset} is too large.`);
  }

  const start = offset + 1;
  const end = start + lengthByteCount;
  if (end > bytes.length) {
    throw new Error(`Length field at offset ${offset} is truncated.`);
  }

  let length = 0;
  for (let index = start; index < end; index += 1) {
    length = length * 256 + bytes[index];
  }

  return {
    length,
    lengthBytes: Array.from(bytes.slice(offset, end)),
    nextOffset: end,
  };
}

function parseNodes(bytes, start, end, depth, state) {
  if (depth > 32) {
    throw new Error("Maximum TLV nesting depth exceeded.");
  }

  const nodes = [];
  let cursor = start;

  while (cursor < end) {
    const currentOffset = cursor;
    const tagInfo = parseTag(bytes, cursor);
    const lengthInfo = parseLength(bytes, tagInfo.nextOffset);
    const valueStart = lengthInfo.nextOffset;
    const valueEnd = valueStart + lengthInfo.length;

    if (valueEnd > end) {
      throw new Error(`Value at offset ${currentOffset} exceeds available input length.`);
    }

    const valueBytes = bytes.slice(valueStart, valueEnd);
    const rawBytes = bytes.slice(currentOffset, valueEnd);
    const rowIndex = state.nextRowIndex;
    state.nextRowIndex += 1;

    const node = {
      rowIndex,
      depth,
      offset: currentOffset,
      tag: tagInfo.tagHex,
      tagClass: tagInfo.tagClass,
      constructed: tagInfo.constructed,
      length: lengthInfo.length,
      headerLength: tagInfo.tagBytes.length + lengthInfo.lengthBytes.length,
      totalLength: valueEnd - currentOffset,
      valueHex: bytesToHex(valueBytes),
      rawHex: bytesToHex(rawBytes),
      valuePreview: getPrintablePreview(valueBytes),
      children: [],
    };

    state.rows.push({
      rowIndex: node.rowIndex,
      depth: node.depth,
      offset: node.offset,
      tagClass: node.tagClass,
      tag: node.tag,
      constructed: node.constructed,
      length: node.length,
      totalLength: node.totalLength,
      valuePreview: node.valuePreview,
      valueHex: node.valueHex,
      rawHex: node.rawHex,
    });

    if (tagInfo.constructed && lengthInfo.length > 0) {
      node.children = parseNodes(bytes, valueStart, valueEnd, depth + 1, state);
    }

    nodes.push(node);
    cursor = valueEnd;
  }

  return nodes;
}

function toJsonTree(nodes) {
  return nodes.map((node) => ({
    tag: node.tag,
    class: node.tagClass,
    constructed: node.constructed,
    length: node.length,
    offset: node.offset,
    valueHex: node.valueHex,
    preview: node.valuePreview || undefined,
    children: toJsonTree(node.children),
  }));
}

function parse(input, inputMode = "hex") {
  const bytes = bytesFromInput(input, inputMode);
  if (!bytes || bytes.length === 0) {
    throw new Error("Input is empty.");
  }

  const state = {
    nextRowIndex: 1,
    rows: [],
  };

  const nodes = parseNodes(bytes, 0, bytes.length, 0, state);
  const maxDepth = state.rows.reduce((current, row) => Math.max(current, row.depth), 0);

  return {
    inputMode,
    bytes,
    nodes,
    rows: state.rows,
    jsonTree: toJsonTree(nodes),
    summary: {
      byteLength: bytes.length,
      nodeCount: state.rows.length,
      maxDepth,
      topLevelCount: nodes.length,
    },
  };
}

export const TLVViewerService = {
  sanitizeHexInput,
  bytesFromInput,
  bytesToHex,
  parse,
};

export { parseLength, parseTag };
