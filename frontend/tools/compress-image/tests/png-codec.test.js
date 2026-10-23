// Failures: bad PNG/CRC/zlib/APNG, source mutation, changed hidden RGB or 16-bit
// samples, dropped profiles/ancillary chunks, palette/refilter transformations,
// lost text savings, and output larger than the input. Use real Oxipng WASM.
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { PNG } from "pngjs";
import { initSync } from "@jsquash/oxipng/codec/pkg/squoosh_oxipng.js";
import { optimizePng, encodePng, estimateLosslessBytes } from "../png-codec.js";
import { parsePng, makeChunk, verifyPngMetadata } from "../service.js";
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
const PROFILE = new Uint8Array(Array.from({ length: 600 }, (_, i) => (i * 7) % 251));
function iccp(name, profile = PROFILE, { method = 0, compressed = deflateSync(profile, { level: 0 }) } = {}) {
  return makeChunk("iCCP", new Uint8Array([...new TextEncoder().encode(name), 0, method, ...compressed]));
}
function chunk(bytes, type) {
  return parsePng(bytes).chunks.find((entry) => entry.type === type);
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
  // ICC failures: Oxipng recompressing/renaming an unchanged profile is rejected
  // (the bug), while a changed, dropped, added, corrupt or non-zlib profile is accepted.
  it("accepts an ICC profile that Oxipng recompresses or renames without changing it", async () => {
    const source = insert(fixture(), iccp("sRGB IEC61966-2.1"));
    const result = await optimizePng(source);
    expect(chunk(result.bytes, "iCCP")).toBeDefined();
    expect(decoded(result.bytes).data).toEqual(decoded(source).data);
  });
  it("rejects ICC profile changes", () => {
    const source = parsePng(insert(fixture(), iccp("Display")));
    const verify = (bytes) => () => verifyPngMetadata(source, parsePng(bytes));
    const changed = PROFILE.slice();
    changed[100] ^= 1;
    expect(verify(insert(fixture(), iccp("Display", PROFILE, { compressed: deflateSync(PROFILE, { level: 9 }) })))).not.toThrow();
    expect(verify(insert(fixture(), iccp("icc")))).not.toThrow();
    expect(verify(insert(fixture(), iccp("Display", changed)))).toThrow(/metadata changed/);
    expect(verify(fixture())).toThrow(/metadata changed/);
    expect(verify(insert(fixture(), iccp("Display", PROFILE, { compressed: new Uint8Array([1, 2, 3]) })))).toThrow(/metadata changed/);
    expect(verify(insert(fixture(), iccp("Display", PROFILE, { method: 1 })))).toThrow(/metadata changed/);
    expect(() => verifyPngMetadata(parsePng(fixture()), source)).toThrow(/metadata changed/);
  });
  it("rejects an ICC profile that decompresses beyond 4 MB", () => {
    const bomb = new Uint8Array(5 * 1024 * 1024);
    const bytes = insert(fixture(), iccp("Display", bomb, { compressed: deflateSync(bomb, { level: 9 }) }));
    expect(() => verifyPngMetadata(parsePng(bytes), parsePng(bytes))).toThrow(/metadata changed/);
  });
  // Validation failures: the source inflated more than once, a codec output that is
  // never fully validated, or a caller's parsed source ignored.
  const validations = async (run) => {
    const logs = [];
    await run((stage, details) => logs.push({ stage, details }));
    return logs.filter((entry) => entry.stage === "png.validated").map((entry) => entry.details.role);
  };
  it("validates the source and the Oxipng output once each", async () => {
    expect(await validations((report) => optimizePng(fixture(), PRESETS.balanced.png, report))).toEqual(["source", "output"]);
  });
  it("reuses a parsed source instead of validating it again", async () => {
    const source = fixture();
    const roles = await validations((report) => optimizePng(source, PRESETS.balanced.png, report, parsePng(source)));
    expect(roles).toEqual(["output"]);
  });
  it("validates resized Oxipng output once", async () => {
    const image = { data: new Uint8ClampedArray(decoded(fixture()).data), width: 32, height: 32 };
    expect(await validations((report) => encodePng(image, PRESETS.balanced.png, report))).toEqual(["output"]);
  });
  it("does not inflate an already optimized source", async () => {
    const first = await optimizePng(fixture());
    const next = await optimizePng(first.bytes);
    expect(next.bytes.length).toBeLessThanOrEqual(first.bytes.length);
  });
  it("reports the actual encoder, options and verification without image data", async () => {
    const logs = [];
    await optimizePng(fixture(), PRESETS.small.png, (stage, details) => logs.push({ stage, details }));
    expect(logs.find((entry) => entry.stage === "Optimizing").details).toMatchObject({ codec: "Oxipng", level: 2 });
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

// Estimate failures: lossless coming in far below the estimate (a skip would then be
// wrong), non-deterministic results, and failing instead of declining without
// CompressionStream.
describe("lossless size estimate", () => {
  const image = (width, height, pixel) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
    return { data, width, height };
  };
  let seed = 7;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) >>> 24;
  const images = {
    gradient: image(320, 200, (x, y) => [x % 256, y % 256, 120, 255]),
    noisyGradient: image(320, 200, (x, y) => [(x + (random() >> 4)) % 256, (y + (random() >> 4)) % 256, 90, 200]),
    noise: image(160, 160, () => [random(), random(), random(), 255]),
    flat: image(320, 200, () => [30, 60, 90, 255]),
    fourColors: image(
      320,
      200,
      (x, y) =>
        [
          [255, 0, 0, 255],
          [0, 255, 0, 255],
          [0, 0, 255, 255],
          [0, 0, 0, 0],
        ][((x >> 4) + (y >> 4)) % 4],
    ),
    grayNoise: image(160, 160, () => {
      const value = random();
      return [value, value, value, 128 + (random() >> 1)];
    }),
    opaqueNoise: image(160, 160, () => [random(), random(), random(), 255]),
    opaqueGradient: image(320, 200, (x, y) => [x % 256, y % 256, (x + y) % 256, 255]),
  };
  // Oxipng stores these as a palette or grayscale, far below an RGBA estimate, so the estimate
  // must decline rather than allow a skip.
  it.each(["flat", "fourColors", "grayNoise"])("declines for images Oxipng can store as palette or grayscale: %s", async (name) => {
    expect(await estimateLosslessBytes(images[name])).toBeNull();
  });
  it.each(["gradient", "noisyGradient", "noise", "opaqueNoise", "opaqueGradient"])(
    "stays within the skip margin of real Oxipng output: %s",
    async (name) => {
      const estimate = await estimateLosslessBytes(images[name]);
      const lossless = (await encodePng(images[name], PRESETS.balanced.png, () => {})).bytes.length;
      expect(lossless).toBeGreaterThan(0.6 * estimate);
    },
  );
  it("is deterministic", async () => {
    expect(await estimateLosslessBytes(images.noisyGradient)).toBe(await estimateLosslessBytes(images.noisyGradient));
  });
  it("declines without CompressionStream", async () => {
    const native = globalThis.CompressionStream;
    globalThis.CompressionStream = undefined;
    try {
      expect(await estimateLosslessBytes(images.flat)).toBeNull();
    } finally {
      globalThis.CompressionStream = native;
    }
  });
});
