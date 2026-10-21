// Failure cases: corrupt signatures/CRC/zlib, APNG, oversized dimensions/inflation,
// changed pixels/profiles, larger output, and the strict 300,000-byte boundary.
import { PNG } from "pngjs";
import { optimizePng, parsePng, makeChunk, fitDimensions } from "../service.js";

function fixture(width = 320, height = 320, noise = false) {
  const png = new PNG({ width, height });
  let seed = 42;
  for (let i = 0; i < png.data.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    png.data[i] = noise ? seed >>> 24 : i % 4 === 3 ? 127 : 80;
  }
  return new Uint8Array(PNG.sync.write(png, { deflateLevel: 0 }));
}
function insert(bytes, chunk) {
  return new Uint8Array(Buffer.concat([bytes.slice(0, 33), chunk, bytes.slice(33)]));
}

describe("lossless PNG compression", () => {
  it("optimizes even small PNGs while preserving decoded pixels", () => {
    const source = fixture(32, 32);
    const result = optimizePng(source);
    expect(source.length).toBeLessThan(100000);
    expect(result.bytes.length).toBeLessThan(source.length);
    expect(PNG.sync.read(Buffer.from(result.bytes)).data).toEqual(PNG.sync.read(Buffer.from(source)).data);
    expect(result.eligible).toBe(true);
  });
  it("reduces a large PNG while preserving decoded RGBA, dimensions, and color metadata", () => {
    const source = insert(fixture(), makeChunk("gAMA", new Uint8Array([0, 0, 177, 143])));
    const result = optimizePng(source);
    expect(result.eligible).toBe(true);
    expect(result.bytes.length).toBeLessThan(300000);
    const before = PNG.sync.read(Buffer.from(source));
    const after = PNG.sync.read(Buffer.from(result.bytes));
    expect([after.width, after.height]).toEqual([before.width, before.height]);
    expect(after.data).toEqual(before.data);
    expect(parsePng(result.bytes).chunks.find((chunk) => chunk.type === "gAMA").raw).toEqual(
      parsePng(source).chunks.find((chunk) => chunk.type === "gAMA").raw,
    );
  });
  it("keeps an incompressible PNG blocked and never returns a larger result", () => {
    const source = fixture(320, 320, true);
    const result = optimizePng(source);
    expect(result.eligible).toBe(false);
    expect(result.bytes.length).toBeLessThanOrEqual(source.length);
    expect(PNG.sync.read(Buffer.from(result.bytes)).data).toEqual(PNG.sync.read(Buffer.from(source)).data);
  });
  it("does not accept an output equal to 300,000 bytes", () => {
    const source = optimizePng(fixture()).bytes;
    const padded = insert(source, makeChunk("vpAg", new Uint8Array(300000 - source.length - 12)));
    expect(padded.length).toBe(300000);
    expect(optimizePng(padded).eligible).toBe(false);
  });
  it("rejects animation, bad CRC, trailing data, missing IDAT and invalid signatures", () => {
    const source = fixture(2, 2);
    expect(() => optimizePng(insert(source, makeChunk("acTL", new Uint8Array(8))))).toThrow(/animated/i);
    const corrupt = source.slice();
    corrupt[40] ^= 1;
    expect(() => optimizePng(corrupt)).toThrow();
    expect(() => optimizePng(new Uint8Array([...source, 0]))).toThrow();
    expect(() => optimizePng(new Uint8Array(40))).toThrow(/PNG/i);
    expect(() => optimizePng(new Uint8Array([...source.slice(0, 33), ...makeChunk("IEND", new Uint8Array())]))).toThrow();
  });
  it("rejects invalid filtered data even below the size limit", () => {
    const source = fixture(2, 2);
    const parsed = parsePng(source);
    const chunks = parsed.chunks.map((chunk) => (chunk.type === "IDAT" ? makeChunk("IDAT", new Uint8Array([1, 2, 3])) : chunk.raw));
    const broken = new Uint8Array(Buffer.concat([source.slice(0, 8), ...chunks]));
    expect(() => optimizePng(broken)).toThrow();
  });
});

// Diagnostic failure cases: no explanation for size rejection, hidden metadata
// overhead, misleading claims that DEFLATE exhausted every lossless encoding.
describe("compression diagnostics", () => {
  it("reports each candidate and the exact size-limit decision", () => {
    const logs = [];
    const source = fixture(320, 320, true);
    const result = optimizePng(source, (stage, details) => logs.push({ stage, details }));
    const attempts = logs.filter((log) => log.stage === "compression.attempt.complete");
    expect(attempts).toHaveLength(3);
    expect(attempts.map((log) => log.details.strategy)).toEqual(["default", "filtered", "rle"]);
    expect(attempts.every((log) => Number.isInteger(log.details.outputBytes))).toBe(true);
    expect(logs.find((log) => log.stage === "integrity.verified")).toBeDefined();
    expect(logs.at(-1)).toMatchObject({
      stage: "result",
      details: {
        eligible: false,
        outputBytes: result.bytes.length,
        maxOutputBytes: 299999,
        bytesOverLimit: result.bytes.length - 299999,
        reason: "target-not-reached",
      },
    });
    expect(logs.find((log) => log.stage === "compression.start").details).toMatchObject({
      optimizer: "pako 1.0.11",
      refiltering: false,
      metadataRemoval: false,
    });
  });
  it("exposes preserved chunk sizes without logging chunk contents", () => {
    const logs = [];
    const source = insert(fixture(2, 2), makeChunk("vpAg", new Uint8Array(300000)));
    optimizePng(source, (stage, details) => logs.push({ stage, details }));
    const validation = logs.find((log) => log.stage === "validation.complete").details;
    expect(validation.chunks.vpAg).toEqual({ count: 1, bytes: 300012 });
    expect(validation.preservedBytes).toBeGreaterThan(300000);
    expect(logs.at(-1).details.reason).toBe("preserved-chunks-exceed-limit");
    expect(JSON.stringify(logs)).not.toContain("data:image");
  });
  it("runs compression attempts for images already below the size limit", () => {
    const logs = [];
    optimizePng(fixture(2, 2), (stage, details) => logs.push({ stage, details }));
    expect(logs.filter((log) => log.stage === "compression.attempt.complete")).toHaveLength(3);
    expect(logs.at(-1)).toMatchObject({ stage: "result", details: { reason: "target-reached", eligible: true } });
  });
});

// Regression cases: large text metadata blocks a small image; stripping must
// preserve all rendering chunks, original bytes, and the small-file bypass.
describe("non-rendering text metadata optimization", () => {
  it("removes large tEXt comments and preserves decoded RGBA and every other chunk", () => {
    const logs = [];
    const small = insert(fixture(2, 2), makeChunk("gAMA", new Uint8Array([0, 0, 177, 143])));
    const comment = new Uint8Array(343409).fill(65);
    comment.set(new TextEncoder().encode("Comment"));
    comment[7] = 0;
    const source = insert(small, makeChunk("tEXt", comment));
    const original = source.slice();
    const result = optimizePng(source, (stage, details) => logs.push({ stage, details }));
    expect(result.eligible).toBe(true);
    expect(result.bytes.length).toBeLessThan(300000);
    expect(result.metadataRemovedBytes).toBe(343421);
    expect(source).toEqual(original);
    expect(PNG.sync.read(Buffer.from(result.bytes)).data).toEqual(PNG.sync.read(Buffer.from(source)).data);
    const before = parsePng(source).chunks.filter((chunk) => !["tEXt", "IDAT"].includes(chunk.type));
    const after = parsePng(result.bytes).chunks.filter((chunk) => chunk.type !== "IDAT");
    expect(after.map((chunk) => chunk.raw)).toEqual(before.map((chunk) => chunk.raw));
    expect(logs.find((log) => log.stage === "metadata.complete").details).toMatchObject({
      removedBytes: 343421,
      removedChunks: { tEXt: { count: 1, bytes: 343421 } },
    });
    expect(logs.at(-1).details.reason).toBe("target-reached");
  });
  it("removes text metadata from small PNGs too", () => {
    const source = insert(fixture(2, 2), makeChunk("tEXt", new Uint8Array([65, 0, 66])));
    const result = optimizePng(source);
    expect(result.bytes.length).toBeLessThan(source.length);
    expect(result.changed).toBe(true);
    expect(result.metadataRemovedBytes).toBe(15);
  });
});

// Resize failures: stretched/cropped aspect ratios, upscaling small originals,
// invalid/fractional dimensions, and portrait/landscape bounds being swapped.
describe("mobile resize dimensions", () => {
  it.each([
    [4000, 3000, 1920, 1920, 1920, 1440],
    [3000, 4000, 1920, 1920, 1440, 1920],
    [800, 500, 1920, 1920, 800, 500],
    [4000, 3000, 1080, 1920, 1080, 810],
    [3000, 4000, 1920, 1080, 810, 1080],
  ])("fits %s by %s within %s by %s", (w, h, mw, mh, width, height) => {
    expect(fitDimensions(w, h, mw, mh)).toEqual({ width, height });
  });
  it.each([0, -1, NaN, Infinity, 1.5, 20000])("rejects an invalid bound: %s", (bound) => {
    expect(() => fitDimensions(800, 500, bound, 1920)).toThrow();
  });
});
