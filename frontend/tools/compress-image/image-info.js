import { MAX_FILE_SIZE, parsePng } from "./service.js";

function dimensions(width, height) {
  if (!width || !height || width > 16384 || height > 16384 || width * height > 16000000) {
    throw new Error("Choose an image under 16 megapixels with dimensions between 1 and 16,384 pixels per side.");
  }
  return { width, height };
}

function inspectJpeg(bytes, view) {
  for (let offset = 2; offset < bytes.length; ) {
    if (bytes[offset++] !== 255) throw new Error("Invalid JPEG marker.");
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 217 || marker === 218) break;
    if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
    if (offset + 2 > bytes.length) throw new Error("JPEG is truncated.");
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) throw new Error("Invalid JPEG segment length.");
    if ([192, 193, 194].includes(marker)) {
      if (length < 8 || length !== 8 + 3 * bytes[offset + 7]) throw new Error("Invalid JPEG frame header.");
      if (bytes[offset + 2] !== 8) throw new Error("Only 8-bit JPEG images are supported.");
      return { type: "image/jpeg", ...dimensions(view.getUint16(offset + 5), view.getUint16(offset + 3)) };
    }
    offset += length;
  }
  throw new Error("JPEG frame is missing or unsupported.");
}

function inspectWebp(bytes, view) {
  if (view.getUint32(4, true) !== bytes.length - 8) throw new Error("Invalid WebP container size.");
  let frame;
  let extended;
  let lossless = false;
  for (let offset = 12; offset < bytes.length; ) {
    if (offset + 8 > bytes.length) throw new Error("WebP chunk is truncated.");
    const type = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const length = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + length + (length & 1);
    if (end > bytes.length) throw new Error("WebP chunk is truncated.");
    if (type === "ANIM" || type === "ANMF") throw new Error("Animated WebP is unsupported. Choose a still image.");
    if (type === "VP8X") {
      if (length !== 10 || extended) throw new Error("Invalid WebP extended header.");
      if (bytes[start] & 2) throw new Error("Animated WebP is unsupported. Choose a still image.");
      const uint24 = (at) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
      extended = dimensions(uint24(start + 4) + 1, uint24(start + 7) + 1);
    }
    if (type === "VP8 ") {
      if (length < 10 || bytes[start] & 1 || bytes[start + 3] !== 157 || bytes[start + 4] !== 1 || bytes[start + 5] !== 42) {
        throw new Error("Invalid WebP lossy frame header.");
      }
      if (frame) throw new Error("Multiple WebP image frames are unsupported.");
      frame = dimensions(view.getUint16(start + 6, true) & 16383, view.getUint16(start + 8, true) & 16383);
    }
    if (type === "VP8L") {
      if (length < 5 || bytes[start] !== 47 || bytes[start + 4] & 224) throw new Error("Invalid WebP lossless frame header.");
      if (frame) throw new Error("Multiple WebP image frames are unsupported.");
      const packed = view.getUint32(start + 1, true);
      frame = dimensions((packed & 16383) + 1, ((packed >>> 14) & 16383) + 1);
      lossless = true;
    }
    offset = end;
  }
  if (!extended && !frame) throw new Error("WebP image header is missing.");
  if (extended && frame && (extended.width !== frame.width || extended.height !== frame.height)) {
    throw new Error("WebP frame dimensions do not match the container.");
  }
  return { type: "image/webp", ...(extended || frame), lossless };
}

// This is an allocation preflight, not proof that the image decodes successfully.
export function inspectImage(bytes) {
  if (!bytes.length || bytes.length > MAX_FILE_SIZE) throw new Error("Choose an image between 1 byte and 32 MB.");
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) {
    const png = parsePng(bytes);
    return { type: "image/png", width: png.width, height: png.height, depth: png.chunks[0].data[8] };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] === 255 && bytes[1] === 216) return inspectJpeg(bytes, view);
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  ) {
    return inspectWebp(bytes, view);
  }
  throw new Error("Choose a valid PNG, JPEG or still WebP image.");
}
