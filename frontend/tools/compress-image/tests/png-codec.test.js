// Failures: bad PNG/CRC/zlib/APNG, source mutation, changed hidden RGB or 16-bit
// samples, dropped profiles/ancillary chunks, palette/refilter transformations,
// lost text savings, and output larger than the input. Use real Oxipng WASM.
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { initSync } from "@jsquash/oxipng/codec/pkg/squoosh_oxipng.js";
import { optimizePng } from "../png-codec.js";
import { parsePng, makeChunk } from "../service.js";
import { PRESETS } from "../config.js";

beforeAll(() => {
  initSync(readFileSync("node_modules/@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm"));
});
function fixture(width = 32, height = 32, depth = 8) {
  const data = depth === 16 ? new Uint16Array(width * height * 4) : new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i++) data[i] = i % 4 === 3 ? (i % 8 === 3 ? 0 : 127) : depth === 16 ? 0x1234 + (i % 17) : 80 + (i % 17);
  return new Uint8Array(PNG.sync.write({ width, height, data }, { bitDepth: depth, inputHasAlpha: true, deflateLevel: 0 }));
}
function insert(bytes, chunk) {
  return new Uint8Array(Buffer.concat([bytes.slice(0, 33), chunk, bytes.slice(33)]));
}
function decoded(bytes) {
  return PNG.sync.read(Buffer.from(bytes), { skipRescale: true });
}

describe("Oxipng lossless encoding", () => {
  it.each(Object.keys(PRESETS))("preserves full samples and hidden RGB with the %s preset", async (preset) => {
    for (const depth of [8, 16]) {
      const source = fixture(32, 32, depth);
      const original = source.slice();
      const result = await optimizePng(source, PRESETS[preset].png);
      expect(result.bytes.length).toBeLessThan(source.length);
      expect(source).toEqual(original);
      expect(decoded(result.bytes).data).toEqual(decoded(source).data);
      expect([result.width, result.height]).toEqual([32, 32]);
    }
  });
  it("preserves gamma and unknown metadata while removing tEXt comments", async () => {
    let source = insert(fixture(), makeChunk("gAMA", new Uint8Array([0, 0, 177, 143])));
    source = insert(source, makeChunk("vpAg", new Uint8Array([1, 2, 3])));
    source = insert(source, makeChunk("tEXt", new Uint8Array([65, 0, 66])));
    const result = await optimizePng(source);
    const chunks = parsePng(result.bytes).chunks;
    expect(result.metadataRemovedBytes).toBe(15);
    expect(chunks.some((chunk) => chunk.type === "tEXt")).toBe(false);
    for (const type of ["gAMA", "vpAg"]) {
      expect(chunks.find((chunk) => chunk.type === type).raw).toEqual(parsePng(source).chunks.find((chunk) => chunk.type === type).raw);
    }
    expect(decoded(result.bytes).data).toEqual(decoded(source).data);
  });
  it("does not inflate an already optimized source", async () => {
    const first = await optimizePng(fixture());
    const next = await optimizePng(first.bytes);
    expect(next.bytes.length).toBeLessThanOrEqual(first.bytes.length);
  });
  it("reports the actual encoder, options and verification without image data", async () => {
    const logs = [];
    await optimizePng(fixture(), PRESETS.small.png, (stage, details) => logs.push({ stage, details }));
    expect(logs.find((entry) => entry.stage === "Optimizing").details).toMatchObject({ codec: "Oxipng", level: 4 });
    expect(logs.some((entry) => entry.stage === "Verifying")).toBe(true);
    expect(JSON.stringify(logs)).not.toContain("data:image");
  });
  it("rejects invalid streams, checksums, animations and trailing data", async () => {
    const source = fixture();
    const corrupt = source.slice();
    corrupt[40] ^= 1;
    await expect(optimizePng(corrupt)).rejects.toThrow();
    await expect(optimizePng(new Uint8Array([...source, 0]))).rejects.toThrow();
    await expect(optimizePng(insert(source, makeChunk("acTL", new Uint8Array(8))))).rejects.toThrow(/animated/i);
    const parsed = parsePng(source);
    const broken = new Uint8Array(
      Buffer.concat([
        source.slice(0, 8),
        ...parsed.chunks.map((chunk) => (chunk.type === "IDAT" ? makeChunk("IDAT", new Uint8Array([1, 2, 3])) : chunk.raw)),
      ]),
    );
    await expect(optimizePng(broken)).rejects.toThrow();
  });
});
