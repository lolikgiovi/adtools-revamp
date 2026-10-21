import pako from "pako";

export const MAX_FILE_SIZE = 32 * 1024 * 1024;
const MAX_DECODED_SIZE = 64 * 1024 * 1024;
const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function join(parts) {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}
export function makeChunk(type, data) {
  const raw = new Uint8Array(data.length + 12);
  const view = new DataView(raw.buffer);
  view.setUint32(0, data.length);
  raw.set(
    Array.from(type, (letter) => letter.charCodeAt(0)),
    4,
  );
  raw.set(data, 8);
  view.setUint32(raw.length - 4, crc32(raw.subarray(4, raw.length - 4)));
  return raw;
}
export function parsePng(bytes) {
  if (bytes.length > MAX_FILE_SIZE) throw new Error("PNG exceeds the 32 MB input limit.");
  if (!SIGNATURE.every((byte, i) => bytes[i] === byte)) throw new Error("Select a valid PNG image.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = [];
  let ended = false;
  let idatEnded = false;
  let hasIdat = false;
  for (let offset = 8; offset < bytes.length; ) {
    if (ended || offset + 12 > bytes.length) throw new Error("Invalid PNG chunk structure.");
    const length = view.getUint32(offset);
    const end = offset + length + 12;
    if (end > bytes.length) throw new Error("PNG is truncated.");
    const raw = bytes.subarray(offset, end);
    const type = String.fromCharCode(...raw.subarray(4, 8));
    if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type)) throw new Error("Invalid PNG chunk type.");
    if (crc32(raw.subarray(4, raw.length - 4)) !== view.getUint32(end - 4)) throw new Error("PNG checksum failed.");
    if (["acTL", "fcTL", "fdAT"].includes(type)) throw new Error("Animated PNG is not supported. Select a still PNG.");
    if (!chunks.length && type !== "IHDR") throw new Error("PNG header is missing.");
    if (type === "IHDR" && (chunks.length || length !== 13)) throw new Error("Invalid PNG header.");
    if (type[0] === type[0].toUpperCase() && !["IHDR", "PLTE", "IDAT", "IEND"].includes(type)) {
      throw new Error("Unsupported PNG critical chunk.");
    }
    if (type === "IDAT") {
      if (idatEnded) throw new Error("Invalid PNG image chunk order.");
      hasIdat = true;
    } else if (hasIdat) idatEnded = true;
    if (type === "PLTE" && (hasIdat || chunks.some((chunk) => chunk.type === "PLTE") || !length || length % 3 || length > 768)) {
      throw new Error("Invalid PNG palette.");
    }
    if (type === "IEND") {
      if (length || !hasIdat) throw new Error("PNG image data is missing.");
      ended = true;
    }
    chunks.push({ type, raw, data: raw.subarray(8, raw.length - 4) });
    offset = end;
  }
  if (!ended) throw new Error("PNG is incomplete.");
  const header = chunks[0].data;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const depth = header[8];
  const color = header[9];
  if (!width || !height || width > 16384 || height > 16384 || width * height > 16000000) {
    throw new Error("PNG exceeds the 16 megapixel or 16,384-pixel dimension limit.");
  }
  if (!DEPTHS[color]?.includes(depth) || header[10] || header[11] || header[12] > 1) {
    throw new Error("Unsupported PNG encoding.");
  }
  if (color === 3 && !chunks.some((chunk) => chunk.type === "PLTE")) throw new Error("PNG palette is missing.");
  const passes = header[12]
    ? [
        [0, 0, 8, 8],
        [4, 0, 8, 8],
        [0, 4, 4, 8],
        [2, 0, 4, 4],
        [0, 2, 2, 4],
        [1, 0, 2, 2],
        [0, 1, 1, 2],
      ]
    : [[0, 0, 1, 1]];
  const rows = passes.map(([x, y, dx, dy]) => {
    const w = Math.max(0, Math.ceil((width - x) / dx));
    const h = Math.max(0, Math.ceil((height - y) / dy));
    return { count: w ? h : 0, stride: Math.ceil((w * depth * CHANNELS[color]) / 8) + 1 };
  });
  const decodedSize = rows.reduce((size, row) => size + row.count * row.stride, 0);
  if (decodedSize > MAX_DECODED_SIZE) throw new Error("PNG exceeds the 64 MB decoded data limit.");
  return { chunks, width, height, rows, decodedSize };
}
function inflateChecked(parsed) {
  const stream = new pako.Inflate({ chunkSize: 65536 });
  const parts = [];
  let size = 0;
  stream.onData = (part) => {
    size += part.length;
    if (size > parsed.decodedSize) throw new Error("PNG image data exceeds its declared dimensions.");
    parts.push(part);
  };
  const compressed = join(parsed.chunks.filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.data));
  stream.push(compressed, true);
  if (stream.err || !stream.ended || size !== parsed.decodedSize || stream.strm.avail_in) {
    throw new Error("PNG image data is corrupt.");
  }
  const decoded = join(parts);
  let offset = 0;
  for (const row of parsed.rows) {
    for (let y = 0; y < row.count; y++, offset += row.stride) {
      if (decoded[offset] > 4) throw new Error("PNG contains an invalid pixel filter.");
    }
  }
  return decoded;
}
export function optimizePng(bytes, report = () => {}) {
  report("validation.start", { inputBytes: bytes.length });
  const parsed = parsePng(bytes);
  const chunks = {};
  let idatBytes = 0;
  for (const chunk of parsed.chunks) {
    chunks[chunk.type] ??= { count: 0, bytes: 0 };
    chunks[chunk.type].count++;
    chunks[chunk.type].bytes += chunk.raw.length;
    if (chunk.type === "IDAT") idatBytes += chunk.raw.length;
  }
  const preservedBytes = bytes.length - idatBytes;
  report("validation.complete", {
    width: parsed.width,
    height: parsed.height,
    bitDepth: parsed.chunks[0].data[8],
    colorType: parsed.chunks[0].data[9],
    interlaced: Boolean(parsed.chunks[0].data[12]),
    chunks,
    preservedBytes,
    imageDataBytes: idatBytes,
    inflatedBytes: parsed.decodedSize,
  });
  report("inflate.start", {});
  const decoded = inflateChecked(parsed);
  report("inflate.complete", { inflatedBytes: decoded.length, validFilters: true });
  // tEXt holds human-readable comments, not PNG rendering information:
  // https://www.w3.org/TR/png-3/#11tEXt. Preserve every other chunk.
  const retainedChunks = parsed.chunks.filter((chunk) => chunk.type !== "tEXt");
  const metadataRemovedBytes = chunks.tEXt?.bytes || 0;
  const retainedBytes = preservedBytes - metadataRemovedBytes;
  report("metadata.complete", {
    removedBytes: metadataRemovedBytes,
    removedChunks: chunks.tEXt ? { tEXt: chunks.tEXt } : {},
    retainedBytes,
    policy: "Remove tEXt comments only; preserve color profiles, transparency and all other chunks.",
  });
  report("compression.start", {
    optimizer: "pako 1.0.11",
    level: 9,
    strategies: ["default", "filtered", "rle"],
    refiltering: false,
    metadataRemoval: metadataRemovedBytes > 0,
    scope: "Recompresses existing filtered scanlines; does not try all possible lossless PNG encodings.",
  });
  let best = metadataRemovedBytes ? join([SIGNATURE, ...retainedChunks.map((chunk) => chunk.raw)]) : bytes;
  for (const [strategy, name] of [
    [0, "default"],
    [1, "filtered"],
    [3, "rle"],
  ]) {
    const started = performance.now();
    report("compression.attempt.start", { strategy: name, level: 9 });
    const compressed = pako.deflate(decoded, { level: 9, strategy });
    let inserted = false;
    const parts = [SIGNATURE];
    for (const chunk of retainedChunks) {
      if (chunk.type !== "IDAT") parts.push(chunk.raw);
      else if (!inserted) {
        parts.push(makeChunk("IDAT", compressed));
        inserted = true;
      }
    }
    const candidate = join(parts);
    const improved = candidate.length < best.length;
    if (improved) best = candidate;
    report("compression.attempt.complete", {
      strategy: name,
      outputBytes: candidate.length,
      compressedDataBytes: compressed.length,
      selected: improved,
      bestBytes: best.length,
      durationMs: Math.round(performance.now() - started),
    });
  }
  report("integrity.start", { outputBytes: best.length });
  // Identical filtered scanlines plus byte-identical retained non-IDAT chunks prove that
  // pixels (including 16-bit samples), palette, transparency and profiles survived.
  const output = parsePng(best);
  const verified = inflateChecked(output);
  const sourceRendering = retainedChunks.filter((chunk) => chunk.type !== "IDAT");
  const outputRendering = output.chunks.filter((chunk) => chunk.type !== "IDAT");
  const chunksPreserved =
    sourceRendering.length === outputRendering.length &&
    sourceRendering.every((chunk, index) => {
      const actual = outputRendering[index].raw;
      return chunk.raw.length === actual.length && chunk.raw.every((byte, offset) => byte === actual[offset]);
    });
  if (
    !chunksPreserved ||
    output.width !== parsed.width ||
    output.height !== parsed.height ||
    verified.length !== decoded.length ||
    !verified.every((byte, i) => byte === decoded[i])
  ) {
    throw new Error("Lossless verification failed. The original image has been preserved.");
  }
  report("integrity.verified", {
    identicalFilteredScanlines: true,
    preservedRenderingAndOtherChunks: true,
    removedTextBytes: metadataRemovedBytes,
    width: output.width,
    height: output.height,
  });
  report("result", { eligible: true, outputBytes: best.length, savedBytes: bytes.length - best.length, reason: "verified" });
  return { bytes: best, width: parsed.width, height: parsed.height, eligible: true, changed: best !== bytes, metadataRemovedBytes };
}

export function fitDimensions(width, height, maxWidth, maxHeight) {
  if (![width, height, maxWidth, maxHeight].every((value) => Number.isInteger(value) && value > 0 && value <= 16384)) {
    throw new Error("Enter whole-number dimensions between 1 and 16,384 pixels.");
  }
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
