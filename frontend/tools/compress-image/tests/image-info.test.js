// Preflight failures: spoofed MIME/extensions, empty/oversized input, missing JPEG
// frame or invalid segment lengths, zero/oversized dimensions, malformed RIFF
// sizes/chunks, APNG, and WebP animation. Actual decoding remains mandatory later.
import { PNG } from "pngjs";
import { inspectImage } from "../image-info.js";
import { MAX_FILE_SIZE, makeChunk } from "../service.js";

function jpeg(width = 100, height = 50) {
  return new Uint8Array([255, 216, 255, 192, 0, 11, 8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 17, 0, 255, 217]);
}
function webp(width = 100, height = 50, animation = false) {
  const bytes = new Uint8Array(30);
  bytes.set(new TextEncoder().encode("RIFF"));
  const view = new DataView(bytes.buffer);
  view.setUint32(4, bytes.length - 8, true);
  bytes.set(new TextEncoder().encode("WEBPVP8X"), 8);
  view.setUint32(16, 10, true);
  bytes[20] = animation ? 2 : 0;
  for (let i = 0; i < 3; i++) {
    bytes[24 + i] = (width - 1) >> (8 * i);
    bytes[27 + i] = (height - 1) >> (8 * i);
  }
  return bytes;
}
function png() {
  return new Uint8Array(PNG.sync.write(new PNG({ width: 3, height: 2 })));
}

describe("image header preflight", () => {
  it("detects format and dimensions from bytes", () => {
    expect(inspectImage(png())).toMatchObject({ type: "image/png", width: 3, height: 2, depth: 8 });
    expect(inspectImage(jpeg())).toMatchObject({ type: "image/jpeg", width: 100, height: 50 });
    expect(inspectImage(webp())).toMatchObject({ type: "image/webp", width: 100, height: 50 });
  });
  it("rejects empty input, unknown formats and oversized files", () => {
    expect(() => inspectImage(new Uint8Array())).toThrow();
    expect(() => inspectImage(new TextEncoder().encode("not an image"))).toThrow();
    expect(() => inspectImage(new Uint8Array(MAX_FILE_SIZE + 1))).toThrow(/32 MB/);
  });
  it("rejects APNG and animated WebP before decoding", () => {
    const source = png();
    const animated = new Uint8Array(Buffer.concat([source.slice(0, 33), makeChunk("acTL", new Uint8Array(8)), source.slice(33)]));
    expect(() => inspectImage(animated)).toThrow(/animated/i);
    expect(() => inspectImage(webp(100, 50, true))).toThrow(/animated/i);
  });
  it("rejects unsafe dimensions before allocating decoded pixels", () => {
    expect(() => inspectImage(jpeg(0, 50))).toThrow(/dimensions/i);
    expect(() => inspectImage(jpeg(16385, 50))).toThrow(/dimension/i);
    expect(() => inspectImage(webp(5000, 5000))).toThrow(/megapixel/i);
  });
  it("rejects invalid JPEG segment lengths and missing frames", () => {
    expect(() => inspectImage(new Uint8Array([255, 216, 255, 224, 255, 255]))).toThrow(/JPEG/);
    expect(() => inspectImage(new Uint8Array([255, 216, 255, 224, 0, 1]))).toThrow(/JPEG/);
    expect(() => inspectImage(new Uint8Array([255, 216, 255, 217]))).toThrow(/JPEG/);
  });
  it("rejects RIFF size mismatch, truncated and invalid chunks", () => {
    const sizeMismatch = webp();
    sizeMismatch[4]++;
    expect(() => inspectImage(sizeMismatch)).toThrow(/WebP/);
    const truncated = webp();
    truncated[16] = 100;
    expect(() => inspectImage(truncated)).toThrow(/WebP/);
    const invalidExtended = webp();
    invalidExtended[16] = 9;
    expect(() => inspectImage(invalidExtended)).toThrow(/WebP/);
  });
  it("extracts simple lossy and lossless WebP frame dimensions", () => {
    const lossless = new Uint8Array(26);
    lossless.set(new TextEncoder().encode("RIFF"));
    new DataView(lossless.buffer).setUint32(4, 18, true);
    lossless.set(new TextEncoder().encode("WEBPVP8L"), 8);
    new DataView(lossless.buffer).setUint32(16, 5, true);
    lossless[20] = 47;
    new DataView(lossless.buffer).setUint32(21, 99 | (49 << 14), true);
    expect(inspectImage(lossless)).toMatchObject({ width: 100, height: 50, lossless: true });
    const lossy = new Uint8Array(30);
    lossy.set(lossless.slice(0, 12));
    new DataView(lossy.buffer).setUint32(4, 22, true);
    lossy.set(new TextEncoder().encode("VP8 "), 12);
    new DataView(lossy.buffer).setUint32(16, 10, true);
    lossy.set([157, 1, 42, 100, 0, 50, 0], 23);
    expect(inspectImage(lossy)).toMatchObject({ width: 100, height: 50, lossless: false });
  });
});
