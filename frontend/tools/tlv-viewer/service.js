// ── QRIS / EMV QR Tag Dictionaries ──────────────────────────────────────────

const QRIS_ROOT_TAGS = {
  "00": "Payload Format Indicator",
  "01": "Point of Initiation Method",
  "02": "Visa",
  "03": "Visa",
  "04": "Mastercard",
  "05": "Mastercard",
  "06": "EMVCo",
  "07": "EMVCo",
  "08": "EMVCo",
  "09": "Discover",
  "10": "Discover",
  "11": "AMEX",
  "12": "AMEX",
  "13": "JCB",
  "14": "JCB",
  "15": "UnionPay",
  "16": "UnionPay",
  "17": "EMVCo",
  "18": "EMVCo",
  "19": "EMVCo",
  "20": "EMVCo",
  "21": "EMVCo",
  "22": "EMVCo",
  "23": "EMVCo",
  "24": "EMVCo",
  "25": "EMVCo",
  "26": "Merchant Account Information",
  "27": "Merchant Account Information",
  "28": "Merchant Account Information",
  "29": "Merchant Account Information",
  "30": "Merchant Account Information",
  "31": "Merchant Account Information",
  "32": "Merchant Account Information",
  "33": "Merchant Account Information",
  "34": "Merchant Account Information",
  "35": "Merchant Account Information",
  "36": "Merchant Account Information",
  "37": "Merchant Account Information",
  "38": "Merchant Account Information",
  "39": "Merchant Account Information",
  "40": "Merchant Account Information",
  "41": "Merchant Account Information",
  "42": "Merchant Account Information",
  "43": "Merchant Account Information",
  "44": "Merchant Account Information",
  "45": "Merchant Account Information",
  "46": "Merchant Account Information",
  "47": "Merchant Account Information",
  "48": "Merchant Account Information",
  "49": "Merchant Account Information",
  "50": "Merchant Account Information",
  "51": "Merchant Account Information",
  "52": "Merchant Category Code",
  "53": "Transaction Currency",
  "54": "Transaction Amount",
  "55": "Tip or Convenience Indicator",
  "56": "Value of Convenience Fee (Fixed)",
  "57": "Value of Convenience Fee (%)",
  "58": "Country Code",
  "59": "Merchant Name",
  "60": "Merchant City",
  "61": "Postal Code",
  "62": "Additional Data Field",
  "63": "CRC",
  "64": "Merchant Information (Language)",
};

const QRIS_MERCHANT_SUBTAGS = {
  "00": "Globally Unique Identifier",
  "01": "Merchant PAN / ID",
  "02": "Merchant ID",
  "03": "Merchant Criteria",
};

const QRIS_ADDITIONAL_SUBTAGS = {
  "01": "Bill Number",
  "02": "Mobile Number",
  "03": "Store Label",
  "04": "Loyalty Number",
  "05": "Reference Label",
  "06": "Customer Label",
  "07": "Terminal Label",
  "08": "Purpose of Transaction",
  "09": "Additional Consumer Data Request",
};

const QRIS_LANGUAGE_SUBTAGS = {
  "00": "Language Preference",
  "01": "Merchant Name (Alt Language)",
  "02": "Merchant City (Alt Language)",
};

const CURRENCY_CODES = { "360": "IDR", "840": "USD", "702": "SGD", "458": "MYR", "764": "THB", "608": "PHP", "704": "VND" };

function getQrisTagName(tag, parentTag) {
  if (!parentTag) return QRIS_ROOT_TAGS[tag] || null;

  const parentNum = parseInt(parentTag, 10);
  if (parentNum >= 26 && parentNum <= 51) return QRIS_MERCHANT_SUBTAGS[tag] || null;
  if (parentTag === "62") return QRIS_ADDITIONAL_SUBTAGS[tag] || null;
  if (parentTag === "64") return QRIS_LANGUAGE_SUBTAGS[tag] || null;

  return null;
}

function getQrisValueAnnotation(tag, value) {
  if (tag === "01") {
    if (value === "11") return "Static";
    if (value === "12") return "Dynamic";
  }
  if (tag === "53" && CURRENCY_CODES[value]) return CURRENCY_CODES[value];
  if (tag === "55") {
    if (value === "01") return "Tip prompted";
    if (value === "02") return "Fixed fee";
    if (value === "03") return "Percentage fee";
  }
  return null;
}

// ── CRC-CCITT ───────────────────────────────────────────────────────────────

function crcCCITT(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc;
}

function validateQrisCrc(input) {
  const crcTagIdx = input.lastIndexOf("6304");
  if (crcTagIdx === -1) return { present: false };

  const payloadForCrc = input.substring(0, crcTagIdx + 4);
  const expected = crcCCITT(payloadForCrc).toString(16).toUpperCase().padStart(4, "0");
  const actual = input.substring(crcTagIdx + 4, crcTagIdx + 8).toUpperCase();

  return { present: true, valid: expected === actual, expected, actual };
}

// ── EMV QR / QRIS Parser ───────────────────────────────────────────────────

function isQrisConstructedTag(tag, depth) {
  // Only root-level tags are templates; sub-tags within templates are primitive
  if (depth > 0) return false;
  const n = parseInt(tag, 10);
  if (isNaN(n)) return false;
  if (n >= 26 && n <= 51) return true;
  if (n === 62 || n === 64) return true;
  if (n >= 80 && n <= 99) return true;
  return false;
}

function parseEmvQrNodes(text, start, end, depth, state, parentTag) {
  if (depth > 10) throw new Error("Maximum nesting depth exceeded.");

  const nodes = [];
  let cursor = start;

  while (cursor < end) {
    const remaining = end - cursor;
    if (remaining < 4) {
      if (remaining > 0) {
        throw new Error(`Incomplete TLV at position ${cursor}: need at least 4 characters for tag+length, got ${remaining}.`);
      }
      break;
    }

    const tag = text.substring(cursor, cursor + 2);
    const lenStr = text.substring(cursor + 2, cursor + 4);
    const len = parseInt(lenStr, 10);

    if (!/^\d{2}$/.test(tag)) throw new Error(`Invalid tag "${tag}" at position ${cursor}.`);
    if (!/^\d{2}$/.test(lenStr) || isNaN(len)) throw new Error(`Invalid length "${lenStr}" at position ${cursor + 2}.`);

    const valueStart = cursor + 4;
    const valueEnd = valueStart + len;

    if (valueEnd > end) {
      throw new Error(`Value for tag ${tag} at position ${cursor} exceeds input (needs ${len} chars, ${end - valueStart} available).`);
    }

    const value = text.substring(valueStart, valueEnd);
    const rowIndex = state.nextRowIndex++;
    const constructed = isQrisConstructedTag(tag, depth);
    const tagName = getQrisTagName(tag, parentTag);
    const annotation = !constructed ? getQrisValueAnnotation(tag, value) : null;

    const node = {
      rowIndex,
      depth,
      offset: cursor,
      tag,
      tagName,
      constructed,
      length: len,
      value,
      annotation,
      children: [],
    };

    state.rows.push({
      rowIndex: node.rowIndex,
      depth: node.depth,
      offset: node.offset,
      tag: node.tag,
      tagName: node.tagName,
      constructed: node.constructed,
      length: node.length,
      value: node.value,
      annotation: node.annotation,
    });

    if (constructed && len > 0) {
      node.children = parseEmvQrNodes(text, valueStart, valueEnd, depth + 1, state, tag);
    }

    nodes.push(node);
    cursor = valueEnd;
  }

  return nodes;
}

function toQrisJsonTree(nodes) {
  return nodes.map((node) => {
    const entry = { tag: node.tag };
    if (node.tagName) entry.name = node.tagName;
    entry.length = node.length;
    entry.value = node.value;
    if (node.annotation) entry.annotation = node.annotation;
    if (node.children && node.children.length > 0) entry.children = toQrisJsonTree(node.children);
    return entry;
  });
}

function parseQris(input) {
  const text = String(input || "").trim();
  if (!text) throw new Error("Input is empty.");

  const crc = validateQrisCrc(text);

  const state = { nextRowIndex: 1, rows: [] };
  const nodes = parseEmvQrNodes(text, 0, text.length, 0, state, null);
  const maxDepth = state.rows.reduce((d, r) => Math.max(d, r.depth), 0);

  return {
    format: "qris",
    nodes,
    rows: state.rows,
    jsonTree: toQrisJsonTree(nodes),
    crc,
    summary: {
      charLength: text.length,
      nodeCount: state.rows.length,
      maxDepth,
      topLevelCount: nodes.length,
    },
  };
}

// ── QRIS Sample Builder ────────────────────────────────────────────────────

function buildQrisSample() {
  // Build each tag properly with correct lengths
  const merchant26 = "0011ID.DANA.WWW" + "0118936009153000000123" + "0303UME";
  const merchant51 = "0014ID.CO.QRIS.WWW" + "0215ID1020010000001" + "0303UME";
  const additional62 = "0703A01";

  const parts = [
    "000201",
    "010211",
    "26" + String(merchant26.length).padStart(2, "0") + merchant26,
    "51" + String(merchant51.length).padStart(2, "0") + merchant51,
    "52045411",
    "5303360",
    "5802ID",
    "5909TOKO BUDI",
    "6007JAKARTA",
    "610510110",
    "62" + String(additional62.length).padStart(2, "0") + additional62,
  ];
  const body = parts.join("") + "6304";
  const crc = crcCCITT(body).toString(16).toUpperCase().padStart(4, "0");
  return body + crc;
}

// ── BER-TLV Parser (existing) ──────────────────────────────────────────────

const TAG_CLASS_LABELS = ["Universal", "Application", "Context-specific", "Private"];

function sanitizeHexInput(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";

  const cleaned = raw.replace(/0x/gi, "").replace(/[\s,:;|_-]+/g, "").replace(/[^a-fA-F0-9]/g, "");
  if (!cleaned) return "";
  if (cleaned.length % 2 !== 0) throw new Error("Hex input has odd length. Every byte must contain two hex characters.");
  return cleaned.toUpperCase();
}

function bytesToHex(bytes, separator = " ") {
  return Array.from(bytes).map((v) => v.toString(16).toUpperCase().padStart(2, "0")).join(separator);
}

function bytesFromHexInput(input) {
  const normalized = sanitizeHexInput(input);
  if (!normalized) return new Uint8Array();
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) bytes[i / 2] = parseInt(normalized.slice(i, i + 2), 16);
  return bytes;
}

function bytesFromBase64Input(input) {
  const normalized = String(input || "").replace(/\s+/g, "");
  if (!normalized) return new Uint8Array();
  try {
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch (_) {
    throw new Error("Base64 input is invalid.");
  }
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
  const printable = compact.split("").filter((c) => { const code = c.charCodeAt(0); return code >= 32 && code <= 126; }).length;
  if (printable / compact.length < 0.75) return "";
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

function parseTag(bytes, offset) {
  if (offset >= bytes.length) throw new Error("Unexpected end of input while reading tag.");
  const first = bytes[offset];
  const tagBytes = [first];
  let cursor = offset + 1;

  if ((first & 0x1f) === 0x1f) {
    let found = false;
    let guard = 0;
    while (cursor < bytes.length) {
      const next = bytes[cursor];
      tagBytes.push(next);
      cursor++;
      guard++;
      if (guard > 8) throw new Error(`Tag at offset ${offset} exceeds supported high-tag-number length.`);
      if ((next & 0x80) === 0) { found = true; break; }
    }
    if (!found) throw new Error(`Tag at offset ${offset} is truncated.`);
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
  if (offset >= bytes.length) throw new Error("Unexpected end of input while reading length.");
  const first = bytes[offset];
  if ((first & 0x80) === 0) return { length: first, lengthBytes: [first], nextOffset: offset + 1 };

  const count = first & 0x7f;
  if (count === 0) throw new Error(`Indefinite length at offset ${offset} is not supported.`);
  if (count > 6) throw new Error(`Length field at offset ${offset} is too large.`);

  const start = offset + 1;
  const end = start + count;
  if (end > bytes.length) throw new Error(`Length field at offset ${offset} is truncated.`);

  let length = 0;
  for (let i = start; i < end; i++) length = length * 256 + bytes[i];
  return { length, lengthBytes: Array.from(bytes.slice(offset, end)), nextOffset: end };
}

function parseBerNodes(bytes, start, end, depth, state) {
  if (depth > 32) throw new Error("Maximum TLV nesting depth exceeded.");
  const nodes = [];
  let cursor = start;

  while (cursor < end) {
    const currentOffset = cursor;
    const tagInfo = parseTag(bytes, cursor);
    const lengthInfo = parseLength(bytes, tagInfo.nextOffset);
    const valueStart = lengthInfo.nextOffset;
    const valueEnd = valueStart + lengthInfo.length;
    if (valueEnd > end) throw new Error(`Value at offset ${currentOffset} exceeds available input length.`);

    const valueBytes = bytes.slice(valueStart, valueEnd);
    const rawBytes = bytes.slice(currentOffset, valueEnd);
    const rowIndex = state.nextRowIndex++;

    const node = {
      rowIndex,
      depth,
      offset: currentOffset,
      tag: tagInfo.tagHex,
      tagClass: tagInfo.tagClass,
      constructed: tagInfo.constructed,
      length: lengthInfo.length,
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
      valuePreview: node.valuePreview,
      valueHex: node.valueHex,
      rawHex: node.rawHex,
    });

    if (tagInfo.constructed && lengthInfo.length > 0) {
      node.children = parseBerNodes(bytes, valueStart, valueEnd, depth + 1, state);
    }

    nodes.push(node);
    cursor = valueEnd;
  }

  return nodes;
}

function toBerJsonTree(nodes) {
  return nodes.map((n) => ({
    tag: n.tag,
    class: n.tagClass,
    constructed: n.constructed,
    length: n.length,
    offset: n.offset,
    valueHex: n.valueHex,
    preview: n.valuePreview || undefined,
    children: toBerJsonTree(n.children),
  }));
}

function parseBerTlv(input, inputMode = "hex") {
  const bytes = inputMode === "base64" ? bytesFromBase64Input(input) : bytesFromHexInput(input);
  if (!bytes || bytes.length === 0) throw new Error("Input is empty.");

  const state = { nextRowIndex: 1, rows: [] };
  const nodes = parseBerNodes(bytes, 0, bytes.length, 0, state);
  const maxDepth = state.rows.reduce((d, r) => Math.max(d, r.depth), 0);

  return {
    format: "ber-tlv",
    bytes,
    nodes,
    rows: state.rows,
    jsonTree: toBerJsonTree(nodes),
    summary: {
      byteLength: bytes.length,
      nodeCount: state.rows.length,
      maxDepth,
      topLevelCount: nodes.length,
    },
  };
}

// ── Auto-detect ─────────────────────────────────────────────────────────────

function detectFormat(input) {
  const trimmed = String(input || "").trim();
  if (!trimmed) return "qris";

  // QRIS payloads always start with "000201" (Payload Format Indicator = "01")
  if (trimmed.startsWith("000201")) return "qris";

  // If it looks like it could be base64 (has + / = and no spaces between hex pairs)
  if (/^[A-Za-z0-9+/]+=*$/.test(trimmed) && /[+/=]/.test(trimmed)) return "ber-base64";

  // If it's purely hex characters (possibly with separators)
  const hexCleaned = trimmed.replace(/0x/gi, "").replace(/[\s,:;|_-]+/g, "");
  if (/^[a-fA-F0-9]+$/.test(hexCleaned)) return "ber-hex";

  // Default to QRIS for text input
  return "qris";
}

// ── Main entry ──────────────────────────────────────────────────────────────

function parse(input, format = "auto") {
  const resolvedFormat = format === "auto" ? detectFormat(input) : format;

  if (resolvedFormat === "qris") return parseQris(input);
  if (resolvedFormat === "ber-base64") return parseBerTlv(input, "base64");
  return parseBerTlv(input, "hex");
}

export const TLVViewerService = {
  sanitizeHexInput,
  bytesFromHexInput,
  bytesToHex,
  parse,
  parseQris,
  parseBerTlv,
  detectFormat,
  validateQrisCrc,
  crcCCITT,
  buildQrisSample,
};

export { parseLength, parseTag };
